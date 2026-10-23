"use strict";

// What runs once every script is in: the listeners, the first draw and the timers. Loaded last.

document.addEventListener("click", onClick);
window.addEventListener("popstate", route);
window.addEventListener("scroll", () => {
    document.body.classList.toggle("scrolled", window.scrollY > 4);
}, { passive : true });
document.getElementById("log").addEventListener("scroll", showLogBottom, { passive : true });
const columnWatch = new ResizeObserver((entries) => entries.forEach((entry) => markColumnEnds(entry.target)));
columnWatch.observe(document.getElementById("php-extensions").parentElement);
// A click outside the dialog, on its backdrop, is a Cancel.
document.getElementById("ask").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
        /** @type {HTMLDialogElement} */ (event.currentTarget).close("cancel");
    }
});
document.getElementById("module-search").addEventListener("input", renderModules);
let searchTimer = null;
document.getElementById("log-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadLog(), 150);
});

setUpPillTabs();
// Links from before the paths, like /#/sites, still land on their view.
if (location.hash.startsWith("#/")) {
    history.replaceState(null, "", location.hash.slice(1));
}
route();
refresh();
loadRecentErrors();

setInterval(refresh, REFRESH_MS);
setInterval(() => {
    if (currentView() === "logs" && isPressed("log-follow")) {
        loadLog();
    }
}, REFRESH_MS);
setInterval(loadRecentErrors, REFRESH_MS * 3);
