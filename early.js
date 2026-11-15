/* Runs before first paint (was an inline <script> in index.html — moved here so the CSP can forbid inline scripts). */
(function () {
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
})();
