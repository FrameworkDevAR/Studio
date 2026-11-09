// The apps of each project, found in its folders, with their names and addresses.

import path from "node:path";

import { PROJECTS } from "./config.js";
import { subDirsOf, capitalize, filesIn, readFile } from "./helpers.js";



/** The app listed first in each project. */
const MAIN_APP   = "desktop";

/** The folder an app keeps another app in, as shop/tv/web, which is listed as tv. */
const NESTED_APP = "web";



/**
 * A project of the config, with its defaults filled in.
 * @typedef {(typeof PROJECTS)[number]} Project
 */

/**
 * An app: its name, its project's folder name, its own folder name, and where it is.
 * @typedef {{ name: string, project: string, app: string, dir: string }} AppInfo
 */



// -------------------------------------------------------------------- apps ---

/**
 * The folders that hold apps, in the config's order, each with its project.
 * @returns {{ root: string, project: Project }[]}
 */
function projectRoots() {
    return PROJECTS
        .filter((project) => project.dir)
        .map((project) => ({ root : project.dir, project }));
}

/**
 * The directories scanned one level deep for apps.
 * @returns {string[]}
 */
function appRoots() {
    return projectRoots().map(({ root }) => root);
}

/**
 * The project a folder is in: the closest root holding it, or none.
 * @param {string} dir
 * @returns {Project | undefined}
 */
function projectOf(dir) {
    const found = projectRoots()
        .filter(({ root }) => dir === root || dir.startsWith(`${root}/`))
        .sort((a, b) => b.root.length - a.root.length)[0];
    return found?.project;
}

/**
 * Where a project goes: the config's order, by its folder's name.
 * @param {string} project its folder's name
 * @returns {number}
 */
function projectRank(project) {
    const index = projectRoots().findIndex(({ root }) => path.basename(root) === project);
    return index === -1 ? Infinity : index;
}

/**
 * An app's name, its project's folder and its own.
 * @param {string} dir
 * @returns {AppInfo}
 */
function appInfo(dir) {
    const home = appHomeOf(dir);
    return {
        name    : nameOf(dir),
        project : path.basename(path.dirname(home)),
        app     : path.basename(home),
        dir,
    };
}

/**
 * The project folder an app is in: the closest root holding it.
 * @param {string} dir
 * @returns {string}
 */
function appRootOf(dir) {
    return appRoots()
        .filter((root) => dir.startsWith(`${root}/`))
        .sort((a, b) => b.length - a.length)[0];
}

/**
 * The folders that can hold an app: each subfolder, and the nested app folder in it (shop/tv/web).
 * @param {string} root
 * @returns {string[]}
 */
function appDirsOf(root) {
    return subDirsOf(root).flatMap((dir) => [ dir, path.join(dir, NESTED_APP) ]);
}

/**
 * The folder an app is named after: itself, or its parent when it is a nested one.
 * @param {string} dir
 * @returns {string}
 */
function appHomeOf(dir) {
    const clean = dir.replace(/\/$/, "");
    return path.basename(clean) === NESTED_APP ? path.dirname(clean) : clean;
}

/**
 * Orders apps by project, in the config's order, then the desktop app first and the rest
 * alphabetically.
 * @param {AppInfo} a
 * @param {AppInfo} b
 * @returns {number}
 */
function byProjectThenApp(a, b) {
    if (a.project !== b.project) {
        return projectRank(a.project) - projectRank(b.project)
            || a.project.localeCompare(b.project);
    }

    if (a.app !== b.app && (a.app === MAIN_APP || b.app === MAIN_APP)) {
        return a.app === MAIN_APP ? -1 : 1;
    }
    return a.app.localeCompare(b.app);
}

/**
 * /path/to/shop-alpha/desktop -> "Shop Alpha - desktop"
 * @param {string} dir
 * @returns {string}
 */
function nameOf(dir) {
    const home = appHomeOf(dir);
    return `${projectTitleOf(path.dirname(home))} - ${path.basename(home)}`;
}

/**
 * A project folder's title: the config's name, or one made from the folder.
 * @param {string} root
 * @returns {string}
 */
function projectTitleOf(root) {
    return projectOf(root)?.name || titleOf(path.basename(root));
}

/**
 * shop-alpha -> "Shop Alpha"
 * @param {string} folder
 * @returns {string}
 */
function titleOf(folder) {
    return folder.split("-").map(capitalize).join(" ");
}

/**
 * The scheme an app is served on: https when its vite.config sets server.https.
 * @param {string} dir
 * @returns {"http" | "https"}
 */
function schemeOf(dir) {
    const configs   = filesIn(dir, "vite.config.");
    const usesHttps = configs.some((config) => /^\s*https\s*[,:]/m.test(readFile(config)));
    return usesHttps ? "https" : "http";
}

/**
 * The host an app is served on: VITE_HOST in its .env files, else vite.config.
 * @param {string} dir
 * @returns {string}
 */
function hostOf(dir) {
    for (const envFile of [ ".env.development.local", ".env.development" ]) {
        const found = readFile(path.join(dir, envFile)).match(/^\s*VITE_HOST\s*=\s*"?([^"\n]*)"?/m);
        if (found && found[1].trim()) {
            return found[1].trim();
        }
    }

    for (const config of filesIn(dir, "vite.config.")) {
        const found = readFile(config).match(/^\s*host\s*:\s*"([^"]+)"/m);
        if (found) {
            return found[1];
        }
    }

    return "localhost";
}



// The public API
export {
    projectRoots,
    appRootOf,
    appDirsOf,
    appInfo,
    byProjectThenApp,
    titleOf,
    schemeOf,
    hostOf,
    appRoots,
    appHomeOf,
};
