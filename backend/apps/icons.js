"use strict";

// The projects' own favicons, found among their files -- never by requesting
// their sites -- for the badges of the Sites page.

const fs = require("fs");
const path = require("path");

const { projectRoots } = require("./apps");

// Folders never searched: they hold packages, not the project's own files.
const SKIPPED_DIRS = [ "node_modules", "vendor", ".git" ];

// The kinds of icon a page can show, best first: an SVG stays sharp at any size.
const ICON_TYPES = [ ".svg", ".png", ".ico" ];

/**
 * The favicon of each project, by the name the page knows it by: the
 * project's folder for one with apps, its title for one with servers, which
 * is looked for in its first server's folder. Kept for 5 minutes, since the
 * page asks every 5s and favicons hardly ever change.
 */
let iconCache = { at : 0, data : {} };



/**
 * The favicon file of each project that has one, by project.
 * @param {import("./apps").StudioApp[]} apps
 * @param {import("./apps").StudioServer[]} servers
 * @returns {Object<string, string>}
 */
function readIcons(apps, servers) {
    if (Date.now() - iconCache.at < 300_000) {
        return iconCache.data;
    }

    const roots = projectRoots(apps);
    for (const server of servers) {
        roots[server.project] ??= server.dir;
    }

    /** @type {Object<string, string>} */
    const icons = {};
    for (const [ project, root ] of Object.entries(roots)) {
        const icon = findIcon(root);
        if (icon) {
            icons[project] = icon;
        }
    }

    iconCache = { at : Date.now(), data : icons };
    return icons;
}

/**
 * The best favicon.* in a folder, a few levels down: an SVG before a PNG
 * before an ICO, and the nearest of each.
 * @param {string} root
 * @param {number=} depth
 * @returns {string}
 */
function findIcon(root, depth = 4) {
    const found = [];
    const walk  = (dir, level) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes : true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const type = path.extname(entry.name).toLowerCase();
            if (entry.isFile() && /^favicon\./i.test(entry.name) && ICON_TYPES.includes(type)) {
                found.push({
                    file : path.join(dir, entry.name),
                    rank : ICON_TYPES.indexOf(type),
                    level,
                });
            } else if (entry.isDirectory() && level < depth && !SKIPPED_DIRS.includes(entry.name)) {
                walk(path.join(dir, entry.name), level + 1);
            }
        }
    };

    walk(root, 1);
    found.sort((a, b) => a.rank - b.rank || a.level - b.level);
    return found[0]?.file || "";
}

/**
 * The file of a project's favicon, if it has one. Only a file found above can be asked for.
 * @param {string} project
 * @returns {string}
 */
function iconFile(project) {
    return iconCache.data[project] || "";
}



// The public API
module.exports = {
    readIcons,
    iconFile,
};
