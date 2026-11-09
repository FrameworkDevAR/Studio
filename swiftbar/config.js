// What the plugin works with: the config, the projects and their servers, the stack's
// paths and versions, and the flags that say what is busy.

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PHPMYADMIN, expandHome, pathsOf, toolsOf } from "../backend/core/paths.js";
import { splitCommand } from "../backend/core/command.js";



// ------------------------------------------------------------------ config ---

const HOME = os.homedir();

/** This machine's settings: see config.example.json for each of them. */
const CONFIG = readConfig();

// The paths of the stack: the config's, or Homebrew's own.
const PATHS      = pathsOf(CONFIG);
const BREW       = PATHS.brew;
const HTTPD      = PATHS.httpd;
const VHOSTS     = PATHS.vhosts;
const APACHE_LOG = PATHS.apacheLog;

// The local PHP settings. Brew keeps a folder per minor version (8.5), so this
// follows the linked one; the file loads after php.ini, so it wins.
const PHP_MINOR  = versionOf("php").split(".").slice(0, 2).join(".");
const PHP_INI    = PATHS.phpIni.replace("{php}", PHP_MINOR);

// What opens the pages and the config files: the config's, or the Mac's default.
const BROWSER    = toolsOf(CONFIG).browser;
const EDITOR     = toolsOf(CONFIG).editor;


/** The projects, in the config's order, with their defaults filled in. */
const PROJECTS = (CONFIG.projects || []).map((project) => ({
    name      : project.name || "",
    dir       : project.dir ? expandHome(project.dir) : "",
    // Left out of the menu with "menu": false; Studio still lists it, from the json.
    menu      : project.menu !== false,
    // A site with a command is a server the menu starts; one without, Apache's, only linked.
    servers   : (project.sites || []).filter((site) => site.command),
    sites     : (project.sites || []).filter((site) => !site.command).map((site) => ({
        name : site.name,
        url  : `${site.https ? "https" : "http"}://${site.host}/`,
    })),
}));

// The fallback title of a project with servers and no name.
const SERVERS_NAME = PROJECTS.find((project) => project.servers.length)?.name || "Servers";

/**
 * The projects' own servers: each started by its own command, and found by
 * what listens on its port. `pathPrefix` goes before PATH for its command only.
 * The config's command is a line, split here into the command and its args. A
 * `flutter run` has no terminal to press r or R in, so it takes signals for them.
 */
const EXTRA_SERVERS = PROJECTS.flatMap((project) => project.servers.map((server) => {
    const [ command = "", ...args ] = splitCommand(server.command || "");

    return {
        ...server,
        command,
        args,
        dir       : expandHome(server.dir),
        group     : project.name || SERVERS_NAME,
        hotReload : command === "flutter",
    };
}));

// Studio, started on demand. node resolves the link SwiftBar runs this through,
// so import.meta.dirname is the plugin's folder, inside Studio's.
const STUDIO = { dir : path.join(import.meta.dirname, ".."), port : 9900 };

// Flags that let the menu show "Starting…" while an action runs: the stack's
// holds its label, since it covers both start and stop all.
const STACK_FLAG    = "/tmp/dev-stack.busy";

// One per pid being shut down.
const STOPPING_FLAG = "/tmp/dev-stopping.";
const SELF = process.argv[1];

// The folder of the node running this comes first, wherever it was installed,
// and /usr/local/bin holds the npm globals linked there.
const PATH = `${path.dirname(process.execPath)}:${PATHS.homebrew}/bin:${
    PATHS.homebrew
}/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

const GREEN = "#4caf50";
const RED   = "#e57373";
const GREY  = "#888888";



// ----------------------------------------------------------------- helpers ---

/**
 * This machine's settings, from config/config.json or the file in
 * STUDIO_CONFIG. Without one the menu still works, with no projects.
 * @returns {Object<string, *>}
 */
function readConfig() {
    const file = process.env.STUDIO_CONFIG
        || path.join(import.meta.dirname, "..", "config", "config.json");

    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

/**
 * Runs a command and returns its trimmed output, or "" if it failed.
 * @param {string} command
 * @returns {string}
 */
function sh(command) {
    try {
        return execSync(command, {
            encoding : "utf8",
            env      : { ...process.env, PATH },
        }).trim();
    } catch {
        return "";
    }
}

/**
 * The installed version of a formula, from where its opt link points, which
 * is cheaper than running the binaries every 10s.
 * @param {string} formula
 * @returns {string}
 */
function versionOf(formula) {
    try {
        return path.basename(fs.realpathSync(path.join(PATHS.homebrew, "opt", formula)))
            .replace(/_\d+$/, "");
    } catch {
        return "";
    }
}



// The public API
export {
    APACHE_LOG,
    VHOSTS,
    GREEN,
    RED,
    PHP_INI,
    GREY,
    SERVERS_NAME,
    PROJECTS,
    SELF,
    PHPMYADMIN,
    EDITOR,
    sh,
    HTTPD,
    versionOf,
    STACK_FLAG,
    EXTRA_SERVERS,
    STOPPING_FLAG,
    BREW,
    HOME,
    STUDIO,
    BROWSER,
    PATH,
};
