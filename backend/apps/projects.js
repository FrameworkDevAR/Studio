// The projects and their servers in the config, as the Sites page adds, changes and removes
// them, a server being a site with a command. The apps themselves are found in a project's
// folders, so they are not written down.

import fs from "node:fs";
import os from "node:os";

import { readConfig, writeConfig } from "../core/config.js";
import { run } from "../core/system.js";
import { splitCommand } from "../core/command.js";
import { readVhosts } from "../stack/apache.js";
import { saveHosts, saveVhosts } from "../stack/vhosts.js";
import { expandHome } from "../core/paths.js";



// A host name, as docs.shop.local.
const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;






/**
 * A site as the config has it. One with a command is a server the menu starts: its id, its
 * name, the folder the command runs in, the command with its arguments, a line as typed in a
 * shell, and the host it answers on, if not localhost. One without is Apache's, or only a
 * link when no vhost has its host: its name, its host and whether over
 * https; its folder is its vhost's. Anything else, as a pathPrefix, is kept as it is.
 * @typedef {{
 *     id?: string, name?: string, host?: string, dir?: string, command?: string,
 *     https?: boolean,
 * }} ServerEntry
 */

/**
 * A project as the config has it: what it is called, the folder of its apps, the host Apache
 * serves that folder at and whether over https, whether each subfolder of the folder is a
 * worktree, which app goes first and which folder holds a nested one, its own servers
 * and sites, and false for menu when the SwiftBar menu leaves it out.
 * @typedef {{
 *     name?: string, dir?: string, host?: string, https?: boolean, worktrees?: boolean,
 *     mainApp?: string, nestedApp?: string, sites?: ServerEntry[], menu?: boolean,
 * }} ProjectEntry
 */

/**
 * A server as the project's form sends it: old is its place in the project's list, "" for a
 * new one, and command the line typed, with its arguments, "" for a site.
 * @typedef {{ old: string, name: string, host: string, dir: string, command: string }}
 *     ServerForm
 */

/**
 * A server for the page: the config's, with its name and folder filled in, and the url a
 * site opens, "" for a server with a command.
 * @typedef {{
 *     id: string, name: string, host: string, dir: string, command: string, url: string,
 * }} PageServer
 */

/** @import { VhostForm } from "../stack/vhosts.js" */

/**
 * A vhost of the running file, one for each of its http and https blocks.
 * @typedef {{ name: string, root: string, ssl: boolean }} VhostEntry
 */

/**
 * A project for the page: the config's, with its place in it, its folder in full, which the
 * apps the plugin lists are found in, its servers and sites, its host and whether over
 * https, and whether the SwiftBar menu shows it.
 * @typedef {{
 *     index: number, name: string, dir: string, home: string, worktrees: boolean,
 *     sites: PageServer[], host: string, https: boolean, menu: boolean,
 * }} StudioProject
 */



// ---------------------------------------------------------------- projects ---

/**
 * The projects of the config, in its order, for the Sites page's forms. A config that is
 * not JSON gives none, so the page still shows; Edit config says what is wrong with it.
 * @returns {StudioProject[]}
 */
function readProjects() {
    let config;
    try {
        config = readConfig();
    } catch {
        return [];
    }

    const vhosts = readVhosts();

    return projectsOf(config).map((project, index) => {
        const home = expandHome(project.dir);

        return {
            index,
            name      : project.name || "",
            dir       : project.dir || "",
            home,
            worktrees : Boolean(project.worktrees),
            sites     : (project.sites || []).map((site) => pageServer(site, vhosts)),
            host      : project.host || "",
            https     : Boolean(project.https),
            menu      : project.menu !== false,
        };
    });
}

/**
 * Adds a project, or changes the one at its index, with its servers and sites as the form
 * lists them, all at once. Anything else it holds stays.
 * Its vhosts are set first, so one Apache refuses leaves the config as it was.
 * @param {{
 *     index: number, name: string, dir: string, sites: ServerForm[], host: string,
 *     https: boolean, menu: boolean,
 * }} form
 * @returns {Promise<{ message: string }>}
 */
