"use strict";

// What runs once every script is in: the listeners, the first draw and the timers. Loaded last.

document.addEventListener("click", onClick);
window.addEventListener("popstate", route);
window.addEventListener("scroll", () => {
    document.body.classList.toggle("scrolled", window.scrollY > 4);
}, { passive : true });
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
