"use strict";

// What runs once every script is in: the listeners, the first draw and the timers. Loaded last.

document.addEventListener("click", onClick);
window.addEventListener("popstate", route);
window.addEventListener("scroll", () => {
    document.body.classList.toggle("scrolled", window.scrollY > 4);
}, { passive : true });
document.getElementById("log").addEventListener("scroll", showLogBottom, { passive : true });
const columnWatch = new ResizeObserver((entries) => entries.forEach((entry) => markColumnEnds(entry.target)));
columnWatch.observe(document.getElementById("php-extensions"));
columnWatch.observe(document.getElementById("node-globals"));
columnWatch.observe(document.getElementById("apache-configs-pane"));
// A click outside the dialog, on its backdrop, is a Cancel.
document.getElementById("ask").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
        /** @type {HTMLDialogElement} */ (event.currentTarget).close("cancel");
    }
});
document.getElementById("node-filter").addEventListener("input", renderNode);
document.getElementById("php-ext-filter").addEventListener("input", renderExtensions);
document.getElementById("npm-search").addEventListener("input", () => searchNpm());
// Enter searches at once, or installs a package named with its version.
document.getElementById("npm-search").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = /** @type {HTMLInputElement} */ (document.querySelector("#npm-search input")).value.trim();
    if (/.@/.test(text)) {
        installNpm(text);
    } else {
        searchNpm(true);
    }
});
document.getElementById("pecl-search").addEventListener("input", () => searchPecl());
document.getElementById("pecl-search").addEventListener("submit", (event) => {
    event.preventDefault();
    searchPecl(true);
});
document.getElementById("pick-filter").addEventListener("input", () => renderPickList());
// Enter in the filter picks the first setting it shows.
document.getElementById("pick-filter").addEventListener("keydown", (event) => {
    const first = /** @type {HTMLElement} */ (document.querySelector("#pick-list [data-pick-key]"));
    if (event.key === "Enter" && first) {
        event.preventDefault();
        choosePick(first.dataset.pickKey);
    }
});
document.getElementById("pick-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitPick();
});
document.getElementById("pick").addEventListener("close", () => finishPick(null));
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