async function saveProject(form) {
    const config   = readConfig();
    const projects = projectsOf(config);
    const index    = Number(form.index);
    const old      = index >= 0 ? projects[index] : {};
    if (!old) {
        throw new Error("That project is no longer in the config");
    }

    const name = text(form.name);
    const dir  = text(form.dir);
    const host = text(form.host).toLowerCase();
    if (!name && !dir && !form.sites?.length) {
        throw new Error("A project needs a name, the folder of its apps, or a site");
    }

    if (dir) {
        checkFolder(dir);
    }
    if (host && !dir) {
        throw new Error("A host needs the project's folder to serve");
    }
    if (host && !HOST_PATTERN.test(host)) {
        throw new Error(`${host} is not a host name, as shop.local`);
    }

    // Two projects of one folder would list its apps twice.
    const twin = projects.find((one, at) => at !== index && one.dir
        && expandHome(one.dir).replace(/\/$/, "") === expandHome(dir).replace(/\/$/, ""));
    if (twin) {
        throw new Error(`That folder is the project ${twin.name || twin.dir} already`);
    }

    // A host is one project's, its own or a site's: two would both write its vhost.
    for (const name of hostsOf(host, form.sites || [])) {
        const holder = projects.find((one, at) => at !== index && (one.host === name
            || (one.sites || []).some((site) => !site.command && site.host === name)));
        if (holder) {
            throw new Error(`${name} is the project ${holder.name || holder.dir}'s already`);
        }
    }

    const others  = projects.filter((one) => one !== old)
        .flatMap((one) => (one.sites || []).map((site) => site.id).filter(Boolean));
    const project = /** @type {ProjectEntry} */ (prune({
        name,
        dir,
        host,
        https : Boolean(host && form.https),
        sites : sitesFrom(form.sites || [], old.sites || [], others, Boolean(form.https)),
        ...without(old, [ "name", "dir", "host", "https", "sites", "menu" ]),
    }));

    // Shown is the default, so only a project left out of the menu says so; prune would
    // drop the false, so it goes in after.
    if (form.menu === false) {
        project.menu = false;
    }

    if (index >= 0) {
        projects[index] = project;
    } else {
        projects.push(project);
    }

    const title  = name || dir || "the project";
    const apache = await saveVhosts({
        ...vhostChange(form, old),
        title,
        home : expandHome(old.dir || dir),
    });
    const hosts  = saveHosts(...serverHosts(project, old, projects));

    await writeConfig(config);
    const notes = [ apache, hosts ].filter(Boolean).join(" ");
    return {
        message : `${index >= 0 ? "Saved" : "Added"} ${title}${notes ? `. ${notes}` : ""}`,
    };
}

/**
 * Takes a project out of the config, with its sites. Its folder and its apps stay, and
 * what runs keeps running; the menu and the page just no longer list them.
 * @param {number} index
 * @returns {Promise<{ message: string }>}
 */
async function removeProject(index) {
    const config   = readConfig();
    const projects = projectsOf(config);
    const project  = projects[Number(index)];
    if (!project) {
        throw new Error("That project is no longer in the config");
    }

    projects.splice(Number(index), 1);
    await writeConfig(config);

    return { message : `Removed ${project.name || project.dir} from the config` };
}


// ------------------------------------------------------------------- sites ---

/**
 * A server for the page. A site's folder is its vhost's, and it opens at its host, over https
 * when the config says so.
 * @param {ServerEntry} server
 * @param {VhostEntry[]} vhosts
 * @returns {PageServer}
 */
function pageServer(server, vhosts) {
    const host    = server.host || "";
    const command = server.command || "";
    let dir       = server.dir || "";
    let url       = "";

    if (!command) {
        dir = vhosts.find((vhost) => vhost.name === host)?.root || "";
        url = `${server.https ? "https" : "http"}://${host}/`;
    }

    return {
        id   : server.id || "",
        name : server.name || server.id || "",
        host,
        dir,
        command,
        url,
    };
}

/**
 * Whether a server is a site: one with no command, which Apache serves.
 * @param {ServerEntry|ServerForm} server
 * @returns {boolean}
 */
function isSite(server) {
    return !text(server.command);
}

/**
 * The entry a form's line had, by its place in the project's list; none for a new line.
 * @param {ServerForm} form
 * @param {ServerEntry[]} old
 * @returns {ServerEntry|undefined}
 */
function entryOf(form, old) {
    return text(form.old) ? old[Number(form.old)] : undefined;
}

/**
 * What a form changes in the vhosts: the project's own, at its host, and one for each site
 * with a folder. A vhost goes when its host is cleared, or its site or folder is taken out,
 * or its site is given a command; a site's vhost outside the project is another's, and stays.
 * A project, or a new site of one, given a host that a vhost of its folder has already, as
 * one made from that vhost, takes it as its own rather than adding a second.
 * @param {{ dir: string, host: string, https: boolean, sites: ServerForm[] }} form
 * @param {ProjectEntry} old
 * @returns {{ forms: VhostForm[], drops: { name: string, root: string }[] }}
 */
