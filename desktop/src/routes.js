"use strict";

// Which view shows, from the path.

function currentView() {
    const view = location.pathname.split("/")[1];
    return VIEWS.includes(view) ? view : "overview";
}

/** The tab of the Sites page, from /sites/apache; the apps otherwise. */
function sitesTab() {
    return location.pathname.split("/")[2] === "apache" ? "apache" : "apps";
}

/** The tab of the PHP page, from /php/extensions; the overrides otherwise. */
function phpTab() {
    return location.pathname.split("/")[2] === "extensions" ? "extensions" : "settings";
}

/** Goes to a path of the page without reloading it. */
function navigate(pathname) {
    if (pathname !== location.pathname) {
        history.pushState(null, "", pathname);
    }
    route();
}

/** Shows the view in the path, and loads what only that view needs. */
function route() {
    const view = currentView();
    for (const section of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("section[data-view]"))) {
        section.classList.toggle("active", section.dataset.view === view);
    }
    for (const link of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("nav a"))) {
        link.classList.toggle("active", link.dataset.view === view);
    }
    document.title = `${TITLES[view]} · Studio`;
    window.scrollTo(0, 0);

    if (view === "logs") {
        loadLog(true);
    }
    if (view === "sites") {
        showSitesTab();
    }
    if (view === "php") {
        showPhpTab();
    }
}

function showPhpTab() {
    const tab = phpTab();
    for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("#php-tabs button"))) {
        button.classList.toggle("active", button.dataset.phpTab === tab);
    }
    document.getElementById("php-settings-pane").hidden    = tab !== "settings";
    document.getElementById("php-settings-actions").hidden = tab !== "settings";
    document.getElementById("php-ext-pane").hidden         = tab !== "extensions";
    document.getElementById("php-ext-actions").hidden      = tab !== "extensions";
    if (state) {
        renderPhpText();
    }
}

function showSitesTab() {
    const tab = sitesTab();
    for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("#site-tabs button"))) {
        button.classList.toggle("active", button.dataset.siteTab === tab);
    }
    document.getElementById("apps-pane").hidden   = tab !== "apps";
    document.getElementById("apache-pane").hidden = tab !== "apache";
    document.getElementById("edit-vhosts").hidden = tab !== "apache";
    document.getElementById("edit-config").hidden = tab !== "apps";
    document.getElementById("sites-text").textContent = tab === "apps"
        ? "The apps and servers of each project, found by their processes, never by requesting them."
        : "The vhosts Apache serves, as configured. They are listed, never checked.";
}
