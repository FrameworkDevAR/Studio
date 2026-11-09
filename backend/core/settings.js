// The Settings page: the browser and the editor Studio opens things with, picked from the apps
// installed, and the range of versions each package of the stack may update to. Both are kept
// in the config, which the plugin reads on every run, so a change applies at once.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readConfig, writeConfig } from "./config.js";
import { CONFIG, readJson } from "./system.js";
import { toolsOf } from "./paths.js";
import { isRange } from "./versions.js";
import { readVersions } from "../stack/brew.js";



/** The browsers and the editors offered, as the setup offers them, when installed. */
const APPS = {
    browser : [
        "Google Chrome", "Brave Browser", "Arc", "Microsoft Edge", "Vivaldi", "Firefox", "Safari",
    ],
    editor  : [ "Visual Studio Code", "Cursor", "Zed", "Sublime Text", "Nova", "BBEdit" ],
};



/**
 * The settings as the page shows them.
 * @typedef {{
 *     browser: string, editor: string, browsers: string[], editors: string[],
 *     versions: { name: string, label: string, version: string, range: string }[],
 * }} Settings
 */



// ---------------------------------------------------------------- settings ---

/**
 * The settings, with the apps that can be picked: those installed, and the one picked even
 * when it is not one of them.
 * @returns {Settings}
 */
function readSettings() {
    const tools = toolsOf(readJson(CONFIG));

    return {
        browser  : tools.browser,
        editor   : tools.editor,
        browsers : appsOf("browser", tools.browser),
        editors  : appsOf("editor", tools.editor),
        versions : readVersions(),
    };
}

/**
 * Saves one setting: the browser, the editor (either "" for the Mac's default), or a
 * package's range of versions ("" for its patches only).
 * @param {{ key: string, name?: string, value: string }} change
 * @returns {Promise<{ message: string }>}
 */
async function saveSetting(change) {
    const value  = String(change.value ?? "").trim();
    const config = readConfig();

    if (change.key === "browser" || change.key === "editor") {
        setTool(config, change.key, value);
    } else if (change.key === "version") {
        setRange(config, String(change.name || ""), value);
    } else {
        throw new Error("Unknown setting");
    }

    // The keys keep the example's order: the projects last.
    const { projects, ...rest } = config;
    await writeConfig(projects === undefined ? rest : { ...rest, projects });

    return { message : "Saved" };
}

/**
 * Sets the browser or the editor in the config, or takes it out for the Mac's default.
 * @param {Object<string, *>} config
 * @param {"browser" | "editor"} key
 * @param {string} value
 * @returns {void}
 */
function setTool(config, key, value) {
    if (value && !appsOf(key, "").includes(value)) {
        throw new Error(`${value} is not installed`);
    }

    if (value) {
        config[key] = value;
    } else {
        delete config[key];
    }
}

/**
 * Sets a package's range in the config, or takes it out, which leaves it its patches.
 * @param {Object<string, *>} config
 * @param {string} name
 * @param {string} range
 * @returns {void}
 */
function setRange(config, name, range) {
    if (!readVersions().some((one) => one.name === name)) {
        throw new Error(`${name} is not a package of the stack`);
    }
    if (range && !isRange(range)) {
        throw new Error(`${range} is not a range, as ~8.5 or ^25`);
    }

    const versions = { ...config.versions };
    if (range) {
        versions[name] = range;
    } else {
        delete versions[name];
    }
    config.versions = versions;
}


// ----------------------------------------------------------------- helpers ---

/**
 * The browsers or editors installed, in /Applications or the user's own, with the one picked
 * first when it is none of them, so the page still shows it.
 * @param {"browser" | "editor"} key
 * @param {string} picked
 * @returns {string[]}
 */
function appsOf(key, picked) {
    const folders   = [ "/Applications", path.join(os.homedir(), "Applications") ];
    const installed = APPS[key].filter((name) => folders
        .some((folder) => fs.existsSync(path.join(folder, `${name}.app`))));

    return picked && !installed.includes(picked) ? [ picked, ...installed ] : installed;
}



// The public API
export {
    readSettings,
    saveSetting,
};
