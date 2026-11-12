/* ============================================================
   FIREBASE INIT (same project/database as the main Donor List app)
   ============================================================ */
const _cfgB64 = "eyJhcGlLZXkiOiJBSXphU3lDSDVvSEZ6dUM2cWJBalY3Y2dIV1FvcEh0R0ExODBqaVUiLCJhdXRoRG9tYWluIjoiYmxvb2QtbmV0d29yay1hODUxYi5maXJlYmFzZWFwcC5jb20iLCJkYXRhYmFzZVVSTCI6Imh0dHBzOi8vYmxvb2QtbmV0d29yay1hODUxYi1kZWZhdWx0LXJ0ZGIuYXNpYS1zb3V0aGVhc3QxLmZpcmViYXNlZGF0YWJhc2UuYXBwIiwicHJvamVjdElkIjoiYmxvb2QtbmV0d29yay1hODUxYiIsInN0b3JhZ2VCdWNrZXQiOiJibG9vZC1uZXR3b3JrLWE4NTFiLmZpcmViYXNlc3RvcmFnZS5hcHAiLCJtZXNzYWdpbmdTZW5kZXJJZCI6IjcxMzA1ODg2ODQyNCIsImFwcElkIjoiMTo3MTMwNTg4Njg0MjQ6d2ViOjU5OTQ0MWM5NTQ0OTBjYTVjYjE5ZmQiLCJtZWFzdXJlbWVudElkIjoiRy1TTDE2VEJKMkZRIn0=";
const firebaseConfig = JSON.parse(atob(_cfgB64));

let firebaseAvailable = false;
let db, auth, donorsRef, appConfigRef, landingPageRef, visitorRef, newsLikesRef;

/* ============================================================
   LOCAL CACHE (shares keys with the main app where relevant,
   so the same browser stays in sync instantly offline)
   ============================================================ */
const CACHE_APPCONFIG_KEY = "blood_donor_appconfig_cache";
const CACHE_LANDING_KEY = "blood_donor_landing_cache";
const CACHE_DONORS_KEY = "blood_stats_cache_v2"; // siteStats summary (donors list itself is admin-only)
const CACHE_VISITOR_KEY = "blood_donor_views_cache"; // মোট ভিউ (অ্যাডমিন প্যানেলের সাথে একই সংখ্যা)

function readCache(key, fallback) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch (err) { return fallback; }
}
function writeCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* ignore */ }
}

/* ============================================================
   BANDWIDTH-SAVING FETCH CACHE
   A persistent .on("value") listener re-downloads the *entire*
   node from Firebase on first load AND again on every future
   write to that node, for as long as the tab stays open. Since
   donors / appConfig / landingPage rarely change minute to
   minute, we fetch them once (.once, not .on) and skip the
   network call altogether on repeat visits within FETCH_TTL_MS —
   the page already renders instantly from the cached copy in
   localStorage, so nothing is lost visually, only the re-download.
   ============================================================ */
const FETCH_TTL_MS = 10 * 60 * 1000; // 10 minutes
function lastFetchedAt(key) {
  try { return parseInt(localStorage.getItem(key + "_fetchedAt"), 10) || 0; } catch (err) { return 0; }
}
function markFetchedNow(key) {
  try { localStorage.setItem(key + "_fetchedAt", String(Date.now())); } catch (err) { /* ignore */ }
}
function isCacheFresh(key) {
  return (Date.now() - lastFetchedAt(key)) < FETCH_TTL_MS;
}

/* ============================================================
   SKELETON LOADING  (আগের পূর্ণ-স্ক্রিন লোডিং স্ক্রিনের বদলে)
   প্রথমবার (কোনো লোকাল ক্যাশ নেই) সাইটে ঢুকলে লেখা ও কার্ডের জায়গায়
   ঝিকমিক স্কেলিটন দেখায়; Firebase-এর প্রথম ডেটা এলেই আসল কনটেন্ট বসে।
   ক্যাশ থাকলে (রিপিট ভিজিট) কনটেন্ট সঙ্গে সঙ্গে ক্যাশ থেকে আসে, তাই
   স্কেলিটন লাগেই না।
   ============================================================ */
let skeletonDone = false; // নিচে landingReady-এর সঙ্গে মেলানো হয়
function isSkeletonLoading() { return !skeletonDone; }
function endSkeleton(rerender) {
  if (skeletonDone) return;
  skeletonDone = true;
  document.documentElement.classList.remove("skelMode");
  if (rerender) { try { renderLanding(); } catch (e) { /* ignore */ } }
}
function skelLine(w) { return '<div class="skel skelLine" style="width:' + w + '"></div>'; }
const SKELETON_TPL = {
  record: () => '<div class="recordCard recordCardSkel" aria-hidden="true"><div class="recordCardPhotoWrap skel"></div><div class="recordCardBody">' + skelLine("82%") + skelLine("56%") + '</div></div>',
  donation: () => '<div class="donationItem skel" aria-hidden="true"></div>',
  galleryAll: () => '<div class="galleryAllItem skel" aria-hidden="true"></div>',
  team: () => '<div class="tcCard tcCardSkel" aria-hidden="true"><div class="tcPhoto skel"></div><div class="tcBody">' + skelLine("70%") + skelLine("45%") + '</div></div>',
  partner: () => '<div class="partnerCard partnerCardSkel" aria-hidden="true"><div class="partnerLogoWrap skel"></div>' + skelLine("70%") + '</div>',
  news: () => '<div class="newsCard newsCardSkel" aria-hidden="true"><div class="skel skelNewsImg"></div><div class="skelNewsBody">' + skelLine("34%") + skelLine("92%") + skelLine("74%") + '</div></div>'
};
function skeletonFill(container, kind, n) {
  if (!container || container.getAttribute("data-skel") === kind) return;
  container.setAttribute("data-skel", kind);
  container.innerHTML = new Array(n).fill(SKELETON_TPL[kind]()).join("");
}

/* ============================================================
   LAZY LOAD — সাইটের সব ছবি (স্ট্যাটিক + পরে JS দিয়ে বসানো)
   স্ক্রিনের কাছাকাছি এলে তবেই ডাউনলোড হয়।
   ============================================================ */
(function lazyAllImages() {
  const mark = img => {
    if (!img.hasAttribute("loading")) img.loading = "lazy";
    if (!img.hasAttribute("decoding")) img.decoding = "async";
  };
  document.querySelectorAll("img").forEach(mark);
  if (!("MutationObserver" in window)) return;
  new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.tagName === "IMG") mark(n);
      else if (n.querySelectorAll) n.querySelectorAll("img").forEach(mark);
    }));
  }).observe(document.documentElement, { childList: true, subtree: true });
})();

/* ============================================================
   DEFAULT LANDING PAGE CONTENT
   ============================================================ */
const DEFAULT_LANDING = {
  siteName: "Blood Network Baraikhali",
  siteVersion: "11-Nov-2026",
  importantNotice: "",
  importantNoticeActive: false,
  heroTitle: "প্রতিটি ফোঁটা রক্ত, একটি নতুন জীবনের গল্প",
  heroSubtitle: "জরুরি মুহূর্তে নির্ভরযোগ্য রক্তদাতা খুঁজে পাওয়ার সবচেয়ে সহজ উপায়। বিনামূল্যে ও স্বেচ্ছাসেবী রক্তদাতাদের নেটওয়ার্কে আজই যুক্ত হোন, জীবন বাঁচাতে হাত বাড়ান।",
  aboutTitle: "আমরা কারা",
  aboutText: "Blood Network Baraikhali একটি স্বেচ্ছাসেবী রক্তদাতা প্ল্যাটফর্ম, যেখানে যাচাইকৃত রক্তদাতাদের তথ্য একত্রে রাখা হয় যাতে জরুরি প্রয়োজনে দ্রুত সঠিক রক্তদাতার সাথে যোগাযোগ করা যায়। আমাদের লক্ষ্য — প্রতিটি এলাকায় যেন রক্তের অভাবে কোনো জীবন ঝুঁকিতে না পড়ে।",
  aboutImage: "",
  impactImage: "",
  donationPhotos: [],
  donationRecords: [],
  heroBackgroundImage: "",
  ctaHeading: "আজই একজন রক্তদাতা হয়ে অন্য কারো জীবনে আশার আলো হয়ে উঠুন",
  feature1Title: "যাচাইকৃত রক্তদাতা",
  feature1Text: "প্রতিটি রক্তদাতার তথ্য যাচাই করে তালিকাভুক্ত করা হয়, যাতে জরুরি সময়ে নির্ভরযোগ্য যোগাযোগ নিশ্চিত হয়।",
  feature2Title: "জরুরি সাড়া",
  feature2Text: "ব্লাড গ্রুপ ও এলাকা অনুযায়ী মুহূর্তেই কাছাকাছি রক্তদাতা খুঁজে বের করা যায়, একদম ফ্রি-তে।",
  feature3Title: "সহজ ও বিনামূল্যে",
  feature3Text: "কোনো সাইনআপ ফি বা লুকানো খরচ নেই — যে কেউ রক্তদাতা হতে বা খুঁজতে পারেন সম্পূর্ণ বিনামূল্যে।",
  team: [],
  faqs: [],
  partners: [],
  news: [],
  hospitals: [],
  sponsors: [],
  navOrder: [],
  homeOrder: [],
  secTitle_gallery: "সাম্প্রতিক রক্তদান",
  secSub_gallery: "",
  secTitle_features: "আমরা যা নিশ্চিত করি",
  secSub_features: "",
  secTitle_team: "যাদের নিয়ে আমরা",
  secSub_team: "স্বেচ্ছাসেবার মানসিকতা নিয়ে যারা প্রতিদিন জীবন বাঁচাতে কাজ করছেন",
  secTitle_faq: "প্রশ্ন ও উত্তর",
  secSub_faq: "",
  secTitle_partners: "আমাদের সহযোগী প্রতিষ্ঠান",
  secSub_partners: "",
  sponsorHeading: "আমাদের স্পনসর",
  sponsorSubtitle: "যাদের সহযোগিতায় আমরা মানুষের পাশে দাঁড়াতে পারছি",
  processStepsRecipient: [
    { id: "r1", title: "রক্তের গ্রুপ ও এলাকা লিখে সার্চ করুন", text: "ওয়েবসাইটে গিয়ে প্রয়োজনীয় রক্তের গ্রুপ এবং আপনার এলাকা নির্বাচন করুন — কোনো সাইনআপ ছাড়াই।" },
    { id: "r2", title: "তালিকা থেকে রক্তদাতা বাছাই করুন", text: "যাচাইকৃত ও সক্রিয় রক্তদাতাদের একটি তালিকা মুহূর্তেই দেখতে পাবেন।" },
    { id: "r3", title: "সরাসরি কল করুন", text: "তালিকায় দেওয়া নাম্বারে সরাসরি ফোন করে যোগাযোগ করুন — মাঝে কোনো মধ্যস্থতাকারী নেই।" },
    { id: "r4", title: "সময় ও স্থান ঠিক করুন", text: "রক্তদাতার সাথে কথা বলে সুবিধাজনক সময় ও হাসপাতাল/স্থান ঠিক করে নিন।" },
    { id: "r5", title: "রক্ত সংগ্রহ করুন, জীবন বাঁচান", text: "নির্ধারিত সময়ে রক্তদাতা এসে রক্ত দেন — এবং একটি জীবন বেঁচে যায়।" }
  ],
  processStepsDonor: [
    { id: "d1", title: "নিবন্ধন করুন", text: "নাম, রক্তের গ্রুপ, ফোন নাম্বার ও এলাকা দিয়ে নেটওয়ার্কে যুক্ত হোন — সম্পূর্ণ বিনামূল্যে।" },
    { id: "d2", title: "প্রোফাইল যাচাই হয়", text: "আমাদের টিম আপনার তথ্য যাচাই করে রক্তদাতার তালিকায় যুক্ত করে দেবে।" },
    { id: "d3", title: "প্রয়োজনে কল পাবেন", text: "কারো রক্তের প্রয়োজন হলে এবং আপনার গ্রুপ মিললে সরাসরি ফোন কল পাবেন।" },
    { id: "d4", title: "স্বেচ্ছায় সিদ্ধান্ত নিন", text: "আপনার সুবিধা ও শারীরিক সুস্থতা বিবেচনা করে রক্ত দেওয়ার সিদ্ধান্ত সম্পূর্ণ আপনার নিজের।" },
    { id: "d5", title: "রক্তদান করুন, বদলে দিন একটি জীবন", text: "একটি রক্তদান একাধিক মানুষের জীবন বাঁচাতে সাহায্য করতে পারে।" }
  ],
  contactName1: "নাম ১",
  contactPhone1: "01XXXXXXXXX",
  contactPhoto1: "", contactWhatsapp1: "", contactMessenger1: "",
  contactName2: "নাম ২",
  contactPhone2: "01XXXXXXXXX",
  contactPhoto2: "", contactWhatsapp2: "", contactMessenger2: "",
  contactName3: "নাম ৩",
  contactPhone3: "01XXXXXXXXX",
  contactPhoto3: "", contactWhatsapp3: "", contactMessenger3: "",
  contactEmail: "contact@bloodnetworkbaraikhali.org",
  contactAddress: "ঢাকা, বাংলাদেশ",
  footerFacebook: "facebook.com/bloodnetworkbaraikhali",
  footerDevName1: "IBRAHIM KHALIL",
  footerDevName2: "SAMIN KHAN"
};

let landingData = Object.assign({}, DEFAULT_LANDING, readCache(CACHE_LANDING_KEY, {}));
/* Loading / error state for the news pages: "ready" once real data (cache or
   the first Firebase snapshot) is available; "failed" if Firebase can't load. */
let landingReady = Object.keys(readCache(CACHE_LANDING_KEY, {})).length > 0;
let landingLoadFailed = false;
skeletonDone = landingReady;
if (skeletonDone) document.documentElement.classList.remove("skelMode");
else setTimeout(() => endSkeleton(true), 9000); // ইন্টারনেট খুব ধীর/বন্ধ হলেও স্কেলিটন আটকে থাকবে না
let appConfigData = readCache(CACHE_APPCONFIG_KEY, { logoImage: "" });
let isAdmin = false;

/* ============================================================
   PERMANENT EMPTY-LIST HANDLING
   Firebase Realtime Database silently deletes a path when it is set to
   an empty array (or empty object) — there is no way to store "this
   list has zero items" as a real array. That meant deleting the very
   last team member / FAQ / partner / donation photo looked like it
   worked, but the next page load (a fresh Firebase snapshot with no
   "team" key at all) fell back to DEFAULT_LANDING's sample content.
   Fix: whenever a list becomes empty, we write an explicit marker
   object { _empty: true } instead of []. That marker is a real,
   non-empty node, so Firebase keeps it permanently — on every future
   load (including a hard page reload) it reads back as "empty",
   never as "missing", and never falls back to the sample content.
   ============================================================ */
const EMPTY_LIST_MARKER = { _empty: true };
function toArrayField(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v && typeof v === "object") {
    if (v._empty === true) return [];
    return Object.values(v).filter(Boolean);
  }
  return [];
}
function syncListToFirebase(fieldName, arr) {
  if (!firebaseAvailable || !landingPageRef) return;
  const toWrite = (Array.isArray(arr) && arr.length === 0) ? EMPTY_LIST_MARKER : arr;
  landingPageRef.child(fieldName).set(toWrite).catch(err => console.log(fieldName + " sync failed:", err));
}

/* Firebase (and old localStorage caches) may hand back plain objects
   instead of arrays for donationPhotos/team/faqs/partners — this keeps
   all four fields as real arrays no matter where the data came from,
   including the { _empty: true } marker above. */
function normalizeLandingData() {
  landingData.donationPhotos = toArrayField(landingData.donationPhotos);
  landingData.donationRecords = toArrayField(landingData.donationRecords);
  landingData.team = toArrayField(landingData.team);
  landingData.faqs = toArrayField(landingData.faqs);
  landingData.partners = toArrayField(landingData.partners);
  landingData.news = toArrayField(landingData.news);
  landingData.hospitals = toArrayField(landingData.hospitals);
  landingData.sponsors = toArrayField(landingData.sponsors);
  landingData.navOrder = toArrayField(landingData.navOrder);
  landingData.homeOrder = toArrayField(landingData.homeOrder);
  landingData.processStepsRecipient = toArrayField(landingData.processStepsRecipient);
  landingData.processStepsDonor = toArrayField(landingData.processStepsDonor);
}
normalizeLandingData();

/* Shows/hides a .dataSection based on whether it has content — public
   visitors never see an empty section, admins always see it (with an
   empty-state + add button) so they can populate it. */
function setSectionVisible(sectionEl, hasData) {
  if (!sectionEl) return;
  sectionEl.classList.toggle("sectionHidden", !hasData);
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* Escapes text so it's safe to interpolate inside an HTML attribute
   (e.g. alt="..."). Without this, a name/text field containing a
   double-quote could break out of the attribute and inject arbitrary
   HTML/JS (stored XSS) when the template string is set via innerHTML. */
function escAttr(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* Sequential donation-search ID — generated by the system, never typed by the admin.
   Starts at 0001 and always continues from the highest existing number
   (so it keeps counting up even if an earlier record was deleted). */
/* Card numbers are now "ABN-0001" style (permanent Donor ID) or legacy "0001".
   This reads the trailing digits of either. */
/* সর্বশেষ রক্তদানের তারিখ অনুযায়ী পুরনো → নতুন ক্রম (তারিখ সমান হলে ID ক্রমে) */
function donationDateCompare(a, b) {
  const ta = new Date(a && a.date).getTime(), tb = new Date(b && b.date).getTime();
  const va = isNaN(ta) ? -Infinity : ta, vb = isNaN(tb) ? -Infinity : tb;
  if (va !== vb) return va < vb ? -1 : 1;
  return donationNoNum(a && a.donationNo) - donationNoNum(b && b.donationNo);
}
/* কত তম ডোনার: সর্বশেষ রক্তদানের তারিখ অনুযায়ী সবচেয়ে পুরনো = ১, সবচেয়ে নতুন = সর্বশেষ নাম্বার */
function donorSerialNo(record) {
  const recs = ((landingData && landingData.donationRecords) || []).filter(r => r);
  if (!record) return 0;
  const sorted = recs.slice().sort(donationDateCompare);
  const idx = sorted.findIndex(r => r === record || (r.id && r.id === record.id) ||
    (donationNoNum(r.donationNo) && donationNoNum(r.donationNo) === donationNoNum(record.donationNo)));
  return idx < 0 ? 0 : idx + 1;
}
function donationNoNum(no) { const m = String(no || "").match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; }
/* Finds a card by Donor ID ("ABN-0001"), plain number ("1" / "0001"), or an old
   legacy number that was merged into the donor's single card. */
function findRecordByNo(q) {
  q = String(q || "").trim().toLowerCase();
  if (!q) return null;
  const recs = landingData.donationRecords || [];
  let f = recs.find(r => (r.donationNo || "").trim().toLowerCase() === q);
  if (f) return f;
  f = recs.find(r => (r.legacyNos || []).some(x => String(x).trim().toLowerCase() === q));
  if (f) return f;
  if (/^\d+$/.test(q)) {
    const padded = "abn-" + q.padStart(4, "0");
    f = recs.find(r => (r.donationNo || "").trim().toLowerCase() === padded);
  }
  return f || null;
}
function genDonationNo() {
  let maxNo = 0;
  landingData.donationRecords.forEach(r => {
    const n = donationNoNum(r.donationNo);
    if (!isNaN(n) && n > maxNo) maxNo = n;
  });
  return String(maxNo + 1).padStart(4, "0");
}

/* Bengali word-ordinals for "কতবারের মতো" (1st, 2nd, 3rd... time) */
const BN_ORDINALS = [
  "", "প্রথম", "দ্বিতীয়", "তৃতীয়", "চতুর্থ", "পঞ্চম", "ষষ্ঠ", "সপ্তম", "অষ্টম", "নবম", "দশম",
  "একাদশ", "দ্বাদশ", "ত্রয়োদশ", "চতুর্দশ", "পঞ্চদশ", "ষোড়শ", "সপ্তদশ", "অষ্টাদশ", "ঊনবিংশ", "বিংশ"
];
function ordinalBn(n) {
  n = parseInt(n, 10) || 1;
  if (n >= 1 && n < BN_ORDINALS.length) return BN_ORDINALS[n];
  return toBengaliDigits(n) + "তম";
}

/* Short numeral-style Bengali ordinals for badges/pills — ১ম, ২য়, ৩য়, ৪র্থ... */
const BN_ORDINAL_SUFFIX = ["", "ম", "য়", "য়", "র্থ", "ম", "ষ্ঠ", "ম", "ম", "ম", "ম"];
function ordinalShortBn(n) {
  n = parseInt(n, 10) || 1;
  if (n >= 1 && n <= 10) return toBengaliDigits(n) + BN_ORDINAL_SUFFIX[n];
  return toBengaliDigits(n) + "তম";
}

/* Composes the fixed announcement text — only name, visit count, blood group and
   hospital come from the admin; everything else is the same every time. */
function buildDonationMessage(r) {
  const network = (landingData.siteName || "ব্লাড নেটওয়ার্ক").trim();
  if (window.I18N && I18N.lang === "en") {
    const n = parseInt(r.visitCount, 10) || 1;
    const sfx = (n % 100 >= 11 && n % 100 <= 13) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
    return [
      (r.name || "").trim() + " has donated blood (" + (r.bloodGroup || "") + ") for the " + n + sfx + " time",
      "at " + (r.hospitalName || "").trim() + ".",
      "",
      "With endless love from " + network + ". 🤝🖤",
      "",
      "Please keep our brother/sister in your prayers.",
      "❤️ Donate Blood • Save Lives",
      "🌍 Together in the service of humanity"
    ].join("\n");
  }
  return [
    (r.name || "").trim(),
    ordinalBn(r.visitCount) + "বারের মতো",
    "(" + (r.bloodGroup || "") + ") লাল ভালোবাসা দান করলেন",
    (r.hospitalName || "").trim() + " এ।",
    "",
    network + " এর পক্ষ থেকে অবিরাম ভালোবাসা রইলো। 🤝🖤",
    "",
    "ভাই/বোনের জন্য সবাই দোয়া করবেন।",
    "❤️ রক্ত দিন • জীবন বাঁচান",
    "🌍 মানবতার সেবায় আমরা একসাথে"
  ].join("\n");
}

/* ============================================================
   GOOGLE DRIVE IMAGE LOADING — RELIABILITY FIX
   Google's classic "drive.google.com/uc?export=view&id=..." share
   link is well known to fail intermittently — some browsers/networks
   (especially on mobile data, or after Google's periodic rate limits)
   block it or get redirected to a warning page instead of the image.
   Every image is now loaded through a small fallback chain: try the
   more reliable googleusercontent thumbnail host first, then the
   Drive "thumbnail" endpoint, then the original URL as a last resort.
   A skeleton shimmer shows the whole time an image is in flight.
   ============================================================ */
function extractDriveFileId(url) {
  if (!url) return null;
  let m = url.match(/\/d\/([a-zA-Z0-9_-]{15,})/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
  if (m) return m[1];
  return null;
}
function driveUrlCandidates(url) {
  const id = extractDriveFileId(url);
  if (!id) return [url]; // not a recognizable Drive link (e.g. base64 data URL) — use as-is
  return [
    "https://lh3.googleusercontent.com/d/" + id + "=w1600",
    "https://drive.google.com/thumbnail?id=" + id + "&sz=w1600",
    url
  ];
}

/* Loads an <img> with skeleton shimmer + automatic fallback across
   URL formats. targetEl (defaults to imgEl) gets "loadingImg" /
   "imgLoadFailed" classes toggled so CSS can show/hide the shimmer
   and any placeholder icon. */
/* ---- website logo shown on the top-left corner of donor photos ---- */
function donorLogoSrc() {
  return (appConfigData && appConfigData.logoImage && appConfigData.logoImage.trim()) ? appConfigData.logoImage : "fav.jpeg";
}
const DONOR_LOGO_HTML = '<img class="donorPhotoLogo" alt="" aria-hidden="true" draggable="false">';
function syncDonorLogos(root) {
  const scope = root || document;
  const src = donorLogoSrc();
  scope.querySelectorAll(".donorPhotoLogo").forEach(function (el) {
    if (el.getAttribute("data-logo-src") === src) return;
    el.setAttribute("data-logo-src", src);
    loadImageWithFallback(el, src, el);
  });
}

function loadImageWithFallback(imgEl, rawUrl, targetEl) {
  const target = targetEl || imgEl;
  if (!imgEl) return;
  if (!rawUrl) {
    imgEl.removeAttribute("src");
    target.classList.remove("loadingImg", "imgLoadFailed");
    return;
  }
  /* Native lazy-loading: the browser only fetches these once the
     element is near the viewport, so donor photos further down the
     donation gallery / records grid / team / news / partner rows
     don't compete with above-the-fold content for bandwidth. Safe
     to set unconditionally — if the element is already visible
     (e.g. the hero brand logo) the browser loads it immediately
     anyway. */
  imgEl.loading = "lazy";
  imgEl.decoding = "async";
  const candidates = driveUrlCandidates(rawUrl);
  target.classList.add("loadingImg");
  target.classList.remove("imgLoadFailed");
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) {
      target.classList.remove("loadingImg");
      target.classList.add("imgLoadFailed");
      return;
    }
    const url = candidates[i++];
    imgEl.onerror = tryNext;
    imgEl.onload = () => {
      target.classList.remove("loadingImg", "imgLoadFailed");
    };
    imgEl.src = url;
  };
  tryNext();
}

/* Same fallback chain, for elements shown via CSS background-image
   (hero section, CTA band) instead of an <img> tag. */
function loadBackgroundWithFallback(el, rawUrl, hasImageClass, lazy) {
  if (!el) return;
  if (!rawUrl) {
    el.style.backgroundImage = "";
    el.classList.remove(hasImageClass, "loadingImg", "imgLoadFailed");
    return;
  }
  const candidates = driveUrlCandidates(rawUrl);
  el.classList.add("loadingImg");
  el.classList.remove("imgLoadFailed");
  const startLoad = () => {
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        el.classList.remove("loadingImg");
        el.classList.add("imgLoadFailed");
        return;
      }
      const url = candidates[i++];
      const probe = new Image();
      probe.onload = () => {
        el.style.backgroundImage = "url('" + url + "')";
        el.classList.add(hasImageClass);
        el.classList.remove("loadingImg", "imgLoadFailed");
      };
      probe.onerror = tryNext;
      probe.src = url;
    };
    tryNext();
  };

  /* CSS background-images aren't covered by the browser's native
     "loading=lazy" (that only applies to <img> elements), so for
     sections that sit well below the fold (e.g. the CTA band) we
     defer the actual network request ourselves with an
     IntersectionObserver until the element is about to scroll into
     view. The hero background (lazy=false/omitted) stays eager
     since it's the very first thing visitors see (LCP). */
  if (lazy && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          io.disconnect();
          startLoad();
        }
      });
    }, { rootMargin: "300px 0px" });
    io.observe(el);
  } else {
    startLoad();
  }
}

