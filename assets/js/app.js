/* ============================================================
   SITE ROOT — worked out from this script's own URL (…/assets/js/app.js),
   so internal links/images work on ourbnb.org, on localhost, and when the
   files are opened straight from a folder (file://).
   ============================================================ */
const SITE_BASE = (function () {
  try {
    const s = document.currentScript && document.currentScript.src;
    if (s) return s.replace(/assets\/js\/[^\/?#]*(?:[?#].*)?$/, "");
  } catch (e) { /* ignore */ }
  return "/";
})();
/* Links meant to be SHARED (QR codes, canonical, share buttons) always use the real domain. */
const SITE_ORIGIN = location.protocol === "file:" ? "https://ourbnb.org" : location.origin;
function sitePage(path, query) {
  let p = path || "";
  if (location.protocol === "file:" && (p === "" || /\/$/.test(p))) p += "index.html";
  return SITE_BASE + p + (query || "");
}

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
/* পেজ-লোডিং স্কেলিটন স্ক্রিন (index.html #pageSkel, CSS: html.pageLoading)।
   ডেটা প্রস্তুত (ক্যাশ/Firebase/ব্যর্থ) আর পেজ লোড শেষ হলে ফেড-আউট হয়ে সরে যায়। */
const pageSkel = (function () {
  let started = false, done = false;
  function hide() {
    if (done) return;
    done = true;
    const h = document.documentElement;
    h.classList.add("pageSkelOut");
    setTimeout(() => h.classList.remove("pageLoading", "pageSkelOut"), 280);
  }
  function go() { requestAnimationFrame(() => requestAnimationFrame(hide)); }
  return {
    ready: function () {
      if (started) return;
      started = true;
      if (document.readyState === "complete") go();
      else { window.addEventListener("load", go, { once: true }); setTimeout(go, 2500); }
    }
  };
})();
let skeletonDone = false; // নিচে landingReady-এর সঙ্গে মেলানো হয়
function isSkeletonLoading() { return !skeletonDone; }
function endSkeleton(rerender) {
  pageSkel.ready();
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
if (landingReady) pageSkel.ready();
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

/* ---------- SECURITY HELPERS ---------- */
/* Image URL whitelist: https://..., a raster data: URL, or a plain local file name (fav.jpeg).
   Quotes / brackets / backslashes / whitespace are rejected so the value can never break out of
   a CSS url("...") or an HTML attribute. SVG data URLs and javascript: are never allowed. */
function safeImgUrl(u) {
  if (typeof u !== "string") return "";
  u = u.trim();
  if (!u || u.length > 2000000) return "";
  if (/^https:\/\/[^\s'"()<>\\]+$/i.test(u) && u.length <= 2048) return u;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/i.test(u)) return u;
  /* সাইটের নিজের ছবি: শুধু ফাইলের নাম (fav.jpeg) দিলে assets/images ফোল্ডার থেকে নেয়,
     ফলে /news/, /hospitals/ ইত্যাদি যেকোনো পেজ থেকে ঠিকঠাক লোড হয়। */
  if (/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$/.test(u)) return SITE_BASE + "assets/images/" + u;
  if (/^\/assets\/[A-Za-z0-9_.\/-]{1,100}$/.test(u)) return SITE_BASE + u.slice(1);
  if (/^[A-Za-z0-9_][A-Za-z0-9_.\/-]{0,100}$/.test(u)) return "/" + u;
  return "";
}
/* Bengali / Arabic-Indic digits -> 0-9 (people type phone numbers on Bangla keyboards) */
function normDigits(str) {
  return String(str == null ? "" : str).replace(/[\u09E6-\u09EF]/g, d => String(d.charCodeAt(0) - 0x09E6))
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
}
/* Bangladesh mobile: 01[3-9]XXXXXXXX, optional +88 / 88 prefix. Returns normalized 11-digit number or "" */
function normBdPhone(raw) {
  const v = normDigits(raw).replace(/[\s\-()]/g, "");
  const m = /^(?:\+?88)?(01[3-9][0-9]{8})$/.exec(v);
  return m ? m[1] : "";
}
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'\-]{1,59}$/u;
const NO_TAGS_RE = /[<>]/;
const VALID_BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/* Per-device spam guard for public forms: cooldown between sends + a daily cap.
   (A real server-side limit is in database.rules.json + Firebase App Check; this just stops
   accidental double-sends and lazy spam.) */
function formGuard(key, cooldownMs, dailyMax) {
  try {
    const raw = JSON.parse(localStorage.getItem("bnb_fg_" + key) || "{}");
    const now = Date.now();
    const day = bdDateKey(now);
    const sentToday = raw.day === day ? (raw.count || 0) : 0;
    if (raw.last && now - raw.last < cooldownMs) {
      return { ok: false, msg: "অনুগ্রহ করে কিছুক্ষণ পর আবার পাঠান" };
    }
    if (sentToday >= dailyMax) {
      return { ok: false, msg: "আজকের জন্য পাঠানোর সীমা শেষ। সরাসরি কল করুন।" };
    }
  } catch (e) { /* storage blocked — allow */ }
  return { ok: true };
}
function formGuardMark(key) {
  try {
    const now = Date.now(), day = bdDateKey(now);
    const raw = JSON.parse(localStorage.getItem("bnb_fg_" + key) || "{}");
    localStorage.setItem("bnb_fg_" + key, JSON.stringify({ last: now, day: day, count: (raw.day === day ? (raw.count || 0) : 0) + 1 }));
  } catch (e) { /* ignore */ }
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
/* সার্চের জন্য লেখা এক রকম করে নেয়: বাংলা সংখ্যা → ইংরেজি (১২ = 12), ছোট হাতের অক্ষর, অদৃশ্য চিহ্ন ও বাড়তি স্পেস বাদ */
function normSearch(s) {
  return String(s == null ? "" : s).normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[\u09e6-\u09ef]/g, d => String(d.charCodeAt(0) - 0x09e6))
    .toLowerCase().replace(/\s+/g, " ").trim();
}
/* "এ+", "a positive", "এবি নেগেটিভ", "o-" ... → "A+", "AB-", "O-"; রক্তের গ্রুপ না হলে "" */
function canonicalBloodGroup(q) {
  let t = normSearch(q).replace(/[\s_.()]/g, "");
  t = t.replace(/positive|pos|পজিটিভ|পজেটিভ|পজিটিব/g, "+").replace(/negative|neg|নেগেটিভ|নেগাটিভ|নেগেটিব/g, "-");
  t = t.replace(/^(এবি|ab)/, "ab").replace(/^(এ|a)(?!b)/, "a").replace(/^(বি|b)/, "b").replace(/^(ও|o)/, "o");
  const m = t.match(/^(ab|a|b|o)([+-])$/);
  return m ? m[1].toUpperCase() + m[2] : "";
}
/* Finds a card by Donor ID ("ABN-0001"), plain number ("1" / "0001"), or an old
   legacy number that was merged into the donor's single card. */
function findRecordByNo(q) {
  q = normSearch(q);
  if (!q) return null;
  const recs = landingData.donationRecords || [];
  let f = recs.find(r => normSearch(r.donationNo) === q);
  if (f) return f;
  f = recs.find(r => (r.legacyNos || []).some(x => normSearch(x) === q));
  if (f) return f;
  if (/^\d+$/.test(q)) {
    const padded = "abn-" + q.padStart(4, "0");
    f = recs.find(r => normSearch(r.donationNo) === padded);
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
  if (!id) { const ok = safeImgUrl(url); return ok ? [ok] : []; } // not a Drive link (e.g. data URL) — only if it passes the whitelist
  return [
    "https://lh3.googleusercontent.com/d/" + id + "=w1600",
    "https://drive.google.com/thumbnail?id=" + id + "&sz=w1600",
    safeImgUrl(url)
  ].filter(Boolean);
}

/* Loads an <img> with skeleton shimmer + automatic fallback across
   URL formats. targetEl (defaults to imgEl) gets "loadingImg" /
   "imgLoadFailed" classes toggled so CSS can show/hide the shimmer
   and any placeholder icon. */
/* ---- website logo shown on the top-left corner of donor photos ---- */
function donorLogoSrc() {
  return (appConfigData && appConfigData.logoImage && appConfigData.logoImage.trim()) ? appConfigData.logoImage : SITE_BASE + "assets/images/fav.jpeg";
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
        el.style.backgroundImage = 'url("' + url + '")';
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
    '<div class="donationItem" data-donation-id="' + escAttr(p.id) + '">' +
      '<div class="imgSkeleton" aria-hidden="true"></div>' +
      '<img class="donationImg" alt="সাম্প্রতিক রক্তদান">' + DONOR_LOGO_HTML +
      '<span class="donationFailMark" aria-hidden="true"><i class="fa-solid fa-image"></i></span>' +
      '<button type="button" class="imgEditBtn" data-img-key="donation:' + escAttr(p.id) + '"><i class="fa-solid fa-camera" aria-hidden="true"></i></button>' +
      '<button type="button" class="imgRemoveBtn" data-img-key="donation:' + escAttr(p.id) + '" title="ছবি মুছুন"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
    '</div>'
  )).join("");
  homePhotos.forEach(p => {
    const item = grid.querySelector('.donationItem[data-donation-id="' + CSS.escape(String(p.id)) + '"]');
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
    '<div class="galleryAllItem" data-gallery-id="' + escAttr(p.id) + '">' +
      '<div class="imgSkeleton" aria-hidden="true"></div>' +
      '<img class="donationImg" alt="রক্তদানের ছবি">' + DONOR_LOGO_HTML +
      '<span class="donationFailMark" aria-hidden="true"><i class="fa-solid fa-image"></i></span>' +
    '</div>'
  )).join("");
  items.forEach(p => {
    const item = grid.querySelector('.galleryAllItem[data-gallery-id="' + CSS.escape(String(p.id)) + '"]');
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
const recordsFilterState = {
  q: (function () { try { return (new URLSearchParams(location.search).get("q") || "").slice(0, 100); } catch (e) { return ""; } })(),
  bg: ""
};

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
    '<button type="button" class="recordCard" data-record-id="' + escAttr(r.id) + '">' +
      '<div class="recordCardPhotoWrap' + (showPhoto ? "" : " placeholderMode") + '">' +
        '<div class="imgSkeleton" aria-hidden="true"></div>' +
        (showPhoto ? '<img class="recordCardImg" alt="' + escAttr(r.name) + '">' + DONOR_LOGO_HTML : "") +
        '<span class="recordCardPlaceholder"><i class="fa-solid ' + placeholderIcon + '" aria-hidden="true"></i></span>' +
        '<span class="recordCardNo"><i class="fa-solid fa-hashtag" aria-hidden="true"></i>' + escAttr(r.donationNo || "") + '</span>' +
        '<span class="recordCardBg">' + escAttr(r.bloodGroup || "—") + '</span>' +
        '<span class="recordCardName">' + escAttr(r.name || "") + '</span>' +
      '</div>' +
      '<div class="recordCardBody">' +
        '<div class="recordCardHospital"><i class="fa-solid fa-hospital" aria-hidden="true"></i><span class="recordCardHospitalText" title="' + escAttr(r.hospitalName || "") + '">' + escAttr(r.hospitalName || "—") + '</span></div>' +
        '<div class="recordCardMetaRow">' +
          (dateBn ? '<span><i class="fa-regular fa-calendar" aria-hidden="true"></i>' + escAttr(dateBn) + '</span>' : "<span></span>") +
          '<span class="recordCardCount"><i class="fa-solid fa-droplet" aria-hidden="true"></i>' + ordinalShortBn(r.visitCount || 1) + ' বার</span>' +
        '</div>' +
        '<div class="recordCardCta"><span>কার্ড দেখুন ও ডাউনলোড</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></div>' +
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
  const q = normSearch(recordsFilterState.q);
  const qBg = canonicalBloodGroup(recordsFilterState.q);
  const bg = recordsFilterState.bg;
  const filtered = all.filter(r => {
    if (bg && (r.bloodGroup || "") !== bg) return false;
    if (!q) return true;
    return (
      normSearch(r.name).includes(q) ||
      normSearch(r.donationNo).includes(q) ||
      normSearch(r.hospitalName).includes(q) ||
      (qBg && (r.bloodGroup || "") === qBg)
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
    const card = grid.querySelector('.recordCard[data-record-id="' + CSS.escape(String(r.id)) + '"]');
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
  if (searchInput && recordsFilterState.q) searchInput.value = recordsFilterState.q;   // /donations/?q=… থেকে আসা খোঁজা
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
        '<div class="tcNameBar"><h3 class="tcName">' + escAttr(m.name || "") + '</h3>' +
          '<i class="fa-solid fa-circle-check tcVerified" aria-hidden="true" title="যাচাইকৃত"></i>' +
          '<span class="tcSrOnly">যাচাইকৃত</span></div>' +
      '</div>' +
      '<div class="tcBody">' +
        (role ? '<span class="tcRole" data-text="' + escAttr(role) + '"><span class="tcRoleText">' + escAttr(role) + '</span></span>' : "") +
        (bio ? '<p class="tcSub">' + escAttr(bio) + '</p>' : "") +
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
    '<div class="faqItem collapsed" data-faq-id="' + escAttr(f.id) + '">' +
      '<button type="button" class="faqRemoveBtn" data-faq-id="' + escAttr(f.id) + '" title="প্রশ্ন মুছুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '<div class="faqQ editable-field" data-faq-id="' + escAttr(f.id) + '" data-field="q" contenteditable="false"></div>' +
      '<span class="faqToggle"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></span>' +
      '<div class="faqA editable-field" data-faq-id="' + escAttr(f.id) + '" data-field="a" contenteditable="false"></div>' +
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
    const item = container.querySelector('.faqItem[data-faq-id="' + CSS.escape(String(f.id)) + '"]');
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
    '<div class="partnerCard" data-partner-id="' + escAttr(p.id) + '">' +
      '<button type="button" class="partnerRemoveBtn" data-partner-id="' + escAttr(p.id) + '" title="সহযোগী মুছুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '<div class="partnerLogoWrap placeholderMode">' +
        '<div class="imgSkeleton" aria-hidden="true"></div>' +
        '<img class="partnerLogo" alt="' + escAttr(p.name) + '">' +
        '<span class="partnerPlaceholderMark"><i class="fa-solid fa-building" aria-hidden="true"></i></span>' +
        '<button type="button" class="imgEditBtn" data-img-key="partner:' + escAttr(p.id) + ':logo"><i class="fa-solid fa-camera" aria-hidden="true"></i></button>' +
      '</div>' +
      '<div class="partnerName editable-field" data-partner-id="' + escAttr(p.id) + '" data-field="name" contenteditable="false"></div>' +
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
    const card = container.querySelector('.partnerCard[data-partner-id="' + CSS.escape(String(p.id)) + '"]');
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
  return SITE_ORIGIN + "/news/?post=" + encodeURIComponent(id);
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
  const href = sitePage("news/", "?post=" + encodeURIComponent(n.id));
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
   NEWS DETAIL PAGE (/news/?post=<id>) — full description, larger photo and,
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

  /* ব্রাউজার ট্যাব ও সার্চ ফলাফলের জন্য সংবাদের শিরোনাম */
  try {
    document.title = (n.title ? n.title + " — " : "") + "Blood Network Baraikhali";
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute("href", SITE_ORIGIN + "/news/?post=" + encodeURIComponent(n.id));
  } catch (err) { /* ignore */ }

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
      (h.phone ? '<a class="hospitalCardCall" href="tel:' + escAttr(String(h.phone).replace(/[^0-9+]/g, "")) + '"><i class="fa-solid fa-phone" aria-hidden="true"></i><span>' + escAttr(h.phone) + '</span></a>' : "") +
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
    '<div class="processStep" data-step-id="' + escAttr(step.id) + '" data-col="' + escAttr(colKey) + '">' +
      '<button type="button" class="stepRemoveBtn" data-step-id="' + escAttr(step.id) + '" data-col="' + escAttr(colKey) + '" title="ধাপ মুছুন"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '<span class="processStepNum">' + toBengaliDigits(index + 1) + '</span>' +
      '<div>' +
        '<div class="processStepTitle editable-field" data-step-id="' + escAttr(step.id) + '" data-col="' + escAttr(colKey) + '" data-field="title" contenteditable="false"></div>' +
        '<div class="processStepText editable-field" data-step-id="' + escAttr(step.id) + '" data-col="' + escAttr(colKey) + '" data-field="text" contenteditable="false"></div>' +
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
    const stepEl = container.querySelector('.processStep[data-step-id="' + CSS.escape(String(s.id)) + '"]');
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

/* Email / Facebook in the footer and on the About page are real links: the visible text comes from the admin
   panel (data-key), and the href is rebuilt from that same text, so editing the text updates the link. */
function updateLinkFields() {
  document.querySelectorAll("a[data-link-key]").forEach(link => {
    const field = link.querySelector(".editable-field");
    const text = ((field ? field.textContent : link.textContent) || "").trim();
    let href = "";
    if (link.getAttribute("data-link-kind") === "mailto") {
      if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(text)) href = "mailto:" + text;
    } else if (text) {
      href = safeHttpsUrl(/^https?:\/\//i.test(text) ? text.replace(/^http:\/\//i, "https://") : "https://" + text.replace(/^\/+/, ""));
    }
    if (href) link.setAttribute("href", href); else link.removeAttribute("href");
  });
}
document.addEventListener("input", e => {
  if (e.target && e.target.closest && e.target.closest("a[data-link-key]")) updateLinkFields();
});
document.addEventListener("click", e => {          // admin is typing inside the link text: don't navigate away
  const l = e.target && e.target.closest && e.target.closest("a[data-link-key]");
  if (l && isAdmin) e.preventDefault();
});

function renderLanding() {
  normalizeLandingData();
  renderNoticeBar();

  document.querySelectorAll(".editable-field[data-key]").forEach(el => {
    if (document.activeElement === el) return; // don't clobber what the admin is typing
    const key = el.getAttribute("data-key");
    if (landingData[key] !== undefined) el.textContent = landingData[key];
  });
  updateLinkFields();

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

  const logoSrc = appConfigData.logoImage && appConfigData.logoImage.trim() ? appConfigData.logoImage : SITE_BASE + "assets/images/fav.jpeg";
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
   রুট পেজ — কীভাবে কাজ করে / সংবাদ / রক্তের গ্রুপ চার্ট ইত্যাদি
   প্রতিটি পেজের নিজস্ব URL আছে (/how-it-works/, /news/, /hospitals/ …),
   আর <body data-route="…"> বলে দেয় কোন পেজ খোলা। হোম পেজে data-route নেই।
   ============================================================ */
(function initRoutePages() {
  const ROUTES = ["process", "blood-group", "news", "news-detail", "donations", "hospitals", "gallery", "about", "privacy"];
  const ROUTE_TITLES = {
    "process": "কীভাবে কাজ করে",
    "blood-group": "রক্তের গ্রুপ চার্ট",
    "news": "সংবাদ ও আপডেট",
    "about": "আমাদের সম্পর্কে",
    "privacy": "গোপনীয়তা নীতি",
    "news-detail": "সংবাদ",
    "donations": "সকল রক্তদান রেকর্ড",
    "hospitals": "হাসপাতাল ও ব্লাড ব্যাংক",
    "gallery": "সব রক্তদানের ছবি"
  };
  /* রুট → ফোল্ডার (build_pages.py এর PAGES এর সাথে মিলতে হবে) */
  const ROUTE_PATHS = {
    "process": "how-it-works/", "blood-group": "blood-group-chart/", "donations": "donations/",
    "news": "news/", "news-detail": "news/", "hospitals": "hospitals/", "gallery": "gallery/",
    "about": "about/", "privacy": "privacy/"
  };
  const heroEl = document.getElementById("top");
  const mainEl = document.getElementById("main");
  if (!heroEl || !mainEl) return;

  const siteNavEl = document.getElementById("siteNav");
  const routeBackTitleEl = document.getElementById("siteNavRouteBackTitle");
  const routeBackEl = document.getElementById("siteNavRouteBrand");
  const navLinks = document.querySelectorAll("[data-nav-route]");
  /* ডিস্কে/ফাইল থেকে খুললে (file://) পেজ-বদলে history API চলে না — তখন আগের মতোই পুরো পেজ লোড হয় */
  const SPA_OK = !!(window.history && history.pushState) && location.protocol !== "file:";
  const REDUCED_MOTION = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  function markActiveNav(currentRoute) {
    navLinks.forEach(link => {
      link.classList.toggle("navLinkActive", link.getAttribute("data-nav-route") === currentRoute);
    });
  }

  /* সাইটের মূল পাথ (যেমন "/") */
  const BASE_PATH = (function () {
    try { return new URL(SITE_BASE, location.href).pathname.replace(/\/?$/, "/"); } catch (e) { return "/"; }
  })();

  /* একটি URL কোন রুট — মিললে { route, newsId, search }, না মিললে null (তখন সাধারণ লিংকের মতো পুরো পেজ খোলে) */
  function routeFromUrl(u) {
    if (u.origin !== location.origin || u.pathname.indexOf(BASE_PATH) !== 0) return null;
    const rest = u.pathname.slice(BASE_PATH.length).replace(/index\.html$/, "").replace(/\/+$/, "");
    let route = null;
    if (rest === "") route = "home";
    else Object.keys(ROUTE_PATHS).forEach(k => { if (k !== "news-detail" && ROUTE_PATHS[k].replace(/\/$/, "") === rest) route = k; });
    if (!route) return null;
    let newsId = null;
    if (route === "news") {
      const post = (u.searchParams.get("post") || "").trim();
      if (post) { route = "news-detail"; newsId = post; }
    }
    return { route: route, newsId: newsId, search: u.search };
  }

  /* প্রথম লোডে খোলা পেজ কোনটা: <body data-route="…"> থেকে। সংবাদের বিস্তারিত পেজ হলো
     /news/?post=<id> (শেয়ার বাটনের লিংক — buildNewsShareUrl দেখুন)। */
  function initialRoute() {
    let route = (document.body.getAttribute("data-route") || "").trim();
    if (!route && SPA_OK) {                 // অফলাইনে index.html দিয়ে /news/ ইত্যাদি খুললে URL দেখে রুট ঠিক করি
      const fromUrl = routeFromUrl(new URL(location.href));
      if (fromUrl && fromUrl.route !== "home") return fromUrl;
    }
    route = route || "home";
    if (route === "news") {
      let post = "";
      try { post = (new URLSearchParams(location.search).get("post") || "").trim(); } catch (err) { /* ignore */ }
      if (post) return { route: "news-detail", newsId: post, search: location.search };
    }
    return { route: route, newsId: null, search: location.search };
  }

  /* ---------- ট্যাব বদলালে title / description / canonical ঠিক রাখা ---------- */
  function setMetaContent(selector, value) {
    const el = document.querySelector(selector);
    if (el && value) el.setAttribute("content", value);
  }
  function updateHead(info) {
    const src = info.route === "home" ? heroEl : document.getElementById("route-" + (info.route === "news-detail" ? "news" : info.route));
    if (!src) return;
    const title = src.getAttribute("data-title") || "";
    const desc = src.getAttribute("data-desc") || "";
    const descEn = src.getAttribute("data-desc-en") || "";
    const path = info.route === "home" ? "" : (ROUTE_PATHS[info.route] || "");
    const url = SITE_ORIGIN + "/" + path;
    const detail = info.route === "news-detail";
    if (title && !detail) document.title = title;
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute("href", detail ? SITE_ORIGIN + "/news/?post=" + encodeURIComponent(info.newsId) : url);
    if (detail) return;       // সংবাদের শিরোনাম/বিবরণ renderNewsDetail() বসায়
    const m = document.querySelector('meta[name="description"]');
    if (m) {
      m.setAttribute("data-bn", desc);
      if (descEn) m.setAttribute("data-en", descEn);
      m.setAttribute("content", (window.I18N && I18N.lang === "en" && descEn) ? descEn : desc);
    }
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', desc);
    setMetaContent('meta[property="og:url"]', url);
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', desc);
  }

  /* রুট পেজের শিরোনাম ও ভূমিকা-লেখা: রুট-ফোল্ডারের পেজে এগুলো আগে থেকেই থাকে,
     হোম থেকে (বা অন্য পেজ থেকে) এলে এখানে বসানো হয়। */
  function ensureIntro(sec) {
    const inner = sec && sec.querySelector(".routePageInner");
    if (!inner || inner.querySelector(".routeIntro")) return;
    const h1 = sec.getAttribute("data-h1");
    if (!h1) return;
    const head = document.createElement("header");
    head.className = "routeIntro";
    const t = document.createElement("h1"); t.className = "routeIntroTitle"; t.textContent = h1;
    head.appendChild(t);
    inner.insertBefore(head, inner.firstChild);
  }

  function animateIn(el) {
    if (!el || REDUCED_MOTION) return;
    el.classList.remove("routeEnter");
    void el.offsetWidth;
    el.classList.add("routeEnter");
    el.addEventListener("animationend", () => el.classList.remove("routeEnter"), { once: true });
  }

  function showRoute(info, opts) {
    opts = opts || {};
    const isRoute = ROUTES.includes(info.route);
    ROUTES.forEach(r => {
      const page = document.getElementById("route-" + r);
      if (page) {
        const on = isRoute && info.route === r;
        if (on) ensureIntro(page);
        page.classList.toggle("active", on);
        if (on) page.setAttribute("role", "main"); else page.removeAttribute("role");
      }
    });
    heroEl.style.display = isRoute ? "none" : "";
    mainEl.style.display = isRoute ? "none" : "";
    if (isRoute) document.body.setAttribute("data-route", info.route === "news-detail" ? "news" : info.route);
    else document.body.removeAttribute("data-route");
    document.documentElement.classList.toggle("newsDetailMode", info.route === "news-detail");
    markActiveNav(!isRoute ? "home" : (info.route === "news-detail" ? "news" : info.route));
    if (siteNavEl) {
      siteNavEl.classList.toggle("inRoutePage", isRoute);
      siteNavEl.classList.remove("navOpen");
      const tg = document.getElementById("siteNavToggle");
      if (tg) { tg.setAttribute("aria-expanded", "false"); const ic = tg.querySelector("i"); if (ic) ic.className = "fa-solid fa-bars"; }
    }
    if (routeBackTitleEl) routeBackTitleEl.textContent = isRoute ? (ROUTE_TITLES[info.route] || "") : "হোম";
    if (routeBackEl) {
      const toNews = info.route === "news-detail";
      routeBackEl.setAttribute("href", toNews ? sitePage("news/") : sitePage(""));
      routeBackEl.setAttribute("aria-label", toNews ? "সংবাদ তালিকায় ফিরে যান" : "হোমে ফিরে যান");
    }
    if (opts.spa) updateHead(info);

    if (info.route === "gallery") {
      galleryPageState.page = 1;
      renderGalleryAll();
    }
    currentNewsDetailId = info.route === "news-detail" ? info.newsId : null;
    if (info.route === "news-detail") renderNewsDetail();
    if (opts.spa && info.route === "donations") {       // /donations/?q=… — খোঁজা শব্দ বসিয়ে তালিকা ফিল্টার
      let q = "";
      try { q = (new URLSearchParams(info.search || "").get("q") || "").slice(0, 100); } catch (err) { /* ignore */ }
      if (q) {
        recordsFilterState.q = q;
        recordsPageState.page = 1;
        const inp = document.getElementById("recordsSearchInput");
        if (inp) inp.value = q;
        renderRecordsGrid();
      }
    }
    if (opts.spa && info.route === "home" && typeof window.tryAutoOpenDonationCardFromUrl === "function") {
      window.tryAutoOpenDonationCardFromUrl();            // /?id=0001 লিংক
    }

    const y = opts.pop ? ((history.state && history.state.y) || 0) : 0;
    window.scrollTo({ top: y, left: 0, behavior: "instant" });

    if (opts.spa) {
      /* শুধু মাঝের কনটেন্ট নতুন করে আসে — উপরের বার ও নিচের মেনু যেমন ছিল তেমনই থাকে */
      if (isRoute) animateIn(document.getElementById("route-" + info.route));
      else { animateIn(heroEl); animateIn(mainEl); }
      window.dispatchEvent(new Event("resize"));           // হিডেন থাকা অংশের মাপ-নির্ভর কোড নতুন করে হিসাব করে
      const focusTarget = isRoute ? document.getElementById("route-" + info.route) : heroEl;
      if (focusTarget) { focusTarget.setAttribute("tabindex", "-1"); focusTarget.focus({ preventScroll: true }); }
    }
  }

  /* ---------- রিলোড ছাড়া পেজ বদল (history API) ---------- */
  const trail = [];                           // trail[i] = i-তম history এন্ট্রির URL (পেছনের-তীর বোতামের জন্য)
  const keyOf = u => u.pathname + u.search;
  let lastKey = keyOf(location);

  function saveScroll() {
    try { history.replaceState(Object.assign({}, history.state || { spa: true, i: 0 }, { y: window.scrollY }), ""); } catch (e) { /* ignore */ }
  }

  function targetUrl(u, info) {
    const path = BASE_PATH + (info.route === "home" ? "" : ROUTE_PATHS[info.route]);
    return path + u.search;
  }

  function go(u, info, opts) {
    opts = opts || {};
    const target = targetUrl(u, info);
    if (target === location.pathname + location.search) {       // একই পেজে আবার ট্যাপ → উপরে ওঠে
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      return;
    }
    const i = history.state && typeof history.state.i === "number" ? history.state.i : 0;
    if (opts.back && i > 0 && trail[i - 1] === target) { history.back(); return; }
    saveScroll();
    trail.length = i + 1;
    trail[i + 1] = target;
    try {
      history.pushState({ spa: true, i: i + 1, y: 0 }, "", target);
    } catch (e) { location.href = u.href; return; }
    lastKey = location.pathname + location.search;
    showRoute(info, { spa: true });
  }

  /* অন্য কোড (যেমন রক্তদান খোঁজা) থেকে ডাকার জন্য: true = রিলোড ছাড়া খুলেছে */
  window.spaNavigate = function (url) {
    if (!SPA_OK) return false;
    let u; try { u = new URL(url, location.href); } catch (e) { return false; }
    const info = routeFromUrl(u);
    if (!info) return false;
    go(u, info);
    return true;
  };

  function scrollToTop() { window.scrollTo({ top: 0, left: 0, behavior: "smooth" }); }

  if (SPA_OK) {
    /* ভেতরের সব লিংক পুরো (absolute) URL করে রাখি — যাতে পেজের ঠিকানা বদলালেও (/news/ থেকে /donations/) ভাঙে না */
    document.querySelectorAll("a[href]").forEach(a => {
      const h = a.getAttribute("href");
      if (!h || /^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(h)) return;
      a.setAttribute("href", a.href);
    });

    try { history.scrollRestoration = "manual"; } catch (e) { /* ignore */ }
    trail[0] = keyOf(location);
    try { history.replaceState(Object.assign({ spa: true, i: 0, y: 0 }, history.state || {}), ""); } catch (e) { /* ignore */ }
    const startI = history.state && typeof history.state.i === "number" ? history.state.i : 0;
    trail[startI] = keyOf(location);

    let st = null;
    window.addEventListener("scroll", () => {
      clearTimeout(st);
      st = setTimeout(saveScroll, 150);
    }, { passive: true });

    document.addEventListener("click", e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const h = a.getAttribute("href") || "";
      if (h.charAt(0) === "#") {
        if (h === "#top" || /^#route-/.test(h)) { e.preventDefault(); scrollToTop(); }   // ফুটারের "উপরে ফিরে যান"
        return;
      }
      let u; try { u = new URL(a.href, location.href); } catch (err) { return; }
      const info = routeFromUrl(u);
      if (!info) return;                       // /admin/, /list/, বাইরের সাইট … → সাধারণ লিংক
      e.preventDefault();
      go(u, info, { back: a === routeBackEl });
    });

    window.addEventListener("popstate", () => {
      const key = keyOf(location);
      if (key === lastKey) return;             // শুধু #hash বদলেছে
      lastKey = key;
      const info = routeFromUrl(new URL(location.href));
      if (!info) { location.reload(); return; }
      showRoute(info, { spa: true, pop: true });
    });
  }

  showRoute(initialRoute(), { scrollTop: true });
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
    const messenger = safeHttpsUrl(chip.getAttribute("data-cc-messenger") || "");

    nameEl.textContent = name;
    phoneEl.textContent = phone;
    const safePhoto = safeImgUrl(photo);
    bgEl.style.backgroundImage = safePhoto ? 'url("' + safePhoto + '")' : "";
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
  let openedAt = 0;
  function openForm() { overlay.style.display = "flex"; openedAt = Date.now(); openNav(); }
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
    if (submitBtn.disabled) return;

    /* bot traps: hidden honeypot field + "filled too fast" — pretend success, send nothing */
    const trap = document.getElementById("joinWebsite");
    if ((trap && trap.value) || (Date.now() - openedAt) < 3000) {
      showToast("আপনার রিকোয়েস্ট পাঠানো হয়েছে, এডমিন যাচাই করে অনুমোদন দেবে");
      form.reset(); closeForm(); return;
    }

    const name = document.getElementById("joinName").value.trim().replace(/\s+/g, " ");
    const mobile = normBdPhone(document.getElementById("joinMobile").value);
    const address = document.getElementById("joinAddress").value.trim().replace(/\s+/g, " ");
    const bloodGroup = document.getElementById("joinBloodGroup").value;
    const ageRaw = normDigits(document.getElementById("joinAge").value).trim();
    const gender = document.getElementById("joinGender").value;

    if (!name || !document.getElementById("joinMobile").value.trim() || !address || !bloodGroup || !ageRaw || !gender) {
      showToast("অনুগ্রহ করে সবগুলো ঘর পূরণ করুন");
      return;
    }
    if (!NAME_RE.test(name)) { showToast("সঠিক নাম লিখুন (২-৬০ অক্ষর, শুধু অক্ষর)"); return; }
    if (!mobile) { showToast("সঠিক মোবাইল নাম্বার দিন (যেমন: 01XXXXXXXXX)"); return; }
    if (address.length < 5 || address.length > 150 || NO_TAGS_RE.test(address)) { showToast("ঠিকানা ৫-১৫০ অক্ষরের মধ্যে লিখুন"); return; }
    if (VALID_BLOOD_GROUPS.indexOf(bloodGroup) === -1) { showToast("সঠিক রক্তের গ্রুপ বেছে নিন"); return; }
    if (["Male", "Female", "Other"].indexOf(gender) === -1) { showToast("সঠিক জেন্ডার বেছে নিন"); return; }
    if (!/^[0-9]{2}$/.test(ageRaw)) { showToast("বয়স ১৮ থেকে ৬৫ এর মধ্যে হতে হবে"); return; }
    const ageNum = parseInt(ageRaw, 10);
    if (ageNum < 18) { showToast("রক্তদাতার বয়স কমপক্ষে ১৮ বছর হতে হবে"); return; }
    if (ageNum > 65) { showToast("রক্তদাতার বয়স সর্বোচ্চ ৬৫ বছর হতে পারে"); return; }

    const guard = formGuard("join", 5 * 60 * 1000, 3);
    if (!guard.ok) { showToast(guard.msg); return; }
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
      age: String(ageNum),
      gender: gender,
      status: "pending",
      requestedAt: firebase.database.ServerValue.TIMESTAMP
    };

    db.ref("donorRequests").child(reqId).set(requestData).then(() => {
      formGuardMark("join");
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

  let openedAt = 0;
  function openForm() { overlay.style.display = "flex"; openedAt = Date.now(); }
  function closeForm() { overlay.style.display = "none"; }

  trigger.addEventListener("click", e => { e.preventDefault(); openForm(); });
  overlay.addEventListener("click", e => { if (e.target === overlay) closeForm(); });
  if (closeBtn) closeBtn.addEventListener("click", closeForm);
  if (cancelBtn) cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const trap = document.getElementById("emrWebsite");
    if ((trap && trap.value) || (Date.now() - openedAt) < 3000) {
      showToast("আপনার জরুরি অনুরোধ পাঠানো হয়েছে, এডমিন দ্রুত যোগাযোগ করবে");
      form.reset(); closeForm(); return;
    }

    const clean = id => document.getElementById(id).value.trim().replace(/\s+/g, " ");
    const patientName = clean("emrPatientName");
    const phoneRaw = document.getElementById("emrPhone").value.trim();
    const phone = normBdPhone(phoneRaw);
    const bloodGroup = document.getElementById("emrBloodGroup").value;
    const unitsRaw = normDigits(clean("emrUnits"));
    const hospital = clean("emrHospital");
    const problem = clean("emrProblem");
    const hemoRaw = normDigits(clean("emrHemoglobin"));
    const note = clean("emrNote");

    if (!patientName || !phoneRaw || !bloodGroup || !hospital) {
      showToast("অনুগ্রহ করে আবশ্যক ঘরগুলো পূরণ করুন");
      return;
    }
    if (!NAME_RE.test(patientName)) { showToast("সঠিক নাম লিখুন (২-৬০ অক্ষর, শুধু অক্ষর)"); return; }
    if (!phone) { showToast("সঠিক মোবাইল নাম্বার দিন (যেমন: 01XXXXXXXXX)"); return; }
    if (VALID_BLOOD_GROUPS.indexOf(bloodGroup) === -1) { showToast("সঠিক রক্তের গ্রুপ বেছে নিন"); return; }
    if (hospital.length < 3 || hospital.length > 120 || NO_TAGS_RE.test(hospital)) { showToast("হাসপাতাল/স্থানের নাম ৩-১২০ অক্ষরের মধ্যে লিখুন"); return; }
    if (unitsRaw && !(/^[0-9]{1,2}$/.test(unitsRaw) && +unitsRaw >= 1 && +unitsRaw <= 20)) { showToast("ব্যাগের সংখ্যা ১ থেকে ২০ এর মধ্যে দিন"); return; }
    if (hemoRaw && !(/^[0-9]{1,2}(\.[0-9])?$/.test(hemoRaw) && parseFloat(hemoRaw) > 0 && parseFloat(hemoRaw) <= 25)) { showToast("হিমোগ্লোবিন ০ থেকে ২৫ এর মধ্যে দিন"); return; }
    if (problem.length > 150 || NO_TAGS_RE.test(problem)) { showToast("রোগীর সমস্যা সর্বোচ্চ ১৫০ অক্ষর, < > চিহ্ন ছাড়া"); return; }
    if (note.length > 300 || NO_TAGS_RE.test(note)) { showToast("বিস্তারিত সর্বোচ্চ ৩০০ অক্ষর, < > চিহ্ন ছাড়া"); return; }

    const guard = formGuard("emr", 2 * 60 * 1000, 5);
    if (!guard.ok) { showToast(guard.msg); return; }
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
      units: unitsRaw || "",
      hospital: hospital,
      problem: problem || "",
      hemoglobin: hemoRaw || "",
      note: note,
      status: "pending",
      requestedAt: firebase.database.ServerValue.TIMESTAMP
    };

    db.ref("emergencyRequests").child(reqId).set(requestData).then(() => {
      formGuardMark("emr");
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
    const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate);
    const dt = dm ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : new Date(rawDate);
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

  /* ---- মোবাইলে বটম-শিট: রেকর্ড কার্ড নিচ থেকে উপরে উঠে আসে (CSS animation);
     বন্ধ করলে বা নিচের দিকে টেনে (swipe down) ছাড়লে নিচে নেমে যায় ---- */
  const sheetMQ = window.matchMedia ? window.matchMedia("(max-width: 559px)") : { matches: false };
  let sheetClosing = false;
  function resetSheetStyles() {
    if (resultModal) { resultModal.style.transition = ""; resultModal.style.transform = ""; }
    resultOverlay.style.transition = "";
    resultOverlay.style.backgroundColor = "";
    sheetClosing = false;
  }
  function closeResultSheet() {
    if (resultOverlay.style.display !== "flex" || sheetClosing) return;
    if (!sheetMQ.matches || !resultModal) { resultOverlay.style.display = "none"; return; }
    sheetClosing = true;
    resultModal.style.transition = "transform .26s cubic-bezier(.4,0,1,1)";
    resultModal.style.transform = "translateY(110%)";
    resultOverlay.style.transition = "background-color .26s ease";
    resultOverlay.style.backgroundColor = "rgba(33,22,19,0)";
    setTimeout(() => { resultOverlay.style.display = "none"; resetSheetStyles(); }, 270);
  }
  if (resultModal) {
    let startY = 0, dragY = 0, startT = 0, armed = false, dragging = false;
    resultModal.addEventListener("touchstart", e => {
      if (!sheetMQ.matches || sheetClosing || e.touches.length !== 1) return;
      startY = e.touches[0].clientY; dragY = 0; startT = Date.now(); armed = true; dragging = false;
    }, { passive: true });
    resultModal.addEventListener("touchmove", e => {
      if (!armed) return;
      const d = e.touches[0].clientY - startY;
      if (!dragging) {
        if (d > 8 && resultModal.scrollTop <= 0) { dragging = true; resultModal.style.transition = "none"; }
        else { if (d < -8) armed = false; return; }
      }
      dragY = Math.max(0, d);
      resultModal.style.transform = "translateY(" + dragY + "px)";
      resultOverlay.style.backgroundColor = "rgba(33,22,19," + (0.55 * (1 - Math.min(1, dragY / 420))).toFixed(3) + ")";
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const endDrag = () => {
      if (!armed) return;
      armed = false;
      if (!dragging) return;
      dragging = false;
      const velocity = dragY / Math.max(1, Date.now() - startT);
      if (dragY > 110 || velocity > 0.6) { closeResultSheet(); return; }
      resultModal.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";
      resultModal.style.transform = "";
      resultOverlay.style.transition = "background-color .25s ease";
      resultOverlay.style.backgroundColor = "";
      setTimeout(() => { resultModal.style.transition = ""; resultOverlay.style.transition = ""; }, 260);
    };
    resultModal.addEventListener("touchend", endDrag, { passive: true });
    resultModal.addEventListener("touchcancel", endDrag, { passive: true });
  }

  let currentDonationRecord = null; // last successfully found record, for the JPEG filename
  const cardActions = document.getElementById("donationResultActions");
  const cardSaveBtn = document.getElementById("donationCardSaveBtn");
  const cardShareBtn = document.getElementById("donationCardShareBtn");

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

  const lc = normSearch;   // (normSearch is defined once at the top level, next to findRecordByNo)

  /* নাম, ID (পুরনো নাম্বারসহ) ও হাসপাতালের নামে মিলিয়ে দেখে; শুরুতে মিললে আগে, তারপর নতুন রক্তদান আগে */
  function searchRecords(raw) {
    const q = lc(String(raw || "").trim());
    if (!q) return [];
    const qBg = canonicalBloodGroup(raw);
    const out = [];
    (landingData.donationRecords || []).forEach(r => {
      if (!r || !(r.name || r.donationNo)) return;
      const fields = [r.name, r.donationNo, r.hospitalName].concat(r.legacyNos || []).map(lc);
      let best = qBg && (r.bloodGroup || "") === qBg ? 2 : 0;
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
    /* রক্তদান রেকর্ড এখন আলাদা পেজ (/donations/) — খোঁজা শব্দটি ?q= দিয়ে সেখানে পাঠানো হয় */
    const dUrl = sitePage("donations/", "?q=" + encodeURIComponent(q));
    if (!(window.spaNavigate && window.spaNavigate(dUrl))) location.href = dUrl;
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
    const watermarkLogoSrc = appConfigData.logoImage && appConfigData.logoImage.trim() ? appConfigData.logoImage : SITE_BASE + "assets/images/fav.jpeg";
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
      /* ============================================================
         নতুন ডিজিটাল কার্ড (সার্টিফিকেট স্টাইল) — ডাউনলোড করা PNG-র (buildDonationCardCanvas)
         সাথে একই ডিজাইন: ক্রিমসন হেডার, গোল্ড রিং-এ ছবি, ব্লাড-গ্রুপ সিল, তথ্য-বক্স, QR যাচাই, স্ট্যাম্প বার
         ============================================================ */
      const networkName = (landingData.siteName || "ব্লাড নেটওয়ার্ক").trim();
      const photoHidden = !!found.hidePhoto;
      const hasPhoto = !photoHidden && !!found.image;
      const serialNo = donorSerialNo(found);
      const lastDate = found.date ? (recordDateBn(found.date) || found.date) : "—";
      const cardUrl = SITE_ORIGIN + "/?id=" + encodeURIComponent(found.donationNo);
      const shortUrl = cardUrl.replace(/^https?:\/\//, "");
      const logoSrc = appConfigData.logoImage && appConfigData.logoImage.trim() ? appConfigData.logoImage : SITE_BASE + "assets/images/fav.jpeg";

      const head = document.createElement("div");
      head.className = "dcHead";
      head.innerHTML =
        '<div class="dcBrand">' +
          '<img class="donationResultLogo" alt="' + escAttr(networkName) + '">' +
          '<div class="dcBrandText"><b>' + escAttr(networkName) + '</b><span>ourbnb.org</span></div>' +
        '</div>' +
        '<span class="dcVerified"><i class="fa-solid fa-check" aria-hidden="true"></i>Verified</span>' +
        '<span class="dcSpark" style="left:16%;top:62%;font-size:15px">✦</span><span class="dcSpark" style="left:29%;top:48%;font-size:10px">✦</span>' +
        '<span class="dcSpark" style="left:8%;top:84%;font-size:9px">✦</span><span class="dcSpark" style="right:16%;top:62%;font-size:15px">✦</span>' +
        '<span class="dcSpark" style="right:29%;top:48%;font-size:10px">✦</span><span class="dcSpark" style="right:8%;top:84%;font-size:9px">✦</span>';
      resultContent.appendChild(head);
      loadImageWithFallback(head.querySelector(".donationResultLogo"), logoSrc);

      /* ছবি বামে · নাম + রক্তদানের সংখ্যা ছবির ডানে · রক্তের গ্রুপ সিল একদম ডানে */
      const ident = document.createElement("div");
      ident.className = "dcIdent";
      ident.innerHTML =
        '<div class="dcPhotoBox">' +
          '<div class="dcPhoto' + (hasPhoto ? "" : " dcPhotoEmpty") + '">' +
            (hasPhoto ? '<img class="dcPhotoImg" alt="' + escAttr(found.name || "") + '">' : '<i class="fa-solid fa-user" aria-hidden="true"></i>') +
          '</div>' +
        '</div>' +
        '<div class="dcInfo">' +
          '<h3 class="donationResultName dcName"></h3>' +
          '<div class="dcStatVal dcCrimson"><i class="fa-regular fa-calendar" aria-hidden="true"></i>' + escAttr(lastDate) + '</div>' +
        '</div>' +
        '<span class="donationResultBgBadge dcSeal">' + escAttr(found.bloodGroup || "—") + '</span>';
      ident.querySelector(".dcName").textContent = (found.name || "").trim();
      resultContent.appendChild(ident);
      if (hasPhoto) loadImageWithFallback(ident.querySelector(".dcPhotoImg"), found.image, ident.querySelector(".dcPhoto"));
      if (photoHidden) {
        const note = document.createElement("div");
        note.className = "dcHiddenNote";
        note.textContent = "ডোনার ছবি প্রকাশ করতে ইচ্ছুক নয়";
        resultContent.appendChild(note);
      }

      const body = document.createElement("div");
      body.className = "donationResultBody dcBody";

      const divTop = document.createElement("div");
      divTop.className = "donationResultDivider dcDivider";
      divTop.innerHTML = '<i class="fa-solid fa-droplet" aria-hidden="true"></i>';
      body.appendChild(divTop);

      const stats = document.createElement("div");
      stats.className = "dcStats";
      stats.innerHTML =
        '<div class="dcStat"><span class="dcStatLabel">রক্তদান</span><b class="dcStatVal dcCrimson">' + ordinalShortBn(found.visitCount || 1) + ' বার</b></div>' +
        '<div class="dcStat"><span class="dcStatLabel">ডোনেশন নম্বর</span><b class="donationResultSerial dcSerial dcStatVal">' + (serialNo > 0 ? toBengaliDigits(serialNo) + ' নাম্বার' : '—') + '</b></div>' +
        '<div class="dcStat"><span class="dcStatLabel">ডোনার ID</span><b class="dcStatVal dcMono">#' + escAttr(found.donationNo || "") + '</b></div>';
      body.appendChild(stats);

      /* হাসপাতাল বার্তা — হাসপাতালের নাম বোল্ড + গাঢ় লাল */
      const hospitalLine = document.createElement("p");
      hospitalLine.className = "donationResultHospitalLine dcCenter";
      hospitalLine.appendChild(document.createTextNode("(" + (found.bloodGroup || "") + ") লাল ভালোবাসা দান করলেন "));
      const hospitalNameStrong = document.createElement("strong");
      hospitalNameStrong.textContent = (found.hospitalName || "").trim();
      hospitalLine.appendChild(hospitalNameStrong);
      hospitalLine.appendChild(document.createTextNode(window.I18N && I18N.lang === "en" ? "." : " এ।"));
      body.appendChild(hospitalLine);

      const thanks = document.createElement("div");
      thanks.className = "donationResultThanks dcCenter";
      const thanksStrong = document.createElement("strong");
      thanksStrong.textContent = networkName;
      thanks.appendChild(thanksStrong);
      thanks.appendChild(document.createTextNode(" এর পক্ষ থেকে অবিরাম ভালোবাসা রইলো।"));
      body.appendChild(thanks);

      const emojiRow = document.createElement("div");
      emojiRow.className = "donationResultEmojiRow dcCenter dcDua";
      emojiRow.textContent = (found.gender === "বোন" ? "বোন" : "ভাই") + " এর জন্য সবাই দোয়া করবেন।";
      body.appendChild(emojiRow);

      /* QR + যাচাই */
      const foot = document.createElement("div");
      foot.className = "dcFoot";
      foot.innerHTML =
        '<div class="donationResultQrWrap"><img class="donationResultQrImg" alt="QR কোড — কার্ড লিংক" loading="lazy" src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=' + encodeURIComponent(cardUrl) + '"></div>' +
        '<div class="dcFootText"><b>কার্ড যাচাই করুন</b><span>QR কোড স্ক্যান করে এই কার্ডের সত্যতা যাচাই করুন।</span><code>' + escAttr(shortUrl) + '</code></div>';
      body.appendChild(foot);
      resultContent.appendChild(body);

      const bar = document.createElement("div");
      bar.className = "donationResultStamp dcBar";
      bar.innerHTML = '<i class="fa-solid fa-droplet" aria-hidden="true"></i>রক্ত দিন • জীবন বাঁচান<i class="fa-solid fa-droplet" aria-hidden="true"></i>';
      resultContent.appendChild(bar);
    }
    if (resultOverlay.style.display !== "flex") resetSheetStyles();
    resultOverlay.style.display = "flex";
    if (cardActions) cardActions.hidden = !found;
    fitDonationCard();
    if (found && navigator.share) { const warm = prepareCardFile(found); if (warm) warm.catch(() => {}); } // ready before the tap (share needs a fresh tap)
  }

  /* ---- মোবাইলে পুরো কার্ড একসাথে দেখাতে: কার্ড স্ক্রিনের উচ্চতার চেয়ে বড় হলে (zoom দিয়ে) ছোট করে ফিট করি,
     যাতে স্ক্রল না করেই পুরোটা দেখা যায়। রিসাইজ/রোটেট করলে আবার হিসাব হয়। ---- */
  let fitRaf = 0;
  function fitDonationCard() {
    if (!resultContent || !resultOverlay) return;
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      resultContent.style.zoom = "";
      if (resultOverlay.style.display !== "flex" || (resultModal && resultModal.style.display === "none")) return;
      const natural = resultContent.offsetHeight;
      if (!natural) return;
      const cs = getComputedStyle(resultOverlay);
      const availH = resultOverlay.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - 4;
      const z = Math.max(0.5, Math.min(1, availH / natural));
      resultContent.style.zoom = z < 0.995 ? String(Math.floor(z * 1000) / 1000) : "";
    });
  }
  window.addEventListener("resize", fitDonationCard);
  window.addEventListener("orientationchange", fitDonationCard);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitDonationCard).catch(() => {});

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
  if (resultCloseBtn) resultCloseBtn.addEventListener("click", closeResultSheet);
  resultOverlay.addEventListener("click", e => { if (e.target === resultOverlay) closeResultSheet(); });

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
    /* স্পেস ছাড়া খুব লম্বা একটি শব্দ (লম্বা নাম/হাসপাতাল) লাইনে না ধরলে অক্ষর ধরে ভেঙে নেয় — কার্ডের বাইরে যাবে না */
    const pushWord = word => {
      if (ctx.measureText(word).width <= maxWidth) return [word];
      const parts = []; let cur = "";
      for (const ch of Array.from(word)) {
        if (cur && ctx.measureText(cur + ch).width > maxWidth) { parts.push(cur); cur = ch; } else cur += ch;
      }
      if (cur) parts.push(cur);
      return parts;
    };
    for (const rawWord of words) {
      const pieces = pushWord(rawWord);
      for (let i = 0; i < pieces.length; i++) {
        const word = pieces[i];
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
        if (i < pieces.length - 1) { lines.push(line); line = ""; }
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  /* হাসপাতালের নাম / নেটওয়ার্কের নাম আলাদা স্টাইলে (বোল্ড + গাঢ় লাল) আঁকার জন্য:
     runs = [{text, strong}] — শব্দ ধরে লাইনে ভাগ করে, প্রতিটি শব্দে নিজের ফন্ট মেপে নেয় */
  function wrapStyledRuns(ctx, runs, maxWidth, fontFor) {
    const tokens = [];
    runs.forEach(r => String(r.text || "").split(/\s+/).filter(Boolean).forEach(w => tokens.push({ text: w, strong: !!r.strong })));
    const wOf = t => { ctx.font = fontFor(t.strong); return ctx.measureText(t.text).width; };
    ctx.font = fontFor(false);
    const spaceW = ctx.measureText(" ").width;
    const lines = [];
    let line = [], lineW = 0;
    const pushLine = () => { if (line.length) lines.push(line); line = []; lineW = 0; };
    tokens.forEach(tok => {
      let pieces = [tok];
      if (wOf(tok) > maxWidth) {           // স্পেস ছাড়া খুব লম্বা শব্দ — অক্ষর ধরে ভাঙি
        pieces = []; let cur = "";
        for (const ch of Array.from(tok.text)) {
          if (cur && wOf({ text: cur + ch, strong: tok.strong }) > maxWidth) { pieces.push({ text: cur, strong: tok.strong }); cur = ch; } else cur += ch;
        }
        if (cur) pieces.push({ text: cur, strong: tok.strong });
      }
      pieces.forEach((pc, i) => {
        const w = wOf(pc);
        const add = line.length ? spaceW + w : w;
        if (line.length && lineW + add > maxWidth) pushLine();
        lineW += line.length ? spaceW + w : w;
        line.push(pc);
        if (i < pieces.length - 1) pushLine();
      });
    });
    pushLine();
    return lines.length ? lines : [[{ text: "", strong: false }]];
  }

  function drawStyledLine(ctx, line, x, y, fontFor, normalColor, strongColor) {
    ctx.font = fontFor(false);
    const spaceW = ctx.measureText(" ").width;
    line.forEach((tok, i) => {
      ctx.font = fontFor(tok.strong);
      ctx.fillStyle = tok.strong ? strongColor : normalColor;
      ctx.fillText(tok.text, x, y);
      x += ctx.measureText(tok.text).width + spaceW;
    });
  }

  /* একটি বাক্যের ভেতরে নির্দিষ্ট নামটি খুঁজে বোল্ড রান বানায় (ট্রান্সলেশনের পরেও কাজ করে) */
  function splitStrongRuns(fullText, strongText) {
    const name = String(strongText || "").trim();
    const idx = name ? fullText.indexOf(name) : -1;
    if (idx < 0) return [{ text: fullText, strong: false }];
    return [
      { text: fullText.slice(0, idx), strong: false },
      { text: name, strong: true },
      { text: fullText.slice(idx + name.length), strong: false }
    ];
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof r === "number") r = { tl: r, tr: r, br: r, bl: r };
    /* a radius bigger than half the shorter side (e.g. 999 for a pill) must be clamped,
       otherwise arcTo() draws a huge arc that paints over the whole card */
    const maxR = Math.max(0, Math.min(w, h) / 2);
    r = { tl: Math.min(r.tl, maxR), tr: Math.min(r.tr, maxR), br: Math.min(r.br, maxR), bl: Math.min(r.bl, maxR) };
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

  function drawStar(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI / 4) * i - Math.PI / 2, rr = i % 2 === 0 ? r : r * 0.38;
      const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
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
    /* ============================================================
       ডিজিটাল রক্তদান কার্ড — নতুন প্রফেশনাল ডিজাইন (সার্টিফিকেট স্টাইল)
       ক্রিমসন হেডার · গোল্ড রিং-এ ডোনারের ছবি · ব্লাড-গ্রুপ সিল ·
       তিন ঘরের তথ্য-বক্স · QR যাচাই ফুটার · নিচে ক্রিমসন স্ট্যাম্প বার।
       সবকিছু canvas-এ হাতে আঁকা, তাই ডাউনলোড/শেয়ার করা PNG সবসময় একই রকম আসে।
       ============================================================ */
    const CARD_W = 400;
    const PAD = 30;
    const contentW = CARD_W - PAD * 2;
    const HEAD_H = 134;      // ক্রিমসন হেডারের উচ্চতা (স্ক্রিনের কার্ডের সাথে মেলানো, যাতে ডাউনলোড লম্বা না হয়)
    const PH_W = 180;        // ডোনারের ছবির প্রস্থ (১৬:৯ রেশিও)
    const PH_H = 101.25;     // ডোনারের ছবির উচ্চতা (১৮০ × ৯/১৬)
    const PH_X = PAD;        // ছবি বামে — বাম কিনারা
    const PH_TOP = HEAD_H - 34; // ছবি হেডারে ৩৪px ঢুকে থাকে
    const SEAL_R = 22;       // রক্তের গ্রুপ সিল (একদম ডানে)
    const PHOTO_RADIUS = 9;  // ছবির কোণের গোলাকার ভাব (৯px)
    const QR = 76;           // QR বক্সের মাপ
    const FOOT_H = 102;
    const BAR_H = 32;
    const scale = 3;         // ৩x — যেকোনো স্ক্রিনে ঝকঝকে

    const C = { crimson: "#9E1B32", crimsonDark: "#6E1220", tint: "#F7E3E6", ink: "#211613", muted: "#8A7A71",
                amber: "#B9722E", line: "#EADFD2", ivory: "#FCF8F2", sage: "#3F7A5D" };

    /* canvas-এ আঁকার ফন্টগুলো আগে থেকে লোড করে নিই — না হলে মাপ ভুল হয়ে লেখা সরে যায় */
    try {
      if (document.fonts && document.fonts.load) {
        const sample = (record.name || "") + (record.hospitalName || "") + "অআকখ রক্তদান ABab01";
        await Promise.race([Promise.all([
          document.fonts.load("600 14.5px 'Noto Sans Bengali'", sample), document.fonts.load("700 12.5px 'Noto Sans Bengali'", sample),
          document.fonts.load("700 24px 'Fraunces'", sample), document.fonts.load("italic 600 14.5px 'Fraunces'", sample),
          document.fonts.load("700 12px 'IBM Plex Mono'", "#ID 0123456789")
        ]), new Promise(r => setTimeout(r, 2500))]);
      }
    } catch (e) { /* ignore */ }

    const measure = document.createElement("canvas").getContext("2d");
    const networkName = (landingData.siteName || "ব্লাড নেটওয়ার্ক").trim();
    const T = (x) => (window.I18N ? I18N.t(x) : x);
    const hospitalText = T("(" + (record.bloodGroup || "") + ") লাল ভালোবাসা দান করলেন " + (record.hospitalName || "").trim() + " এ।");
    const thanksText = T(networkName + " এর পক্ষ থেকে অবিরাম ভালোবাসা রইলো।");
    const duaText = T((record.gender === "বোন" ? "বোন" : "ভাই") + " এর জন্য সবাই দোয়া করবেন।");
    const stampText = T("রক্ত দিন • জীবন বাঁচান");
    const bn = "'Noto Sans Bengali','Inter',sans-serif";
    const disp = "'Fraunces','Noto Sans Bengali',Georgia,serif";
    const mono = "'IBM Plex Mono',monospace";

    const hospitalFont = strong => (strong ? "700" : "600") + " 14px " + bn;
    const thanksFont = strong => strong ? "700 13.5px " + disp : "italic 600 13.5px " + disp;
    const hospitalLines = wrapStyledRuns(measure, splitStrongRuns(hospitalText, record.hospitalName), contentW, hospitalFont);
    const thanksLines = wrapStyledRuns(measure, splitStrongRuns(thanksText, networkName), contentW, thanksFont);

    const nameText = (record.name || "").trim();
    const bgText = record.bloodGroup || "—";
    /* ছবির ডানে নাম (সর্বোচ্চ ২ লাইন) — ডানে সিলের জায়গা ছেড়ে */
    const infoX = PH_X + PH_W + 18;
    const infoW = CARD_W - PAD - infoX;
    measure.font = "700 19px " + disp;
    let nameLines = wrapCanvasText(measure, nameText, infoW);
    if (nameLines.length > 2) {
      let l2 = nameLines[1];
      while (l2.length > 1 && measure.measureText(l2 + "…").width > infoW) l2 = l2.slice(0, -1);
      nameLines = [nameLines[0], l2 + "…"];
    }
    const serialNo = donorSerialNo(record);
    const hidden = !!record.hidePhoto;

    /* ---- উল্লম্ব বিন্যাস (আঁকার ক্রমের সাথে হুবহু মেলে) ---- */
    const nameY0 = HEAD_H + 28;
    const nameYLast = nameY0 + (nameLines.length - 1) * 24;
    const serialCY = nameYLast + 22;                     // নামের নিচে "X নাম্বার ডোনার" পিলের মাঝ-রেখা
    const identBottom = Math.max(PH_TOP + PH_H + 12, serialCY + 12 + 8);
    const yStart = identBottom;
    const noteH = hidden ? 22 : 0;
    const divY = yStart + noteH + 28;
    const statsTop = divY + 16;
    const statsH = 60;
    const hospY0 = statsTop + statsH + 28;
    const hospLastY = hospY0 + (hospitalLines.length - 1) * 23;
    const thanksY0 = hospLastY + 30;
    const thanksLastY = thanksY0 + (thanksLines.length - 1) * 22;
    const duaY = thanksLastY + 26;
    const footTop = duaY + 18;
    let totalH = footTop + FOOT_H + BAR_H;
    if (!isFinite(totalH) || totalH < 400) totalH = 740; // safety fallback

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(CARD_W * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    /* ছোট সহায়ক: মাপে না ধরলে ফন্ট ছোট করে বসায় */
    const fitFont = (txt, weight, startPx, minPx, maxW, family) => {
      let px = startPx;
      ctx.font = weight + " " + px + "px " + family;
      while (px > minPx && ctx.measureText(txt).width > maxW) { px -= 0.5; ctx.font = weight + " " + px + "px " + family; }
      return px;
    };
    const styledW = (line, fontFor) => {
      ctx.font = fontFor(false);
      const sp = ctx.measureText(" ").width;
      let w = 0;
      line.forEach((t, i) => { ctx.font = fontFor(t.strong); w += ctx.measureText(t.text).width + (i ? sp : 0); });
      return w;
    };

    // ---- কার্ডের ভিত্তি + গোল কোণ ----
    roundRectPath(ctx, 0, 0, CARD_W, totalH, 24);
    ctx.fillStyle = C.ivory;
    ctx.fill();
    ctx.save();
    roundRectPath(ctx, 0, 0, CARD_W, totalH, 24);
    ctx.clip();

    // ---- ওয়াটারমার্ক (সবার আগে আঁকা, তাই সবকিছুর পেছনে) ----
    const logoSrc = (appConfigData.logoImage && appConfigData.logoImage.trim()) ? appConfigData.logoImage : SITE_BASE + "assets/images/fav.jpeg";
    let logoImg = await loadDrawableImage(logoSrc);
    if (!logoImg) logoImg = await loadDrawableImage(SITE_BASE + "assets/images/fav.jpeg");
    ctx.save();
    ctx.globalAlpha = 0.055;
    if (logoImg) {
      const wmW = CARD_W * 0.56;
      const wmH = wmW * (logoImg.height / logoImg.width || 1);
      ctx.filter = "grayscale(1)";
      ctx.drawImage(logoImg, (CARD_W - wmW) / 2, statsTop - 10, wmW, wmH);
      ctx.filter = "none";
    }
    ctx.restore();

    // ---- ক্রিমসন হেডার ----
    const hg = ctx.createLinearGradient(0, 0, CARD_W, HEAD_H);
    hg.addColorStop(0, C.crimson);
    hg.addColorStop(1, C.crimsonDark);
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, CARD_W, HEAD_H);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, CARD_W, HEAD_H); ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.09)";            // হালকা বিন্দুর প্যাটার্ন
    for (let px = 8; px < CARD_W; px += 14) for (let py = 8; py < HEAD_H; py += 14) { ctx.beginPath(); ctx.arc(px, py, 1, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "rgba(255,255,255,0.07)";            // কোণার বড় আলোর বৃত্ত
    ctx.beginPath(); ctx.arc(CARD_W + 10, -20, 110, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-30, HEAD_H + 10, 90, 0, Math.PI * 2); ctx.fill();
    // উৎসবের ঝিলিক — ছবির দুপাশে সোনালি তারা
    [[62, 104, 7, 0.9], [112, 82, 4.5, 0.7], [34, 132, 4, 0.6], [338, 104, 7, 0.9], [288, 80, 4.5, 0.7], [368, 130, 4, 0.6], [96, 128, 3.5, 0.55], [306, 132, 3.5, 0.55]]
      .forEach(st => drawStar(ctx, st[0], st[1], st[2], "rgba(243,216,168," + st[3] + ")"));
    ctx.restore();
    // হেডারের নিচে গোল্ড ফয়েল লাইন
    const gl = ctx.createLinearGradient(0, 0, CARD_W, 0);
    gl.addColorStop(0, "#8F5A20"); gl.addColorStop(0.35, "#F3D8A8"); gl.addColorStop(0.65, "#D9A55A"); gl.addColorStop(1, "#8F5A20");
    ctx.fillStyle = gl;
    ctx.fillRect(0, HEAD_H - 3, CARD_W, 3);

    // ব্র্যান্ড: লোগো + নেটওয়ার্কের নাম + কার্ডের শিরোনাম
    const lgx = PAD + 21, lgy = 40, lgr = 21;
    ctx.beginPath(); ctx.arc(lgx, lgy, lgr + 2.5, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(lgx, lgy, lgr, 0, Math.PI * 2); ctx.clip();
    if (logoImg) {
      const ir = logoImg.width / logoImg.height || 1;
      let dw, dh;
      if (ir > 1) { dh = lgr * 2; dw = dh * ir; } else { dw = lgr * 2; dh = dw / ir; }
      ctx.drawImage(logoImg, lgx - dw / 2, lgy - dh / 2, dw, dh);
    }
    ctx.restore();
    const brandX = PAD + 54;
    const brandMaxW = CARD_W - PAD - 92 - brandX - 6;
    ctx.textAlign = "left";
    fitFont(networkName, "700", 14, 10, brandMaxW, disp);
    ctx.fillStyle = "#fff";
    ctx.fillText(networkName, brandX, 36);
    ctx.font = "600 10.5px " + bn;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillText(T("ourbnb.org"), brandX, 53);

    // VERIFIED গোল্ড পিল (ডানে উপরে)
    const vw = 88, vh = 24, vx = CARD_W - PAD - vw, vy = 28;
    roundRectPath(ctx, vx, vy, vw, vh, 12);
    const vg = ctx.createLinearGradient(vx, vy, vx + vw, vy + vh);
    vg.addColorStop(0, "#F6E2BC"); vg.addColorStop(1, "#D9A55A");
    ctx.fillStyle = vg; ctx.fill();
    ctx.fillStyle = "#3A2205";
    ctx.font = "700 9.5px " + mono;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("✓ VERIFIED", vx + vw / 2, vy + vh / 2 + 1);
    ctx.textBaseline = "alphabetic";

    // ---- ডোনারের স্কয়ার ছবি — বামে (৯px গোল কোণ, গোল্ড ফ্রেম) ----
    const cx = CARD_W / 2;
    const px0 = PH_X, py0 = PH_TOP, pW = PH_W, pH = PH_H;
    ctx.save();
    ctx.shadowColor = "rgba(33,22,19,0.25)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 5;
    roundRectPath(ctx, px0 - 7, py0 - 7, pW + 14, pH + 14, PHOTO_RADIUS + 7); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.restore();
    const ringG = ctx.createLinearGradient(px0, py0, px0 + pW, py0 + pH);
    ringG.addColorStop(0, "#F3D8A8"); ringG.addColorStop(0.5, "#B9722E"); ringG.addColorStop(1, "#F0D29B");
    roundRectPath(ctx, px0 - 3.5, py0 - 3.5, pW + 7, pH + 7, PHOTO_RADIUS + 3.5); ctx.lineWidth = 3; ctx.strokeStyle = ringG; ctx.stroke();

    ctx.save();
    roundRectPath(ctx, px0, py0, pW, pH, PHOTO_RADIUS); ctx.clip();
    let drewPhoto = false;
    if (!hidden && record.image) {
      const photoImg = await loadDrawableImage(record.image);
      if (photoImg) {
        const ir = photoImg.width / photoImg.height || 1;
        let dw, dh, dx, dy;
        if (ir > pW / pH) { dh = pH; dw = dh * ir; dx = px0 + pW / 2 - dw / 2; dy = py0; }
        else { dw = pW; dh = dw / ir; dx = px0; dy = py0 - (dh - pH) * 0.25; }  // লম্বা ছবিতে মুখ উপরের দিকে
        ctx.drawImage(photoImg, dx, dy, dw, dh);
        drewPhoto = true;
      }
    }
    if (!drewPhoto) {
      const pcx = px0 + pW / 2, pcy = py0 + pH / 2;
      ctx.fillStyle = C.tint; ctx.fillRect(px0, py0, pW, pH);
      ctx.fillStyle = "#D7A0AA";
      ctx.beginPath(); ctx.arc(pcx, pcy - 12, 18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(pcx, pcy + 44, 36, 28, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // ---- নাম (ছবির ডানে) ----
    ctx.textAlign = "left";
    ctx.font = "700 19px " + disp; ctx.fillStyle = C.ink;
    nameLines.forEach((ln, i) => ctx.fillText(ln, infoX, nameY0 + i * 24));

    // ---- সর্বশেষ রক্তদানের তারিখ — নামের নিচে হালকা লাল পিল ----
    {
      const dTxt = record.date ? (recordDateBn(record.date) || record.date) : "—";
      let dSize = 12.5;
      ctx.font = "700 " + dSize + "px " + bn;
      while (ctx.measureText(dTxt).width > infoW - 36 && dSize > 9) { dSize -= 0.5; ctx.font = "700 " + dSize + "px " + bn; }
      const dw = Math.min(infoW + 4, ctx.measureText(dTxt).width + 36);
      roundRectPath(ctx, infoX, serialCY - 12.5, dw, 25, 12.5);
      ctx.fillStyle = C.tint; ctx.fill();
      // ছোট ক্যালেন্ডার আইকন
      const ix = infoX + 10, iy = serialCY - 5;
      ctx.strokeStyle = C.crimson; ctx.lineWidth = 1.4; ctx.lineJoin = "round";
      roundRectPath(ctx, ix, iy, 11, 10, 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ix, iy + 3.5); ctx.lineTo(ix + 11, iy + 3.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ix + 3, iy - 1.5); ctx.lineTo(ix + 3, iy + 1); ctx.moveTo(ix + 8, iy - 1.5); ctx.lineTo(ix + 8, iy + 1); ctx.stroke();
      ctx.fillStyle = C.crimson; ctx.textBaseline = "middle";
      ctx.fillText(dTxt, infoX + 26, serialCY + 1);
      ctx.textBaseline = "alphabetic";
    }

    // ---- রক্তের গ্রুপ সিল — হেডারের নিচে-ডানে (ছবি পরিষ্কার দেখা যায়) ----
    const sr = SEAL_R, sx = CARD_W - PAD - sr - 3, sy = HEAD_H - 40;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.30)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.beginPath(); ctx.arc(sx, sy, sr + 3, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.restore();
    const sg = ctx.createLinearGradient(sx - sr, sy - sr, sx + sr, sy + sr);
    sg.addColorStop(0, "#F3D8A8"); sg.addColorStop(0.5, "#B9722E"); sg.addColorStop(1, "#F0D29B");
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.lineWidth = 2.5; ctx.strokeStyle = sg; ctx.stroke();
    ctx.fillStyle = C.crimson; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    fitFont(bgText, "700", 15, 10, sr * 2 - 10, disp);
    ctx.fillText(bgText, sx, sy + 1);
    ctx.textBaseline = "alphabetic";

    ctx.textAlign = "center";
    if (hidden) {
      ctx.font = "600 11px " + bn; ctx.fillStyle = C.muted;
      ctx.fillText(T("ডোনার ছবি প্রকাশ করতে ইচ্ছুক নয়"), cx, yStart + 14);
    }

    // ---- গোল্ড ডিভাইডার + রক্তের ফোঁটা ----
    ctx.strokeStyle = "rgba(185,114,46,0.45)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, divY); ctx.lineTo(cx - 16, divY); ctx.moveTo(cx + 16, divY); ctx.lineTo(CARD_W - PAD, divY); ctx.stroke();
    drawTeardrop(ctx, cx, divY, 5, C.amber);

    // ---- তথ্য-বক্স: রক্তদানের সংখ্যা | সর্বশেষ রক্তদান | ID ----
    roundRectPath(ctx, PAD, statsTop, contentW, statsH, 14);
    ctx.fillStyle = "#FFFFFF"; ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
    const cellW = contentW / 3;
    const cells = [
      { label: T("রক্তদান"), value: T(ordinalShortBn(record.visitCount || 1) + " বার"), font: bn },
      { label: T("ডোনেশন নম্বর"), value: serialNo > 0 ? T(toBengaliDigits(serialNo) + " নাম্বার") : "—", font: bn },
      { label: T("ডোনার ID"), value: "#" + (record.donationNo || ""), font: mono }
    ];
    cells.forEach((cell, i) => {
      const ccx = PAD + cellW * i + cellW / 2;
      if (i > 0) {
        ctx.strokeStyle = C.line; ctx.beginPath();
        ctx.moveTo(PAD + cellW * i, statsTop + 12); ctx.lineTo(PAD + cellW * i, statsTop + statsH - 12); ctx.stroke();
      }
      ctx.fillStyle = C.muted; ctx.font = "600 10px " + bn;
      ctx.fillText(cell.label, ccx, statsTop + 22);
      fitFont(cell.value, "700", 14, 9.5, cellW - 14, cell.font);
      ctx.fillStyle = i === 0 ? C.crimson : C.ink;
      ctx.fillText(cell.value, ccx, statsTop + 43);
    });

    // ---- হাসপাতাল বার্তা (মাঝখানে) — রান ধরে আঁকি তাই left-align + নিজে মাঝে বসাই ----
    ctx.textAlign = "left";
    hospitalLines.forEach((line, i) => {
      const w = styledW(line, hospitalFont);
      drawStyledLine(ctx, line, cx - w / 2, hospY0 + i * 23, hospitalFont, C.ink, C.crimsonDark);
    });
    thanksLines.forEach((line, i) => {
      const w = styledW(line, thanksFont);
      drawStyledLine(ctx, line, cx - w / 2, thanksY0 + i * 22, thanksFont, "#4A3A33", C.crimsonDark);
    });
    ctx.textAlign = "center";
    ctx.font = "700 14px " + bn; ctx.fillStyle = C.ink;
    ctx.fillText(duaText, cx, duaY);

    // ---- ফুটার: QR + যাচাইয়ের লেখা ----
    ctx.strokeStyle = "rgba(185,114,46,0.5)"; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD, footTop); ctx.lineTo(CARD_W - PAD, footTop); ctx.stroke(); ctx.setLineDash([]);
    const cardUrl = SITE_ORIGIN + "/?id=" + encodeURIComponent(record.donationNo || "");
    const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=" + encodeURIComponent(cardUrl);
    const qrImgEl = await loadDrawableImage(qrUrl);
    const qx = PAD, qy = footTop + 13;
    roundRectPath(ctx, qx - 5, qy - 5, QR + 10, QR + 10, 12);
    ctx.save(); ctx.shadowColor = "rgba(33,22,19,0.14)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
    if (qrImgEl) ctx.drawImage(qrImgEl, qx, qy, QR, QR);

    const tx0 = qx + QR + 20, tw = CARD_W - PAD - tx0;
    ctx.textAlign = "left";
    ctx.font = "700 13px " + bn; ctx.fillStyle = C.crimson;
    ctx.fillText(T("কার্ড যাচাই করুন"), tx0, qy + 13);
    ctx.font = "500 11px " + bn; ctx.fillStyle = C.muted;
    wrapCanvasText(ctx, T("QR কোড স্ক্যান করে এই কার্ডের সত্যতা যাচাই করুন।"), tw).slice(0, 3)
      .forEach((ln, i) => ctx.fillText(ln, tx0, qy + 31 + i * 15));
    const shortUrl = cardUrl.replace(/^https?:\/\//, "");
    fitFont(shortUrl, "600", 10.5, 8, tw, mono);
    ctx.fillStyle = C.ink;
    ctx.fillText(shortUrl, tx0, qy + QR - 2);

    // ---- নিচের ক্রিমসন স্ট্যাম্প বার ----
    const by = totalH - BAR_H;
    const bg2 = ctx.createLinearGradient(0, by, CARD_W, by);
    bg2.addColorStop(0, C.crimson); bg2.addColorStop(1, C.crimsonDark);
    ctx.fillStyle = bg2; ctx.fillRect(0, by, CARD_W, BAR_H);
    ctx.fillStyle = gl; ctx.fillRect(0, by, CARD_W, 1.5);
    ctx.font = "700 12px " + bn; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(stampText, cx, by + BAR_H / 2 + 1);
    const stW = ctx.measureText(stampText).width;
    drawTeardrop(ctx, cx - stW / 2 - 16, by + BAR_H / 2, 4.5, "#F3D8A8");
    drawTeardrop(ctx, cx + stW / 2 + 16, by + BAR_H / 2, 4.5, "#F3D8A8");
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

    ctx.restore(); // end outer card clip
    // কার্ডের চারপাশে হালকা বর্ডার
    roundRectPath(ctx, 0.5, 0.5, CARD_W - 1, totalH - 1, 24);
    ctx.strokeStyle = "rgba(185,114,46,0.35)"; ctx.lineWidth = 1; ctx.stroke();
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
      const fileName = "donation-card-" + String(currentDonationRecord.donationNo || "card").replace(/[^A-Za-z0-9_-]/g, "") + ".png";

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

  /* ============================================================
     রক্তদানের ডিজিটাল কার্ড — সবার জন্য: ছবি (PNG) হিসেবে সেভ ও শেয়ার।
     কার্ডটা আগের মতোই canvas-এ হাতে আঁকা (buildDonationCardCanvas);
     এখানে শুধু সেটাকে ফাইল বানিয়ে ডাউনলোড বা ফোনের শেয়ার মেনুতে দেওয়া হয়।
     ============================================================ */
  let cardFileCache = { key: "", promise: null };
  function cardFileName(rec) { return "donation-card-" + String(rec.donationNo || "card").replace(/[^A-Za-z0-9_-]/g, "") + ".png"; }
  function prepareCardFile(rec) {
    if (!rec) return null;
    const key = [rec.id, rec.donationNo, rec.name, rec.date, rec.hospitalName, rec.bloodGroup, rec.visitCount, rec.hidePhoto ? 1 : 0, rec.photo || rec.image || ""].join("|");
    if (cardFileCache.key === key && cardFileCache.promise) return cardFileCache.promise;
    const p = (async () => {
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
      const canvas = await buildDonationCardCanvas(rec);
      const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob failed")), "image/png"));
      return new File([blob], cardFileName(rec), { type: "image/png" });
    })();
    cardFileCache = { key: key, promise: p };
    p.catch(() => { if (cardFileCache.promise === p) cardFileCache = { key: "", promise: null }; });
    return p;
  }
  function setActBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = busy;
    const ic = btn.querySelector("i");
    if (!ic) return;
    if (busy) { btn.dataset.ic = ic.className; ic.className = "fa-solid fa-spinner fa-spin"; }
    else if (btn.dataset.ic) ic.className = btn.dataset.ic;
  }
  async function saveDonationCard() {
    const rec = currentDonationRecord;
    if (!rec) return;
    setActBusy(cardSaveBtn, true);
    try {
      const file = await prepareCardFile(rec);
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url; link.download = file.name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      showToast("কার্ড সেভ হয়েছে");
    } catch (err) {
      console.log("Card save failed:", err);
      showToast("কার্ডের ছবি তৈরি করা যায়নি, আবার চেষ্টা করুন");
    } finally { setActBusy(cardSaveBtn, false); }
  }
  async function shareDonationCard() {
    const rec = currentDonationRecord;
    if (!rec) return;
    const url = SITE_ORIGIN + "/?id=" + encodeURIComponent(rec.donationNo || "");
    const net = ((landingData && landingData.siteName) || "Blood Network Baraikhali").trim();
    const title = net + " — রক্তদান কার্ড";
    const text = (rec.name ? rec.name + " " : "") + "(" + (rec.bloodGroup || "") + ") রক্তদান কার্ড — " + net;
    setActBusy(cardShareBtn, true);
    try {
      if (navigator.share) {
        let shared = false;
        try {
          const file = await prepareCardFile(rec);
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: title, text: text + "\n" + url });
            shared = true;
          }
        } catch (err) { if (err && err.name === "AbortError") return; }
        if (!shared) await navigator.share({ title: title, text: text, url: url });
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showToast("লিংক কপি হয়েছে");
      } else {
        window.prompt("কার্ডের লিংক কপি করুন:", url);
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      showToast("শেয়ার করা যায়নি, আবার চেষ্টা করুন");
    } finally { setActBusy(cardShareBtn, false); }
  }
  if (cardSaveBtn) cardSaveBtn.addEventListener("click", saveDonationCard);
  if (cardShareBtn) cardShareBtn.addEventListener("click", shareDonationCard);


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

/* ============================================================
   মোবাইলের নিচের মেনু বার, "আরও" শিট, অফলাইন বার, স্কিপ লিংক
   (HTML: index.html এর .bottomNav / .bnSheet / .offlineBar / .skipLink)
   ============================================================ */
(function initMobileChrome() {
  const nav = document.getElementById("bottomNav");
  const moreBtn = document.getElementById("bnMoreBtn");
  const sheet = document.getElementById("bnSheet");
  const overlay = document.getElementById("bnSheetOverlay");
  const reqBtn = document.getElementById("bnRequestBtn");

  if (nav && moreBtn && sheet && overlay) {
    const focusables = () => Array.prototype.slice.call(sheet.querySelectorAll("a[href], button"));
    function setSheet(open) {
      sheet.hidden = !open;
      overlay.hidden = !open;
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("bnSheetOpen", open);
      if (open) { const f = focusables()[0]; if (f) f.focus(); }
    }
    moreBtn.addEventListener("click", () => setSheet(sheet.hidden));
    overlay.addEventListener("click", () => setSheet(false));
    sheet.addEventListener("click", e => { if (e.target.closest("a[href], button")) setSheet(false); });
    document.addEventListener("keydown", e => {
      if (sheet.hidden) return;
      if (e.key === "Escape") { setSheet(false); moreBtn.focus(); return; }
      if (e.key === "Tab") {                       // keep keyboard focus inside the open sheet
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener("resize", () => { if (window.innerWidth > 760 && !sheet.hidden) setSheet(false); });

    // the "More" tab lights up when the open page is one of the pages inside the sheet
    const syncMore = () => moreBtn.classList.toggle("navLinkActive", !!sheet.querySelector(".navLinkActive"));
    syncMore();
    new MutationObserver(syncMore).observe(sheet, { subtree: true, attributes: true, attributeFilter: ["class"] });

    // on-screen keyboard open -> hide the bar so it doesn't float above the keyboard
    const isField = el => !!(el && el.matches && el.matches("input, textarea, select, [contenteditable='true']"));
    document.addEventListener("focusin", e => { if (isField(e.target)) document.body.classList.add("kbOpen"); });
    document.addEventListener("focusout", () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove("kbOpen"); }, 60));
  }

  if (reqBtn) {      // centre button = the same "emergency request" form as the hero button
    reqBtn.addEventListener("click", () => {
      const t = document.getElementById("heroEmergencyBtn");
      if (t) t.click();
    });
  }

  // offline notice
  const offBar = document.getElementById("offlineBar");
  let wasOffline = false;
  function syncOnline() {
    const off = !navigator.onLine;
    if (offBar) offBar.hidden = !off;
    document.body.classList.toggle("isOffline", off);
    if (!off && wasOffline && typeof showToast === "function") showToast("আবার অনলাইনে এসেছেন");
    wasOffline = off;
  }
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  syncOnline();

  // skip link: on the home page jump to <main>, on inner pages to the open page section
  const skip = document.getElementById("skipLink");
  if (skip) skip.addEventListener("click", e => {
    e.preventDefault();
    const target = document.querySelector(".routePage.active") || document.getElementById("main");
    if (!target) return;
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: "auto", block: "start" });
  });
})();

/* html2canvas is no longer used — the admin "download card as PNG" button
   now draws the card by hand onto a <canvas> (see buildDonationCardCanvas),
   so there's nothing to lazy-load here anymore. */

/* Firebase App Check (reCAPTCHA v3) — the real defence against bots spamming the public forms /
   counters. Paste your reCAPTCHA v3 SITE key here after enabling App Check in the Firebase console
   (see SECURITY-NOTES.md). Empty = App Check off (site still works). */
const APP_CHECK_SITE_KEY = "";

function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    if (APP_CHECK_SITE_KEY && firebase.appCheck) {
      try { firebase.appCheck().activate(APP_CHECK_SITE_KEY, true); } catch (e) { console.log("App Check failed:", e); }
    }
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
      pageSkel.ready();
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
    landingLoadFailed = true;
    endSkeleton(true);
    try { renderNewsSection(); renderNewsDetail(); } catch (e) { /* ignore */ }
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
  .then(() => APP_CHECK_SITE_KEY ? loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check-compat.js") : null)
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
    navigator.serviceWorker.register(SITE_BASE + "service-worker.js")
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


/* একবারের পরিষ্কার-করা: আগে নোটিফিকেশনের জন্য নিবন্ধিত পুরনো Service Worker/সাবস্ক্রিপশন সরায়।
   (আগে index.html-এর inline script-এ ছিল; CSP-র জন্য এখানে আনা হয়েছে।) */
(function cleanOldPushWorkers() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (r) {
      if (r.scope.indexOf("/fcm-push/") === -1) return;
      var done = function () { r.unregister(); };
      if (r.pushManager) r.pushManager.getSubscription().then(function (sub) { return sub ? sub.unsubscribe() : null; }).then(done, done);
      else done();
    });
  }).catch(function () {});
})();