function vhostChange(form, old) {
    const vhosts  = readVhosts();
    const home    = expandHome(old.dir);
    const main    = vhosts.find((vhost) => (old.host
        ? vhost.name === old.host
        : isOwnVhost(vhost, form)));
    const https   = Boolean(form.https);
    const entries = old.sites || [];
    const forms   = [];
    const drops   = [];
    const kept    = [];

    if (text(form.host)) {
        forms.push({
            oldName : main?.name || "",
            oldRoot : main?.root || "",
            name    : text(form.host).toLowerCase(),
            dir     : text(form.dir),
            https,
        });
    } else if (main) {
        drops.push({ name : main.name, root : main.root });
    }

    for (const site of (form.sites || []).filter(isSite)) {
        const before = entryOf(site, entries);
        const vhost  = before && isSite(before)
            ? vhosts.find((one) => one.name === before.host)
            : vhosts.find((one) => isOwnVhost(one, site));
        kept.push(before);

        // A site at the project's own host is that vhost, already set above.
        if (vhost && vhost.name === main?.name) {
            continue;
        }

        if (text(site.dir)) {
            forms.push({
                oldName : vhost?.name || "",
                oldRoot : vhost?.root || "",
                name    : text(site.host),
                dir     : text(site.dir),
                https,
            });
        } else if (vhost && isInside(vhost.root, home)) {
            drops.push({ name : vhost.name, root : vhost.root });
        }
    }

    for (const site of entries.filter((one) => isSite(one) && !kept.includes(one))) {
        const vhost = vhosts.find((one) => one.name === site.host);

        if (vhost && vhost.name !== main?.name && isInside(vhost.root, home)) {
            drops.push({ name : vhost.name, root : vhost.root });
        }
    }

    return { forms, drops };
}

/**
 * The hosts a form gives its project: its own, and its sites' that have no command.
 * @param {string} host
 * @param {ServerForm[]} sites
 * @returns {string[]}
 */
function hostsOf(host, sites) {
    const named = sites.filter((site) => !text(site.command))
        .map((site) => text(site.host).toLowerCase());

    return [ host, ...named ].filter(Boolean);
}

/**
 * Whether a vhost is the one a form's host and folder describe: the same name, serving the
 * same folder.
 * @param {{ name: string, root: string }} vhost
 * @param {{ dir: string, host: string }} form
 * @returns {boolean}
 */
function isOwnVhost(vhost, form) {
    const dir = expandHome(text(form.dir)).replace(/(.)\/+$/, "$1");

    return Boolean(text(form.host)) && vhost.name === text(form.host).toLowerCase()
        && vhost.root === dir;
}

/**
 * Whether a folder is another one or inside it.
 * @param {string} dir
 * @param {string} home
 * @returns {boolean}
 */
function isInside(dir, home) {
    return Boolean(home) && (dir === home || dir.startsWith(`${home.replace(/\/+$/, "")}/`));
}


// ----------------------------------------------------------------- servers ---

/**
 * A project's servers and sites as the form lists them, in its order. One that was there
 * before keeps what the form does not show, as a pathPrefix, and a server its id, which the
 * menu starts it by; a new server's id is made from its name. The command is kept as typed,
 * a line with its arguments, once it splits as a shell would. A site's folder is its vhost's,
 * so it is not written down, and it goes by the project's https when Apache serves it.
 * @param {ServerForm[]} forms
 * @param {ServerEntry[]} old the project's sites until now
 * @param {string[]} others the ids of the other projects' servers
 * @param {boolean} https
 * @returns {ServerEntry[]}
 */
function sitesFrom(forms, old, others, https) {
    const kept = forms.map((form) => (isSite(form) ? undefined : entryOf(form, old)?.id));
    const ids  = [ ...others, ...kept.filter(Boolean) ];

    return forms.map((form, at) => {
        const name    = text(form.name);
        const dir     = text(form.dir);
        const command = text(form.command).replace(/\s+/g, " ");
        const host    = text(form.host).toLowerCase();
        const before  = entryOf(form, old) || {};
        const rest    = without(before,
            [ "id", "name", "dir", "command", "host", "https", "args" ]);

        if (host && !HOST_PATTERN.test(host)) {
            throw new Error(`${host} is not a host name, as docs.shop.local`);
        }
        if (dir) {
            checkFolder(dir);
        }

        if (!command) {
            if (!name || !host) {
                throw new Error(`The site ${name || "new"} needs a name and a host`);
            }

            // A link keeps its own scheme, as Apache has no say in it.
            const secure = dir ? https : Boolean(before.https && before.host === host);
            return /** @type {ServerEntry} */ (prune({ name, host, https : secure, ...rest }));
        }

        if (!name || !dir || !splitCommand(command).length) {
            throw new Error(`The server ${name || "new"} needs a name and the folder it runs in`);
        }

        let id = kept[at];
        if (!id) {
            id = newId(name, ids);
            ids.push(id);
        }

        return /** @type {ServerEntry} */ (prune({
            id,
            // A name that only repeats the id says nothing the id did not.
            name : name === id ? "" : name,
            dir,
            command,
            host,
            // The arguments were once a list of their own, now in the command.
            ...rest,
        }));
    });
}