/* ============================================================
   RENDER
   ============================================================ */
const HOME_GALLERY_LIMIT = 10;   // হোম পেজে সর্বশেষ ১০টি ছবি
const GALLERY_PER_PAGE = 20;     // "সব ছবি" পেজে প্রতি পেজে ২০টি
const galleryPageState = { page: 1 };

function renderDonationGallery() {
  renderGalleryAll();
  const grid = document.getElementById("donationGrid");
  if (!grid) return;
  const seeAll = document.getElementById("donationSeeAllWrap");
  if (seeAll) seeAll.style.display = (!isSkeletonLoading() && landingData.donationPhotos.length > HOME_GALLERY_LIMIT) ? "" : "none";
  if (isSkeletonLoading()) { skeletonFill(grid, "donation", 8); return; }
  if (!landingData.donationPhotos.length) {
    grid.innerHTML = '<div class="donationEmptyState"><i class="fa-solid fa-images" aria-hidden="true"></i><span>এখনও কোনো ছবি যোগ করা হয়নি</span></div>';
    return;
  }
  const homePhotos = landingData.donationPhotos.slice(0, HOME_GALLERY_LIMIT);
  grid.removeAttribute("data-skel");
  grid.innerHTML = homePhotos.map(p => (
    '<div class="donationItem" data-donation-id="' + p.id + '">' +
      '<div class="imgSkeleton" aria-hidden="true"></div>' +
      '<img class="donationImg" alt="সাম্প্রতিক রক্তদান">' + DONOR_LOGO_HTML +
      '<span class="donationFailMark" aria-hidden="true"><i class="fa-solid fa-image"></i></span>' +
      '<button type="button" class="imgEditBtn" data-img-key="donation:' + p.id + '"><i class="fa-solid fa-camera" aria-hidden="true"></i></button>' +
      '<button type="button" class="imgRemoveBtn" data-img-key="donation:' + p.id + '" title="ছবি মুছুন"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
    '</div>'
  )).join("");
  homePhotos.forEach(p => {
    const item = grid.querySelector('.donationItem[data-donation-id="' + p.id + '"]');
    if (!item) return;
    loadImageWithFallback(item.querySelector(".donationImg"), p.src, item);
  });
  syncDonorLogos(grid);
}

/* ============================================================
   সব ছবি পেজ (#gallery) — প্রতি পেজে ২০টি ছবি, আগের/পরের বাটন সহ
   ============================================================ */
function renderGalleryAll() {
  const grid = document.getElementById("galleryAllGrid");
  if (!grid) return;
  const empty = document.getElementById("galleryAllEmpty");
  const pager = document.getElementById("galleryAllPager");
  if (isSkeletonLoading()) {
    if (empty) empty.style.display = "none";
    if (pager) pager.innerHTML = "";
    skeletonFill(grid, "galleryAll", 8);
    return;
  }
  const all = landingData.donationPhotos || [];
  grid.removeAttribute("data-skel");
  if (!all.length) {
    grid.innerHTML = "";
    if (pager) pager.innerHTML = "";
    if (empty) empty.style.display = "flex";
    return;
  }
  if (empty) empty.style.display = "none";
  const totalPages = Math.max(1, Math.ceil(all.length / GALLERY_PER_PAGE));
  if (galleryPageState.page > totalPages) galleryPageState.page = totalPages;
  if (galleryPageState.page < 1) galleryPageState.page = 1;
  const page = galleryPageState.page;
  const items = all.slice((page - 1) * GALLERY_PER_PAGE, page * GALLERY_PER_PAGE);
  grid.innerHTML = items.map(p => (
    '<div class="galleryAllItem" data-gallery-id="' + p.id + '">' +
      '<div class="imgSkeleton" aria-hidden="true"></div>' +
      '<img class="donationImg" alt="রক্তদানের ছবি">' + DONOR_LOGO_HTML +
      '<span class="donationFailMark" aria-hidden="true"><i class="fa-solid fa-image"></i></span>' +
    '</div>'
  )).join("");
  items.forEach(p => {
    const item = grid.querySelector('.galleryAllItem[data-gallery-id="' + p.id + '"]');
    if (item) loadImageWithFallback(item.querySelector(".donationImg"), p.src, item);
  });
  syncDonorLogos(grid);
  if (pager) {
    if (totalPages <= 1) { pager.innerHTML = ""; }
    else {
      pager.innerHTML =
        '<button type="button" class="pgBtn pgNav" data-gpage="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + ' aria-label="আগের পেজ"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>আগের</span></button>' +
        '<button type="button" class="pgBtn pgNav" data-gpage="' + (page + 1) + '"' + (page >= totalPages ? " disabled" : "") + ' aria-label="পরের পেজ"><span>পরের</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>' +
        '<div class="pgInfo">পেজ ' + toBengaliDigits(page) + ' / ' + toBengaliDigits(totalPages) + ' · মোট ' + toBengaliDigits(all.length) + 'টি ছবি</div>';
    }
  }
}

