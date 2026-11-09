// The Settings page, in three tabs. General: the browser and the editor Studio opens things
// with, and the range of versions each package of the stack may update to, each saved to the
// config as it changes. Updates: what is out, with buttons to update it, and the last updates.
// Paths: those the setup wrote, only shown.

import { act } from "../core/api.js";
import { esc, icon, shortPath } from "../core/helpers.js";
import { LOGOS, logoSvg } from "../core/logos.js";
import { state } from "../core/state.js";
import { isUpdating } from "./node.js";



/** The tag of each step an update takes. */
const STEP_TAGS = { patch : "green", minor : "amber", major : "red" };



/**
 * A package of the stack as the Settings page lists it.
 * @typedef {{ name: string, label: string, version: string, range: string }} StackVersion
 */

/**
 * A package with a newer version: the range it is kept in, and the one that would take it,
 * when its range holds it.
 * @typedef {{
 *     name: string, label: string, version: string, latest: string, range?: string,
 *     next?: string,
 * }} Outdated
 */

/**
 * An update of the stack, as the log keeps it.
 * @typedef {{
 *     at: string, name: string, label: string, from: string, to: string, by: string,
 * }} UpdateRecord
 */



// ---------------------------------------------------------------- settings ---

// What each part last drew, so a refresh that changes nothing leaves an open select alone.
const drawn = { general : "", updates : "" };

/**
 * Draws the settings, each tab when what it shows changed since the last time.
 * @returns {void}
 */
function renderSettings() {
    const settings = state.settings;
    const general  = JSON.stringify([ settings, state.updates.held ]);
    if (general !== drawn.general) {
        drawn.general = general;
        renderGeneral();
    }

    // The minute is in it, so "checked 5 min ago" moves on.
    const updates = JSON.stringify([
        state.updates, settings.history, isUpdating("brew"), isUpdating("move"),
        Math.floor(Date.now() / 60_000),
    ]);
    if (updates !== drawn.updates) {
        drawn.updates = updates;
        renderOutdated();
    }

    const count = state.updates.packages.length + state.updates.held.length;
    document.getElementById("tab-updates-count").textContent = count ? String(count) : "";
}

/**
 * The General tab: the apps, and the range of each package. The paths are drawn with it, as
 * they change only with the setup.
 * @returns {void}
 */
function renderGeneral() {
    const settings = state.settings;

    document.getElementById("settings-apps").innerHTML = [
        row("Browser", "Opens the pages. One built on Chrome reuses the tab already open.",
            appSelect("browser", settings.browser, settings.browsers)),
        row("Editor", "Opens the config files.",
            appSelect("editor", settings.editor, settings.editors)),
    ].join("");

    document.getElementById("settings-versions").innerHTML = settings.versions
        .map((pkg) => row(pkg.label, versionHint(pkg), rangeSelect(pkg))).join("");

    document.getElementById("settings-paths").innerHTML = settings.paths
        .map((one) => row(one.label, `<code>${esc(shortPath(one.path))}</code>`,
            one.found ? "" : `<span class="tag red">Missing</span>`, "pref-info")).join("");
}

/**
 * The Updates tab: a card saying whether all is up to date, with Check now and Update all,
 * then each update that is out, and the last ones done.
 * @returns {void}
 */
function renderOutdated() {
    const { packages, held } = state.updates;
    const rows = [ ...packages.map(updateRow), ...held.map(updateRow) ];

    document.getElementById("settings-summary").innerHTML = summaryOf();
    document.getElementById("settings-outdated-panel").hidden = !rows.length;
    document.getElementById("settings-outdated").innerHTML = rows.join("");

    const history = state.settings.history;
    document.getElementById("settings-history").innerHTML = history.length
        ? history.map(historyRow).join("")
        : `<p class="muted">None yet. Each update from Studio or ./setup.sh shows here.</p>`;
}

/**
 * The card atop the tab: how the stack stands, when it was last checked, and the buttons. Its
 * tone follows it: green when all is current, blue when updates are out, amber when only its
 * ranges hold some.
 * @returns {string}
 */
