"use strict";

// The apps of each project, found in its folders, with their names and addresses.

const fs = require("fs");
const path = require("path");

const { PROJECTS, NO_PROJECT } = require("./config");
const { subDirsOf, capitalize, filesIn, readFile } = require("./helpers");


// -------------------------------------------------------------------- apps ---

/**
 * A project of the config, with its defaults filled in.
 * @typedef {(typeof PROJECTS)[number]} Project
 */

/**
 * The settings a folder goes by: its project's, or those of no project, which has no dir and
 * no servers.
 * @typedef {Project | typeof NO_PROJECT} ProjectSettings
 */

/**
 * An app: its name, its project's folder name, its own folder name, and where it is.
 * @typedef {{ name: string, project: string, app: string, dir: string }} AppInfo
 */

/**
 * The folders that hold apps, in the config's order, each with its project:
 * a project's own folder, or each subfolder of one with worktrees.
 * @returns {{ root: string, project: Project }[]}
 */
function projectRoots() {
    return PROJECTS
        .filter((project) => project.dir)
        .flatMap((project) => (project.worktrees ? subDirsOf(project.dir) : [ project.dir ])
            .map((root) => ({ root, project })));
}

/**
 * The directories scanned one level deep for apps.
 * @returns {string[]}
 */
function appRoots() {
    return projectRoots().map(({ root }) => root);
}

/**
 * The settings of the project a folder is in: the closest root holding it.
 * @param {string} dir
 * @returns {ProjectSettings}
 */
function settingsOf(dir) {
    const found = projectRoots()
        .filter(({ root }) => dir === root || dir.startsWith(`${root}/`))
        .sort((a, b) => b.root.length - a.root.length)[0];
    return found ? found.project : NO_PROJECT;
}

/**
 * Where a project goes: the config's order, and its worktrees by folder name.
 * @param {string} project its folder's name
 * @returns {number}
 */
function projectRank(project) {
    const index = projectRoots().findIndex(({ root }) => path.basename(root) === project);
    return index === -1 ? Infinity : index;
}

/**
 * The main app of every worktree, whether running or not.
 * @returns {string[]}
 */
function desktopApps() {
    return projectRoots()
        .filter(({ project }) => project.worktrees)
        .map(({ root, project }) => path.join(root, project.mainApp))
        .filter((dir) => fs.existsSync(path.join(dir, "package.json")));
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
    const nested = settingsOf(root).nestedApp;
    return subDirsOf(root).flatMap((dir) => [ dir, path.join(dir, nested) ]);
}

/**
 * The folder an app is named after: itself, or its parent when it is a nested one.
 * @param {string} dir
 * @returns {string}
 */
function appHomeOf(dir) {
    const clean = dir.replace(/\/$/, "");
    return path.basename(clean) === settingsOf(clean).nestedApp ? path.dirname(clean) : clean;
}

/**
 * Orders apps by project, in the config's order, then the main app first and the rest
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

    const main = settingsOf(a.dir).mainApp;
    if (a.app !== b.app && (a.app === main || b.app === main)) {
        return a.app === main ? -1 : 1;
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
    const settings = settingsOf(root);
    return settings.name && !settings.worktrees ? settings.name : titleOf(path.basename(root));
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
module.exports = {
    projectRoots,
    appRootOf,
    appDirsOf,
    appInfo,
    byProjectThenApp,
    titleOf,
    schemeOf,
    hostOf,
    desktopApps,
    appRoots,
    appHomeOf,
};