(function initGalleryAllPager() {
  const pager = document.getElementById("galleryAllPager");
  if (!pager) return;
  pager.addEventListener("click", e => {
    const b = e.target.closest(".pgBtn");
    if (!b || b.disabled) return;
    const p = parseInt(b.getAttribute("data-gpage"), 10);
    if (!p) return;
    galleryPageState.page = p;
    renderGalleryAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();

const DONATION_BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/* ============================================================
   সকল রক্তদান রেকর্ড — কার্ড গ্রিড (রুট পেজ #donations)
   একই landingData.donationRecords ব্যবহার করে, যা ID সার্চ বক্স ও
   এডমিন প্যানেলের "ডোনেশন রেকর্ড" ম্যানেজারও ব্যবহার করে — তাই আলাদা
   কোনো Firebase রিড লাগে না, সবসময় সিঙ্কে থাকে।
   ============================================================ */
const recordsFilterState = { q: "", bg: "" };

function recordDateBn(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  if (window.I18N && I18N.lang === "en") return I18N.fmtDate(d, "short");
  const months = ["জানু", "ফেব্রু", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্ট", "অক্টো", "নভে", "ডিসে"];
  return toBengaliDigits(d.getDate()) + " " + months[d.getMonth()] + ", " + toBengaliDigits(d.getFullYear());
}

function recordCardTemplate(r) {
  const showPhoto = !r.hidePhoto && r.image;
  const placeholderIcon = r.hidePhoto ? "fa-eye-slash" : "fa-user";
  const dateBn = recordDateBn(r.date);
  return (
    '<button type="button" class="recordCard" data-record-id="' + r.id + '">' +
      '<div class="recordCardPhotoWrap' + (showPhoto ? "" : " placeholderMode") + '">' +
        '<div class="imgSkeleton" aria-hidden="true"></div>' +
        (showPhoto ? '<img class="recordCardImg" alt="' + escAttr(r.name) + '">' + DONOR_LOGO_HTML : "") +
        '<span class="recordCardPlaceholder"><i class="fa-solid ' + placeholderIcon + '" aria-hidden="true"></i></span>' +
        '<span class="recordCardNo"><i class="fa-solid fa-hashtag" aria-hidden="true"></i>' + escAttr(r.donationNo || "") + '</span>' +
        '<span class="recordCardBg">' + escAttr(r.bloodGroup || "—") + '</span>' +
        '<span class="recordCardName">' + escAttr(r.name || "") + '</span>' +
      '</div>' +
      '<div class="recordCardBody">' +
        '<div class="recordCardHospital"><i class="fa-solid fa-hospital" aria-hidden="true"></i>' + escAttr(r.hospitalName || "—") + '</div>' +
        '<div class="recordCardMetaRow">' +
          (dateBn ? '<span><i class="fa-regular fa-calendar" aria-hidden="true"></i>' + escAttr(dateBn) + '</span>' : "<span></span>") +
          '<span><i class="fa-solid fa-droplet" aria-hidden="true"></i>' + ordinalShortBn(r.visitCount || 1) + ' বার</span>' +
        '</div>' +
      '</div>' +
    '</button>'
  );
}

/* ============================================================
   পেজিনেশন — প্রতি পেজে প্রায় ৩০০vh (স্ক্রিনের উচ্চতার ৩ গুণ) জায়গায়
   যত রেকর্ড ধরে ততটাই থাকে, বাকিগুলো পরের পেজে যায়।
   কলামের সংখ্যা ও কার্ডের উচ্চতা একটি অদৃশ্য নমুনা-কার্ড মেপে বের করা হয়,
   তাই মোবাইল/ডেস্কটপ/স্ক্রিন ঘোরানো সবকিছুতেই নিজে থেকে ঠিক হয়।
   ============================================================ */
const RECORDS_PAGE_VH = 3; // ৩ × স্ক্রিনের উচ্চতা (300vh)
const recordsPageState = { page: 1, perPage: 0, key: "" };

function recordsProbePerPage(grid, sampleRecord) {
  const vh = window.innerHeight || document.documentElement.clientHeight || 800;
  const gw = grid.clientWidth;
  const w = gw > 0 ? gw : Math.max(240, Math.min(1120, (document.documentElement.clientWidth || window.innerWidth || 360) - 20));
  const key = Math.round(w) + "x" + vh;
  if (recordsPageState.key === key && recordsPageState.perPage) return recordsPageState.perPage;

  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;width:" + w + "px;";
  probe.innerHTML = '<div class="recordsGrid">' + recordCardTemplate(sampleRecord) + '</div>';
  document.body.appendChild(probe);
  const g = probe.firstElementChild;
  const card = g.firstElementChild;
  const cs = getComputedStyle(g);
  const cols = Math.max(1, cs.gridTemplateColumns.split(" ").filter(Boolean).length);
  const gap = parseFloat(cs.rowGap) || 0;
  const cardH = card ? card.getBoundingClientRect().height : 0;
  probe.remove();

  let perPage = 12;
  if (cardH > 0) {
    const rows = Math.max(1, Math.floor((vh * RECORDS_PAGE_VH + gap) / (cardH + gap)));
    perPage = cols * rows;
  }
  recordsPageState.key = key;
  recordsPageState.perPage = perPage;
  return perPage;
}

function renderRecordsPager(pager, page, totalPages, total) {
  if (!pager) return;
  if (totalPages <= 1) { pager.innerHTML = ""; return; }
  const set = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) { set.add(2); set.add(3); }
  if (page >= totalPages - 2) { set.add(totalPages - 1); set.add(totalPages - 2); }
  const list = Array.from(set).filter(p => p >= 1 && p <= totalPages).sort((x, y) => x - y);
  let html = '<button type="button" class="pgBtn pgNav" data-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + ' aria-label="আগের পেজ"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>আগের</span></button>';
  let prev = 0;
  list.forEach(p => {
    if (prev && p - prev > 1) html += '<span class="pgDots" aria-hidden="true">…</span>';
    html += '<button type="button" class="pgBtn pgNum' + (p === page ? " active" : "") + '" data-page="' + p + '"' + (p === page ? ' aria-current="page"' : "") + '>' + toBengaliDigits(p) + '</button>';
    prev = p;
  });
  html += '<button type="button" class="pgBtn pgNav" data-page="' + (page + 1) + '"' + (page >= totalPages ? " disabled" : "") + ' aria-label="পরের পেজ"><span>পরের</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
  html += '<div class="pgInfo">পেজ ' + toBengaliDigits(page) + ' / ' + toBengaliDigits(totalPages) + ' · মোট ' + toBengaliDigits(total) + 'টি রেকর্ড</div>';
  pager.innerHTML = html;
}

function renderRecordsGrid() {
  const grid = document.getElementById("recordsGrid");
  if (!grid) return;
  const emptyState = document.getElementById("recordsEmptyState");
  const pager = document.getElementById("recordsPager");

  /* প্রথম ডেটা আসার আগে: স্কেলিটন কার্ড */
  if (isSkeletonLoading()) {
    if (emptyState) emptyState.style.display = "none";
    if (pager) pager.innerHTML = "";
    skeletonFill(grid, "record", 8);
    return;
  }

  /* সর্বশেষ রক্তদানের তারিখ অনুযায়ী — সবচেয়ে নতুন আগে */
  const all = (landingData.donationRecords || []).slice().sort((a, b) => donationDateCompare(b, a));
  const q = recordsFilterState.q.trim().toLowerCase();
  const bg = recordsFilterState.bg;
  const filtered = all.filter(r => {
    if (bg && (r.bloodGroup || "") !== bg) return false;
    if (!q) return true;
    return (
      (r.name || "").toLowerCase().includes(q) ||
      (r.donationNo || "").toLowerCase().includes(q) ||
      (r.hospitalName || "").toLowerCase().includes(q)
    );
  });

  grid.removeAttribute("data-skel");
  if (!filtered.length) {
    grid.innerHTML = "";
    if (pager) pager.innerHTML = "";
    if (emptyState) {
      emptyState.style.display = "flex";
      const span = emptyState.querySelector("span");
      if (span) span.textContent = all.length ? "এই খোঁজে কোনো রেকর্ড পাওয়া যায়নি" : "এখনও কোনো রেকর্ড যোগ করা হয়নি";
    }
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  /* প্রতি পেজে কয়টি রেকর্ড (≈৩০০vh) */
  const prevPerPage = recordsPageState.perPage;
  const perPage = recordsProbePerPage(grid, filtered[0]);
  if (prevPerPage && prevPerPage !== perPage) {
    /* স্ক্রিনের মাপ বদলালে, যে রেকর্ড দেখছিলেন সেটি যে পেজে পড়ে সেই পেজেই থাকুন */
    recordsPageState.page = Math.floor(((recordsPageState.page - 1) * prevPerPage) / perPage) + 1;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (recordsPageState.page > totalPages) recordsPageState.page = totalPages;
  if (recordsPageState.page < 1) recordsPageState.page = 1;

  const start = (recordsPageState.page - 1) * perPage;
  const pageItems = filtered.slice(start, start + perPage);
  grid.innerHTML = pageItems.map(recordCardTemplate).join("");
  pageItems.forEach(r => {
    const card = grid.querySelector('.recordCard[data-record-id="' + r.id + '"]');
    if (!card) return;
    const img = card.querySelector(".recordCardImg");
    if (img) loadImageWithFallback(img, r.image, card.querySelector(".recordCardPhotoWrap"));
  });
  syncDonorLogos(grid);
  renderRecordsPager(pager, recordsPageState.page, totalPages, filtered.length);
}

(function initRecordsGridPage() {
  const grid = document.getElementById("recordsGrid");
  if (!grid) return;
  const searchInput = document.getElementById("recordsSearchInput");
  const bgFilter = document.getElementById("recordsBgFilter");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      recordsFilterState.q = searchInput.value || "";
      recordsPageState.page = 1;
      renderRecordsGrid();
    });
  }
  if (bgFilter) {
    bgFilter.addEventListener("change", () => {
      recordsFilterState.bg = bgFilter.value || "";
      recordsPageState.page = 1;
      renderRecordsGrid();
    });
  }
  /* পেজ বাটনে ক্লিক */
  const pager = document.getElementById("recordsPager");
  if (pager) {
    pager.addEventListener("click", e => {
      const b = e.target.closest(".pgBtn");
      if (!b || b.disabled) return;
      const p = parseInt(b.getAttribute("data-page"), 10);
      if (!p) return;
      recordsPageState.page = p;
      renderRecordsGrid();
      const tb = document.querySelector("#route-donations .recordsToolbar") || grid;
      const top = tb.getBoundingClientRect().top + window.pageYOffset - 76;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  }
  /* স্ক্রিনের মাপ বদলালে (ফোন ঘোরানো, উইন্ডো বড়-ছোট) পেজের হিসাব নতুন করে */
  let lastW = window.innerWidth, lastH = window.innerHeight, rt = null;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const w = window.innerWidth, h = window.innerHeight;
      if (w === lastW && Math.abs(h - lastH) < 150) return; // মোবাইলে ঠিকানা-বার ওঠানামা উপেক্ষা
      lastW = w; lastH = h;
      renderRecordsGrid();
    }, 250);
  });
  /* রেকর্ড পেজটি প্রথমবার দেখানো হলে (display:none → দৃশ্যমান) সঠিক মাপে আবার হিসাব */
  if ("ResizeObserver" in window) {
    let lastGW = -1, ro = null;
    new ResizeObserver(() => {
      const gw = grid.clientWidth;
      if (gw === lastGW) return;
      lastGW = gw;
      clearTimeout(ro);
      ro = setTimeout(renderRecordsGrid, 80);
    }).observe(grid);
  }
  grid.addEventListener("click", e => {
    const card = e.target.closest(".recordCard");
    if (!card) return;
    const id = card.getAttribute("data-record-id");
    const record = (landingData.donationRecords || []).find(rec => rec.id === id);
    if (record && typeof window.renderDonationResult === "function") {
      window.renderDonationResult(record);
    }
  });
})();

/* ============================================================
   টিম — নতুন ডিজাইন: বড় ছবির উপরে নাম ও পদবি (গ্রেডিয়েন্ট ওভারলে),
   নিচে সংক্ষিপ্ত পরিচিতি + কল / ফেসবুক বাটন। ক্রম এডমিন প্যানেল থেকে ঠিক করা হয়।
   ============================================================ */
function teamCardTemplate(m) {
  const fb = safeHttpsUrl(m.facebook);
  const phoneRaw = String(m.phone || "").trim();
  const phone = phoneRaw.replace(/[^0-9+]/g, "");
  const bio = (m.bio || "").trim();
  const role = (m.role || "").trim();
  const contact =
    (phone ? '<a class="tcLink" href="tel:' + escAttr(phone) + '" aria-label="কল করুন"><i class="fa-solid fa-phone" aria-hidden="true"></i></a>' : "") +
    (fb ? '<a class="tcLink tcLinkFb" href="' + escAttr(fb) + '" target="_blank" rel="noopener noreferrer" aria-label="ফেসবুক"><i class="fa-brands fa-facebook-f" aria-hidden="true"></i></a>' : "");
  return (
    '<article class="tcCard" data-team-id="' + escAttr(m.id) + '">' +
      '<div class="tcPhoto placeholderMode">' +
        '<div class="imgSkeleton" aria-hidden="true"></div>' +
        '<img class="tcImg" alt="' + escAttr(m.name) + '">' +
        '<span class="tcPlaceholder"><i class="fa-solid fa-user" aria-hidden="true"></i></span>' +
      '</div>' +
      '<div class="tcBody">' +
        '<h3 class="tcName">' + escAttr(m.name || "") + '</h3>' +
        (role ? '<span class="tcRole" data-text="' + escAttr(role) + '"><span class="tcRoleText">' + escAttr(role) + '</span></span>' : "") +
        (bio ? '<p class="tcBio">' + escAttr(bio) + '</p>' : "") +
        (contact ? '<div class="tcContact">' + contact + '</div>' : "") +
      '</div>' +
    '</article>'
  );
}

/* মোবাইলে টিমের কার্ড ছোট (৩ জন এক সারিতে) — ট্যাপ করলে পুরো তথ্য নিচ থেকে উঠে আসে */
function closeTeamSheet() {
  const sh = document.getElementById("teamSheet");
  if (sh) { sh.classList.remove("open"); document.body.classList.remove("tsLock"); }
}
function openTeamSheet(id) {
  const m = (landingData.team || []).find(x => String(x.id) === String(id));
  if (!m) return;
  let sh = document.getElementById("teamSheet");
  if (!sh) {
    sh = document.createElement("div");
    sh.id = "teamSheet";
    sh.className = "teamSheet";
    sh.innerHTML = '<div class="tsBackdrop" data-ts-close></div><div class="tsPanel" role="dialog" aria-modal="true" aria-label="টিম সদস্যের তথ্য"><span class="tsGrab" aria-hidden="true"></span><button type="button" class="tsClose" data-ts-close aria-label="বন্ধ করুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button><div class="tsContent"></div></div>';
    document.body.appendChild(sh);
    sh.addEventListener("click", e => { if (e.target.closest("[data-ts-close]")) closeTeamSheet(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeTeamSheet(); });
  }
  const fb = safeHttpsUrl(m.facebook);
  const phoneRaw = String(m.phone || "").trim();
  const phone = phoneRaw.replace(/[^0-9+]/g, "");
  const box = sh.querySelector(".tsContent");
  box.innerHTML =
    '<div class="tsHead"><div class="tsPhoto placeholderMode"><div class="imgSkeleton" aria-hidden="true"></div><img alt="' + escAttr(m.name) + '"><span class="tsPh"><i class="fa-solid fa-user" aria-hidden="true"></i></span></div>' +
    '<div class="tsHeadText">' + (m.role ? '<span class="tsRole">' + escAttr(m.role) + '</span>' : "") + '<h3 class="tsName">' + escAttr(m.name || "") + '</h3></div></div>' +
    (m.bio ? '<p class="tsBio">' + escAttr(m.bio) + '</p>' : "") +
    ((phone || fb) ? '<div class="tsActions">' +
      (phone ? '<a class="tsBtn tsCall" href="tel:' + escAttr(phone) + '"><i class="fa-solid fa-phone" aria-hidden="true"></i> ' + escAttr(phoneRaw) + '</a>' : "") +
      (fb ? '<a class="tsBtn tsFb" href="' + escAttr(fb) + '" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-facebook-f" aria-hidden="true"></i> ফেসবুক</a>' : "") +
    '</div>' : "");
  if (m.photo) {
    const wrap = box.querySelector(".tsPhoto");
    wrap.classList.remove("placeholderMode");
    loadImageWithFallback(wrap.querySelector("img"), m.photo, wrap);
  }
  sh.classList.add("open");
  document.body.classList.add("tsLock");
}
document.addEventListener("click", e => {
  const card = e.target.closest ? e.target.closest("#teamRow .tcCard") : null;
  if (!card || e.target.closest("a")) return;
  if (!window.matchMedia || !window.matchMedia("(max-width: 640px)").matches) return;
  openTeamSheet(card.getAttribute("data-team-id"));
});

/* পদবি এক লাইনে থাকে; জায়গায় না ধরলে ডান থেকে বামে ধীরে ধীরে নিজে নিজে ঘুরে পুরোটা দেখায় */
function fitTeamRoles() {
  document.querySelectorAll("#teamRow .tcRole").forEach(el => {
    const txt = el.getAttribute("data-text") || "";
    el.classList.remove("marquee");
    el.style.removeProperty("--shift");
    el.style.removeProperty("--dur");
    el.innerHTML = '<span class="tcRoleText"></span>';
    el.firstChild.textContent = txt;
    if (!el.clientWidth) return; // সেকশন এখনো লুকানো — দৃশ্যমান হলে ResizeObserver আবার চালাবে
    if (el.scrollWidth <= el.clientWidth + 1) return;
    el.innerHTML = '<span class="tcRoleTrack"><span></span><span aria-hidden="true"></span></span>';
    const spans = el.querySelectorAll(".tcRoleTrack > span");
    spans[0].textContent = txt; spans[1].textContent = txt;
    const shift = spans[1].offsetLeft - spans[0].offsetLeft; // মোবাইল/ডেস্কটপ দুই জায়গার গ্যাপ নিজে থেকেই ধরা পড়ে
    el.style.setProperty("--shift", shift + "px");
    el.style.setProperty("--dur", Math.max(7, Math.round(shift / 22)) + "s");
    el.classList.add("marquee");
  });
}
(function initTeamRoleFit() {
  let t = null;
  const run = () => { clearTimeout(t); t = setTimeout(fitTeamRoles, 120); };
  window.addEventListener("resize", run);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
  const row = document.getElementById("teamRow");
  if (row && "ResizeObserver" in window) {
    let lastW = -1;
    new ResizeObserver(() => { const w = row.clientWidth; if (w === lastW) return; lastW = w; run(); }).observe(row);
  }
})();

function renderTeamSection() {
  const container = document.getElementById("teamRow");
  if (!container) return;
  if (isSkeletonLoading()) { skeletonFill(container, "team", 4); return; }
  const sig = JSON.stringify(landingData.team.map(m => [m.id, m.name, m.role, m.bio, m.photo, m.phone, m.facebook]));
  if (container.getAttribute("data-sig") !== sig || container.getAttribute("data-skel")) {
    container.removeAttribute("data-skel");
    container.setAttribute("data-sig", sig);
    container.innerHTML = landingData.team.map(teamCardTemplate).join("");
    container.querySelectorAll(".tcCard").forEach((card, i) => {
      const m = landingData.team[i];
      if (!m || !m.photo) return;
      const wrap = card.querySelector(".tcPhoto");
      wrap.classList.remove("placeholderMode");
      loadImageWithFallback(card.querySelector(".tcImg"), m.photo, wrap);
    });
  }
  setSectionVisible(document.getElementById("teamSection"), landingData.team.length > 0);
  fitTeamRoles();
}

function faqItemTemplate(f) {
  return (
    '<div class="faqItem collapsed" data-faq-id="' + f.id + '">' +
      '<button type="button" class="faqRemoveBtn" data-faq-id="' + f.id + '" title="প্রশ্ন মুছুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '<div class="faqQ editable-field" data-faq-id="' + f.id + '" data-field="q" contenteditable="false"></div>' +
      '<span class="faqToggle"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></span>' +
      '<div class="faqA editable-field" data-faq-id="' + f.id + '" data-field="a" contenteditable="false"></div>' +
    '</div>'
  );
}

function renderFaqSection() {
  const container = document.getElementById("faqList");
  if (!container) return;
  const existingIds = Array.from(container.children).map(c => c.getAttribute("data-faq-id"));
  const newIds = landingData.faqs.map(f => f.id);
  const structureChanged = existingIds.length !== newIds.length || existingIds.some((id, i) => id !== newIds[i]);
  if (structureChanged) {
    container.innerHTML = landingData.faqs.map(faqItemTemplate).join("");
    if (isAdmin) container.querySelectorAll(".editable-field").forEach(el => el.setAttribute("contenteditable", "true"));
  }
  landingData.faqs.forEach(f => {
    const item = container.querySelector('.faqItem[data-faq-id="' + f.id + '"]');
    if (!item) return;
    const qEl = item.querySelector(".faqQ");
    const aEl = item.querySelector(".faqA");
    if (qEl && document.activeElement !== qEl) qEl.textContent = f.q;
    if (aEl && document.activeElement !== aEl) aEl.textContent = f.a;
  });
  setSectionVisible(document.getElementById("faqSection"), landingData.faqs.length > 0);
}

function partnerCardTemplate(p) {
  return (
    '<div class="partnerCard" data-partner-id="' + p.id + '">' +
      '<button type="button" class="partnerRemoveBtn" data-partner-id="' + p.id + '" title="সহযোগী মুছুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '<div class="partnerLogoWrap placeholderMode">' +
        '<div class="imgSkeleton" aria-hidden="true"></div>' +
        '<img class="partnerLogo" alt="' + escAttr(p.name) + '">' +
        '<span class="partnerPlaceholderMark"><i class="fa-solid fa-building" aria-hidden="true"></i></span>' +
        '<button type="button" class="imgEditBtn" data-img-key="partner:' + p.id + ':logo"><i class="fa-solid fa-camera" aria-hidden="true"></i></button>' +
      '</div>' +
      '<div class="partnerName editable-field" data-partner-id="' + p.id + '" data-field="name" contenteditable="false"></div>' +
    '</div>'
  );
}

function renderPartnersSection() {
  const container = document.getElementById("partnersGrid");
  if (!container) return;
  if (isSkeletonLoading()) { skeletonFill(container, "partner", 5); return; }
  const existingIds = Array.from(container.children).map(c => c.getAttribute("data-partner-id"));
  const newIds = landingData.partners.map(p => p.id);
  const structureChanged = existingIds.length !== newIds.length || existingIds.some((id, i) => id !== newIds[i]);
  if (structureChanged) {
    container.innerHTML = landingData.partners.map(partnerCardTemplate).join("");
    if (isAdmin) container.querySelectorAll(".editable-field").forEach(el => el.setAttribute("contenteditable", "true"));
  }
  landingData.partners.forEach(p => {
    const card = container.querySelector('.partnerCard[data-partner-id="' + p.id + '"]');
    if (!card) return;
    const nameEl = card.querySelector(".partnerName");
    if (nameEl && document.activeElement !== nameEl) nameEl.textContent = p.name;
    const wrap = card.querySelector(".partnerLogoWrap");
    const img = card.querySelector(".partnerLogo");
    if (p.logo) {
      wrap.classList.remove("placeholderMode");
      loadImageWithFallback(img, p.logo, wrap);
    } else {
      wrap.classList.add("placeholderMode");
      wrap.classList.remove("loadingImg", "imgLoadFailed");
      img.removeAttribute("src");
    }
  });
  setSectionVisible(document.getElementById("partnersSection"), landingData.partners.length > 0);
}

/* Converts a plain number (1, 2, 3 ...) to Bengali digits (১, ২, ৩ ...)
   for the numbered circles in the "কীভাবে কাজ করে" steps. */
function toBengaliDigits(n) {
  const map = ["০","১","২","৩","৪","৫","৬","৭","৮","৯"];
  return String(n).split("").map(ch => (map[ch] !== undefined ? map[ch] : ch)).join("");
}

/* ============================================================
   NEWS SECTION — admin writes news from the admin panel (title,
   content, optional photo, date); the public site lists everything,
   newest first, each post with its own like + share (WhatsApp /
   Facebook / Messenger / copy-link) buttons.
   ============================================================ */
const CACHE_NEWS_LIKES_KEY = "blood_donor_news_likes_cache";
const LIKED_NEWS_KEY = "blood_donor_liked_news";
let newsLikesData = readCache(CACHE_NEWS_LIKES_KEY, {});

function getLikedNewsIds() { return readCache(LIKED_NEWS_KEY, []); }
function setLikedNewsIds(arr) { writeCache(LIKED_NEWS_KEY, arr); }
function isNewsLiked(id) { return getLikedNewsIds().indexOf(id) !== -1; }

/* ক্লিক-লক: একই বাটনে দ্রুত পরপর ট্যাপ করলে ডাবল কাউন্ট হবে না */
let newsLikeBusy = {};

/* ১২৩ → "১২৩", ১২৫০ → "১.২k" */
function formatLikeCount(n) {
  n = Math.max(0, parseInt(n, 10) || 0);
  if (n >= 1000) return toBengaliDigits((Math.floor(n / 100) / 10).toString().replace(/\.0$/, "")) + "k";
  return toBengaliDigits(n);
}

/* পেজের সব লাইক বাটন (তালিকা + ডিটেইল) একসাথে আপডেট — পুরো কার্ড আবার না এঁকে,
   তাই ফায়ারবেস থেকে নতুন লাইক এলেই (অন্য কারো লাইকও) সঙ্গে সঙ্গে সংখ্যা বদলায়। */
function updateNewsLikeUI() {
  document.querySelectorAll(".newsLikeBtn[data-news-id]").forEach(btn => {
    const id = btn.getAttribute("data-news-id");
    const count = Math.max(0, parseInt(newsLikesData && newsLikesData[id], 10) || 0);
    const liked = isNewsLiked(id);
    btn.classList.toggle("liked", liked);
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.setAttribute("aria-label", (liked ? "লাইক সরান" : "লাইক দিন") + " — মোট " + count);
    const icon = btn.querySelector("i");
    if (icon) icon.className = liked ? "fa-solid fa-heart" : "fa-regular fa-heart";
    const cEl = btn.querySelector(".newsLikeCount");
    if (cEl) {
      const prev = cEl.getAttribute("data-count");
      if (prev !== String(count)) {
        cEl.setAttribute("data-count", String(count));
        cEl.textContent = formatLikeCount(count);
        if (prev !== null) { cEl.classList.remove("likePop"); void cEl.offsetWidth; cEl.classList.add("likePop"); }
      }
    }
  });
}

function toggleNewsLike(id) {
  if (!id || newsLikeBusy[id]) return;
  newsLikeBusy[id] = true;
  setTimeout(() => { newsLikeBusy[id] = false; }, 450);

  const liked = isNewsLiked(id);
  const likedIds = getLikedNewsIds();
  if (liked) {
    setLikedNewsIds(likedIds.filter(x => x !== id));
    newsLikesData[id] = Math.max(0, (newsLikesData[id] || 1) - 1);
  } else {
    setLikedNewsIds(likedIds.concat([id]));
    newsLikesData[id] = (newsLikesData[id] || 0) + 1;
  }
  writeCache(CACHE_NEWS_LIKES_KEY, newsLikesData);
  updateNewsLikeUI(); // ইনস্ট্যান্ট ফিডব্যাক
  if (!liked) {
    document.querySelectorAll(".newsLikeBtn[data-news-id]").forEach(b => {
      if (b.getAttribute("data-news-id") !== id) return;
      b.classList.remove("likeBurst"); void b.offsetWidth; b.classList.add("likeBurst");
    });
  }
  if (firebaseAvailable && newsLikesRef) {
    newsLikesRef.child(id).transaction(curr => Math.max(0, (curr || 0) + (liked ? -1 : 1)), (err) => {
      if (!err) return;
      /* সার্ভারে লেখা না গেলে লোকাল পরিবর্তন ফিরিয়ে নিই */
      setLikedNewsIds(liked ? getLikedNewsIds().concat([id]) : getLikedNewsIds().filter(x => x !== id));
      newsLikesData[id] = Math.max(0, (newsLikesData[id] || 0) + (liked ? 1 : -1));
      writeCache(CACHE_NEWS_LIKES_KEY, newsLikesData);
      updateNewsLikeUI();
      showToast("লাইক সেভ করা যায়নি, আবার চেষ্টা করুন");
    });
  }
}

/* A shareable deep link straight to one news post — opened later, it
   lands on the news page and scrolls/highlights that exact card. */
function buildNewsShareUrl(id) {
  return location.origin + location.pathname + "#news/" + encodeURIComponent(id);
}

function formatNewsDateBn(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  if (window.I18N && I18N.lang === "en") return I18N.fmtDate(d, "long");
  const months = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
  return toBengaliDigits(d.getDate()) + " " + months[d.getMonth()] + ", " + toBengaliDigits(d.getFullYear());
}

function newsCardTemplate(n) {
  const href = "#news/" + encodeURIComponent(n.id);
  const id = escAttr(n.id);
  return (
    '<article class="newsCard newsCardCompact" data-news-id="' + id + '">' +
      '<div class="newsDetailMeta"><span class="newsCardCategoryTag"></span><span><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> <span class="newsCardDateText"></span></span></div>' +
      '<h3 class="newsCardTitle"><a class="newsTitleLink" href="' + href + '"></a></h3>' +
      '<div class="newsCompactFoot">' +
        '<div class="newsCardTopActions">' +
          '<button type="button" class="newsLikeBtn" data-news-id="' + id + '" aria-label="লাইক"><i class="fa-regular fa-heart" aria-hidden="true"></i><span class="newsLikeCount">০</span></button>' +
          '<div class="newsShareWrap">' +
            '<button type="button" class="newsShareBtn" data-news-id="' + id + '" aria-label="শেয়ার"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i></button>' +
            '<div class="newsShareMenu">' +
              '<a class="newsShareOpt waShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</a>' +
              '<a class="newsShareOpt fbShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-facebook" aria-hidden="true"></i>Facebook</a>' +
              '<a class="newsShareOpt msgShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-facebook-messenger" aria-hidden="true"></i>Messenger</a>' +
              '<button type="button" class="newsShareOpt copyShare" data-news-id="' + id + '"><i class="fa-solid fa-link" aria-hidden="true"></i>লিংক কপি</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<a class="newsReadMore" href="' + href + '">ওপেন করুন <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>' +
      '</div>' +
    '</article>'
  );
}

function renderNewsSection() {
  const container = document.getElementById("newsList");
  if (!container) return;
  if (isSkeletonLoading()) { skeletonFill(container, "news", 3); return; }
  const sorted = landingData.news.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const existingIds = Array.from(container.children).map(c => c.getAttribute("data-news-id"));
  const newIds = sorted.map(n => n.id);
  const structureChanged = existingIds.length !== newIds.length || existingIds.some((id, i) => id !== newIds[i]);
  if (structureChanged) {
    container.innerHTML = sorted.map(newsCardTemplate).join("");
  }
  sorted.forEach(n => {
    const card = Array.from(container.children).find(c => c.getAttribute("data-news-id") === n.id);
    if (!card) return;
    const titleEl = card.querySelector(".newsTitleLink");
    if (titleEl) titleEl.textContent = n.title || "শিরোনামহীন";
    const dateEl = card.querySelector(".newsCardDateText");
    if (dateEl) dateEl.textContent = formatNewsDateBn(n.date);
    const catEl = card.querySelector(".newsCardCategoryTag");
    if (catEl) catEl.textContent = n.category || "সাধারণ";

    const shareUrl = buildNewsShareUrl(n.id);
    const shareText = encodeURIComponent((n.title || "") + " — " + (landingData.siteName || ""));
    const encodedUrl = encodeURIComponent(shareUrl);
    const waLink = card.querySelector(".waShare");
    const fbLink = card.querySelector(".fbShare");
    const msgLink = card.querySelector(".msgShare");
    const copyBtn = card.querySelector(".copyShare");
    if (waLink) waLink.setAttribute("href", "https://wa.me/?text=" + shareText + "%20" + encodedUrl);
    if (fbLink) fbLink.setAttribute("href", "https://www.facebook.com/sharer/sharer.php?u=" + encodedUrl);
    if (msgLink) msgLink.setAttribute("href", "fb-messenger://share/?link=" + encodedUrl);
    if (copyBtn) copyBtn.setAttribute("data-share-url", shareUrl);
  });
  updateNewsLikeUI();
  setSectionVisible(document.getElementById("newsSection"), landingData.news.length > 0);

  // loading / empty / error states for public visitors
  const hasNews = landingData.news.length > 0;
  const loadingEl = document.getElementById("newsLoading");
  const emptyEl = document.getElementById("newsEmptyPublic");
  if (loadingEl) {
    const showLoading = !hasNews && (!landingReady || landingLoadFailed);
    loadingEl.style.display = showLoading ? "flex" : "none";
    const label = loadingEl.querySelector("span:last-child");
    if (label) label.textContent = landingLoadFailed ? "সংবাদ লোড করা যায়নি — ইন্টারনেট সংযোগ পরীক্ষা করে পেজটি রিফ্রেশ করুন।" : "সংবাদ লোড হচ্ছে…";
    const spin = loadingEl.querySelector(".newsLoadingSpinner");
    if (spin) spin.style.display = landingLoadFailed ? "none" : "";
  }
  if (emptyEl) emptyEl.style.display = (!hasNews && landingReady && !landingLoadFailed) ? "flex" : "none";
}

/* ============================================================
   NEWS DETAIL PAGE (#news/<id>) — full description, larger photo and,
   when the admin attached them, the report images (last
   month's donation history). Re-rendered whenever news / likes change.
   ============================================================ */
let currentNewsDetailId = null;

/* Only https:// links are ever placed in an href / src taken from the
   database — blocks javascript: / data: URLs from being injected. */
function safeHttpsUrl(u) {
  return (typeof u === "string" && /^https:\/\//i.test(u.trim())) ? u.trim() : "";
}
/* সংবাদের "রিপোর্টের ছবি" — শুধু বৈধ https লিংক, খালি/ভাঙা এন্ট্রি বাদ */
function newsReportImages(n) {
  return toArrayField(n && n.reportImages).map(safeHttpsUrl).filter(Boolean);
}

function newsDetailStateHtml(icon, msg, spinner) {
  return     '<div class="newsDetailState">' + (spinner ? '<span class="newsLoadingSpinner" aria-hidden="true"></span>' : '<i class="fa-solid ' + icon + '" aria-hidden="true"></i>') +
    '<span>' + escAttr(msg) + '</span></div>';
}

function renderNewsDetail() {
  const box = document.getElementById("newsDetail");
  if (!box || !currentNewsDetailId) return;
  const n = landingData.news.find(x => x.id === currentNewsDetailId);
  if (!n) {
    box.removeAttribute("data-sig");
    if (landingLoadFailed) box.innerHTML = newsDetailStateHtml("fa-triangle-exclamation", "সংবাদ লোড করা যায়নি — ইন্টারনেট সংযোগ পরীক্ষা করে পেজটি রিফ্রেশ করুন।");
    else if (!landingReady) box.innerHTML = newsDetailStateHtml("", "সংবাদ লোড হচ্ছে…", true);
    else box.innerHTML = newsDetailStateHtml("fa-circle-question", "এই সংবাদটি খুঁজে পাওয়া যায়নি — এটি সরিয়ে ফেলা হয়ে থাকতে পারে।");
    return;
  }

  const sig = JSON.stringify([n.id, n.title, n.date, n.category, n.content, n.newsImage, newsReportImages(n), window.I18N ? I18N.lang : "bn"]);
  if (box.getAttribute("data-sig") !== sig) {
    box.setAttribute("data-sig", sig);
    const reportImgs = newsReportImages(n);
    const pdfHtml = reportImgs.length ? (
      '<div class="newsReport">' +
        '<div class="newsReportHead"><i class="fa-solid fa-images" aria-hidden="true"></i> ডোনেশন হিস্ট্রি রিপোর্ট <span class="newsReportHint">(ছবিতে চাপ দিয়ে বড় করে দেখুন)</span></div>' +
        '<div class="newsReportGrid">' +
          reportImgs.map((u, i) =>
            '<a class="newsReportItem" href="' + escAttr(u) + '" target="_blank" rel="noopener noreferrer" aria-label="রিপোর্ট ছবি ' + (i + 1) + ' বড় করে দেখুন">' +
            '<div class="imgSkeleton" aria-hidden="true"></div><img alt="রিপোর্ট ছবি ' + (i + 1) + '" data-report-src="' + escAttr(u) + '"></a>'
          ).join("") +
        '</div>' +
      '</div>'
    ) : '';
    box.innerHTML =
            '<article class="newsDetailCard" data-news-id="' + escAttr(n.id) + '">' +
        '<div class="newsDetailTop">' +
          (n.newsImage ? '<div class="newsDetailImageWrap"><div class="imgSkeleton" aria-hidden="true"></div><img alt="' + escAttr(n.title) + '"></div>' : '') +
          '<div class="newsDetailHead">' +
            '<div class="newsDetailMeta"><span class="newsCardCategoryTag"></span><span><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> <span class="newsDetailDate"></span></span></div>' +
            '<h2 class="newsDetailTitle"></h2>' +
            '<div class="newsDetailActions">' +
              '<div class="newsCardTopActions">' +
                '<button type="button" class="newsLikeBtn" data-news-id="' + escAttr(n.id) + '" aria-label="লাইক"><i class="fa-regular fa-heart" aria-hidden="true"></i><span class="newsLikeCount">০</span></button>' +
                '<div class="newsShareWrap">' +
                  '<button type="button" class="newsShareBtn" data-news-id="' + escAttr(n.id) + '" aria-label="শেয়ার"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i></button>' +
                  '<div class="newsShareMenu">' +
                    '<a class="newsShareOpt waShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</a>' +
                    '<a class="newsShareOpt fbShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-facebook" aria-hidden="true"></i>Facebook</a>' +
                    '<a class="newsShareOpt msgShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-facebook-messenger" aria-hidden="true"></i>Messenger</a>' +
                    '<button type="button" class="newsShareOpt copyShare"><i class="fa-solid fa-link" aria-hidden="true"></i>লিংক কপি</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<p class="newsDetailText"></p>' +
        pdfHtml +
      '</article>';
    box.querySelector(".newsDetailTitle").textContent = n.title || "শিরোনামহীন";
    box.querySelector(".newsDetailDate").textContent = formatNewsDateBn(n.date);
    box.querySelector(".newsCardCategoryTag").textContent = n.category || "সাধারণ";
    box.querySelector(".newsDetailText").textContent = n.content || "";
    const wrap = box.querySelector(".newsDetailImageWrap");
    if (wrap) loadImageWithFallback(wrap.querySelector("img"), n.newsImage, wrap);
    box.querySelectorAll(".newsReportItem").forEach(a => loadImageWithFallback(a.querySelector("img"), a.getAttribute("href"), a));

    const shareUrl = buildNewsShareUrl(n.id);
    const shareText = encodeURIComponent((n.title || "") + " — " + (landingData.siteName || ""));
    const encodedUrl = encodeURIComponent(shareUrl);
    box.querySelector(".waShare").setAttribute("href", "https://wa.me/?text=" + shareText + "%20" + encodedUrl);
    box.querySelector(".fbShare").setAttribute("href", "https://www.facebook.com/sharer/sharer.php?u=" + encodedUrl);
    box.querySelector(".msgShare").setAttribute("href", "fb-messenger://share/?link=" + encodedUrl);
    box.querySelector(".copyShare").setAttribute("data-share-url", shareUrl);
  }

  updateNewsLikeUI(); // লাইক অবস্থা ও সংখ্যা (পেজ না ভেঙেই)
}

/* ============================================================
   আজকের হিরো — হোমপেজে সবচেয়ে সাম্প্রতিক রক্তদাতাকে ফিচার করা।
   landingData.donationRecords (এডমিন/list.html থেকে সিঙ্কড) থেকেই
   সবচেয়ে নতুন তারিখের রেকর্ডটি বাছাই করা হয় — আলাদা কোনো ডাটা লাগে না।
   ============================================================ */
function renderHeroDonorSection() {
  const section = document.getElementById("heroDonorSection");
  if (!section) return;
  const records = (landingData.donationRecords || []).filter(r => r && r.name);
  if (!records.length) { setSectionVisible(section, false); return; }
  const latest = records.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];

  // শুধু ২৪ ঘণ্টা দেখানো হবে: রক্তদানের তারিখের শুরু (local midnight)
  // থেকে ঠিক ২৪ ঘণ্টা পর এই সেকশন নিজে থেকেই হাইড হয়ে যায়।
  const parts = (latest.date || "").split("-").map(n => parseInt(n, 10));
  const donationMidnight = parts.length === 3 && !isNaN(parts[0])
    ? new Date(parts[0], parts[1] - 1, parts[2]).getTime()
    : null;
  const within24h = donationMidnight != null && (Date.now() - donationMidnight) < (24 * 60 * 60 * 1000) && (Date.now() - donationMidnight) >= 0;
  if (!within24h) { setSectionVisible(section, false); return; }

  setSectionVisible(section, true);

  const nameEl = document.getElementById("heroDonorName");
  const groupEl = document.getElementById("heroDonorGroup");
  const hospEl = document.getElementById("heroDonorHospital");
  const dateEl = document.getElementById("heroDonorDate");
  const wrap = document.getElementById("heroDonorPhotoWrap");
  const img = document.getElementById("heroDonorPhoto");

  if (nameEl) nameEl.textContent = latest.name || "";
  if (groupEl) groupEl.textContent = latest.bloodGroup || "";
  if (hospEl) hospEl.textContent = latest.hospitalName ? ("📍 " + latest.hospitalName) : "";
  if (dateEl) dateEl.textContent = formatNewsDateBn(latest.date);

  const showPhoto = latest.image && !latest.hidePhoto;
  if (wrap && img) {
    if (showPhoto) {
      wrap.classList.remove("placeholderMode");
      loadImageWithFallback(img, latest.image, wrap);
    } else {
      wrap.classList.add("placeholderMode");
      wrap.classList.remove("loadingImg", "imgLoadFailed");
      img.removeAttribute("src");
    }
  }
}
// প্রতি ৫ মিনিটে রিচেক করে, যাতে ট্যাব খোলা রাখলেও ২৪ ঘণ্টা পার হওয়ার
// সাথে সাথেই (পেজ রিলোড ছাড়াই) সেকশনটা নিজে থেকে হাইড হয়ে যায়।
setInterval(renderHeroDonorSection, 5 * 60 * 1000);

/* ============================================================
   নিকটস্থ হাসপাতাল ও ব্লাড ব্যাংক — এডমিন প্যানেলে যোগ করা
   landingData.hospitals লিস্ট থেকে কার্ড আকারে দেখানো হয়, ফোন নম্বরে
   ট্যাপ করলে সরাসরি কল করা যায়।
   ============================================================ */
function hospitalCardTemplate(h) {
  const isBank = h.type === "ব্লাড ব্যাংক";
  return (
    '<div class="hospitalCard">' +
      '<div class="hospitalCardIcon"><i class="fa-solid ' + (isBank ? "fa-droplet" : "fa-hospital") + '" aria-hidden="true"></i></div>' +
      '<div class="hospitalCardBody">' +
        '<span class="hospitalCardType">' + escAttr(h.type || "হাসপাতাল") + '</span>' +
        '<h3 class="hospitalCardName">' + escAttr(h.name || "") + '</h3>' +
        (h.address ? '<p class="hospitalCardAddress"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>' + escAttr(h.address) + '</p>' : "") +
      '</div>' +
      (h.phone ? '<a class="hospitalCardCall" href="tel:' + escAttr(h.phone) + '"><i class="fa-solid fa-phone" aria-hidden="true"></i><span>' + escAttr(h.phone) + '</span></a>' : "") +
    '</div>'
  );
}
function renderHospitalsSection() {
  const container = document.getElementById("hospitalsList");
  if (!container) return;
  const list = landingData.hospitals || [];
  container.innerHTML = list.map(hospitalCardTemplate).join("");
  const emptyState = document.getElementById("hospitalsEmptyState");
  if (emptyState) emptyState.style.display = list.length ? "none" : "";
}

/* ============================================================
   NEWS LIKE / SHARE — one delegated listener on the list container
   (cards get re-rendered without re-binding, so delegation avoids
   ever double-attaching a handler).
   ============================================================ */
(function initNewsInteractions() {
  const containers = [document.getElementById("newsList"), document.getElementById("newsDetail")].filter(Boolean);
  if (!containers.length) return;

  /* মেনু যেন স্ক্রিনের বাইরে কেটে না যায় — ভিউপোর্টের ভেতরে ক্ল্যাম্প করে বসায় */
  function positionShareMenu(wrap, menu) {
    menu.style.left = "auto"; menu.style.right = "0";
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const menuW = menu.offsetWidth || 178;
    const wr = wrap.getBoundingClientRect();
    const margin = 10;
    let left = wr.right - menuW;                        // বাটনের ডান প্রান্তের সাথে মিলিয়ে
    left = Math.max(margin, Math.min(left, vw - menuW - margin));
    menu.style.right = "auto";
    menu.style.left = (left - wr.left) + "px";
    const originX = Math.max(0, Math.min(menuW, wr.left + wr.width / 2 - left));
    menu.style.transformOrigin = originX + "px top";
  }

  function closeAllShareMenus(except) {
    document.querySelectorAll(".newsShareMenu.open").forEach(m => { if (m !== except) m.classList.remove("open"); });
  }

  containers.forEach(container => container.addEventListener("click", e => {
    const likeBtn = e.target.closest(".newsLikeBtn");
    if (likeBtn) {
      toggleNewsLike(likeBtn.getAttribute("data-news-id"));
      return;
    }
    const shareBtn = e.target.closest(".newsShareBtn");
    if (shareBtn) {
      const menu = shareBtn.parentElement.querySelector(".newsShareMenu");
      const willOpen = menu && !menu.classList.contains("open");
      closeAllShareMenus();
      if (menu && willOpen) {
        positionShareMenu(shareBtn.parentElement, menu);
        menu.classList.add("open");
      }
      return;
    }
    const copyBtn = e.target.closest(".copyShare");
    if (copyBtn) {
      const url = copyBtn.getAttribute("data-share-url") || "";
      const menu = copyBtn.closest(".newsShareMenu");
      if (menu) menu.classList.remove("open");
      if (!url) return;
      const done = () => showToast("লিংক কপি করা হয়েছে");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
      } else {
        fallbackCopy(url, done);
      }
      return;
    }
    const shareOpt = e.target.closest(".newsShareOpt");
    if (shareOpt) {
      const menu = shareOpt.closest(".newsShareMenu");
      if (menu) setTimeout(() => menu.classList.remove("open"), 150);
    }
  }));

  function fallbackCopy(url, done) {
    try {
      const tmp = document.createElement("textarea");
      tmp.value = url;
      tmp.style.position = "fixed";
      tmp.style.opacity = "0";
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      document.body.removeChild(tmp);
      done();
    } catch (err) { /* clipboard unavailable — link stays shareable via the app buttons */ }
  }

  document.addEventListener("click", e => {
    if (!e.target.closest(".newsShareWrap")) closeAllShareMenus();
  });
})();

function processStepTemplate(step, index, colKey) {
  return (
    '<div class="processStep" data-step-id="' + step.id + '" data-col="' + colKey + '">' +
      '<button type="button" class="stepRemoveBtn" data-step-id="' + step.id + '" data-col="' + colKey + '" title="ধাপ মুছুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '<span class="processStepNum">' + toBengaliDigits(index + 1) + '</span>' +
      '<div>' +
        '<div class="processStepTitle editable-field" data-step-id="' + step.id + '" data-col="' + colKey + '" data-field="title" contenteditable="false"></div>' +
        '<div class="processStepText editable-field" data-step-id="' + step.id + '" data-col="' + colKey + '" data-field="text" contenteditable="false"></div>' +
      '</div>' +
    '</div>'
  );
}

function renderProcessCol(colKey, containerId, emptyId, cardId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const steps = landingData[colKey];
  const existingIds = Array.from(container.children).map(c => c.getAttribute("data-step-id"));
  const newIds = steps.map(s => s.id);
  const structureChanged = existingIds.length !== newIds.length || existingIds.some((id, i) => id !== newIds[i]);
  if (structureChanged) {
    container.innerHTML = steps.map((s, i) => processStepTemplate(s, i, colKey)).join("");
    if (isAdmin) container.querySelectorAll(".editable-field").forEach(el => el.setAttribute("contenteditable", "true"));
  } else {
    /* Structure unchanged — just refresh the step numbers + text without
       rebuilding the DOM (keeps focus/cursor intact while typing). */
    Array.from(container.children).forEach((el, i) => {
      const numEl = el.querySelector(".processStepNum");
      if (numEl) numEl.textContent = toBengaliDigits(i + 1);
    });
  }
  steps.forEach(s => {
    const stepEl = container.querySelector('.processStep[data-step-id="' + s.id + '"]');
    if (!stepEl) return;
    const titleEl = stepEl.querySelector(".processStepTitle");
    const textEl = stepEl.querySelector(".processStepText");
    if (titleEl && document.activeElement !== titleEl) titleEl.textContent = s.title;
    if (textEl && document.activeElement !== textEl) textEl.textContent = s.text;
  });
  setSectionVisible(document.getElementById(cardId), steps.length > 0);
}

function renderNoticeBar() {
  const bar = document.getElementById("noticeBar");
  if (!bar) return;
  const track = document.getElementById("noticeBarTrack");
  const text = (landingData.importantNotice || "").trim();
  const active = !!landingData.importantNoticeActive && !!text;
  bar.classList.toggle("show", active);
  if (active && track) {
    track.textContent = text;
    // Slower scroll for longer text so it stays readable at any length.
    const duration = Math.max(12, Math.min(45, text.length * 0.28));
    track.style.animationDuration = duration + "s";
  }
}

/* ============================================================
   এডমিন-নিয়ন্ত্রিত ক্রম — মেনু/পেজের ক্রম (navOrder) ও হোমের সেকশন ক্রম (homeOrder)
   সংরক্ষিত তালিকা + ডিফল্ট মিলিয়ে চূড়ান্ত ক্রম বানানো হয় (নতুন কিছু যোগ হলে নিজে থেকে শেষে আসে)।
   ============================================================ */
const NAV_ROUTE_DEFAULTS = ["process", "blood-group", "donations", "news", "hospitals"];
const HOME_SECTION_DEFAULTS = ["stats", "heroDonor", "gallery", "about", "features", "team", "faq", "partners", "cta", "sponsors"];
function mergeOrder(saved, defaults) {
  const out = [], seen = {};
  toArrayField(saved).forEach(it => {
    const key = it && (typeof it === "string" ? it : it.key);
    if (!key || seen[key] || defaults.indexOf(key) === -1) return;
    seen[key] = true;
    out.push({ key: key, visible: !(it && typeof it === "object" && it.visible === false) });
  });
  defaults.forEach(k => { if (!seen[k]) out.push({ key: k, visible: true }); });
  return out;
}
let lastNavOrderSig = "", lastHomeOrderSig = "";

function renderNavOrder() {
  const order = mergeOrder(landingData.navOrder, NAV_ROUTE_DEFAULTS);
  const sig = order.map(o => o.key).join(",");
  const reorder = sig !== lastNavOrderSig;
  lastNavOrderSig = sig;
  ["siteNavLinks", "siteNavMobile"].forEach(id => {
    const box = document.getElementById(id);
    if (!box) return;
    const cta = box.querySelector(".langRowMobile, .siteNavCta, .siteNavCtaMobile"); // links always stay above the language row + CTA
    order.forEach(o => {
      const a = box.querySelector('a[data-nav-route="' + o.key + '"]');
      if (!a) return;
      a.classList.toggle("navHiddenByAdmin", !o.visible);
      if (reorder) box.insertBefore(a, cta || null);
    });
  });
  const fbox = document.getElementById("footerLinks");
  if (fbox) {
    order.forEach(o => {
      const a = fbox.querySelector('a[data-footer-route="' + o.key + '"]');
      const row = a && a.closest(".footerRow");
      if (!row) return;
      row.classList.toggle("navHiddenByAdmin", !o.visible);
      if (reorder) fbox.appendChild(row);
    });
  }
}

function renderHomeOrder() {
  const main = document.getElementById("main");
  if (!main) return;
  const order = mergeOrder(landingData.homeOrder, HOME_SECTION_DEFAULTS);
  const sig = order.map(o => o.key).join(",");
  const reorder = sig !== lastHomeOrderSig;
  lastHomeOrderSig = sig;
  const footer = document.querySelector("footer.siteFooter");
  order.forEach((o, idx) => {
    const el = document.querySelector('[data-home-section="' + o.key + '"]');
    if (!el) return;
    el.classList.toggle("adminHidden", !o.visible);
    if (!reorder) return;
    /* স্পনসর সবার শেষে থাকলে ফুটারের উপরে (সব পেজে দেখায়); মাঝে সরালে হোমের ভেতরে ঠিক সেই জায়গায় */
    if (o.key === "sponsors" && idx === order.length - 1 && footer && footer.parentNode) footer.parentNode.insertBefore(el, footer);
    else main.appendChild(el);
  });
}

/* প্রতিটি সেকশনের শিরোনাম ও ছোট বর্ণনা — এডমিন থেকে বদলানো যায় (secTitle_* / secSub_*) */
function renderSectionTexts() {
  document.querySelectorAll("[data-sec-title]").forEach(el => {
    const v = (landingData["secTitle_" + el.getAttribute("data-sec-title")] || "").trim();
    if (v) el.textContent = v;
  });
  document.querySelectorAll("[data-sec-sub]").forEach(el => {
    const v = (landingData["secSub_" + el.getAttribute("data-sec-sub")] || "").trim();
    el.textContent = v;
    el.style.display = v ? "" : "none";
  });
}

/* ============================================================
   স্পনসর সেকশন — সবসময় সবার নিচে (ফুটারের উপরে), হোম ও সব পেজে।
   টিয়ার অনুযায়ী ভাগ করা: প্রধান → গোল্ড → সিলভার → সহায়ক।
   ============================================================ */
const SPONSOR_TIERS = [
  { key: "প্রধান স্পনসর", cls: "main", icon: "fa-crown" },
  { key: "গোল্ড স্পনসর", cls: "gold", icon: "fa-star" },
  { key: "সিলভার স্পনসর", cls: "silver", icon: "fa-medal" },
  { key: "সহায়ক স্পনসর", cls: "support", icon: "fa-hand-holding-heart" }
];
function sponsorCardTemplate(s) {
  const link = safeHttpsUrl(s.link);
  const tag = link ? "a" : "div";
  const attrs = link ? ' href="' + escAttr(link) + '" target="_blank" rel="noopener noreferrer sponsored"' : "";
  const tier = SPONSOR_TIERS.some(t => t.key === s.tier) ? s.tier : "";
  const kind = (s.kind || "").trim(), intro = (s.tagline || "").trim();
  return (
    '<' + tag + ' class="spCard" data-sponsor-id="' + escAttr(s.id) + '"' + attrs + '>' +
      '<div class="sponsorLogoWrap placeholderMode">' +
        '<div class="imgSkeleton" aria-hidden="true"></div>' +
        '<img class="sponsorLogo" alt="' + escAttr(s.name) + '">' +
        '<span class="sponsorPlaceholderMark"><i class="fa-solid fa-building" aria-hidden="true"></i></span>' +
      '</div>' +
      '<div class="spName">' + escAttr(s.name || "") + '</div>' +
      (tier ? '<span class="spTier">' + escAttr(tier) + '</span>' : "") +
      (kind ? '<div class="spKind"><span>স্পনসর করছেন</span>' + escAttr(kind) + '</div>' : "") +
      (intro ? '<p class="spIntro">' + escAttr(intro) + '</p>' : "") +
      (link ? '<span class="spLink">ওয়েবসাইট দেখুন <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>' : "") +
    '</' + tag + '>'
  );
}

/* সব স্পনসর একটাই সারিতে, বাম থেকে ডানে (ক্যাটাগরি অনুযায়ী আগে-পরে সাজানো)।
   জায়গায় কুলালে মাঝখানে স্থির; বেশি হলে নিজে নিজে ধীরে সরতে থাকে (হোভার/ট্যাপে থামে)। */
let sponsorRowHtml = "", sponsorRowList = [];
function fitSponsorRow() {
  const row = document.getElementById("sponsorsRow");
  const track = document.getElementById("sponsorsTrack");
  if (!row || !track || !sponsorRowHtml) return;
  track.classList.remove("marquee");
  track.style.removeProperty("--dur");
  track.innerHTML = sponsorRowHtml;
  const load = () => track.querySelectorAll(".spCard").forEach(card => {
    const s = sponsorRowList.find(x => String(x.id) === card.getAttribute("data-sponsor-id"));
    if (!s || !s.logo) return;
    const wrap = card.querySelector(".sponsorLogoWrap");
    wrap.classList.remove("placeholderMode");
    loadImageWithFallback(card.querySelector(".sponsorLogo"), s.logo, wrap);
  });
  load();
  if (track.scrollWidth > row.clientWidth + 1) {
    const w = track.scrollWidth;
    track.innerHTML = sponsorRowHtml + sponsorRowHtml.replace(/<(a|div) class="spCard"/g, '<$1 aria-hidden="true" tabindex="-1" class="spCard"');
    track.classList.add("marquee");
    track.style.setProperty("--dur", Math.max(14, Math.round(w / 45)) + "s");
    load();
  }
}
let sponsorResizeTimer = null;
window.addEventListener("resize", () => { clearTimeout(sponsorResizeTimer); sponsorResizeTimer = setTimeout(fitSponsorRow, 200); });

function renderSponsorsSection() {
  const section = document.getElementById("sponsorsSection");
  const box = document.getElementById("sponsorsTiers");
  if (!section || !box) return;
  const list = (landingData.sponsors || []).filter(s => s && (s.name || s.logo));
  setSectionVisible(section, list.length > 0 && !isSkeletonLoading());
  if (!list.length) { box.innerHTML = ""; box.removeAttribute("data-sig"); sponsorRowHtml = ""; return; }

  const h = document.getElementById("sponsorsHeading");
  const sub = document.getElementById("sponsorsSubtitle");
  if (h) h.textContent = landingData.sponsorHeading || "আমাদের স্পনসর";
  if (sub) { sub.textContent = landingData.sponsorSubtitle || ""; sub.style.display = sub.textContent ? "" : "none"; }

  const sig = JSON.stringify(list.map(s => [s.id, s.name, s.logo, s.link, s.tier, s.tagline, s.kind]));
  if (box.getAttribute("data-sig") === sig) return;
  box.setAttribute("data-sig", sig);

  const rank = s => { const i = SPONSOR_TIERS.findIndex(t => t.key === s.tier); return i < 0 ? SPONSOR_TIERS.length : i; };
  sponsorRowList = list.map((s, i) => ({ s: s, i: i })).sort((x, y) => rank(x.s) - rank(y.s) || x.i - y.i).map(o => o.s);
  sponsorRowHtml = sponsorRowList.map(sponsorCardTemplate).join("");
  box.innerHTML = '<div class="sponsorRow" id="sponsorsRow"><div class="sponsorTrack" id="sponsorsTrack"></div></div>';
  fitSponsorRow();
}

function renderLanding() {
  normalizeLandingData();
  renderNoticeBar();

  document.querySelectorAll(".editable-field[data-key]").forEach(el => {
    if (document.activeElement === el) return; // don't clobber what the admin is typing
    const key = el.getAttribute("data-key");
    if (landingData[key] !== undefined) el.textContent = landingData[key];
  });

  const aboutWrap = document.getElementById("aboutImageWrap");
  const aboutImg = document.getElementById("aboutImageEl");
  if (landingData.aboutImage) {
    aboutWrap.classList.remove("placeholderMode");
    loadImageWithFallback(aboutImg, landingData.aboutImage, aboutWrap);
  } else {
    aboutWrap.classList.add("placeholderMode");
    aboutWrap.classList.remove("loadingImg", "imgLoadFailed");
    aboutImg.removeAttribute("src");
  }

  const heroEl = document.getElementById("top");
  loadBackgroundWithFallback(heroEl, landingData.heroBackgroundImage, "hasImage"); // eager: hero is the LCP element

  const ctaBand = document.getElementById("ctaBand");
  loadBackgroundWithFallback(ctaBand, landingData.impactImage, "hasImage", true); // lazy: far below the fold

  renderNavOrder();
  renderHomeOrder();
  renderSectionTexts();
  renderSponsorsSection();
  renderDonationGallery();
  renderRecordsGrid();
  renderNewsSection();
  renderNewsDetail();
  renderHeroDonorSection();
  renderHospitalsSection();
  renderTeamSection();
  renderFaqSection();
  renderPartnersSection();
  renderProcessCol("processStepsRecipient", "processStepsRecipient", "processStepsRecipientEmpty", "processColRecipient");
  renderProcessCol("processStepsDonor", "processStepsDonor", "processStepsDonorEmpty", "processColDonor");

  [1, 2, 3].forEach(n => {
    const name = landingData["contactName" + n] || "";
    const phone = landingData["contactPhone" + n] || "";
    const nameEl = document.getElementById("callFabName" + n);
    const numEl = document.getElementById("callFabNum" + n);
    const itemEl = document.getElementById("callFabItem" + n);
    if (nameEl) nameEl.textContent = name;
    if (numEl) numEl.textContent = phone;
    if (itemEl) {
      itemEl.setAttribute("href", "tel:" + phone.replace(/[^0-9+]/g, ""));
      itemEl.setAttribute("data-cc-name", name);
      itemEl.setAttribute("data-cc-phone", phone);
      itemEl.setAttribute("data-cc-photo", landingData["contactPhoto" + n] || "");
      itemEl.setAttribute("data-cc-whatsapp", landingData["contactWhatsapp" + n] || phone);
      itemEl.setAttribute("data-cc-messenger", landingData["contactMessenger" + n] || "");
    }

    const heroChipEl = document.getElementById("heroPhoneChip" + n);
    const heroChipNameEl = document.getElementById("heroPhoneChipName" + n);
    const heroChipTextEl = document.getElementById("heroPhoneChipText" + n);
    if (heroChipNameEl) heroChipNameEl.textContent = name;
    if (heroChipTextEl) heroChipTextEl.textContent = phone;
    if (heroChipEl) {
      heroChipEl.setAttribute("href", "tel:" + phone.replace(/[^0-9+]/g, ""));
      heroChipEl.setAttribute("data-cc-name", name);
      heroChipEl.setAttribute("data-cc-phone", phone);
      heroChipEl.setAttribute("data-cc-photo", landingData["contactPhoto" + n] || "");
      heroChipEl.setAttribute("data-cc-whatsapp", landingData["contactWhatsapp" + n] || phone);
      heroChipEl.setAttribute("data-cc-messenger", landingData["contactMessenger" + n] || "");
    }
  });

  const logoSrc = appConfigData.logoImage && appConfigData.logoImage.trim() ? appConfigData.logoImage : "fav.jpeg";
  loadImageWithFallback(document.getElementById("heroBrandLogo"), logoSrc);
  loadImageWithFallback(document.getElementById("footerBrandLogo"), logoSrc);
  loadImageWithFallback(document.getElementById("callingCardBrandLogo"), logoSrc);
  syncDonorLogos(document);

  const joinNames = [1, 2, 3].map(n => landingData["contactName" + n] || "");
  const joinPhones = [1, 2, 3].map(n => landingData["contactPhone" + n] || "");
  [1, 2, 3].forEach(n => {
    const nameEl = document.getElementById("joinCallName" + n);
    const numEl = document.getElementById("joinCallNum" + n);
    const linkEl = document.getElementById("joinCallItem" + n);
    if (nameEl) nameEl.textContent = joinNames[n - 1];
    if (numEl) numEl.textContent = joinPhones[n - 1];
    if (linkEl) linkEl.setAttribute("href", "tel:" + joinPhones[n - 1].replace(/[^0-9+]/g, ""));
  });
}
renderLanding();

/* ============================================================
   AUTO-SCROLL — ONLY the "সাম্প্রতিক রক্তদান" photo gallery
   auto-glides every 10s with a smooth animation, looping back to
   the start at the end. Every other horizontally scrollable row
   (features, team) stays fully manual — no auto-scroll — so it
   never keeps drifting on its own. Pauses while the visitor is
   hovering/touching so manual scrolling never fights it.
   ============================================================ */
(function initAutoScrollRows() {
  const AUTO_SCROLL_INTERVAL = 10000;
  document.querySelectorAll("#donationGrid.scrollRowX").forEach(row => {
    let timer = null;
    let paused = false;

    function tick() {
      if (paused || row.classList.contains("isStack")) return; // mobile stack carousel drives itself
      const maxScroll = row.scrollWidth - row.clientWidth;
      if (maxScroll <= 4) return; // nothing to scroll
      if (row.scrollLeft >= maxScroll - 4) {
        row.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        row.scrollBy({ left: row.clientWidth * 0.9, behavior: "smooth" });
      }
    }

    function start() {
      if (timer) clearInterval(timer);
      timer = setInterval(tick, AUTO_SCROLL_INTERVAL);
    }

    row.addEventListener("mouseenter", () => { paused = true; });
    row.addEventListener("mouseleave", () => { paused = false; });
    row.addEventListener("touchstart", () => { paused = true; }, { passive: true });
    row.addEventListener("touchend", () => { setTimeout(() => { paused = false; }, 3000); }, { passive: true });
    row.addEventListener("focusin", () => { paused = true; });
    row.addEventListener("focusout", () => { paused = false; });

    start();
  });
})();

/* ============================================================
   HERO HEARTBEAT LINE — a real cardiac-monitor sweep: the strip
   loops continuously (never blanks out and restarts). A cursor
   point sweeps left → right, erasing a small gap just ahead of
   itself and drawing a brand-new, fully randomized heartbeat
   pattern behind it; the old sweep's trace stays visible ahead
   of the cursor until the cursor reaches and overwrites it — on
   wrap it just keeps going from the left edge with a new pattern,
   exactly like a hospital ECG monitor.
   ============================================================ */
(function initHeroHeartbeat() {
  const canvas = document.getElementById("heroPulseCanvas");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");

  const crimson = getComputedStyle(document.documentElement).getPropertyValue("--crimson").trim() || "#9E1B32";
  const SPEED = 130;      // logical px / second the cursor sweeps at
  const GAP_WIDTH = 14;   // erased blank gap just ahead of the cursor

  let W = 0, H = 70;
  let displayBuf = [];
  let nextBuf = [];
  let head = 0;
  let lastTs = null;
  let reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function lerpFill(buf, xa, xb, ya, yb) {
    xa = Math.max(0, Math.round(xa));
    xb = Math.min(buf.length, Math.round(xb));
    const span = xb - xa;
    if (span <= 0) return;
    for (let x = xa; x < xb; x++) {
      const t = (x - xa) / span;
      buf[x] = ya + (yb - ya) * t;
    }
  }

  function generatePattern(width, height) {
    const baseY = height / 2;
    const buf = new Array(width).fill(baseY);
    let x = 0;
    let y = baseY;
    while (x < width - 40) {
      const amp = 0.5 + Math.random() * 0.9;   // random pulse strength each beat
      const gap = 45 + Math.random() * 75;      // random spacing between beats
      const x0 = x;
      x = x0 + gap;
      lerpFill(buf, x0, x, y, baseY); y = baseY;   // resting baseline
      // P wave
      const pPeak = baseY - 0.08 * height * amp;
      lerpFill(buf, x, x + 5, y, pPeak); x += 5; y = pPeak;
      lerpFill(buf, x, x + 5, y, baseY); x += 5; y = baseY;
      lerpFill(buf, x, x + 4, y, baseY); x += 4;   // PR segment
      // Q dip
      const qDip = baseY + 0.07 * height * amp;
      lerpFill(buf, x, x + 3, y, qDip); x += 3; y = qDip;
      // R spike
      const rPeak = baseY - 0.44 * height * amp;
      lerpFill(buf, x, x + 4, y, rPeak); x += 4; y = rPeak;
      // S dip
      const sDip = baseY + 0.24 * height * amp;
      lerpFill(buf, x, x + 5, y, sDip); x += 5; y = sDip;
      lerpFill(buf, x, x + 6, y, baseY); x += 6; y = baseY;  // back to baseline
      lerpFill(buf, x, x + 10, y, baseY); x += 10;  // ST segment
      // T wave
      const tPeak = baseY - 0.13 * height * amp;
      lerpFill(buf, x, x + 10, y, tPeak); x += 10; y = tPeak;
      lerpFill(buf, x, x + 16, y, baseY); x += 16; y = baseY;
    }
    lerpFill(buf, x, width, y, baseY);
    return buf;
  }

  function sizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height)) || 70;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    displayBuf = generatePattern(W, H);
    nextBuf = generatePattern(W, H);
    head = 0;
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    const headIdx = Math.min(W - 1, Math.floor(head));

    ctx.beginPath();
    ctx.strokeStyle = crimson;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let x = 0; x < W; x++) {
      const y = displayBuf[x];
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // erase a small gap just ahead of the cursor — the classic monitor "sweep" look
    ctx.clearRect(headIdx + 1, 0, GAP_WIDTH, H);

    // the sweeping cursor dot itself
    const dotY = nextBuf[headIdx] !== undefined ? nextBuf[headIdx] : H / 2;
    ctx.beginPath();
    ctx.fillStyle = crimson;
    ctx.shadowColor = "rgba(158,27,50,0.85)";
    ctx.shadowBlur = 8;
    ctx.arc(headIdx, dotY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function frame(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    if (!reduced) {
      head += SPEED * dt;
      if (head >= W) {
        head -= W;
        displayBuf = nextBuf;
        nextBuf = generatePattern(W, H);
      }
      const headIdx = Math.min(W - 1, Math.floor(head));
      for (let x = 0; x <= headIdx; x++) displayBuf[x] = nextBuf[x];
    }
    render();
    requestAnimationFrame(frame);
  }

  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);
  requestAnimationFrame(frame);
})();

