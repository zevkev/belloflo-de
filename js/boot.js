// Classic (non-module) script loaded in <head>, so it runs before first
// paint: applies the saved theme (only saved once a visitor uses the
// toggle) or the system setting, which avoids a flash of the wrong theme.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("belloflo-theme");
  } catch (e) {}
  if (theme !== "dark" && theme !== "light") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
