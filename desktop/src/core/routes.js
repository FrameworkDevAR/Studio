// Which view shows, from the path.

import { TITLES, VIEWS, state } from "./state.js";
import { showBrowse } from "../database/page.js";
import { renderDbText } from "../pages/databases.js";
import { loadLog } from "../pages/logs.js";
import { renderPhpText } from "../pages/php.js";



/** What the Settings page says under its title, by tab. */
const SETTINGS_TEXTS = {
    general : "What Studio opens things with, and how far the stack updates. Each change is"
        + " saved at once.",
    updates : "What is out for the stack, and what was updated last, by Studio or ./setup.sh.",
    paths   : "Where the stack is, as the setup found it. Only the setup changes them.",
};



/**
 * The view in the path, or the overview when it names none.
 * @returns {string}
 */
function currentView() {
    const view = location.pathname.split("/")[1];
    return VIEWS.includes(view) ? view : "overview";
}

/**
 * The tab of the Sites page, from /sites/vhosts; the projects otherwise. The tab was
 * /sites/apache before, which still opens it.
 * @returns {"vhosts" | "projects"}
 */
function sitesTab() {
    const part = location.pathname.split("/")[2];
    return part === "vhosts" || part === "apache" ? "vhosts" : "projects";
}

/**
 * The tab of the Apache page, from /apache/configs; the modules otherwise.
 * @returns {"configs" | "modules"}
 */
function apacheTab() {
    return location.pathname.split("/")[2] === "configs" ? "configs" : "modules";
}

/**
 * The tab of the PHP page, from /php/extensions; the overrides otherwise.
 * @returns {"extensions" | "settings"}
 */
function phpTab() {
    return location.pathname.split("/")[2] === "extensions" ? "extensions" : "settings";
}

/**
 * The tab of the Databases page, from /databases/users or /databases/options; the databases
 * otherwise.
 * @returns {"users" | "options" | "databases"}
 */
function dbTab() {
    const tab = location.pathname.split("/")[2];
    return tab === "users" || tab === "options" ? tab : "databases";
}

/**
 * The tab of the Settings page, from /settings/updates or /settings/paths; the general one
 * otherwise.
 * @returns {"updates" | "paths" | "general"}
 */
function settingsTab() {
    const tab = location.pathname.split("/")[2];
    return tab === "updates" || tab === "paths" ? tab : "general";
}

/**
 * Goes to a path of the page without reloading it.
 * @param {string} pathname
 * @returns {void}
 */
function navigate(pathname) {
    if (pathname !== location.pathname) {
        history.pushState(null, "", pathname);
    }
    route();
}

/**
 * Shows the view in the path, and loads what only that view needs.
 * @returns {void}
 */
function route() {
    const view = currentView();

    for (const section of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("section[data-view]")
    )) {
        section.classList.toggle("active", section.dataset.view === view);
    }

    // A database's own page is part of Databases in the sidebar.
    for (const link of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("nav a")
    )) {
        link.classList.toggle(
            "active",
            link.dataset.view === (view === "database" ? "databases" : view),
        );
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
    if (view === "apache") {
        showApacheTab();
    }
    if (view === "databases") {
        showDbTab();
    }
    if (view === "database") {
        showBrowse();
    }
    if (view === "settings") {
        showSettingsTab();
    }
}

/**
 * Shows the tab of the Settings page in the path, with the text that goes with it.
 * @returns {void}
 */
function showSettingsTab() {
    const tab = settingsTab();

    for (const button of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("#settings-tabs button")
    )) {
        button.classList.toggle("active", button.dataset.settingsTab === tab);
    }

    document.getElementById("settings-general-pane").hidden = tab !== "general";
    document.getElementById("settings-updates-pane").hidden = tab !== "updates";
    document.getElementById("settings-paths-pane").hidden   = tab !== "paths";
    document.getElementById("settings-text").textContent    = SETTINGS_TEXTS[tab];
}

/**
 * Shows the tab of the Databases page in the path, with its actions.
 * @returns {void}
 */
function showDbTab() {
    const tab = dbTab();

    for (const button of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("#db-tabs button")
    )) {
        button.classList.toggle("active", button.dataset.dbTab === tab);
    }

    document.getElementById("db-list-pane").hidden    = tab !== "databases";
    document.getElementById("db-users-pane").hidden   = tab !== "users";
    document.getElementById("db-options-pane").hidden = tab !== "options";

    if (state) {
        renderDbText();
    }
}

/**
 * Shows the tab of the Apache page in the path, with the text that goes with it.
 * @returns {void}
 */
function showApacheTab() {
    const tab = apacheTab();

    for (const button of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("#apache-tabs button")
    )) {
        button.classList.toggle("active", button.dataset.apacheTab === tab);
    }

    document.getElementById("apache-modules-pane").hidden = tab !== "modules";
    document.getElementById("apache-configs-pane").hidden = tab !== "configs";
    document.getElementById("apache-text").innerHTML = tab === "modules"
        ? `Apache checks each change first. <span class="tag"
            title="Apache's config, the vhosts or a site's .htaccess">used</span> means something
            needs it.`
        : `The files <code>httpd.conf</code> includes, each turned on by its
            <code>Include</code> line.`;
}

/**
 * Shows the tab of the PHP page in the path, with its actions.
 * @returns {void}
 */
function showPhpTab() {
    const tab = phpTab();

    for (const button of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("#php-tabs button")
    )) {
        button.classList.toggle("active", button.dataset.phpTab === tab);
    }

    document.getElementById("php-settings-pane").hidden = tab !== "settings";
    document.getElementById("php-ext-pane").hidden      = tab !== "extensions";

    if (state) {
        renderPhpText();
    }
}

/**
 * Shows the tab of the Sites page in the path, with its button and its text.
 * @returns {void}
 */
function showSitesTab() {
    const tab = sitesTab();

    // An old link to the tab goes on at its address now, without a step back to it.
    if (location.pathname.startsWith("/sites/apache")) {
        history.replaceState(null, "", "/sites/vhosts");
    }

    for (const button of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("#site-tabs button")
    )) {
        button.classList.toggle("active", button.dataset.siteTab === tab);
    }

    document.getElementById("projects-pane").hidden = tab !== "projects";
    document.getElementById("vhosts-pane").hidden   = tab !== "vhosts";
    document.getElementById("sites-text").textContent = tab === "projects"
        ? "Each project's apps and servers, found by their processes."
        : "The vhosts Apache serves, listed and never requested.";
}



// The public API
export {
    currentView,
    phpTab,
    dbTab,
    navigate,
    route,
};