/* ============================================================
   SITE NAV — mobile hamburger toggle + scroll shadow
   ============================================================ */
(function initSiteNav() {
  const nav = document.getElementById("siteNav");
  const toggle = document.getElementById("siteNavToggle");
  const mobilePanel = document.getElementById("siteNavMobile");
  if (!nav || !toggle || !mobilePanel) return;

  function setOpen(open) {
    nav.classList.toggle("navOpen", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const icon = toggle.querySelector("i");
    if (icon) icon.className = open ? "fa-solid fa-xmark" : "fa-solid fa-bars";
  }

  toggle.addEventListener("click", () => setOpen(!nav.classList.contains("navOpen")));
  mobilePanel.querySelectorAll("a").forEach(a => a.addEventListener("click", () => setOpen(false)));
  document.addEventListener("click", e => {
    if (nav.classList.contains("navOpen") && !nav.contains(e.target)) setOpen(false);
  });

  function onScroll() { nav.classList.toggle("navScrolled", window.scrollY > 8); }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();

/* ============================================================
   ইন-পেজ রাউটার — কীভাবে কাজ করে / সংবাদ / রক্তের গ্রুপ চার্ট ইত্যাদি
   এই পেজগুলো আলাদা .html ফাইল নয়, একই index.html-এর ভেতরেই আছে।
   URL হ্যাশ (#process, #news, #news/<id>, #blood-group) দেখে হোম পেজ
   লুকিয়ে সংশ্লিষ্ট রুট পেজ দেখানো হয়।
   ============================================================ */
(function initRoutePages() {
  const ROUTES = ["process", "blood-group", "news", "news-detail", "donations", "hospitals", "gallery"];
  const ROUTE_TITLES = {
    "process": "কীভাবে কাজ করে",
    "blood-group": "রক্তের গ্রুপ চার্ট",
    "news": "সংবাদ ও আপডেট",
    "news-detail": "সংবাদ",
    "donations": "সকল রক্তদান রেকর্ড",
    "hospitals": "হাসপাতাল ও ব্লাড ব্যাংক",
    "gallery": "সব রক্তদানের ছবি"
  };
  const heroEl = document.getElementById("top");
  const mainEl = document.getElementById("main");
  if (!heroEl || !mainEl) return;

  const siteNavEl = document.getElementById("siteNav");
  const routeBackTitleEl = document.getElementById("siteNavRouteBackTitle");
  const routeBackEl = document.getElementById("siteNavRouteBrand");
  const navLinks = document.querySelectorAll("[data-nav-route]");

  function markActiveNav(currentRoute) {
    navLinks.forEach(link => {
      link.classList.toggle("navLinkActive", link.getAttribute("data-nav-route") === currentRoute);
    });
  }

  /* "#news" opens the news list page; "#news/<id>" (also what the share
     buttons link to — see buildNewsShareUrl) opens that one news item's
     detail page. A raw hash of "blood-group" must NOT be mistaken for a
     "news" route, so only an exact "news" or a "news/" prefix counts. */
  function parseHash(rawHash) {
    const hash = (rawHash || "").replace("#", "");
    if (hash.indexOf("news/") === 0 && hash.length > 5) {
      let id = hash.slice(5);
      try { id = decodeURIComponent(id); } catch (err) { /* malformed % sequence — use raw */ }
      return { route: "news-detail", newsId: id };
    }
    if (hash === "news" || hash === "news/") return { route: "news", newsId: null };
    return { route: hash, newsId: null };
  }

  function showRoute(hash) {
    const parsed = parseHash(hash);
    const isRoute = ROUTES.includes(parsed.route);
    ROUTES.forEach(r => {
      const page = document.getElementById("route-" + r);
      if (page) page.classList.toggle("active", isRoute && parsed.route === r);
    });
    heroEl.style.display = isRoute ? "none" : "";
    mainEl.style.display = isRoute ? "none" : "";
    markActiveNav(!isRoute ? "home" : (parsed.route === "news-detail" ? "news" : parsed.route));
    if (siteNavEl) siteNavEl.classList.toggle("inRoutePage", isRoute);
    if (routeBackTitleEl) routeBackTitleEl.textContent = isRoute ? (ROUTE_TITLES[parsed.route] || "") : "হোম";
    if (routeBackEl) {
      const toNews = parsed.route === "news-detail";
      routeBackEl.setAttribute("href", toNews ? "#news" : "#top");
      routeBackEl.setAttribute("aria-label", toNews ? "সংবাদ তালিকায় ফিরে যান" : "হোমে ফিরে যান");
    }
    if (parsed.route === "gallery") {
      galleryPageState.page = 1;
      renderGalleryAll();
    }
    if (parsed.route === "news-detail") {
      currentNewsDetailId = parsed.newsId;
      renderNewsDetail();
    }
    window.scrollTo(0, 0);
  }

  function handleHash() {
    showRoute(location.hash || "");
  }

  window.addEventListener("hashchange", handleHash);
  handleHash();
})();

/* ============================================================
   FLOATING CALL BUTTON
   ============================================================ */
(function initCallFab() {
  const fab = document.getElementById("callFab");
  const btn = document.getElementById("callFabBtn");
  if (!fab || !btn) return;
  btn.addEventListener("click", () => fab.classList.toggle("open"));
  document.addEventListener("click", e => {
    if (!fab.contains(e.target)) fab.classList.remove("open");
  });
})();

/* ============================================================
   HEADER PHONE CLICK -> CALLING CARD POPUP MODAL
   ============================================================ */
(function initCallingCardModal() {
  const overlay = document.getElementById("callingCardOverlay");
  const closeBtn = document.getElementById("callingCardClose");
  const bgEl = document.getElementById("callingCardBg");
  const nameEl = document.getElementById("callingCardName");
  const phoneEl = document.getElementById("callingCardPhone");
  const callBtn = document.getElementById("callingCardCallBtn");
  const waBtn = document.getElementById("callingCardWaBtn");
  const msgBtn = document.getElementById("callingCardMsgBtn");
  if (!overlay) return;

  function openCallingCard(chip) {
    const name = chip.getAttribute("data-cc-name") || "";
    const phone = chip.getAttribute("data-cc-phone") || "";
    const photo = chip.getAttribute("data-cc-photo") || "";
    const whatsapp = (chip.getAttribute("data-cc-whatsapp") || phone).replace(/[^0-9]/g, "");
    const messenger = chip.getAttribute("data-cc-messenger") || "";

    nameEl.textContent = name;
    phoneEl.textContent = phone;
    bgEl.style.backgroundImage = photo ? "url('" + photo + "')" : "";
    callBtn.setAttribute("href", "tel:" + phone.replace(/[^0-9+]/g, ""));
    waBtn.setAttribute("href", whatsapp ? "https://wa.me/" + whatsapp : "#");
    /* All 3 buttons (call / WhatsApp / Messenger) always stay visible so the
       card layout is consistent — if a Messenger link hasn't been set in
       admin, the button is just dimmed/disabled instead of disappearing. */
    msgBtn.setAttribute("href", messenger || "#");
    msgBtn.classList.toggle("callingCardActionDisabled", !messenger);

    overlay.classList.add("show");
  }
  function closeCallingCard() { overlay.classList.remove("show"); }

  /* Every calling-card trigger — the 3 header phone chips AND the 3
     items inside the floating call button's menu — share the same
     ".ccTrigger" class + "data-cc-*" attributes, so both places open
     this exact same donor-ID-card popup instead of dialing directly. */
  document.querySelectorAll(".ccTrigger").forEach(trigger => {
    trigger.addEventListener("click", e => {
      e.preventDefault();
      openCallingCard(trigger);
      const fab = document.getElementById("callFab");
      if (fab) fab.classList.remove("open");
    });
  });
  if (closeBtn) closeBtn.addEventListener("click", closeCallingCard);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeCallingCard(); });
})();

/* ============================================================
   FOOTER YEAR
   ============================================================ */
document.getElementById("footerYear").textContent = new Date().getFullYear();

/* ============================================================
   "রক্তদাতা হিসেবে যোগ দিন" — DONOR JOIN FORM MODAL
   (clicking any .joinCallTrigger button now opens the registration
   form; the older direct-call modal is still reachable from the
   "কল করে যোগ দিন" link inside the form, for people who'd rather
   just call than fill it in)
   ============================================================ */
(function initJoinFormModal() {
  const triggers = document.querySelectorAll(".joinCallTrigger");
  const overlay = document.getElementById("joinFormModalOverlay");
  const closeBtn = document.getElementById("joinFormCloseBtn");
  const cancelBtn = document.getElementById("joinFormCancelBtn");
  const callAltBtn = document.getElementById("joinFormCallAltBtn");
  const callOverlay = document.getElementById("joinCallModalOverlay");
  const closeCallOverlayBtn = document.getElementById("joinCallCloseBtn");
  const form = document.getElementById("joinDonorForm");
  const submitBtn = document.getElementById("joinFormSubmitBtn");
  if (!triggers.length || !overlay || !form) return;

  function openNav(navWasOpenCheck) {
    const nav = document.getElementById("siteNav");
    const navToggle = document.getElementById("siteNavToggle");
    if (nav && nav.classList.contains("navOpen") && navToggle) navToggle.click();
  }
  function openForm() { overlay.style.display = "flex"; openNav(); }
  function closeForm() { overlay.style.display = "none"; }

  triggers.forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      openForm();
    });
  });
  overlay.addEventListener("click", e => { if (e.target === overlay) closeForm(); });
  if (closeBtn) closeBtn.addEventListener("click", closeForm);
  if (cancelBtn) cancelBtn.addEventListener("click", closeForm);

  if (callAltBtn && callOverlay) {
    callAltBtn.addEventListener("click", () => {
      closeForm();
      callOverlay.style.display = "flex";
    });
  }
  if (callOverlay) {
    callOverlay.addEventListener("click", e => { if (e.target === callOverlay) callOverlay.style.display = "none"; });
  }
  if (closeCallOverlayBtn && callOverlay) {
    closeCallOverlayBtn.addEventListener("click", () => { callOverlay.style.display = "none"; });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    const name = document.getElementById("joinName").value.trim();
    const mobile = document.getElementById("joinMobile").value.trim();
    const address = document.getElementById("joinAddress").value.trim();
    const bloodGroup = document.getElementById("joinBloodGroup").value;
    const age = document.getElementById("joinAge").value;
    const gender = document.getElementById("joinGender").value;

    if (!name || !mobile || !address || !bloodGroup || !age || !gender) {
      showToast("অনুগ্রহ করে সবগুলো ঘর পূরণ করুন");
      return;
    }
    if (parseInt(age, 10) < 18) {
      showToast("রক্তদাতার বয়স কমপক্ষে ১৮ বছর হতে হবে");
      return;
    }
    if (!firebaseAvailable || !db) {
      showToast("ইন্টারনেট সংযোগ পাওয়া যায়নি, একটু পর আবার চেষ্টা করুন");
      return;
    }

    const prevLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "পাঠানো হচ্ছে...";

    const reqId = "req_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const requestData = {
      id: reqId,
      name: name,
      mobile: mobile,
      address: address,
      bloodGroup: bloodGroup,
      age: age,
      gender: gender,
      status: "pending",
      requestedAt: Date.now()
    };

    db.ref("donorRequests").child(reqId).set(requestData).then(() => {
      showToast("আপনার রিকোয়েস্ট পাঠানো হয়েছে, এডমিন যাচাই করে অনুমোদন দেবে");
      form.reset();
      closeForm();
    }).catch(err => {
      console.log("Join request failed:", err);
      showToast("রিকোয়েস্ট পাঠানো যায়নি, আবার চেষ্টা করুন");
    }).finally(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = prevLabel;
    });
  });
})();