function summaryOf() {
    const { checked, checking, packages, held } = state.updates;
    const busy = isUpdating("brew") || isUpdating("move");

    let tone  = "green";
    let badge = "check";
    let title = "Everything is up to date";
    if (packages.length) {
        tone  = "blue";
        badge = "up";
        title = packages.length === 1 ? "An update is out" : `${packages.length} updates are out`;
    } else if (held.length) {
        tone  = "yellow";
        badge = "lock";
        title = held.length === 1 ? "An update is held by its range"
            : `${held.length} updates are held by their ranges`;
    }
    if (!checked && !packages.length && !held.length) {
        title = "Not checked yet";
    }

    let when = checked ? `Checked ${agoOf(checked)}` : "Homebrew is asked once an hour";
    if (checking) {
        when = "Checking with Homebrew…";
    }

    const extra = held.length && packages.length ? ` · ${held.length} held by its range` : "";
    const all   = busy ? "Updating…" : "Update all…";

    return `
        <div class="upd-summary tone-${tone}">
            <span class="upd-badge">${icon(badge)}</span>
            <div class="upd-summary-text">
                <b>${title}</b>
                <small class="muted">${when}${extra}</small>
            </div>
            <div class="actions">
                <button class="ghost" data-brew-check${checking ? " disabled" : ""}>${icon(
                    "restart")}${checking ? "Checking…" : "Check now"}</button>
                ${packages.length > 1 ? `<button data-brew-update-all>${icon("up")}${all}</button>`
                    : ""}
            </div>
        </div>`;
}

/**
 * An update that is out: the package's logo and name, its versions, how big a step it is, and
 * its button: Update, or Move to when its range holds it.
 * @param {Outdated} pkg
 * @returns {string}
 */
function updateRow(pkg) {
    const busy = isUpdating("brew") || isUpdating("move");
    const step = stepOf(pkg.version, pkg.latest);

    let button = `<button class="small" data-brew-update="${esc(pkg.name)}">${busy
        ? "Updating…" : "Update"}</button>`;
    let note   = "";
    if (pkg.range) {
        button = `<button class="small ghost" data-brew-move="${esc(pkg.name)}"
            title="Set it to ${esc(pkg.next)} in the config, and update ${esc(pkg.label)}"
            >Move to ${esc(pkg.next)}…</button>`;
        note   = `<small class="muted">Kept at ${esc(pkg.range)} by its range</small>`;
    }

    return `
        <div class="upd-row">
            ${logoOf(pkg.name)}
            <div class="upd-text">
                <b>${esc(pkg.label)} <span class="tag ${STEP_TAGS[step]}">${step}</span></b>
                ${note}
            </div>
            <span class="upd-versions"><span class="muted">${esc(pkg.version)}</span>
                <span class="upd-arrow">→</span><b>${esc(pkg.latest)}</b></span>
            ${button}
        </div>`;
}

/**
 * An update of the log: the package's logo and name, its versions, and when and from where.
 * @param {UpdateRecord} one
 * @returns {string}
 */
function historyRow(one) {
    const date = new Date(one.at);
    const day  = date.toLocaleDateString([], { day : "numeric", month : "short" });
    const time = date.toLocaleTimeString([], { hour : "2-digit", minute : "2-digit" });
    const by   = one.by === "setup" ? "./setup.sh" : "Studio";

    return `
        <div class="upd-row past">
            ${logoOf(one.name)}
            <div class="upd-text">
                <b>${esc(one.label)}</b>
                <small class="muted">${esc(day)}, ${esc(time)} · from ${by}</small>
            </div>
            <span class="upd-versions"><span class="muted">${esc(one.from)}</span>
                <span class="upd-arrow">→</span><b>${esc(one.to)}</b></span>
        </div>`;
}

/**
 * A package's logo on its brand color, or a box for one with none, as mkcert.
 * @param {string} name
 * @returns {string}
 */
