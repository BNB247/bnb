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
const CACHE_DONORS_KEY = "blood_donor_cache";
const CACHE_VISITOR_KEY = "blood_donor_visitor_cache";

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
   PAGE LOADER (scale-in loading screen)
   Stays visible until the page has finished loading (including
   images), with a minimum show time so it never just flashes, and
   a hard maximum so it can never get stuck if something is slow.
   ============================================================ */
let pageLoaderHidden = false;
function hidePageLoader() {
  if (pageLoaderHidden) return;
  pageLoaderHidden = true;
  const loader = document.getElementById("pageLoader");
  if (loader) loader.classList.add("loaderHidden");
}
(function setupPageLoader() {
  const minTimer = new Promise(res => setTimeout(res, 450));
  const maxTimer = new Promise(res => setTimeout(res, 5000));
  const windowLoad = new Promise(res => {
    if (document.readyState === "complete") res();
    else window.addEventListener("load", res, { once: true });
  });
  Promise.race([windowLoad, maxTimer]).then(() => minTimer).then(hidePageLoader);
})();

/* ============================================================
   DEFAULT LANDING PAGE CONTENT
   ============================================================ */
const DEFAULT_LANDING = {
  siteName: "Blood Network Baraikhali",
  siteVersion: "1.0.0",
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
  testimonials: [

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
  landingData.processStepsRecipient = toArrayField(landingData.processStepsRecipient);
  landingData.processStepsDonor = toArrayField(landingData.processStepsDonor);
  landingData.testimonials = toArrayField(landingData.testimonials);
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
function genDonationNo() {
  let maxNo = 0;
  landingData.donationRecords.forEach(r => {
    const n = parseInt(r.donationNo, 10);
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
function loadImageWithFallback(imgEl, rawUrl, targetEl) {
  const target = targetEl || imgEl;
  if (!imgEl) return;
  if (!rawUrl) {
    imgEl.removeAttribute("src");
    target.classList.remove("loadingImg", "imgLoadFailed");
    return;
  }
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
function loadBackgroundWithFallback(el, rawUrl, hasImageClass) {
  if (!el) return;
  if (!rawUrl) {
    el.style.backgroundImage = "";
    el.classList.remove(hasImageClass, "loadingImg", "imgLoadFailed");
    return;
  }
  const candidates = driveUrlCandidates(rawUrl);
  el.classList.add("loadingImg");
  el.classList.remove("imgLoadFailed");
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
}

/* ============================================================
   RENDER
   ============================================================ */
function renderDonationGallery() {
  const grid = document.getElementById("donationGrid");
  if (!grid) return;
  if (!landingData.donationPhotos.length) {
    grid.innerHTML = '<div class="donationEmptyState"><i class="fa-solid fa-images" aria-hidden="true"></i><span>এখনও কোনো ছবি যোগ করা হয়নি</span></div>';
    return;
  }
  grid.innerHTML = landingData.donationPhotos.map(p => (
    '<div class="donationItem" data-donation-id="' + p.id + '">' +
      '<div class="imgSkeleton" aria-hidden="true"></div>' +
      '<img class="donationImg" alt="সাম্প্রতিক রক্তদান">' +
      '<span class="donationFailMark" aria-hidden="true"><i class="fa-solid fa-image"></i></span>' +
      '<button type="button" class="imgEditBtn" data-img-key="donation:' + p.id + '"><i class="fa-solid fa-camera" aria-hidden="true"></i></button>' +
      '<button type="button" class="imgRemoveBtn" data-img-key="donation:' + p.id + '" title="ছবি মুছুন"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
    '</div>'
  )).join("");
  landingData.donationPhotos.forEach(p => {
    const item = grid.querySelector('.donationItem[data-donation-id="' + p.id + '"]');
    if (!item) return;
    loadImageWithFallback(item.querySelector(".donationImg"), p.src, item);
  });
}

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
        (showPhoto ? '<img class="recordCardImg" alt="' + escAttr(r.name) + '">' : "") +
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

function renderRecordsGrid() {
  const grid = document.getElementById("recordsGrid");
  if (!grid) return;
  const emptyState = document.getElementById("recordsEmptyState");
  const all = (landingData.donationRecords || []).slice().sort((a, b) => {
    const na = parseInt(a.donationNo, 10) || 0, nb = parseInt(b.donationNo, 10) || 0;
    return nb - na;
  });
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

  if (!filtered.length) {
    grid.innerHTML = "";
    if (emptyState) {
      emptyState.style.display = "flex";
      const span = emptyState.querySelector("span");
      if (span) span.textContent = all.length ? "এই খোঁজে কোনো রেকর্ড পাওয়া যায়নি" : "এখনও কোনো রেকর্ড যোগ করা হয়নি";
    }
    return;
  }
  if (emptyState) emptyState.style.display = "none";
  grid.innerHTML = filtered.map(recordCardTemplate).join("");
  filtered.forEach(r => {
    const card = grid.querySelector('.recordCard[data-record-id="' + r.id + '"]');
    if (!card) return;
    const img = card.querySelector(".recordCardImg");
    if (img) loadImageWithFallback(img, r.image, card.querySelector(".recordCardPhotoWrap"));
  });
}

(function initRecordsGridPage() {
  const grid = document.getElementById("recordsGrid");
  if (!grid) return;
  const searchInput = document.getElementById("recordsSearchInput");
  const bgFilter = document.getElementById("recordsBgFilter");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      recordsFilterState.q = searchInput.value || "";
      renderRecordsGrid();
    });
  }
  if (bgFilter) {
    bgFilter.addEventListener("change", () => {
      recordsFilterState.bg = bgFilter.value || "";
      renderRecordsGrid();
    });
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

function teamCardTemplate(m) {
  return (
    '<div class="teamCard" data-team-id="' + m.id + '">' +
      '<button type="button" class="teamRemoveBtn" data-team-id="' + m.id + '" title="সদস্য মুছুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '<div class="teamPhotoWrap placeholderMode">' +
        '<div class="imgSkeleton" aria-hidden="true"></div>' +
        '<img class="teamPhoto" alt="' + escAttr(m.name) + '">' +
        '<span class="teamPlaceholderMark"><i class="fa-solid fa-user" aria-hidden="true"></i></span>' +
        '<button type="button" class="imgEditBtn" data-img-key="team:' + m.id + ':photo"><i class="fa-solid fa-camera" aria-hidden="true"></i> ছবি পরিবর্তন</button>' +
        '<button type="button" class="imgRemoveBtn" data-img-key="team:' + m.id + ':photo" title="ছবি মুছুন"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
      '</div>' +
      '<div class="teamName editable-field" data-team-id="' + m.id + '" data-field="name" contenteditable="false"></div>' +
      '<div class="teamRole editable-field" data-team-id="' + m.id + '" data-field="role" contenteditable="false"></div>' +
      '<p class="teamBio editable-field" data-team-id="' + m.id + '" data-field="bio" contenteditable="false"></p>' +
    '</div>'
  );
}

function renderTeamSection() {
  const container = document.getElementById("teamRow");
  if (!container) return;
  const existingIds = Array.from(container.children).map(c => c.getAttribute("data-team-id"));
  const newIds = landingData.team.map(m => m.id);
  const structureChanged = existingIds.length !== newIds.length || existingIds.some((id, i) => id !== newIds[i]);
  if (structureChanged) {
    container.innerHTML = landingData.team.map(teamCardTemplate).join("");
    if (isAdmin) container.querySelectorAll(".editable-field").forEach(el => el.setAttribute("contenteditable", "true"));
  }
  landingData.team.forEach(m => {
    const card = container.querySelector('.teamCard[data-team-id="' + m.id + '"]');
    if (!card) return;
    const nameEl = card.querySelector(".teamName");
    const roleEl = card.querySelector(".teamRole");
    const bioEl = card.querySelector(".teamBio");
    if (nameEl && document.activeElement !== nameEl) nameEl.textContent = m.name;
    if (roleEl && document.activeElement !== roleEl) roleEl.textContent = m.role;
    if (bioEl && document.activeElement !== bioEl) bioEl.textContent = m.bio;
    const wrap = card.querySelector(".teamPhotoWrap");
    const img = card.querySelector(".teamPhoto");
    if (m.photo) {
      wrap.classList.remove("placeholderMode");
      loadImageWithFallback(img, m.photo, wrap);
    } else {
      wrap.classList.add("placeholderMode");
      wrap.classList.remove("loadingImg", "imgLoadFailed");
      img.removeAttribute("src");
    }
  });
  setSectionVisible(document.getElementById("teamSection"), landingData.team.length > 0);
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

function toggleNewsLike(id) {
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
  renderNewsSection(); // instant local feedback
  if (firebaseAvailable && newsLikesRef) {
    newsLikesRef.child(id).transaction(curr => Math.max(0, (curr || 0) + (liked ? -1 : 1)));
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
  const months = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
  return toBengaliDigits(d.getDate()) + " " + months[d.getMonth()] + ", " + toBengaliDigits(d.getFullYear());
}

function newsCardTemplate(n) {
  return (
    '<article class="newsCard" data-news-id="' + n.id + '">' +
      '<div class="newsCardTopActions">' +
        '<button type="button" class="newsLikeBtn" data-news-id="' + n.id + '" aria-label="লাইক">' +
          '<i class="fa-regular fa-heart" aria-hidden="true"></i>' +
          '<span class="newsLikeCount"></span>' +
        '</button>' +
        '<div class="newsShareWrap">' +
          '<button type="button" class="newsShareBtn" data-news-id="' + n.id + '" aria-label="শেয়ার">' +
            '<i class="fa-solid fa-share-nodes" aria-hidden="true"></i>' +
          '</button>' +
          '<div class="newsShareMenu">' +
            '<a class="newsShareOpt waShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</a>' +
            '<a class="newsShareOpt fbShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-facebook" aria-hidden="true"></i>Facebook</a>' +
            '<a class="newsShareOpt msgShare" href="#" target="_blank" rel="noopener"><i class="fa-brands fa-facebook-messenger" aria-hidden="true"></i>Messenger</a>' +
            '<button type="button" class="newsShareOpt copyShare" data-news-id="' + n.id + '"><i class="fa-solid fa-link" aria-hidden="true"></i>লিংক কপি</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="newsCardImageWrap placeholderMode">' +
        '<div class="imgSkeleton" aria-hidden="true"></div>' +
        '<img class="newsCardImage" alt="' + escAttr(n.title) + '">' +
        '<span class="newsCardPlaceholderMark"><i class="fa-solid fa-newspaper" aria-hidden="true"></i></span>' +
      '</div>' +
      '<div class="newsCardTitleBox">' +
        '<span class="newsCardDate"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i><span class="newsCardDateText"></span></span>' +
        '<h3 class="newsCardTitle"></h3>' +
      '</div>' +
      '<p class="newsCardText"></p>' +
    '</article>'
  );
}

function renderNewsSection() {
  const container = document.getElementById("newsList");
  if (!container) return;
  const sorted = landingData.news.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const existingIds = Array.from(container.children).map(c => c.getAttribute("data-news-id"));
  const newIds = sorted.map(n => n.id);
  const structureChanged = existingIds.length !== newIds.length || existingIds.some((id, i) => id !== newIds[i]);
  if (structureChanged) {
    container.innerHTML = sorted.map(newsCardTemplate).join("");
  }
  sorted.forEach(n => {
    const card = container.querySelector('.newsCard[data-news-id="' + n.id + '"]');
    if (!card) return;
    const titleEl = card.querySelector(".newsCardTitle");
    const textEl = card.querySelector(".newsCardText");
    const dateEl = card.querySelector(".newsCardDateText");
    if (titleEl) titleEl.textContent = n.title;
    if (dateEl) dateEl.textContent = formatNewsDateBn(n.date);
    if (textEl) textEl.textContent = n.content || "";

    const wrap = card.querySelector(".newsCardImageWrap");
    const img = card.querySelector(".newsCardImage");
    if (n.newsImage) {
      wrap.classList.remove("placeholderMode");
      loadImageWithFallback(img, n.newsImage, wrap);
    } else {
      wrap.classList.add("placeholderMode");
      wrap.classList.remove("loadingImg", "imgLoadFailed");
      img.removeAttribute("src");
    }

    // like button state + count
    const likeBtn = card.querySelector(".newsLikeBtn");
    const likeIcon = likeBtn ? likeBtn.querySelector("i") : null;
    const likeCountEl = card.querySelector(".newsLikeCount");
    const likeCount = (newsLikesData && newsLikesData[n.id]) || 0;
    if (likeCountEl) likeCountEl.textContent = likeCount > 0 ? likeCount : "";
    if (likeBtn) likeBtn.classList.toggle("liked", isNewsLiked(n.id));
    if (likeIcon) likeIcon.className = isNewsLiked(n.id) ? "fa-solid fa-heart" : "fa-regular fa-heart";

    // share links — a fresh, correct URL per post, rebuilt every render
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
  setSectionVisible(document.getElementById("newsSection"), landingData.news.length > 0);
}

/* ============================================================
   NEWS LIKE / SHARE — one delegated listener on the list container
   (cards get re-rendered without re-binding, so delegation avoids
   ever double-attaching a handler).
   ============================================================ */
(function initNewsInteractions() {
  const container = document.getElementById("newsList");
  if (!container) return;

  function closeAllShareMenus(except) {
    document.querySelectorAll(".newsShareMenu.open").forEach(m => { if (m !== except) m.classList.remove("open"); });
  }

  container.addEventListener("click", e => {
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
      if (menu && willOpen) menu.classList.add("open");
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
  });

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

function testimonialCardTemplate(t) {
  const initial = (t.name || "?").trim().charAt(0) || "?";
  return (
    '<div class="testimonialCard" data-testimonial-id="' + t.id + '">' +
      '<button type="button" class="testimonialRemoveBtn" data-testimonial-id="' + t.id + '" title="গল্প মুছুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '<i class="fa-solid fa-quote-left testimonialQuoteIcon" aria-hidden="true"></i>' +
      '<p class="testimonialText editable-field" data-testimonial-id="' + t.id + '" data-field="text" contenteditable="false"></p>' +
      '<div class="testimonialFoot">' +
        '<span class="testimonialAvatar">' + initial + '</span>' +
        '<div>' +
          '<div class="testimonialName editable-field" data-testimonial-id="' + t.id + '" data-field="name" contenteditable="false"></div>' +
          '<div class="testimonialMeta">' +
            '<span class="testimonialBadge editable-field" data-testimonial-id="' + t.id + '" data-field="bloodGroup" contenteditable="false"></span>' +
            '<span class="editable-field" data-testimonial-id="' + t.id + '" data-field="meta" contenteditable="false"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function renderTestimonialsSection() {
  const container = document.getElementById("testimonialGrid");
  if (!container) return;
  const existingIds = Array.from(container.children).map(c => c.getAttribute("data-testimonial-id"));
  const newIds = landingData.testimonials.map(t => t.id);
  const structureChanged = existingIds.length !== newIds.length || existingIds.some((id, i) => id !== newIds[i]);
  if (structureChanged) {
    container.innerHTML = landingData.testimonials.map(testimonialCardTemplate).join("");
    if (isAdmin) container.querySelectorAll(".editable-field").forEach(el => el.setAttribute("contenteditable", "true"));
  }
  landingData.testimonials.forEach(t => {
    const card = container.querySelector('.testimonialCard[data-testimonial-id="' + t.id + '"]');
    if (!card) return;
    const textEl = card.querySelector(".testimonialText");
    const nameEl = card.querySelector(".testimonialName");
    const badgeEl = card.querySelector(".testimonialBadge");
    const metaEl = card.querySelector('[data-field="meta"]');
    const avatarEl = card.querySelector(".testimonialAvatar");
    if (textEl && document.activeElement !== textEl) textEl.textContent = t.text;
    if (nameEl && document.activeElement !== nameEl) nameEl.textContent = t.name;
    if (badgeEl && document.activeElement !== badgeEl) badgeEl.textContent = t.bloodGroup;
    if (metaEl && document.activeElement !== metaEl) metaEl.textContent = t.meta;
    if (avatarEl && document.activeElement !== nameEl) avatarEl.textContent = (t.name || "?").trim().charAt(0) || "?";
  });
  setSectionVisible(document.getElementById("testimonialsBody"), landingData.testimonials.length > 0);
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
  loadBackgroundWithFallback(heroEl, landingData.heroBackgroundImage, "hasImage");

  const ctaBand = document.getElementById("ctaBand");
  loadBackgroundWithFallback(ctaBand, landingData.impactImage, "hasImage");

  renderDonationGallery();
  renderRecordsGrid();
  renderNewsSection();
  renderTeamSection();
  renderFaqSection();
  renderPartnersSection();
  renderProcessCol("processStepsRecipient", "processStepsRecipient", "processStepsRecipientEmpty", "processColRecipient");
  renderProcessCol("processStepsDonor", "processStepsDonor", "processStepsDonorEmpty", "processColDonor");
  renderTestimonialsSection();

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
      if (paused) return;
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
   ইন-পেজ রাউটার — কীভাবে কাজ করে / সফলতার গল্প / রক্তের গ্রুপ চার্ট
   এই ৩টি পেজ আলাদা .html ফাইল নয়, একই index.html-এর ভেতরেই আছে।
   URL হ্যাশ (#process, #testimonials, #blood-group) দেখে হোম পেজ
   লুকিয়ে সংশ্লিষ্ট রুট পেজ দেখানো হয়।
   ============================================================ */
(function initRoutePages() {
  const ROUTES = ["process", "testimonials", "blood-group", "news", "donations"];
  const heroEl = document.getElementById("top");
  const mainEl = document.getElementById("main");
  if (!heroEl || !mainEl) return;

  const navLinks = document.querySelectorAll("[data-nav-route]");

  function markActiveNav(currentRoute) {
    navLinks.forEach(link => {
      link.classList.toggle("navLinkActive", link.getAttribute("data-nav-route") === currentRoute);
    });
  }

  /* "#news" opens the news list page; "#news/<id>" (used by the news
     share buttons — see buildNewsShareUrl) opens the same list page
     and then scrolls to + highlights that one shared post. A raw hash
     of "blood-group" must NOT be mistaken for a "news" route, so only
     an exact "news" or a "news/" prefix counts. */
  function parseHash(rawHash) {
    const hash = (rawHash || "").replace("#", "");
    if (hash === "news" || hash.indexOf("news/") === 0) {
      return { route: "news", newsId: hash.indexOf("news/") === 0 ? decodeURIComponent(hash.slice(5)) : null };
    }
    return { route: hash, newsId: null };
  }

  function highlightSharedNews(id, attemptsLeft) {
    if (!id) return;
    const card = document.querySelector('.newsCard[data-news-id="' + id + '"]');
    if (!card) {
      // News list may still be rendering (data just arrived from Firebase) — retry briefly.
      if (attemptsLeft > 0) setTimeout(() => highlightSharedNews(id, attemptsLeft - 1), 250);
      return;
    }
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("newsCardHighlight");
    setTimeout(() => card.classList.remove("newsCardHighlight"), 2600);
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
    markActiveNav(isRoute ? parsed.route : "home");
    if (parsed.route === "news" && parsed.newsId) {
      highlightSharedNews(parsed.newsId, 12);
    } else {
      window.scrollTo(0, 0);
    }
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
function computeAndRenderStats(donorsVal) {
  const donors = donorsVal ? Object.values(donorsVal) : [];
  const totalDonors = donors.length;
  const totalDonations = donors.reduce((sum, d) => sum + (parseInt(d.donationCount, 10) || 0), 0);

  animateNumber(document.getElementById("statDonors"), totalDonors);
  animateNumber(document.getElementById("statDonations"), totalDonations);
  computeLast28DaysDonations(donors);

  const bgCounts = {};
  Object.keys(BLOOD_GROUP_ID_MAP).forEach(g => { bgCounts[g] = 0; });
  donors.forEach(d => {
    const g = (d.bloodGroup || "").toString().trim().toUpperCase();
    if (bgCounts.hasOwnProperty(g)) bgCounts[g]++;
  });
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
function computeLast28DaysDonations(donors) {
  const list = donors || [];
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27);
  let count = 0;
  list.forEach(d => {
    const rawDate = (d.lastDonateDate || "").slice(0, 10);
    if (!rawDate) return;
    const dt = new Date(rawDate);
    if (isNaN(dt.getTime())) return;
    if (dt >= cutoff && dt <= now) count++;
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
  el.textContent = msg;
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
      computeAndRenderStats(readCache(CACHE_DONORS_KEY, []).reduce((acc, d) => { acc[d.id] = d; return acc; }, {}));
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

  function performDonationSearch() {
    const q = (searchInput.value || "").trim();
    if (!q) { showToast("অনুগ্রহ করে ID লিখুন"); return; }
    const found = landingData.donationRecords.find(r => (r.donationNo || "").trim().toLowerCase() === q.toLowerCase());
    renderDonationResult(found);
  }

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

      /* হাসপাতাল — plain text line, no icon/box design; hospital name itself is bold */
      const hospitalLine = document.createElement("p");
      hospitalLine.className = "donationResultHospitalLine";
      hospitalLine.appendChild(document.createTextNode(
        "(" + (found.bloodGroup || "") + ") লাল ভালোবাসা দান করলেন "
      ));
      const hospitalNameStrong = document.createElement("strong");
      hospitalNameStrong.textContent = (found.hospitalName || "").trim();
      hospitalLine.appendChild(hospitalNameStrong);
      hospitalLine.appendChild(document.createTextNode(" এ।"));
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
    const hospitalText = "(" + (record.bloodGroup || "") + ") লাল ভালোবাসা দান করলেন " + (record.hospitalName || "").trim() + " এ।";
    const thanksText = networkName + " এর পক্ষে থেকে অবিরাম ভালোবাসা রইলো।".replace("পক্ষে থেকে", "পক্ষ থেকে");
    const emojiText = (record.gender === "বোন" ? "বোন" : "ভাই") +" এর জন্য সবাই দোয়া করবেন।";
    const stampText = "রক্ত দিন • জীবন বাঁচান";

    measure.font = "600 14.5px 'Noto Sans Bengali','Inter',sans-serif";
    const hospitalLines = wrapCanvasText(measure, hospitalText, contentW);
    measure.font = "italic 600 14.5px 'Fraunces',Georgia,serif";
    const thanksLines = wrapCanvasText(measure, thanksText, contentW);

    let bodyH = 18;   // top padding
    bodyH += 30;      // #ID row
    bodyH += 32;      // name + blood-group row
    bodyH += 26;      // visit-count row
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
      const msg = record.hidePhoto ? "ডোনার ছবি প্রকাশ করতে ইচ্ছুক নয়" : "";
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
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.clip();
    if (watermarkImg) {
      const ir2 = watermarkImg.width / watermarkImg.height || 1;
      let ldw, ldh;
      if (ir2 > 1) { ldh = logoR * 2; ldw = ldh * ir2; } else { ldw = logoR * 2; ldh = ldw / ir2; }
      ctx.drawImage(watermarkImg, logoCx - ldw / 2, logoCy - ldh / 2, ldw, ldh);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(logoCx, logoCy, logoR, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();

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
    y += 32;

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
    ctx.fillText(ordinalShortBn(record.visitCount || 1) + " বারের মতো", PAD + 16, y);
    y += 26;

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
    const found = records.find(r => (r.donationNo || "").trim().toLowerCase() === wantedId);
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
    visitorRef = db.ref("siteStats/visitorCount");
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

    /* LandingPage content (team, FAQs, partners, testimonials, news,
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
      landingData = Object.assign({}, DEFAULT_LANDING, val);
      normalizeLandingData();
      writeCache(CACHE_LANDING_KEY, landingData);
      markFetchedNow(CACHE_LANDING_KEY);
      renderLanding();
      if (window.refreshOpenDonationCard) window.refreshOpenDonationCard();
      if (window.tryAutoOpenDonationCardFromUrl) window.tryAutoOpenDonationCardFromUrl();
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
      renderNewsSection();
    });

    bumpVisitorIfNewDevice();
  } catch (err) {
    console.log("Firebase init failed, running from local cache only:", err);
  }
}

/* One-time fetches (used both by the TTL-gated calls above and to
   force a fresh copy — e.g. right before an admin starts editing,
   so they never overwrite someone else's newer change). */
function fetchDonorsOnce() {
  return donorsRef.once("value").then(snapshot => {
    const val = snapshot.val() || {};
    writeCache(CACHE_DONORS_KEY, Object.values(val));
    markFetchedNow(CACHE_DONORS_KEY);
    computeAndRenderStats(val);
  }).catch(err => console.log("Donors fetch failed:", err));
}

function fetchAppConfigOnce() {
  return appConfigRef.once("value").then(snapshot => {
    const val = snapshot.val() || {};
    appConfigData = { logoImage: val.logoImage || "" };
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
  .catch(err => console.log("Could not load Firebase SDK:", err));