/* ============================================================
   "জরুরি রক্তের অনুরোধ" — EMERGENCY BLOOD REQUEST MODAL
   Submits straight to Firebase under emergencyRequests/{id} so the
   admin's private list (list.html → Emergency Requests) sees it
   immediately — separate from donorRequests (new-donor signups)
   above, since an emergency request is a patient/recipient asking
   for blood, not someone registering to become a donor.
   ============================================================ */
(function initEmergencyRequestModal() {
  const trigger = document.getElementById("heroEmergencyBtn");
  const overlay = document.getElementById("emergencyRequestModalOverlay");
  const closeBtn = document.getElementById("emergencyRequestCloseBtn");
  const cancelBtn = document.getElementById("emergencyRequestCancelBtn");
  const form = document.getElementById("emergencyRequestForm");
  const submitBtn = document.getElementById("emergencyRequestSubmitBtn");
  if (!trigger || !overlay || !form) return;

  function openForm() { overlay.style.display = "flex"; }
  function closeForm() { overlay.style.display = "none"; }

  trigger.addEventListener("click", e => { e.preventDefault(); openForm(); });
  overlay.addEventListener("click", e => { if (e.target === overlay) closeForm(); });
  if (closeBtn) closeBtn.addEventListener("click", closeForm);
  if (cancelBtn) cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    const patientName = document.getElementById("emrPatientName").value.trim();
    const phone = document.getElementById("emrPhone").value.trim();
    const bloodGroup = document.getElementById("emrBloodGroup").value;
    const units = document.getElementById("emrUnits").value.trim();
    const hospital = document.getElementById("emrHospital").value.trim();
    const problem = document.getElementById("emrProblem").value.trim();
    const hemoglobin = document.getElementById("emrHemoglobin").value.trim();
    const note = document.getElementById("emrNote").value.trim();

    if (!patientName || !phone || !bloodGroup || !hospital) {
      showToast("অনুগ্রহ করে আবশ্যক ঘরগুলো পূরণ করুন");
      return;
    }
    if (!firebaseAvailable || !db) {
      showToast("ইন্টারনেট সংযোগ পাওয়া যায়নি, একটু পর আবার চেষ্টা করুন");
      return;
    }

    const prevLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "পাঠানো হচ্ছে...";

    const reqId = "emr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const requestData = {
      id: reqId,
      patientName: patientName,
      phone: phone,
      bloodGroup: bloodGroup,
      units: units || "",
      hospital: hospital,
      problem: problem || "",
      hemoglobin: hemoglobin || "",
      note: note,
      status: "pending",
      requestedAt: Date.now()
    };

    db.ref("emergencyRequests").child(reqId).set(requestData).then(() => {
      showToast("আপনার জরুরি অনুরোধ পাঠানো হয়েছে, এডমিন দ্রুত যোগাযোগ করবে");
      form.reset();
      closeForm();
    }).catch(err => {
      console.log("Emergency request failed:", err);
      showToast("অনুরোধ পাঠানো যায়নি, আবার চেষ্টা করুন");
    }).finally(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = prevLabel;
    });
  });
})();