function logoOf(name) {
    if (!LOGOS[name]) {
        return `<span class="upd-logo plain">${icon("box")}</span>`;
    }
    return `<span class="upd-logo" style="background:${LOGOS[name].color}">${logoSvg(name)}</span>`;
}

/**
 * How big a step an update is, as semver counts it: the first number changing is major, the
 * second minor, anything else a patch. Homebrew's rebuild, as _1, and a cask's build are left
 * out.
 * @param {string} from
 * @param {string} to
 * @returns {"major" | "minor" | "patch"}
 */
function stepOf(from, to) {
    const [ a, b ] = [ from, to ].map((version) => version.split(/[_,]/)[0].split("."));
    if (a[0] !== b[0]) {
        return "major";
    }
    return a[1] === b[1] ? "patch" : "minor";
}

/**
 * How long ago a time was, as the page says it: "just now", "5 min ago", "2 h ago".
 * @param {number} at
 * @returns {string}
 */
function agoOf(at) {
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 1) {
        return "just now";
    }
    return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

/**
 * Saves a setting the page changed: the browser, the editor, or a package's range.
 * @param {HTMLSelectElement} select
 * @returns {Promise<void>}
 */
async function saveSetting(select) {
    await act({
        action : "save-setting",
        key    : select.dataset.setting,
        name   : select.dataset.name || "",
        value  : select.value,
    });
}

/**
 * One setting: its name and what it does on the left, its field on the right.
 * @param {string} label
 * @param {string} hint
 * @param {string} field
 * @param {string=} kind a class for a row that only shows something, as pref-info
 * @returns {string}
 */
function row(label, hint, field, kind = "") {
    return `
        <div class="pref ${kind}">
            <div class="pref-text"><b>${esc(label)}</b><small class="muted">${hint}</small></div>
            ${field}
        </div>`;
}

/**
 * The installed browsers or editors to pick from, the Mac's default first.
 * @param {"browser" | "editor"} key
 * @param {string} picked
 * @param {string[]} apps
 * @returns {string}
 */
function appSelect(key, picked, apps) {
    const options = [ [ "", "The Mac's default" ], ...apps.map((app) => [ app, app ]) ];
    return selectOf(key, "", options, picked);
}

/**
 * The ranges a package can take, from its version: its patches, its minor versions too, or
 * any, and the config's own when it is none of those.
 * @param {StackVersion} pkg
 * @returns {string}
 */
function rangeSelect(pkg) {
    const [ major, minor ] = pkg.version.split(/[_,]/)[0].split(".");
    const patches = `~${major}.${minor || 0}`;
    const options = [
        [ patches, `Patches only · ${patches}` ],
        [ `^${major}`, `Minor versions too · ^${major}` ],
        [ "*", "Any version · *" ],
    ];

    const range = pkg.range || patches;
    if (!options.some(([ value ]) => value === range)) {
        options.push([ range, `As the config says · ${range}` ]);
    }

    return selectOf("version", pkg.name, options, range);
}

/**
 * A select of the page, which saves as it changes.
 * @param {string} key
 * @param {string} name the package it is for, or ""
 * @param {string[][]} options each value and its label
 * @param {string} picked
 * @returns {string}
 */
function selectOf(key, name, options, picked) {
    return `
        <span class="field select"><select data-setting="${key}" data-name="${esc(name)}">
            ${options.map(([ value, label ]) => `<option value="${esc(value)}"${
                value === picked ? " selected" : ""}>${esc(label)}</option>`).join("")}
        </select></span>`;
}

/**
 * What a package's row says under its name: the version installed, and a newer one its range
 * holds back, which Move to on the Overview takes.
 * @param {StackVersion} pkg
 * @returns {string}
 */
function versionHint(pkg) {
    const held = state.updates.held.find((one) => one.name === pkg.name);
    const text = `${esc(pkg.version)} installed`;
    return held ? `${text}, ${esc(held.latest)} is out and held back` : text;
}



// The public API
export {
    renderSettings,
    saveSetting,
};
