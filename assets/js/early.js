/* Runs before first paint (was an inline <script> in index.html — moved here so the CSP can forbid inline scripts). */
(function () {
  // site root from this script's own URL — works on the domain, localhost and file://
  var BASE = "/";
  try { var cs = document.currentScript && document.currentScript.src; if (cs) BASE = cs.replace(/assets\/js\/[^\/?#]*(?:[?#].*)?$/, ""); } catch (e) {}
  function pg(p, q) { if (location.protocol === "file:" && (p === "" || /\/$/.test(p))) p += "index.html"; return BASE + p + (q || ""); }
  // 0) পুরনো # লিংক (ourbnb.org/#news/ID, #process …) নতুন URL-এ পাঠায় — আগে শেয়ার করা লিংক যেন কাজ করে
  try {
    var hash = (location.hash || "").replace(/^#/, "");
    if (hash) {
      var legacy = { "process": pg("how-it-works/"), "blood-group": pg("blood-group-chart/"), "donations": pg("donations/"),
                     "news": pg("news/"), "hospitals": pg("hospitals/"), "gallery": pg("gallery/") };
      var to = "";
      if (legacy[hash]) to = legacy[hash];
      else if (hash.indexOf("news/") === 0 && hash.length > 5) to = pg("news/", "?post=" + hash.slice(5));   // id আগে থেকেই encode করা
      if (to) { location.replace(to); return; }
    }
  } catch (e) {}

  // 0b) সংবাদের বিস্তারিত পেজে (/news/?post=…) তালিকা এক ঝলকও দেখানো হয় না
  try {
    if (/\/news(\/index\.html)?\/*$/.test(location.pathname) && /[?&]post=[^&]/.test(location.search)) {
      document.documentElement.classList.add("newsDetailMode");
    }
  } catch (e) {}

  // 1) first visit with no local cache -> show skeleton placeholders
  try { if (!localStorage.getItem("blood_donor_landing_cache")) document.documentElement.classList.add("skelMode"); }
  catch (e) { document.documentElement.classList.add("skelMode"); }

  // 2) clickjacking protection (static hosts like GitHub Pages can't send X-Frame-Options)
  try {
    if (window.top !== window.self) {
      try { window.top.location = window.self.location.href; }
      catch (e) { document.documentElement.style.display = "none"; }
    }
  } catch (e) { document.documentElement.style.display = "none"; }
  // 3) পেজ-লোডিং স্কেলিটন স্ক্রিন চালু (app.js পেজ তৈরি হলে বন্ধ করে; কিছু আটকে গেলেও ১২ সেকেন্ডে নিজেই সরে যায়)
  try {
    var de = document.documentElement;
    de.classList.add("pageLoading");
    setTimeout(function () { de.classList.add("pageSkelOut"); setTimeout(function () { de.classList.remove("pageLoading", "pageSkelOut"); }, 300); }, 12000);
  } catch (e) {}

  // 4) ফন্ট/আইকন CSS পেজ আটকে না রেখে ব্যাকগ্রাউন্ডে লোড হয়, শেষ হলে চালু হয়
  try {
    var ls = document.querySelectorAll("link[data-async-css]");
    for (var i = 0; i < ls.length; i++) {
      (function (l) {
        if (l.sheet) { l.media = "all"; return; }
        l.addEventListener("load", function () { l.media = "all"; });
        l.addEventListener("error", function () { l.media = "all"; });
      })(ls[i]);
    }
  } catch (e) {}
})();
