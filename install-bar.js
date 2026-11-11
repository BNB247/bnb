/* B.N.B "অ্যাপ ডাউনলোড" বার — সাইটের একদম উপরে
   - [✕]  [আইকন + লেখা]  [অ্যাপ ডাউনলোড]  → ইনস্টল না থাকলে
   - [✕]  [আইকন + লেখা]  [অ্যাপ খুলুন]     → ইনস্টল করা থাকলে
   - ✕ চাপলে ৩ দিন আর দেখাবে না | অ্যাপের ভেতর থেকে খুললে বারটি দেখাবেই না */
(function () {
  "use strict";
  var DISMISS_KEY = "bnb_ib_dismissed_at";
  var INSTALLED_KEY = "bnb_app_installed";
  var HIDE_DAYS = 3;
  var BAR_H = 46;

  // APK সরাসরি ডাউনলোডের লিংক (GitHub Releases-এ আপলোড করা .apk ফাইলের লিংক)। না থাকলে ফাঁকা রাখুন।
  // উদাহরণ: "https://github.com/bnb247/bnb/releases/download/v1/BNB.apk"
  var APK_URL = "";

  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return;                                   // অ্যাপের ভেতরে আছে: বার দরকার নেই

  var ua = navigator.userAgent;
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isAndroid = /android/i.test(ua);
  // শুধু মোবাইল/ট্যাবলেট ফোনে বার দেখাবে; ডেস্কটপ/ল্যাপটপে নয়
  var isMobileDevice = /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);   // iPadOS
  if (!isMobileDevice) return;

  var deferred = null, bar = null, installed = false;
  try { installed = localStorage.getItem(INSTALLED_KEY) === "1"; } catch (e) {}

  function isDismissed() {
    try {
      var t = parseInt(localStorage.getItem(DISMISS_KEY), 10);
      return t && (Date.now() - t) < HIDE_DAYS * 86400000;
    } catch (e) { return false; }
  }

  function injectStyle() {
    if (document.getElementById("installBarStyle")) return;
    var st = document.createElement("style"); st.id = "installBarStyle";
    st.textContent =
      ":root{--ibH:" + BAR_H + "px}" +
      "#installBar{position:fixed;top:0;left:0;right:0;height:var(--ibH);z-index:260;display:flex;align-items:center;gap:10px;" +
      "padding:0 10px;background:linear-gradient(90deg,#7d1226,#9E1B32);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.22);" +
      "font-family:'Noto Sans Bengali',Inter,system-ui,sans-serif;box-sizing:border-box}" +
      "#installBar .ibX{flex:none;width:30px;height:30px;border:0;border-radius:50%;background:rgba(255,255,255,.2);color:#fff;" +
      "font-size:19px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}" +
      "#installBar .ibIcon{flex:none;width:28px;height:28px;border-radius:7px;object-fit:cover;background:#fff}" +
      "#installBar .ibText{flex:1;min-width:0;font-size:13px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#installBar .ibBtn{flex:none;border:0;border-radius:999px;background:#fff;color:#9E1B32;font-weight:800;font-size:13px;" +
      "padding:8px 14px;cursor:pointer;font-family:inherit;white-space:nowrap}" +
      "body.hasInstallBar{padding-top:var(--ibH)!important}" +
      "body.hasInstallBar .siteNav{top:var(--ibH)!important}" +
      "#ibModal{position:fixed;inset:0;z-index:270;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;" +
      "font-family:'Noto Sans Bengali',Inter,system-ui,sans-serif}" +
      "#ibModal .box{background:#fff;color:#2a1c18;width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:20px 18px 24px;box-sizing:border-box}" +
      "#ibModal h3{margin:0 0 10px;font-size:17px}#ibModal ol{margin:0 0 14px;padding-left:20px;font-size:14.5px;line-height:1.7}" +
      "#ibModal button{border:0;border-radius:10px;background:#9E1B32;color:#fff;font-weight:700;padding:10px 20px;font-size:14px;cursor:pointer;font-family:inherit}" +
      "#ibToast{position:fixed;left:50%;top:calc(var(--ibH) + 10px);transform:translateX(-50%);z-index:280;background:#2a1c18;color:#fff;" +
      "padding:10px 16px;border-radius:10px;font-size:13px;max-width:90%;font-family:'Noto Sans Bengali',Inter,sans-serif}";
    document.head.appendChild(st);
  }

  function toast(msg) {
    var t = document.getElementById("ibToast"); if (t) t.remove();
    t = document.createElement("div"); t.id = "ibToast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }

  function render() {
    if (!bar) return;
    var open = installed && !deferred;
    bar.querySelector(".ibText").textContent = open ? "B.N.B অ্যাপ ইনস্টল করা আছে" : "B.N.B অ্যাপ ইনস্টল করুন";
    bar.querySelector(".ibBtn").textContent = open ? "অ্যাপ খুলুন" : "অ্যাপ ডাউনলোড";
  }

  function showBar() {
    if (bar || isDismissed()) return;
    if (document.body.classList.contains("adminMode")) return;
    injectStyle();
    bar = document.createElement("div");
    bar.id = "installBar";
    bar.setAttribute("role", "region");
    bar.innerHTML =
      '<button class="ibX" type="button" aria-label="বন্ধ করুন">&times;</button>' +
      '<img class="ibIcon" src="icon-192.png" alt="" onerror="this.style.display=\'none\'">' +
      '<span class="ibText"></span>' +
      '<button class="ibBtn" type="button"></button>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add("hasInstallBar");
    bar.querySelector(".ibX").onclick = hideBar;
    bar.querySelector(".ibBtn").onclick = onMainClick;
    render();
  }

  function hideBar() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {}
    if (bar) { bar.remove(); bar = null; }
    document.body.classList.remove("hasInstallBar");
  }

  function howToModal() {
    var steps;
    if (isIOS) steps = ["Safari ব্রাউজারে সাইটটি খুলুন", "নিচের <b>Share</b> (⬆️) বাটনে চাপুন", "<b>“Add to Home Screen”</b> বেছে নিন", "<b>Add</b> চাপুন, হোম স্ক্রিনে B.N.B আইকন আসবে"];
    else if (isAndroid) steps = ["Chrome-এর উপরের ডানে <b>⋮</b> মেনুতে চাপুন", "<b>“Install app”</b> বা <b>“Add to Home screen”</b> বেছে নিন", "<b>Install</b> চাপুন"];
    else steps = ["ঠিকানা বারের ডানদিকে <b>ইনস্টল (⊕)</b> আইকনে চাপুন", "<b>Install</b> চাপুন"];
    var m = document.createElement("div"); m.id = "ibModal";
    m.innerHTML = '<div class="box"><h3>📲 অ্যাপ ইনস্টল করার নিয়ম</h3><ol>' +
      steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") +
      '</ol><button type="button">ঠিক আছে</button></div>';
    m.onclick = function (e) { if (e.target === m || e.target.tagName === "BUTTON") m.remove(); };
    document.body.appendChild(m);
  }

  function openApp() {
    var url = location.origin + location.pathname.replace(/[^\/]*$/, "");   // সাইটের মূল ফোল্ডার
    if (isAndroid) {
      // Android: সিস্টেমকে বলা হয় এই ঠিকানা খোলার অ্যাপ (ইনস্টল করা B.N.B) চালু করতে
      var intent = "intent://" + url.replace(/^https?:\/\//, "") +
        "#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=" + encodeURIComponent(url) + ";end";
      var hidden = false;
      var onVis = function () { if (document.hidden) hidden = true; };
      document.addEventListener("visibilitychange", onVis);
      location.href = intent;
      setTimeout(function () {
        document.removeEventListener("visibilitychange", onVis);
        if (!hidden) toast("অ্যাপ না খুললে হোম স্ক্রিনের B.N.B আইকনে চাপুন");
      }, 1800);
    } else {
      toast("হোম স্ক্রিন বা ডেস্কটপের B.N.B আইকন থেকে অ্যাপ খুলুন");
    }
  }

  function downloadApk() {
    var a = document.createElement("a");
    a.href = APK_URL; a.download = "BNB.apk"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    toast("ডাউনলোড শুরু হয়েছে। শেষ হলে ফাইলটি খুলে Install চাপুন।");
  }

  function onMainClick() {
    var open = installed && !deferred;
    if (open) return openApp();
    if (deferred) {
      var p = deferred; deferred = null;
      p.prompt();
      p.userChoice.then(function (c) {
        if (c && c.outcome !== "accepted") { deferred = p; }   // বাতিল করলে আবার চেষ্টা করা যাবে
      }).catch(function () {});
      return;
    }
    if (isAndroid && APK_URL) return downloadApk();            // ইনস্টল বক্স না এলে সরাসরি APK ডাউনলোড
    howToModal();                                              // iPhone বা যেখানে সরাসরি ইনস্টল বক্স নেই
  }

  /* Chrome নিজে জানায় অ্যাপটি ইনস্টল করা যাবে (মানে এখনো ইনস্টল নেই) */
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    installed = false;
    try { localStorage.removeItem(INSTALLED_KEY); } catch (x) {}   // আনইনস্টল করলে আবার "ডাউনলোড" দেখাবে
    if (bar) render(); else showBar();
  });

  window.addEventListener("appinstalled", function () {
    deferred = null; installed = true;
    try { localStorage.setItem(INSTALLED_KEY, "1"); localStorage.removeItem(DISMISS_KEY); } catch (e) {}
    if (bar) render(); else showBar();
  });

  function start() {
    // আগে ইনস্টল করা থাকলে ব্রাউজার জানাতে পারে (manifest-এ related_applications থাকলে)
    if (navigator.getInstalledRelatedApps) {
      navigator.getInstalledRelatedApps().then(function (apps) {
        if (apps && apps.length) { installed = true; try { localStorage.setItem(INSTALLED_KEY, "1"); } catch (e) {} if (bar) render(); }
      }).catch(function () {});
    }
    setTimeout(showBar, 1200);   // iPhone/অন্য ব্রাউজারে beforeinstallprompt আসে না, তাই নিজে দেখাই
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
