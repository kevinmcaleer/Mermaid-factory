// Applies the saved light/dark interface choice before first paint.
// Loaded as a classic (blocking) script so the page never flashes the wrong theme.
(function () {
  var KEY = "mf-ui-theme";
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage may be blocked */ }
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-ui-theme", saved);
  }
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("ui-theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-ui-theme");
      if (!current) {
        current = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      var next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-ui-theme", next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      document.dispatchEvent(new CustomEvent("mf:ui-theme", { detail: next }));
    });
  });
})();