/* ============================================================
   LIVE STATS
   ============================================================ */
let statsAnimated = false;
function animateNumber(el, to) {
  const from = parseInt(el.textContent.replace(/[^0-9]/g, ""), 10) || 0;
  if (from === to) return;
  const duration = 1200;
  let start = null;
  function step(ts) {
    if (!start) start = ts;
    const progress = Math.min((ts - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString("en-US");
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = to.toLocaleString("en-US");
  }
  requestAnimationFrame(step);
  const card = el.closest(".statCard, .bloodGroupCard");
  if (card) {
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 900);
  }
}

let latestVisitorCount = readCache(CACHE_VISITOR_KEY, 0);
const BLOOD_GROUP_ID_MAP = {
  "A+": "bgAPos", "A-": "bgANeg",
  "B+": "bgBPos", "B-": "bgBNeg",
  "AB+": "bgABPos", "AB-": "bgABNeg",
  "O+": "bgOPos", "O-": "bgONeg"
};
function computeAndRenderStats(agg) {
  // agg = siteStats summary written by list.html:
  // { donorCount, totalDonations, bloodGroups:{"A+":n,...}, lastDonateDates:{"YYYY-MM-DD":n} }
  agg = (agg && typeof agg === "object" && !Array.isArray(agg)) ? agg : {};
  const totalDonors = parseInt(agg.donorCount, 10) || 0;
  const totalDonations = parseInt(agg.totalDonations, 10) || 0;

  animateNumber(document.getElementById("statDonors"), totalDonors);
  animateNumber(document.getElementById("statDonations"), totalDonations);
  computeLast28DaysDonations(agg.lastDonateDates);

  const bgCounts = {};
  Object.keys(BLOOD_GROUP_ID_MAP).forEach(g => { bgCounts[g] = parseInt((agg.bloodGroups || {})[g], 10) || 0; });
  Object.keys(BLOOD_GROUP_ID_MAP).forEach(g => {
    const el = document.getElementById(BLOOD_GROUP_ID_MAP[g]);
    if (el) animateNumber(el, bgCounts[g]);
  });
}

/* Counts donors whose most recent donation (lastDonateDate) falls
   within the last 28 days (inclusive of today) — the SAME donors[]
   data and the SAME lastDonateDate field that the "Donation
   Statement" PDF in the donor-management app (list.html) filters by,
   so the two numbers always agree.

   This used to read a separate landingPage/donationRecords
   "certificate" list instead. That list only gets an entry when a
   donation is logged through one specific quick-add flow in
   list.html (the donor-profile "add new record" button); donations
   added via CSV import or the plain donor-edit form's donation
   history never got pushed there, so this counter silently
   undercounted (e.g. showing 1) while the PDF statement — which
   reads every donor's real lastDonateDate — correctly showed 9. */
function computeLast28DaysDonations(dateCounts) {
  const map = (dateCounts && typeof dateCounts === "object") ? dateCounts : {};
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27);
  let count = 0;
  Object.keys(map).forEach(rawDate => {
    const dt = new Date(rawDate);
    if (isNaN(dt.getTime())) return;
    if (dt >= cutoff && dt <= now) count += parseInt(map[rawDate], 10) || 0;
  });
  const el = document.getElementById("statLast28");
  if (el) animateNumber(el, count);
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = window.I18N ? I18N.t(msg) : msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ============================================================
   REVEAL ON SCROLL
   ============================================================ */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("inView");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach(el => revealObserver.observe(el));

const statsObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting && !statsAnimated) {
      statsAnimated = true;
      computeAndRenderStats(readCache(CACHE_DONORS_KEY, {}));
      animateNumber(document.getElementById("statVisitors"), latestVisitorCount);
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.2 });
const statsSectionEl = document.getElementById("stats");
if (statsSectionEl) statsObserver.observe(statsSectionEl);

/* FAQ accordion toggle */
document.addEventListener("click", e => {
  const faqQ = e.target.closest(".faqQ");
  if (faqQ) {
    const item = faqQ.closest(".faqItem");
    if (item) item.classList.toggle("collapsed");
  }
});

/* ============================================================
   DONATION RECORD SEARCH (public) + ADMIN MANAGER MODAL
   ============================================================ */