/**
 * The hosts a save points at this Mac, and those it no longer needs: a server's host is only
 * a name for localhost, so it needs its line in the hosts file and no vhost; a site's comes
 * with its vhost. One another
 * server still answers on stays.
 * @param {ProjectEntry} project as saved
 * @param {ProjectEntry} old as it was
 * @param {ProjectEntry[]} projects all of them, the saved one among them
 * @returns {[ string[], string[] ]}
 */
function serverHosts(project, old, projects) {
    const hostsOf = (one) => (one.sites || []).filter((server) => !isSite(server))
        .map((server) => server.host)
        .filter(Boolean);
    const adds    = hostsOf(project);
    const used    = projects.flatMap(hostsOf);

    return [ adds, hostsOf(old).filter((host) => !used.includes(host)) ];
}

/**
 * A new server's id, from its name: "Shop Docs" gives shop-docs, or shop-docs-2 when that is
 * taken. The menu's actions take it, and the page puts it in attributes, so it is letters,
 * digits, dots and dashes.
 * @param {string} name
 * @param {string[]} taken
 * @returns {string}
 */
function newId(name, taken) {
    const base = name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
        .replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "server";

    let id = base;
    for (let count = 2; taken.includes(id); count++) {
        id = `${base}-${count}`;
    }

    return id;
}


// ----------------------------------------------------------------- folders ---

/**
 * Asks for a folder with the Mac's own dialog, as the page cannot: a browser never tells
 * a page where a file it picks is. It opens on the folder given, or its closest one that
 * is there, and gives the one chosen as the config writes it, with ~ for home; "" when
 * the dialog is cancelled.
 * @param {string} start the folder in the field, as typed
 * @returns {Promise<{ dir: string }>}
 */
async function pickFolder(start) {
    // A path that is not whole, as one half typed, opens at home.
    let from = expandHome(text(start));
    if (!from.startsWith("/")) {
        from = os.homedir();
    }

    while (!isFolder(from)) {
        from = from.replace(/\/[^/]*\/?$/, "") || "/";
    }

    // System Events shows the dialog, so it comes up in front of the browser rather than
    // behind it. The folder goes in as an argument, never into the script's text.
    const result = await run("/usr/bin/osascript", [
        "-e", "on run argv",
        "-e", "tell application \"System Events\"",
        "-e", "activate",
        "-e", "set chosen to choose folder with prompt \"The folder for Studio\" " +
            "default location (POSIX file (item 1 of argv))",
        "-e", "end tell",
        "-e", "return POSIX path of chosen",
        "-e", "end run",
        from,
    ], 600_000);

    // Cancelling is error -128, and says nothing; anything else is a real failure.
    if (!result.ok) {
        if (/-128/.test(result.stderr)) {
            return { dir : "" };
        }
        throw new Error(`The folder dialog did not open: ${result.stderr.trim()}`);
    }

    const dir  = result.stdout.trim().replace(/(.)\/$/, "$1");
    const home = os.homedir();
    const mine = dir === home || dir.startsWith(`${home}/`);

    return { dir : mine ? `~${dir.slice(home.length)}` : dir };
}


// ----------------------------------------------------------------- helpers ---

/**
 * The config's list of projects, made when it has none, so a change to it is the config's.
 * @param {Object<string, *>} config
 * @returns {ProjectEntry[]}
 */
function projectsOf(config) {
    if (!Array.isArray(config.projects)) {
        config.projects = [];
    }
    return config.projects;
}

/**
 * Throws unless a folder, as typed with ~ for home, is one.
 * @param {string} dir
 * @returns {void}
 */
function checkFolder(dir) {
    if (!isFolder(expandHome(dir))) {
        throw new Error(`There is no folder ${dir}`);
    }
}

/**
 * Whether a path is a folder that is there.
 * @param {string} dir
 * @returns {boolean}
 */
function isFolder(dir) {
    try {
        return fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

/**
 * A form's value as a trimmed text, "" for none.
 * @param {*} value
 * @returns {string}
 */
function text(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * An entry without its empty settings: no "", no false and no [], so the config only says
 * what differs from what the plugin goes by.
 * @param {Object<string, *>} entry
 * @returns {Object<string, *>}
 */
function prune(entry) {
    return Object.fromEntries(Object.entries(entry).filter(([ , value ]) => value !== ""
        && value !== false && !(Array.isArray(value) && !value.length)));
}

/**
 * An entry without the settings a form gives, so what is left is kept as it was.
 * @param {Object<string, *>} entry
 * @param {string[]} keys
 * @returns {Object<string, *>}
 */
function without(entry, keys) {
    return Object.fromEntries(Object.entries(entry).filter(([ key ]) => !keys.includes(key)));
}




// The public API
export {
    readProjects,
    saveProject,
    removeProject,
    pickFolder,
};
