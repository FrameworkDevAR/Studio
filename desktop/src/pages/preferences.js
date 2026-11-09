// The Settings page: the browser and the editor Studio opens things with, and the range of
// versions each package of the stack may update to. Each saves to the config as it changes.

import { act } from "../core/api.js";
import { esc } from "../core/helpers.js";
import { state } from "../core/state.js";



/**
 * A package of the stack as the Settings page lists it.
 * @typedef {{ name: string, label: string, version: string, range: string }} StackVersion
 */



// ---------------------------------------------------------------- settings ---

// What the page last drew, so a refresh that changes nothing leaves an open select alone.
let drawn = "";

/**
 * Draws the settings, when they changed since the last time.
 * @returns {void}
 */
function renderSettings() {
    const settings = state.settings;
    const held     = state.updates.held;
    const sign     = JSON.stringify([ settings, held ]);
    if (sign === drawn) {
        return;
    }

    drawn = sign;
    document.getElementById("settings-apps").innerHTML = [
        row("Browser", "Opens the pages. One built on Chrome reuses the tab already open.",
            appSelect("browser", settings.browser, settings.browsers)),
        row("Editor", "Opens the config files.",
            appSelect("editor", settings.editor, settings.editors)),
    ].join("");

    document.getElementById("settings-versions").innerHTML = settings.versions
        .map((pkg) => row(pkg.label, versionHint(pkg), rangeSelect(pkg))).join("");
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
 * @returns {string}
 */
function row(label, hint, field) {
    return `
        <div class="pref">
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