(function initDonationSearchAndManager() {
  const searchInput = document.getElementById("donationSearchInput");
  const searchBtn = document.getElementById("donationSearchBtn");
  const resultOverlay = document.getElementById("donationResultModalOverlay");
  const resultContent = document.getElementById("donationResultContent");
  const resultCloseBtn = document.getElementById("donationResultCloseBtn");
  const resultModal = document.getElementById("donationResultModal");
  const resultPrintBtn = document.getElementById("donationResultPrintBtn");
  const resultDownloadBtn = document.getElementById("donationResultDownloadBtn");
  const manageBtn = document.getElementById("manageDonationRecordsBtn");
  const manageOverlay = document.getElementById("donationManageModalOverlay");
  const manageCloseBtn = document.getElementById("donationManageCloseBtn");
  if (!searchInput || !searchBtn || !resultOverlay) return;

  let currentDonationRecord = null; // last successfully found record, for the JPEG filename

  function iconRow(iconClass, label, value) {
    const row = document.createElement("div");
    row.className = "donationResultInfoRow";
    const iconWrap = document.createElement("span");
    iconWrap.className = "donationResultInfoIcon";
    const icon = document.createElement("i");
    icon.className = iconClass;
    icon.setAttribute("aria-hidden", "true");
    iconWrap.appendChild(icon);
    const textWrap = document.createElement("span");
    textWrap.className = "donationResultInfoText";
    const labelEl = document.createElement("span");
    labelEl.className = "donationResultInfoLabel";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "donationResultInfoValue";
    valueEl.textContent = value;
    textWrap.appendChild(labelEl);
    textWrap.appendChild(valueEl);
    row.appendChild(iconWrap);
    row.appendChild(textWrap);
    return row;
  }

  /* ---------- হোম সার্চ: ID / নাম / হাসপাতাল দিয়ে খোঁজা + টাইপ করলে সাজেশন ---------- */
  const SUG_LIMIT = 6;
  const sugBox = document.createElement("div");
  sugBox.className = "searchSuggest";
  sugBox.id = "searchSuggest";
  sugBox.setAttribute("role", "listbox");
  sugBox.hidden = true;
  document.body.appendChild(sugBox);
  searchInput.setAttribute("autocomplete", "off");
  searchInput.setAttribute("role", "combobox");
  searchInput.setAttribute("aria-autocomplete", "list");
  searchInput.setAttribute("aria-controls", "searchSuggest");
  searchInput.setAttribute("aria-expanded", "false");
  let sugList = [], sugActive = -1;

  const lc = s => String(s == null ? "" : s).toLowerCase();

  /* নাম, ID (পুরনো নাম্বারসহ) ও হাসপাতালের নামে মিলিয়ে দেখে; শুরুতে মিললে আগে, তারপর নতুন রক্তদান আগে */
  function searchRecords(raw) {
    const q = lc(String(raw || "").trim());
    if (!q) return [];
    const out = [];
    (landingData.donationRecords || []).forEach(r => {
      if (!r || !(r.name || r.donationNo)) return;
      const fields = [r.name, r.donationNo, r.hospitalName].concat(r.legacyNos || []).map(lc);
      let best = 0;
      fields.forEach(f => {
        if (!f) return;
        const i = f.indexOf(q);
        if (i === -1) return;
        best = Math.max(best, i === 0 ? 2 : 1);
      });
      if (best) out.push({ r: r, sc: best });
    });
    out.sort((a, b) => b.sc - a.sc || donationDateCompare(b.r, a.r));
    return out.map(o => o.r);
  }

  function appendHighlighted(parent, text, q) {
    text = String(text || "");
    const i = q ? lc(text).indexOf(q) : -1;
    if (i === -1) { parent.appendChild(document.createTextNode(text)); return; }
    parent.appendChild(document.createTextNode(text.slice(0, i)));
    const m = document.createElement("mark");
    m.textContent = text.slice(i, i + q.length);
    parent.appendChild(m);
    parent.appendChild(document.createTextNode(text.slice(i + q.length)));
  }

  function positionSuggest() {
    if (sugBox.hidden) return;
    const box = searchInput.closest(".heroSearchBox") || searchInput;
    const r = box.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    sugBox.style.left = r.left + "px";
    sugBox.style.width = r.width + "px";
    sugBox.style.top = (r.bottom + 6) + "px";
    sugBox.style.maxHeight = Math.max(140, Math.min(360, vh - r.bottom - 16)) + "px";
  }
  function hideSuggest() {
    sugBox.hidden = true;
    sugActive = -1;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
  }
  function setSugActive(i) {
    const items = sugBox.querySelectorAll(".searchSuggestItem");
    items.forEach((el, idx) => el.classList.toggle("active", idx === i));
    sugActive = i;
    if (items[i]) {
      searchInput.setAttribute("aria-activedescendant", items[i].id);
      items[i].scrollIntoView({ block: "nearest" });
    } else searchInput.removeAttribute("aria-activedescendant");
  }

  function renderSuggest() {
    const raw = (searchInput.value || "").trim();
    if (!raw || isSkeletonLoading()) { hideSuggest(); return; }
    const q = lc(raw);
    const all = searchRecords(raw);
    sugList = all.slice(0, SUG_LIMIT);
    sugBox.innerHTML = "";
    if (!all.length) {
      const empty = document.createElement("div");
      empty.className = "searchSuggestEmpty";
      empty.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
      const sp = document.createElement("span");
      sp.textContent = "কোনো রেকর্ড পাওয়া যায়নি";
      empty.appendChild(sp);
      sugBox.appendChild(empty);
    } else {
      sugList.forEach((r, i) => {
        const it = document.createElement("button");
        it.type = "button";
        it.className = "searchSuggestItem";
        it.id = "searchSug" + i;
        it.setAttribute("role", "option");
        it.setAttribute("data-idx", String(i));
        const bg = document.createElement("span");
        bg.className = "searchSuggestBg";
        bg.textContent = r.bloodGroup || "—";
        const main = document.createElement("span");
        main.className = "searchSuggestMain";
        const nm = document.createElement("span");
        nm.className = "searchSuggestName";
        appendHighlighted(nm, r.name || "", q);
        const meta = document.createElement("span");
        meta.className = "searchSuggestMeta";
        const idEl = document.createElement("span");
        idEl.className = "searchSuggestId";
        appendHighlighted(idEl, r.donationNo || "", q);
        meta.appendChild(idEl);
        if (r.hospitalName) {
          const dot = document.createElement("span");
          dot.className = "searchSuggestDot";
          dot.textContent = "•";
          const h = document.createElement("span");
          h.className = "searchSuggestHosp";
          appendHighlighted(h, r.hospitalName, q);
          meta.appendChild(dot);
          meta.appendChild(h);
        }
        main.appendChild(nm);
        main.appendChild(meta);
        it.appendChild(bg);
        it.appendChild(main);
        sugBox.appendChild(it);
      });
      if (all.length > SUG_LIMIT) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "searchSuggestMore";
        more.textContent = "মোট " + toBengaliDigits(all.length) + "টি মিলেছে — সবগুলো দেখুন";
        more.setAttribute("data-more", "1");
        sugBox.appendChild(more);
      }
    }
    sugBox.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
    sugActive = -1;
    positionSuggest();
  }

  /* একাধিক ফলাফল হলে রক্তদান রেকর্ড পেজে ওই খোঁজা অনুযায়ী ফিল্টার করে নিয়ে যায় */
  function openRecordsFiltered(q) {
    recordsFilterState.q = q;
    recordsPageState.page = 1;
    const ri = document.getElementById("recordsSearchInput");
    if (ri) ri.value = q;
    renderRecordsGrid();
    location.hash = "#donations";
  }

  function chooseRecord(r) {
    if (!r) return;
    hideSuggest();
    searchInput.value = r.name || r.donationNo || "";
    searchInput.blur();
    renderDonationResult(r);
  }

  function performDonationSearch() {
    const q = (searchInput.value || "").trim();
    if (!q) { showToast("ID, নাম বা হাসপাতালের নাম লিখুন"); return; }
    hideSuggest();
    const exact = findRecordByNo(q);
    if (exact) { renderDonationResult(exact); return; }
    const list = searchRecords(q);
    if (!list.length) { renderDonationResult(null); return; }
    if (list.length === 1) { renderDonationResult(list[0]); return; }
    openRecordsFiltered(q);
  }

  searchInput.addEventListener("input", renderSuggest);
  searchInput.addEventListener("focus", renderSuggest);
  searchInput.addEventListener("keydown", e => {
    if (sugBox.hidden) return;
    const n = sugList.length;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); setSugActive((sugActive + 1) % n); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); setSugActive((sugActive - 1 + n) % n); }
    else if (e.key === "Escape") { hideSuggest(); }
    else if (e.key === "Enter" && sugActive >= 0 && sugList[sugActive]) { e.preventDefault(); e.stopImmediatePropagation(); chooseRecord(sugList[sugActive]); }
  }, true);
  sugBox.addEventListener("mousedown", e => e.preventDefault()); // ইনপুটের ফোকাস না হারাতে
  sugBox.addEventListener("click", e => {
    const more = e.target.closest(".searchSuggestMore");
    if (more) { const q = (searchInput.value || "").trim(); hideSuggest(); searchInput.blur(); openRecordsFiltered(q); return; }
    const it = e.target.closest(".searchSuggestItem");
    if (it) chooseRecord(sugList[parseInt(it.getAttribute("data-idx"), 10)]);
  });
  document.addEventListener("pointerdown", e => {
    if (sugBox.hidden) return;
    if (sugBox.contains(e.target) || searchInput.contains(e.target) || e.target.closest("#donationSearchBtn")) return;
    hideSuggest();
  });
  window.addEventListener("resize", positionSuggest);
  window.addEventListener("scroll", positionSuggest, { passive: true });
  window.addEventListener("hashchange", hideSuggest);

  /* Shared renderer — used by manual search AND by auto-opening a card
     when the page is loaded with a ?id=... link (e.g. from a QR scan). */
  function renderDonationResult(found) {
    currentDonationRecord = found || null;
    resultContent.innerHTML = "";
    if (resultModal) resultModal.classList.remove("sharpMode");

    /* ---- watermark (logo + "BNB") behind everything in the card ---- */
    const watermarkLogoSrc = appConfigData.logoImage && appConfigData.logoImage.trim() ? appConfigData.logoImage : "fav.jpeg";
    const watermark = document.createElement("div");
    watermark.className = "donationResultWatermark";
    watermark.setAttribute("aria-hidden", "true");
    const watermarkImg = document.createElement("img");
    watermarkImg.alt = "";
    loadImageWithFallback(watermarkImg, watermarkLogoSrc);
    const watermarkText = document.createElement("div");
    watermarkText.className = "donationResultWatermarkText";
    watermarkText.textContent = "BNB";
    watermark.appendChild(watermarkImg);
    watermark.appendChild(watermarkText);
    resultContent.appendChild(watermark);

    if (!found) {
      const wrap = document.createElement("div");
      wrap.className = "donationNotFound";
      const iconCircle = document.createElement("div");
      iconCircle.className = "donationResultIconCircle";
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-magnifying-glass";
      icon.setAttribute("aria-hidden", "true");
      iconCircle.appendChild(icon);
      const msg = document.createElement("p");
      msg.textContent = "এই ID-তে কোনো রেকর্ড পাওয়া যায়নি। ID আবার যাচাই করুন।";
      wrap.appendChild(iconCircle);
      wrap.appendChild(msg);
      resultContent.appendChild(wrap);
    } else {
      /* ---- crimson certificate head band ---- */
      const headBand = document.createElement("div");
      headBand.className = "donationResultHeadBand";

      const ribbon = document.createElement("div");
      ribbon.className = "donationResultRibbon";
      ribbon.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>Verified';
      headBand.appendChild(ribbon);

      /* ---- website/organization logo only — brand text + eyebrow removed ---- */
      const brandRow = document.createElement("div");
      brandRow.className = "donationResultBrandRow";
      const logoImg = document.createElement("img");
      logoImg.className = "donationResultLogo";
      logoImg.alt = (landingData.siteName || "Blood Network").trim();
      brandRow.appendChild(logoImg);
      headBand.appendChild(brandRow);
      const logoSrc = appConfigData.logoImage && appConfigData.logoImage.trim() ? appConfigData.logoImage : "fav.jpeg";
      loadImageWithFallback(logoImg, logoSrc);

      /* ---- donor photo is set as the head band's OWN background (not a separate element) ---- */
      if (found.hidePhoto) {
        const fallback = document.createElement("div");
        fallback.className = "donationResultAvatarFallback donationResultAvatarHidden";
        const fbIcon = document.createElement("i");
        fbIcon.className = "fa-solid fa-eye-slash";
        fbIcon.setAttribute("aria-hidden", "true");
        fallback.appendChild(fbIcon);
        const fbText = document.createElement("span");
        fbText.className = "donationResultAvatarHiddenText";
        fbText.textContent = "ডোনার ছবি প্রকাশ করতে ইচ্ছুক নয়";
        fallback.appendChild(fbText);
        headBand.appendChild(fallback);
      } else if (found.image) {
        loadBackgroundWithFallback(headBand, found.image, "hasImage");
      } else {
        const fallback = document.createElement("div");
        fallback.className = "donationResultAvatarFallback";
        const fbIcon = document.createElement("i");
        fbIcon.className = "fa-solid fa-user";
        fbIcon.setAttribute("aria-hidden", "true");
        fallback.appendChild(fbIcon);
        headBand.appendChild(fallback);
      }
      const verifiedBadge = document.createElement("span");
      verifiedBadge.className = "donationResultVerifiedBadge";
      verifiedBadge.innerHTML = '<i class="fa-solid fa-droplet" aria-hidden="true"></i>';
      headBand.appendChild(verifiedBadge);
      resultContent.appendChild(headBand);

      /* ---- body ---- */
      const body = document.createElement("div");
      body.className = "donationResultBody";

      /* ID — moved below the header band */
      const noPill = document.createElement("span");
      noPill.className = "donationResultNo";
      const noIcon = document.createElement("i");
      noIcon.className = "fa-solid fa-hashtag";
      noIcon.setAttribute("aria-hidden", "true");
      noPill.appendChild(noIcon);
      noPill.appendChild(document.createTextNode("ID: " + found.donationNo));
      body.appendChild(noPill);

      /* ---- কত তম ডোনার ---- */
      const serialNo = donorSerialNo(found);
      if (serialNo > 0) {
        const serialEl = document.createElement("div");
        serialEl.className = "donationResultSerial";
        serialEl.innerHTML = '<i class="fa-solid fa-ranking-star" aria-hidden="true"></i><b>' + toBengaliDigits(serialNo) + ' নাম্বার</b> ডোনার';
        body.appendChild(serialEl);
      }

      /* ---- name + blood group, same row ---- */
      const nameRow = document.createElement("div");
      nameRow.className = "donationResultNameRow";
      const nameEl = document.createElement("div");
      nameEl.className = "donationResultName";
      nameEl.textContent = (found.name || "").trim();
      nameRow.appendChild(nameEl);
      const bgBadge = document.createElement("span");
      bgBadge.className = "donationResultBgBadge";
      bgBadge.textContent = found.bloodGroup || "—";
      nameRow.appendChild(bgBadge);
      body.appendChild(nameRow);

      /* ---- total donation count, modern pill ---- */
      const countBadge = document.createElement("div");
      countBadge.className = "donationResultCountBadge";
      countBadge.innerHTML =
        '<i class="fa-solid fa-droplet" aria-hidden="true"></i>' +
        '<b>' + ordinalShortBn(found.visitCount || 1) + '</b> বারের মতো';
      body.appendChild(countBadge);

      /* ---- last donation date (+ optional list of all donation dates) ---- */
      if (found.date) {
        const lastRow = document.createElement("div");
        lastRow.className = "donationResultLastDate";
        const lastIcon = document.createElement("i");
        lastIcon.className = "fa-regular fa-calendar";
        lastIcon.setAttribute("aria-hidden", "true");
        lastRow.appendChild(lastIcon);
        lastRow.appendChild(document.createTextNode("সর্বশেষ রক্তদান: " + (recordDateBn(found.date) || found.date)));
        body.appendChild(lastRow);
      }

      /* হাসপাতাল — plain text line, no icon/box design; hospital name itself is bold */
      const hospitalLine = document.createElement("p");
      hospitalLine.className = "donationResultHospitalLine";
      hospitalLine.appendChild(document.createTextNode(
        "(" + (found.bloodGroup || "") + ") লাল ভালোবাসা দান করলেন "
      ));
      const hospitalNameStrong = document.createElement("strong");
      hospitalNameStrong.textContent = (found.hospitalName || "").trim();
      hospitalLine.appendChild(hospitalNameStrong);
      hospitalLine.appendChild(document.createTextNode(window.I18N && I18N.lang === "en" ? "." : " এ।"));
      body.appendChild(hospitalLine);

      const divider = document.createElement("div");
      divider.className = "donationResultDivider";
      divider.innerHTML = '<i class="fa-solid fa-droplet" aria-hidden="true"></i>';
      body.appendChild(divider);

      const thanks = document.createElement("div");
      thanks.className = "donationResultThanks";
      const networkName = (landingData.siteName || "ব্লাড নেটওয়ার্ক").trim();
      thanks.innerHTML =
        '<strong>' + networkName.replace(/[<>&]/g, "") + '</strong> এর পক্ষ থেকে অবিরাম ভালোবাসা রইলো।<br>';
      body.appendChild(thanks);

      const emojiRow = document.createElement("div");
      emojiRow.className = "donationResultEmojiRow";
      emojiRow.textContent = (found.gender === "বোন" ? "বোন" : "ভাই") +" এর জন্য সবাই দোয়া করবেন।";
      body.appendChild(emojiRow);

      const stamp = document.createElement("div");
      stamp.className = "donationResultStamp";
      stamp.innerHTML = '<i class="fa-solid fa-shield-heart" aria-hidden="true"></i>রক্ত দিন • জীবন বাঁচান';
      body.appendChild(stamp);

      /* ---- dynamic card URL + QR code ---- */
      const cardUrl = window.location.origin + window.location.pathname + "?id=" + encodeURIComponent(found.donationNo);
      const qrWrap = document.createElement("div");
      qrWrap.className = "donationResultQrWrap";
      const qrImg = document.createElement("img");
      qrImg.className = "donationResultQrImg";
      qrImg.alt = "QR কোড — কার্ড লিংক";
      qrImg.loading = "lazy";
      qrImg.src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=" + encodeURIComponent(cardUrl);
      qrWrap.appendChild(qrImg);
      const qrCaption = document.createElement("div");
      qrCaption.className = "donationResultQrCaption";
      qrCaption.textContent = "স্ক্যান করে কার্ড দেখুন";
      qrWrap.appendChild(qrCaption);
      body.appendChild(qrWrap);

      resultContent.appendChild(body);
    }
    resultOverlay.style.display = "flex";
  }

  /* Re-renders the currently open card (if any) against whatever is
     now in landingData.donationRecords — used by the live Firebase
     listener below so an edited record (a new photo especially)
     shows up immediately instead of waiting for it to be searched
     again or for the 10-minute cache to expire. */
  function refreshOpenDonationCard() {
    if (resultOverlay.style.display !== "flex" || !currentDonationRecord) return;
    const fresh = landingData.donationRecords.find(r => r.id === currentDonationRecord.id) ||
      landingData.donationRecords.find(r => (r.donationNo || "").trim().toLowerCase() === (currentDonationRecord.donationNo || "").trim().toLowerCase());
    renderDonationResult(fresh || null);
  }
  window.refreshOpenDonationCard = refreshOpenDonationCard;
  window.renderDonationResult = renderDonationResult;

  searchBtn.addEventListener("click", performDonationSearch);
  searchInput.addEventListener("keydown", e => { if (e.key === "Enter") performDonationSearch(); });
  if (resultCloseBtn) resultCloseBtn.addEventListener("click", () => { resultOverlay.style.display = "none"; });
  resultOverlay.addEventListener("click", e => { if (e.target === resultOverlay) resultOverlay.style.display = "none"; });

  /* ---- hidden gesture: double-tap/double-click the blood group badge
     on the record card to toggle a "clean" look — square corners
     (border-radius: 0) and the close (X) button fades out (opacity: 0,
     and made unclickable while hidden). Tap it twice again to bring
     the rounded corners and close button back. Not shown anywhere in
     the UI on purpose — it's a hidden shortcut, useful for a clean
     screenshot of the card. */
  if (resultModal) {
    resultModal.addEventListener("dblclick", e => {
      if (!e.target.closest(".donationResultBgBadge")) return;
      resultModal.classList.toggle("sharpMode");
    });
  }


  /* ---- admin-only: print the currently open card, forced onto a
     single 9:16 page. The card is cloned into a dedicated print stage
     (#cardPrintRoot), scaled to fit the custom @page size defined in
     the stylesheet, and everything else is hidden via .printingCard
     on <body> for the duration of the print. ---- */
  function buildDonationCardPrintStage() {
    const source = document.getElementById("donationResultContent");
    if (!source) return null;

    let printRoot = document.getElementById("cardPrintRoot");
    if (printRoot) printRoot.remove();
    printRoot = document.createElement("div");
    printRoot.id = "cardPrintRoot";

    const clone = source.cloneNode(true);
    clone.style.transformOrigin = "top left";
    printRoot.appendChild(clone);
    document.body.appendChild(printRoot);

    // @page is 100mm x 177.78mm (a 9:16 ratio) — convert to px @ 96dpi
    // so the clone can be scaled to fit exactly one page.
    const mmToPx = 96 / 25.4;
    const pageW = 100 * mmToPx;
    const pageH = (100 * 16 / 9) * mmToPx;
    printRoot.style.width = pageW + "px";
    printRoot.style.height = pageH + "px";

    const rect = clone.getBoundingClientRect();
    const scale = Math.min(pageW / rect.width, pageH / rect.height);
    const scaledW = rect.width * scale;
    const scaledH = rect.height * scale;
    clone.style.transform = "scale(" + scale + ")";
    clone.style.marginLeft = Math.max(0, (pageW - scaledW) / 2) + "px";
    clone.style.marginTop = Math.max(0, (pageH - scaledH) / 2) + "px";

    return printRoot;
  }

  function printDonationCard() {
    if (!currentDonationRecord) return;
    if (!buildDonationCardPrintStage()) return;
    document.body.classList.add("printingCard");
    window.print();
  }

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printingCard");
    const printRoot = document.getElementById("cardPrintRoot");
    if (printRoot) printRoot.remove();
  });

  if (resultPrintBtn) {
    resultPrintBtn.addEventListener("click", printDonationCard);
  }

  /* Google Drive image hosts (drive.google.com, lh3.googleusercontent.com)
     happily let a plain <img> display them, but most do NOT send an
     Access-Control-Allow-Origin header, so a same-page fetch(url,{mode:
     "cors"}) is rejected — which is exactly what "taints" a canvas that
     later draws that image. Routing the URL through images.weserv.nl (a
     free image proxy built for this: it fetches the image server-side and
     re-serves it with a permissive CORS header) lets us actually read the
     pixels. Used only as a fallback after a direct fetch fails, so hosts
     that already allow CORS (or are same-origin) skip the extra hop. */
  function corsProxyUrl(url) {
    try {
      const withoutScheme = url.replace(/^https?:\/\//i, "");
      return "https://images.weserv.nl/?url=" + encodeURIComponent(withoutScheme);
    } catch (err) {
      return null;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
  }

  /* Fetches a (possibly cross-origin) image URL and converts it to a
     data: URL, trying the URL directly first and falling back to the CORS
     proxy. Returns null (never throws) so the caller can skip that one
     image instead of failing the whole card. */
  async function toDataUrlSafe(url) {
    if (!url || url.indexOf("data:") === 0) return url || null;
    const candidates = [url, corsProxyUrl(url)].filter(Boolean);
    for (const candidateUrl of candidates) {
      try {
        const res = await fetch(candidateUrl, { mode: "cors", cache: "no-store" });
        if (!res.ok) throw new Error("fetch failed: " + res.status);
        const blob = await res.blob();
        return await blobToDataUrl(blob);
      } catch (err) {
        console.log("toDataUrlSafe: attempt failed for", candidateUrl, err);
      }
    }
    return null;
  }

  function loadImageEl(src) {
    return new Promise((resolve) => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /* Resolves a (possibly cross-origin) image URL to an <img> element the
     canvas can safely draw AND read back from (data URL first). Google
     Drive links only reliably resolve through ONE of a few URL shapes
     (lh3.googleusercontent.com/d/ID, drive.google.com/thumbnail?id=ID, or
     the raw share URL) depending on the file — driveUrlCandidates() (same
     helper the on-screen <img> fallback already uses) gives all of them,
     and each one is tried directly and then via the CORS proxy until one
     actually produces image bytes. */
  async function loadDrawableImage(url) {
    if (!url) return null;
    const candidates = typeof driveUrlCandidates === "function" ? driveUrlCandidates(url) : [url];
    for (const candidateUrl of candidates) {
      const dataUrl = await toDataUrlSafe(candidateUrl);
      /* IMPORTANT: only ever draw a successfully-fetched data: URL.
         Falling back to drawing the original cross-origin URL directly
         would taint the canvas (the browser can't be sure we have
         permission to read those pixels back), which makes
         canvas.toDataURL() throw a SecurityError later — that thrown
         error was exactly what "প্রিভিউ তৈরি করা যায়নি" was catching. */
      if (dataUrl) {
        const img = await loadImageEl(dataUrl);
        if (img) return img;
      }
    }
    console.log("loadDrawableImage: all URL candidates failed for", url);
    return null;
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof r === "number") r = { tl: r, tr: r, br: r, bl: r };
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y);
    ctx.arcTo(x + w, y, x + w, y + r.tr, r.tr);
    ctx.lineTo(x + w, y + h - r.br);
    ctx.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
    ctx.lineTo(x + r.bl, y + h);
    ctx.arcTo(x, y + h, x, y + h - r.bl, r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.arcTo(x, y, x + r.tl, y, r.tl);
    ctx.closePath();
  }

  function drawTeardrop(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.bezierCurveTo(cx + size * 0.85, cy - size * 0.1, cx + size * 0.6, cy + size, cx, cy + size);
    ctx.bezierCurveTo(cx - size * 0.6, cy + size, cx - size * 0.85, cy - size * 0.1, cx, cy - size);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ---- draws the whole donation card by hand onto a <canvas>, using the
     Canvas 2D API instead of asking html2canvas to screenshot the live
     DOM. This is the "new system": no more DOM snapshotting, so none of
     html2canvas's cross-origin-image / negative-z-index / webfont-timing
     quirks can apply — every pixel is placed explicitly here, matching
     the on-screen card's colors, fonts and layout. ---- */
  async function buildDonationCardCanvas(record) {
    const CARD_W = 400;
    const HEAD_H = 232;
    const PAD = 26;
    const contentW = CARD_W - PAD * 2;
    const scale = 3; // render at 3x for a crisp download regardless of screen DPI

    const measure = document.createElement("canvas").getContext("2d");
    const networkName = (landingData.siteName || "ব্লাড নেটওয়ার্ক").trim();
    const T = (x) => (window.I18N ? I18N.t(x) : x);
    const hospitalText = T("(" + (record.bloodGroup || "") + ") লাল ভালোবাসা দান করলেন " + (record.hospitalName || "").trim() + " এ।");
    const thanksText = T(networkName + " এর পক্ষে থেকে অবিরাম ভালোবাসা রইলো।".replace("পক্ষে থেকে", "পক্ষ থেকে"));
    const emojiText = T((record.gender === "বোন" ? "বোন" : "ভাই") +" এর জন্য সবাই দোয়া করবেন।");
    const stampText = T("রক্ত দিন • জীবন বাঁচান");

    measure.font = "600 14.5px 'Noto Sans Bengali','Inter',sans-serif";
    const hospitalLines = wrapCanvasText(measure, hospitalText, contentW);
    measure.font = "italic 600 14.5px 'Fraunces',Georgia,serif";
    const thanksLines = wrapCanvasText(measure, thanksText, contentW);

    const serialNoCv = donorSerialNo(record);
    let bodyH = 18;   // top padding
    bodyH += 30;      // #ID row
    bodyH += serialNoCv > 0 ? 20 : 0; // serial row
    bodyH += 32;      // name + blood-group row
    bodyH += 26;      // visit-count row
    if (record.date) bodyH += 22; // last donation date row
    bodyH += hospitalLines.length * 24 + 12;
    bodyH += 24;      // divider
    bodyH += thanksLines.length * 25 + 4;
    bodyH += 30;      // emoji row
    bodyH += 44;      // stamp pill
    bodyH += 24;      // gap before QR
    bodyH += 152;     // QR box
    bodyH += 30;      // bottom padding
    let totalH = HEAD_H + bodyH;
    if (!isFinite(totalH) || totalH <= HEAD_H) totalH = HEAD_H + 400; // safety fallback, should never trigger
    console.log("buildDonationCardCanvas: card size", CARD_W + "x" + totalH, "at " + scale + "x");

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(CARD_W * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // ---- card base + rounded outer corners ----
    roundRectPath(ctx, 0, 0, CARD_W, totalH, 22);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.save();
    roundRectPath(ctx, 0, 0, CARD_W, totalH, 22);
    ctx.clip();

    // ---- watermark: drawn FIRST so it naturally sits behind everything
    //      else painted after it — no z-index trick needed at all. ----
    const logoSrc = (appConfigData.logoImage && appConfigData.logoImage.trim()) ? appConfigData.logoImage : "fav.jpeg";
    const watermarkImg = await loadDrawableImage(logoSrc);
    ctx.save();
    ctx.globalAlpha = 0.07;
    if (watermarkImg) {
      const wmW = CARD_W * 0.52;
      const wmH = wmW * (watermarkImg.height / watermarkImg.width || 1);
      ctx.filter = "grayscale(1)";
      ctx.drawImage(watermarkImg, (CARD_W - wmW) / 2, totalH / 2 - wmH - 24, wmW, wmH);
      ctx.filter = "none";
    }
    ctx.font = "800 44px 'Fraunces','Inter',sans-serif";
    ctx.fillStyle = "#211613";
    ctx.textAlign = "center";
    ctx.fillText("BNB", CARD_W / 2, totalH / 2 + 26);
    ctx.textAlign = "left";
    ctx.restore();

    // ---- head band ----
    ctx.save();
    roundRectPath(ctx, 0, 0, CARD_W, HEAD_H, { tl: 22, tr: 22, br: 0, bl: 0 });
    ctx.clip();
    const hasPhoto = !record.hidePhoto && !!record.image;
    if (hasPhoto) {
      const photoImg = await loadDrawableImage(record.image);
      if (photoImg) {
        const ir = photoImg.width / photoImg.height;
        const br = CARD_W / HEAD_H;
        let dw, dh, dx, dy;
        if (ir > br) { dh = HEAD_H; dw = dh * ir; dx = (CARD_W - dw) / 2; dy = 0; }
        else { dw = CARD_W; dh = dw / ir; dx = 0; dy = (HEAD_H - dh) / 2; }
        ctx.drawImage(photoImg, dx, dy, dw, dh);
      }
    }
    const headGrad = ctx.createLinearGradient(0, 0, CARD_W * 0.6, HEAD_H);
    if (hasPhoto) {
      headGrad.addColorStop(0, "rgba(158,27,50,0.82)");
      headGrad.addColorStop(1, "rgba(110,18,32,0.88)");
    } else {
      headGrad.addColorStop(0, "#9E1B32");
      headGrad.addColorStop(1, "#6E1220");
    }
    ctx.fillStyle = headGrad;
    ctx.fillRect(0, 0, CARD_W, HEAD_H);

    if (!hasPhoto) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "600 15.5px 'Noto Sans Bengali','Inter',sans-serif";
      ctx.textAlign = "center";
      const msg = record.hidePhoto ? (window.I18N ? I18N.t("ডোনার ছবি প্রকাশ করতে ইচ্ছুক নয়") : "ডোনার ছবি প্রকাশ করতে ইচ্ছুক নয়") : "";
      if (msg) ctx.fillText(msg, CARD_W / 2, HEAD_H / 2 + 30);
      ctx.textAlign = "left";
    }

    // ribbon ("VERIFIED"), rotated 45° across the top-right corner
    ctx.save();
    ctx.translate(CARD_W - 34 + 75, 16 + 12);
    ctx.rotate(Math.PI / 4);
    const ribbonGrad = ctx.createLinearGradient(-75, -12, 75, 12);
    ribbonGrad.addColorStop(0, "#F3D8A8");
    ribbonGrad.addColorStop(0.55, "#B9722E");
    ribbonGrad.addColorStop(1, "#8F5A20");
    ctx.fillStyle = ribbonGrad;
    ctx.fillRect(-75, -12, 150, 24);
    ctx.fillStyle = "#3A2205";
    ctx.font = "700 9.5px 'IBM Plex Mono',monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✓ VERIFIED", 0, 1);
    ctx.restore();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // brand logo circle, top-left of head band
    const logoCx = PAD + 21, logoCy = 30 + 21, logoR = 21;
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoCx, logoCy, logoR, 0, Math.PI * 2);
    ctx.clip();
    if (watermarkImg) {
      const ir2 = watermarkImg.width / watermarkImg.height || 1;
      let ldw, ldh;
      if (ir2 > 1) { ldh = logoR * 2; ldw = ldh * ir2; } else { ldw = logoR * 2; ldh = ldw / ir2; }
      ctx.drawImage(watermarkImg, logoCx - ldw / 2, logoCy - ldh / 2, ldw, ldh);
    }
    ctx.restore();

    // verified droplet badge, bottom-right of head band
    const vbx = CARD_W - 14 - 13, vby = HEAD_H - 10 - 13;
    ctx.beginPath();
    ctx.arc(vbx, vby, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#3F7A5D";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke();
    drawTeardrop(ctx, vbx, vby + 1, 5, "#ffffff");

    ctx.restore(); // end head-band clip

    // ---- body ----
    let y = HEAD_H + 26;
    ctx.fillStyle = "#211613";
    ctx.font = "700 12px 'IBM Plex Mono',monospace";
    ctx.fillText("#ID: " + (record.donationNo || ""), PAD, y);
    y += 24;
    if (serialNoCv > 0) {
      ctx.font = "700 12.5px 'Noto Sans Bengali','Inter',sans-serif";
      ctx.fillStyle = "#9E1B32";
      ctx.fillText(window.I18N ? I18N.t(toBengaliDigits(serialNoCv) + " নাম্বার ডোনার") : toBengaliDigits(serialNoCv) + " নাম্বার ডোনার", PAD, y);
      y += 28;
    } else {
      y += 8;
    }

    ctx.font = "700 23px 'Fraunces',Georgia,serif";
    ctx.fillStyle = "#211613";
    const nameText = (record.name || "").trim();
    ctx.fillText(nameText, PAD, y);
    const nameW = ctx.measureText(nameText).width;
    const bgText = record.bloodGroup || "—";
    ctx.font = "700 14.5px 'Fraunces',Georgia,serif";
    const bgTextW = ctx.measureText(bgText).width;
    const bgBadgeW = bgTextW + 26, bgBadgeH = 28;
    const bgBadgeX = PAD + nameW + 10, bgBadgeY = y - 20;
    roundRectPath(ctx, bgBadgeX, bgBadgeY, bgBadgeW, bgBadgeH, 999);
    const badgeGrad = ctx.createLinearGradient(bgBadgeX, bgBadgeY, bgBadgeX + bgBadgeW, bgBadgeY + bgBadgeH);
    badgeGrad.addColorStop(0, "#9E1B32");
    badgeGrad.addColorStop(1, "#6E1220");
    ctx.fillStyle = badgeGrad;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(bgText, bgBadgeX + 13, bgBadgeY + bgBadgeH / 2 + 1);
    ctx.textBaseline = "alphabetic";
    y += 28;

    ctx.font = "700 12.5px 'Noto Sans Bengali','Inter',sans-serif";
    ctx.fillStyle = "#7A4A18";
    drawTeardrop(ctx, PAD + 5, y - 5, 5, "#B9722E");
    ctx.fillText(window.I18N ? I18N.t(ordinalShortBn(record.visitCount || 1) + " বারের মতো") : ordinalShortBn(record.visitCount || 1) + " বারের মতো", PAD + 16, y);
    y += 26;
    if (record.date) {
      ctx.font = "600 12px 'Noto Sans Bengali','Inter',sans-serif";
      ctx.fillStyle = "#6B5B53";
      ctx.fillText(window.I18N ? I18N.t("সর্বশেষ রক্তদান: " + (recordDateBn(record.date) || record.date)) : "সর্বশেষ রক্তদান: " + (recordDateBn(record.date) || record.date), PAD, y - 4);
      y += 22;
    }

    ctx.font = "600 14.5px 'Noto Sans Bengali','Inter',sans-serif";
    ctx.fillStyle = "#211613";
    for (const line of hospitalLines) {
      ctx.fillText(line, PAD, y);
      y += 24;
    }
    y += 12;

    // divider
    ctx.strokeStyle = "#E7DCD4";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(CARD_W - PAD, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(CARD_W / 2 - 10, y - 6, 20, 12);
    drawTeardrop(ctx, CARD_W / 2, y, 4, "#B9722E");
    y += 24;

    ctx.font = "italic 600 14.5px 'Fraunces',Georgia,serif";
    ctx.fillStyle = "#211613";
    for (const line of thanksLines) {
      ctx.fillText(line, PAD, y);
      y += 25;
    }
    y += 4;

    ctx.font = "700 15px 'Noto Sans Bengali','Inter',sans-serif";
    ctx.fillStyle = "#211613";
    ctx.fillText(emojiText, PAD, y);
    y += 30;

    // stamp pill
    ctx.font = "700 11px 'Noto Sans Bengali','Inter',sans-serif";
    const stampTextW = ctx.measureText(stampText).width;
    const stampW = stampTextW + 40;
    roundRectPath(ctx, PAD, y - 20, stampW, 34, 999);
    const stampGrad = ctx.createLinearGradient(PAD, y, PAD + stampW, y);
    stampGrad.addColorStop(0, "#F7EAD8");
    stampGrad.addColorStop(1, "#F0DCB6");
    ctx.fillStyle = stampGrad;
    ctx.fill();
    ctx.strokeStyle = "#B9722E";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#7A4A18";
    ctx.fillText(stampText, PAD + 18, y + 3);
    y += 44;

    // QR code
    const cardUrl = window.location.origin + window.location.pathname + "?id=" + encodeURIComponent(record.donationNo || "");
    const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=" + encodeURIComponent(cardUrl);
    const qrImgEl = await loadDrawableImage(qrUrl);
    const qrSize = 140;
    const qrX = (CARD_W - qrSize) / 2;
    roundRectPath(ctx, qrX - 6, y - 6, qrSize + 12, qrSize + 12, 10);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(33,22,19,0.12)";
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (qrImgEl) ctx.drawImage(qrImgEl, qrX, y, qrSize, qrSize);

    ctx.restore(); // end outer card clip
    return canvas;
  }

  /* ---- admin-only: builds the card canvas above, then opens a small
     popup window that shows that canvas full-size with a download button —
     this is the "new system": the person can SEE the exact PNG (rendered
     entirely from data, not a DOM screenshot) before saving it. ---- */
  async function downloadDonationCardPNG() {
    if (!currentDonationRecord) return;
    resultDownloadBtn.disabled = true;
    const prevLabel = resultDownloadBtn.innerHTML;
    resultDownloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>প্রস্তুত হচ্ছে...</span>';
    try {
      if (document.fonts && document.fonts.ready) {
        await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1500))]);
      }
      const canvas = await buildDonationCardCanvas(currentDonationRecord);
      const dataUrl = canvas.toDataURL("image/png");
      const fileName = "donation-card-" + (currentDonationRecord.donationNo || "card") + ".png";

      const win = window.open("", "_blank", "width=460,height=780");
      if (!win) { showToast("পপ-আপ ব্লক হয়েছে, ব্রাউজারে অনুমতি দিন"); return; }
      win.document.title = fileName;
      win.document.write(
        '<!doctype html><html><head><meta charset="utf-8"><title>' + fileName + '</title>' +
        '<style>' +
        'html,body{margin:0;background:#2b2320;min-height:100%;}' +
        'body{display:flex;flex-direction:column;align-items:center;gap:16px;padding:22px;font-family:sans-serif;box-sizing:border-box;}' +
        'canvas{max-width:100%;height:auto;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,0.4);}' +
        'button{padding:12px 24px;border-radius:999px;border:none;background:#9E1B32;color:#fff;font-size:15px;font-weight:700;cursor:pointer;}' +
        'button:hover{background:#6E1220;}' +
        '</style></head><body>' +
        '<canvas id="cardCanvas" width="' + canvas.width + '" height="' + canvas.height + '"></canvas>' +
        '<button id="dlBtn">ডাউনলোড করুন</button>' +
        '</body></html>'
      );
      win.document.close();
      const targetCanvas = win.document.getElementById("cardCanvas");
      const tctx = targetCanvas.getContext("2d");
      const previewImg = new win.Image();
      previewImg.onload = () => tctx.drawImage(previewImg, 0, 0);
      previewImg.src = dataUrl;
      const dlBtn = win.document.getElementById("dlBtn");
      dlBtn.addEventListener("click", () => {
        const link = win.document.createElement("a");
        link.href = dataUrl;
        link.download = fileName;
        win.document.body.appendChild(link);
        link.click();
        link.remove();
      });
      showToast("নতুন উইন্ডোতে কার্ড প্রস্তুত");
    } catch (err) {
      console.log("Canvas card render failed:", err);
      showToast("প্রিভিউ তৈরি করা যায়নি, আবার চেষ্টা করুন");
    } finally {
      resultDownloadBtn.disabled = false;
      resultDownloadBtn.innerHTML = prevLabel;
    }
  }

  if (resultDownloadBtn) {
    resultDownloadBtn.addEventListener("click", downloadDonationCardPNG);
  }

  if (manageBtn && manageOverlay) {
    manageBtn.addEventListener("click", () => {
      renderDonationManageList();
      manageOverlay.style.display = "flex";
    });
    if (manageCloseBtn) manageCloseBtn.addEventListener("click", () => { manageOverlay.style.display = "none"; });
  }

  /* ---- auto-open donation card (.donationResultModal) when the page is
     opened via a QR / shared link like  yourdomain.com/?id=0001
     (0001 = the donor's sequential donationNo, same one used for manual
     search) ---- */
  let autoOpenedFromUrl = false;
  function tryAutoOpenDonationCardFromUrl() {
    if (autoOpenedFromUrl) return;
    const wantedId = (new URLSearchParams(window.location.search).get("id") || "").trim().toLowerCase();
    if (!wantedId) return;
    const records = (landingData && landingData.donationRecords) || [];
    const found = findRecordByNo(wantedId);
    if (found) {
      autoOpenedFromUrl = true;
      renderDonationResult(found);
    }
  }
  window.tryAutoOpenDonationCardFromUrl = tryAutoOpenDonationCardFromUrl;
  // Try right away (covers data restored from local cache) — it will be
  // retried once fresh data arrives from Firebase too.
  tryAutoOpenDonationCardFromUrl();
})();

