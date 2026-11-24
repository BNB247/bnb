/* ============================================================
   LoginGuard — client-side login rate limiter (admin + list pages)
   - Minimum gap between two login attempts (stops double-click / script spam)
   - 5 wrong attempts in a row -> locked: 1 min, then 5 min, 15 min, 1 hour
   - Lock state lives in localStorage, so refresh / new tab / reopening
     the page does NOT reset it (shared across tabs via "storage" event)
   - Firebase "auth/too-many-requests" -> locked for 15 minutes
   - Hidden honeypot field: bots that auto-fill every input are rejected
   - While locked, NO request is sent to Firebase at all
   NOTE: this is a browser-side guard. Real server-side protection comes from
   Firebase Auth's own throttling + App Check + API-key restriction.
   ============================================================ */
(function (w) {
  "use strict";

  var DEFAULT_STEPS = [60e3, 300e3, 900e3, 3600e3];
  var BN = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[+d]; }); }
  function now() { return Date.now(); }

  function create(opts) {
    opts = opts || {};
    var KEY = "bnb_loginguard_" + (opts.ns || "default");
    var MAX = opts.maxAttempts || 5;
    var GAP = opts.minGapMs || 2000;
    var DECAY = opts.decayMs || 24 * 3600e3;
    var STEPS = opts.lockSteps || DEFAULT_STEPS;
    var TOO_MANY_LOCK = 900e3;
    var mem = null;            // fallback if localStorage is blocked
    var timer = null, cb = null, hp = null;

    function blank() { return { fails: 0, level: 0, lockedUntil: 0, last: 0 }; }

    function load() {
      var s = null;
      try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
      if (!s || typeof s !== "object") s = mem || blank();
      var t = now(), maxLock = STEPS[STEPS.length - 1];
      s = {
        fails: Math.max(0, +s.fails || 0),
        level: Math.min(STEPS.length, Math.max(0, +s.level || 0)),
        lockedUntil: Math.max(0, +s.lockedUntil || 0),
        last: Math.max(0, +s.last || 0)
      };
      if (s.lockedUntil > t + maxLock) s.lockedUntil = t + maxLock;   // clock-tamper clamp
      if (s.last && t - s.last > DECAY && s.lockedUntil < t) s = blank(); // old history forgotten
      return s;
    }
    function save(s) {
      mem = s;
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    }

    /* -> { wait: ms, locked: bool }.  wait === 0 means "go ahead". */
    function check() {
      var s = load(), t = now();
      if (s.lockedUntil > t) return { wait: s.lockedUntil - t, locked: true };
      if (s.last && t >= s.last && t - s.last < GAP) return { wait: GAP - (t - s.last), locked: false };
      return { wait: 0, locked: false };
    }

    /* call right before sending a request (starts the min-gap clock) */
    function begin() { var s = load(); s.last = now(); save(s); }

    /* call when a login attempt failed. Returns the new check() state. */
    function fail(err) {
      var code = err && err.code ? err.code : "";
      if (code === "auth/network-request-failed") return check(); // not the user's fault: don't count
      var s = load(), t = now();
      if (code === "auth/too-many-requests") {
        s.level = Math.min(STEPS.length, s.level + 1);
        s.lockedUntil = t + Math.max(TOO_MANY_LOCK, STEPS[s.level - 1]);
        s.fails = 0;
      } else {
        s.fails += 1;
        if (s.fails >= MAX) {
          s.level = Math.min(STEPS.length, s.level + 1);
          s.lockedUntil = t + STEPS[s.level - 1];
          s.fails = 0;
        }
      }
      s.last = t;
      save(s);
      return check();
    }

    function success() { save(blank()); }

    function format(ms) {
      var total = Math.ceil(ms / 1000), h = Math.floor(total / 3600),
          m = Math.floor((total % 3600) / 60), sec = total % 60, out = [];
      if (h) out.push(bn(h) + " ঘণ্টা");
      if (m) out.push(bn(m) + " মিনিট");
      if (sec && !h) out.push(bn(sec) + " সেকেন্ড");
      return out.join(" ");
    }
    function message(c) {
      if (c && c.locked) return "অনেকবার ভুল চেষ্টা হয়েছে। " + format(c.wait) + " পর আবার চেষ্টা করুন।";
      return "একটু অপেক্ষা করুন, তারপর আবার চেষ্টা করুন।";
    }

    /* cb(state) runs every second while locked, and once more when the lock ends */
    function tick() {
      var c = check();
      if (cb) cb(c);
      if (!(c.locked && c.wait > 0)) { clearInterval(timer); timer = null; }
    }
    function refresh() {
      clearInterval(timer); timer = null;
      var c = check();
      if (cb) cb(c);
      if (c.locked && c.wait > 0) timer = setInterval(tick, 1000);
    }
    function watch(fn) {
      cb = fn;
      refresh();
      w.addEventListener("storage", function (e) { if (e.key === KEY) refresh(); }); // other tab
    }

    /* invisible trap field — humans never see or fill it */
    function honeypot(container) {
      if (!container || hp) return;
      var wrap = document.createElement("div");
      wrap.setAttribute("aria-hidden", "true");
      wrap.style.cssText = "position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;opacity:0;";
      hp = document.createElement("input");
      hp.type = "text"; hp.name = "company_url"; hp.tabIndex = -1;
      hp.setAttribute("autocomplete", "off");
      wrap.appendChild(hp);
      container.appendChild(wrap);
    }
    function isBot() { return !!(hp && hp.value && hp.value.trim()); }

    return { check: check, begin: begin, fail: fail, success: success,
             message: message, watch: watch, refresh: refresh,
             honeypot: honeypot, isBot: isBot };
  }

  w.LoginGuard = { create: create };
})(window);