/* ============================================================
   VISITOR COUNTER
   (localStorage, not sessionStorage, so each device/browser is
   counted exactly once — a new tab or a repeat visit later that
   day won't bump the count again)
   ============================================================ */
function bumpVisitorIfNewDevice() {
  try {
    if (localStorage.getItem("blood_donor_visited")) return;
    localStorage.setItem("blood_donor_visited", "1");
    if (firebaseAvailable && visitorRef) {
      visitorRef.transaction(curr => (curr || 0) + 1);
    }
  } catch (err) { /* ignore */ }
}

/* ============================================================
   LIVE VIEWERS + TOTAL VIEWS  (এডমিন ড্যাশবোর্ডে দেখা যায়)
   - siteStats/live/{sessionId}  : এখন যারা সাইটে আছে (ট্যাব বন্ধ হলে নিজে মুছে যায়)
   - siteStats/totalViews        : মোট ভিউ
   - siteStats/daily/{YYYY-MM-DD}: প্রতিদিনের ভিউ (বাংলাদেশ সময়, গ্রাফের জন্য)
   একই ট্যাবে রিলোড করলে ভিউ বাড়ে না — নতুন ট্যাব/সেশনে একবার গোনা হয়।
   ============================================================ */
function bdDateKey(ts) {
  return new Date((ts || Date.now()) + 6 * 3600 * 1000).toISOString().slice(0, 10);
}
function trackLiveAndViews() {
  if (!firebaseAvailable || !db) return;
  let sid = "";
  try {
    sid = sessionStorage.getItem("bnb_live_sid") || "";
    if (!sid) { sid = genId(); sessionStorage.setItem("bnb_live_sid", sid); }
  } catch (err) { sid = genId(); }

  try {
    if (!sessionStorage.getItem("bnb_view_counted")) {
      sessionStorage.setItem("bnb_view_counted", "1");
      db.ref("siteStats/totalViews").transaction(c => (c || 0) + 1);
      db.ref("siteStats/daily/" + bdDateKey()).transaction(c => (c || 0) + 1);
    }
  } catch (err) { /* ignore */ }

  const liveRef = db.ref("siteStats/live/" + sid);
  const stamp = firebase.database.ServerValue.TIMESTAMP;
  let connected = false;
  db.ref(".info/connected").on("value", snap => {
    connected = snap.val() === true;
    if (!connected) return;
    liveRef.onDisconnect().remove()
      .then(() => liveRef.set(stamp))
      .catch(err => console.log("Live presence failed:", err));
  });
  /* হার্টবিট: ট্যাব খোলা থাকলে প্রতি ৯০ সেকেন্ডে "আমি আছি" জানায় */
  setInterval(() => { if (connected && !document.hidden) liveRef.set(stamp).catch(() => {}); }, 90000);
  document.addEventListener("visibilitychange", () => { if (connected && !document.hidden) liveRef.set(stamp).catch(() => {}); });
  window.addEventListener("pagehide", () => { try { liveRef.remove(); } catch (err) { /* ignore */ } });
  window.addEventListener("pageshow", e => { if (e.persisted && connected) liveRef.set(stamp).catch(() => {}); });
}

/* ============================================================
   FIREBASE CONNECT
   ============================================================ */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    let settled = false;
    /* If a CDN script is blocked (ad-blocker, network hiccup, CSP) it can
       sometimes fail silently — neither onload nor onerror fires — which
       used to leave callers (like the export button) waiting forever. A
       10s timeout guarantees this promise always settles. */
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("script load timed out: " + src));
    }, 10000);
    s.onload = () => { if (settled) return; settled = true; clearTimeout(timeoutId); resolve(); };
    s.onerror = (err) => { if (settled) return; settled = true; clearTimeout(timeoutId); reject(err); };
    s.src = src;
    document.head.appendChild(s);
  });
}

/* html2canvas is no longer used — the admin "download card as PNG" button
   now draws the card by hand onto a <canvas> (see buildDonationCardCanvas),
   so there's nothing to lazy-load here anymore. */

function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    donorsRef = db.ref("donors");
    appConfigRef = db.ref("appConfig");
    landingPageRef = db.ref("landingPage");
    visitorRef = db.ref("siteStats/totalViews"); // ওয়েবসাইট ও অ্যাডমিন — দুই জায়গায় একই "মোট ভিউ"
    newsLikesRef = db.ref("newsLikes");
    firebaseAvailable = true;

    if (isCacheFresh(CACHE_DONORS_KEY)) {
      console.log("Donors: using cached copy, skipping download");
    } else {
      fetchDonorsOnce();
    }

    if (isCacheFresh(CACHE_APPCONFIG_KEY)) {
      console.log("AppConfig: using cached copy, skipping download");
    } else {
      fetchAppConfigOnce();
    }

    /* LandingPage content (team, FAQs, partners, news,
       gallery photos, process steps, site texts, donation records,
       notices...) used to be fetched ONCE and then reused from a
       10-minute local cache to save bandwidth (see isCacheFresh
       above). That meant an admin deleting/editing anything in
       admin.html could take up to 10 minutes to actually disappear
       or update on the public site — every visitor's browser kept
       serving its old cached copy until that timer ran out.
       Fix: landingPage is now a live listener instead, the same fix
       already applied earlier to just "importantNotice" and
       "donationRecords" individually — this generalizes it to
       EVERY field under landingPage. It still paints instantly from
       localStorage on load (see the DEFAULT_LANDING/readCache line
       near the top of this file), then Firebase's very first "value"
       event replaces that with the true current copy, and every
       future admin change (including deletes) re-fires this same
       listener and re-renders within a second or two — no more
       waiting on a cache timer. */
    landingPageRef.on("value", snapshot => {
      const val = snapshot.val() || {};
      landingReady = true;
      landingLoadFailed = false;
      skeletonDone = true;
      document.documentElement.classList.remove("skelMode");
      landingData = Object.assign({}, DEFAULT_LANDING, val);
      normalizeLandingData();
      writeCache(CACHE_LANDING_KEY, landingData);
      markFetchedNow(CACHE_LANDING_KEY);
      renderLanding();
      if (window.refreshOpenDonationCard) window.refreshOpenDonationCard();
      if (window.tryAutoOpenDonationCardFromUrl) window.tryAutoOpenDonationCardFromUrl();
    }, err => {
      console.log("Landing page listener failed:", err);
      landingLoadFailed = true;
      endSkeleton(true);
      renderNewsSection();
      renderNewsDetail();
    });

    /* Visitor count stays a live listener — it's a single small
       number, not a full collection, so keeping it real-time costs
       almost nothing next to the nodes above. */
    visitorRef.on("value", snapshot => {
      latestVisitorCount = snapshot.val() || 0;
      writeCache(CACHE_VISITOR_KEY, latestVisitorCount);
      if (statsAnimated) animateNumber(document.getElementById("statVisitors"), latestVisitorCount);
    });

    /* News likes — small dataset, so a live listener stays cheap and
       keeps like counts in sync across everyone currently viewing the
       page (e.g. two visitors on the news page at the same time). */
    newsLikesRef.on("value", snapshot => {
      newsLikesData = snapshot.val() || {};
      writeCache(CACHE_NEWS_LIKES_KEY, newsLikesData);
      updateNewsLikeUI(); // রিয়েল-টাইম: অন্য কেউ লাইক দিলেও সঙ্গে সঙ্গে বদলায়
    });

    trackLiveAndViews(); // মোট ভিউ গোনা (আলাদা visitorCount আর বাড়ানো হয় না)
  } catch (err) {
    console.log("Firebase init failed, running from local cache only:", err);
  }
}

/* One-time fetches (used both by the TTL-gated calls above and to
   force a fresh copy — e.g. right before an admin starts editing,
   so they never overwrite someone else's newer change). */
function fetchDonorsOnce() {
  // Public visitors may NOT read /donors (names, phones, addresses). They read
  // only the small aggregate numbers under /siteStats (public-read in the rules).
  const s = db.ref("siteStats");
  return Promise.all([
    s.child("donorCount").once("value"),
    s.child("totalDonations").once("value"),
    s.child("bloodGroups").once("value"),
    s.child("lastDonateDates").once("value")
  ]).then(r => {
    const agg = {
      donorCount: r[0].val() || 0,
      totalDonations: r[1].val() || 0,
      bloodGroups: r[2].val() || {},
      lastDonateDates: r[3].val() || {}
    };
    writeCache(CACHE_DONORS_KEY, agg);
    markFetchedNow(CACHE_DONORS_KEY);
    computeAndRenderStats(agg);
  }).catch(err => console.log("Stats fetch failed:", err));
}

function fetchAppConfigOnce() {
  return appConfigRef.child("logoImage").once("value").then(snapshot => {
    appConfigData = { logoImage: snapshot.val() || "" };
    writeCache(CACHE_APPCONFIG_KEY, appConfigData);
    markFetchedNow(CACHE_APPCONFIG_KEY);
    renderLanding();
  }).catch(err => console.log("AppConfig fetch failed:", err));
}

/* landingPage no longer uses a once()+cache fetch — see the live
   landingPageRef.on("value", ...) listener in initFirebase() above,
   which replaced this so admin deletes/edits show up immediately
   instead of waiting for the old 10-minute cache to expire. */

/* Core data path: app + database only. This is what donors, donations,
   lives-impacted and visitor-count all depend on, so it loads with
   nothing else blocking it (auth is not needed to read this data). */
loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js")
  .then(() => loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"))
  .then(initFirebase)
  .catch(err => {
    console.log("Could not load Firebase SDK:", err);
    landingLoadFailed = true;
    renderNewsSection();
    renderNewsDetail();
  });

/* ============================================================
   PWA: SERVICE WORKER REGISTRATION
   Registered after "load" so it never competes with the page's
   own first paint / Firebase data for bandwidth. Safe no-op on
   browsers without support (older iOS Safari, some in-app
   browsers) and on file:// (local double-click) previews.
   ============================================================ */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js")
      .catch(err => console.log("Service worker registration failed:", err));
  });
}

/* ============================================================
   LANGUAGE CHANGE (বাংলা / English)
   i18n.js swaps all static + rendered text. Views that format
   dates / sentences from raw data are simply re-rendered so they
   pick up the new language straight away.
   ============================================================ */
document.addEventListener("bnb:langchange", function () {
  [
    typeof renderRecordsGrid === "function" && renderRecordsGrid,
    typeof renderNewsSection === "function" && renderNewsSection,
    typeof renderNewsDetail === "function" && renderNewsDetail,
    window.refreshOpenDonationCard
  ].forEach(function (fn) {
    if (!fn) return;
    try { fn(); } catch (e) { /* a view that isn't mounted yet is fine */ }
  });
});


/* ============================================================
   MOBILE ONLY — "সাম্প্রতিক রক্তদান" messy photo-deck carousel (≤640px)
   প্রতিটি ছবির নিজস্ব স্থির (একটু এলোমেলো) পজিশন/কোণ থাকে। শুধু উপরের
   ছবিটি পুরো স্ক্রিনের বাইরে উড়ে যায়, তারপর একই অ্যানিমেশনে সবার নিচে
   ঢুকে যায়। নিচের ছবিগুলো একটুও নড়ে না। ডেস্কটপে কিছুই বদলায় না।
   ============================================================ */
(function initDonationStack() {
  const grid = document.getElementById("donationGrid");
  if (!grid || !window.matchMedia) return;
  const mq = window.matchMedia("(max-width: 640px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const AUTO_MS = 5000;     // time between automatic slides
  const OUT_MS = 800;       // top photo flies off screen
  const BACK_MS = 900;      // …then slides back in underneath the pile
  // fixed pose per photo: [x%, y%, rotation°] — deliberately a bit messy
  const POSES = [
    [0, 0, -1], [-4, -3, -5], [4, -2, 4], [-4, 3, -7], [4, 4, 6],
    [-2, -4, 3], [3, 4, -4], [-5, 0, 6], [5, 2, -6], [0, -4, -3]
  ];
  let order = [];           // photo indexes, top of the deck first
  let busy = false, nextSide = 1, timer = null, paused = false, dots = null;
  let onScreen = false, entered = false, io = null;

  const getItems = () => Array.from(grid.querySelectorAll(":scope > .donationItem"));

  function ensureDots() {
    if (dots) return dots;
    dots = document.createElement("div");
    dots.className = "donationDots";
    grid.insertAdjacentElement("afterend", dots);
    dots.addEventListener("click", e => {
      const b = e.target.closest("button[data-i]");
      if (b) go(nextSide, true, parseInt(b.getAttribute("data-i"), 10));
    });
    return dots;
  }

  function applyPoses(items) {
    items.forEach((el, i) => {
      const p = POSES[i % POSES.length];
      el.style.setProperty("--tx", p[0] + "%");
      el.style.setProperty("--ty", p[1] + "%");
      el.style.setProperty("--rot", p[2] + "deg");
    });
  }

  function layout() {
    const items = getItems(), n = items.length;
    if (!n) return;
    items.forEach((el, i) => {
      const rank = order.indexOf(i);
      el.style.setProperty("--z", String(n - rank));
      el.classList.toggle("isTop", rank === 0);
    });
    if (dots) dots.querySelectorAll("button").forEach((b, i) => b.classList.toggle("act", i === order[0]));
  }

  /* 1) top photo flies completely off screen (left or right)
     2) it is moved to the bottom of the deck and slides back in under the
        pile. Photos below keep their poses — only z-order changes. */
  function go(side, user, target) {
    const items = getItems(), n = items.length;
    if (n < 2 || busy) return;
    const topIdx = order[0];
    if (target === topIdx) return;
    const goal = (target == null) ? order[1] : target;
    busy = true;
    const el = items[topIdx];
    el.setAttribute("data-out", side > 0 ? "r" : "l");
    nextSide = -side;                          // alternate sides next time
    setTimeout(() => {
      // top photo -> bottom; if a dot was tapped, bring that photo to the top
      order.push(order.shift());
      while (order[0] !== goal) order.push(order.shift());
      // keep the old top photo at the very bottom
      order.splice(order.indexOf(topIdx), 1); order.push(topIdx);
      el.removeAttribute("data-out");
      layout();
      setTimeout(() => { busy = false; }, BACK_MS);
    }, OUT_MS);
    if (user) restart();
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function restart() {
    stop();
    if (reduceMotion.matches || !mq.matches || getItems().length < 2) return;
    timer = setInterval(() => { if (!paused && onScreen && !document.hidden) go(nextSide); }, AUTO_MS);
  }

  function enable() {
    const items = getItems();
    if (!items.length) return disable();
    grid.classList.add("isStack");
    applyPoses(items);
    order = items.map((_, i) => i);
    busy = false;
    const d = ensureDots();
    d.innerHTML = items.map((_, i) => '<button type="button" data-i="' + i + '" aria-label="' + (i + 1) + '"></button>').join("");
    d.classList.toggle("on", items.length > 1);
    layout();
    restart();
    watchScreen();
  }

  /* Smooth scroll-in: when the section scrolls into view the photos glide from
     one neat stack into their poses (staggered). Auto-slide only runs on screen. */
  function reveal() {
    if (entered) { grid.classList.add("inView"); return; }
    entered = true;
    getItems().forEach((el, i) => { el.style.transitionDelay = (order.indexOf(i) * 70) + "ms"; });
    requestAnimationFrame(() => grid.classList.add("inView"));
    setTimeout(() => getItems().forEach(el => { el.style.transitionDelay = ""; }), 1800);
  }

  function watchScreen() {
    if (io) return;
    if (!("IntersectionObserver" in window)) { onScreen = true; reveal(); return; }
    io = new IntersectionObserver(es => {
      es.forEach(en => {
        onScreen = en.isIntersecting;
        if (onScreen) reveal();
      });
    }, { threshold: 0.3 });
    io.observe(grid);
  }

  function disable() {
    stop();
    grid.classList.remove("isStack", "inView");
    getItems().forEach(el => {
      el.removeAttribute("data-out"); el.classList.remove("isTop");
      ["--tx", "--ty", "--rot", "--z"].forEach(v => el.style.removeProperty(v));
    });
    if (dots) { dots.classList.remove("on"); dots.innerHTML = ""; }
  }

  function sync() { mq.matches ? enable() : disable(); }

  // swipe the top photo left/right (it flies off that way); tap a peeking photo = next
  let sx = 0, sy = 0, tracking = false, moved = false;
  grid.addEventListener("pointerdown", e => {
    if (!grid.classList.contains("isStack")) return;
    tracking = true; moved = false; paused = true; sx = e.clientX; sy = e.clientY;
  });
  grid.addEventListener("pointermove", e => {
    if (tracking && Math.abs(e.clientX - sx) > 8) moved = true;
  });
  grid.addEventListener("pointerup", e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? -1 : 1, true);
    } else if (!moved && !(e.target.closest && e.target.closest("button"))) {
      go(nextSide, true);
    }
    setTimeout(() => { paused = false; }, 2500);
  });
  grid.addEventListener("pointercancel", () => { tracking = false; paused = false; });

  // Items are re-rendered by renderDonationGallery() — re-apply when they change.
  if ("MutationObserver" in window) {
    new MutationObserver(() => { if (mq.matches) enable(); }).observe(grid, { childList: true });
  }
  (mq.addEventListener ? mq.addEventListener("change", sync) : mq.addListener(sync));
  sync();
})();
