// The small helpers the rest shares: running commands, waiting, reading files.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { sh, PATH } from "./config.js";



/**
 * True when at least one process matches the pgrep pattern.
 * @param {string} pattern
 * @returns {boolean}
 */
function isRunning(pattern) {
    return sh(`pgrep ${pattern}`) !== "";
}

/**
 * Polls a URL until it answers, or gives up. The wait is long because a start
 * right after a stop also waits out the port's TIME_WAIT.
 * @param {string} url
 * @param {number=} attempts
 * @param {number=} waitMs
 * @returns {boolean}
 */
function waitForUrl(url, attempts = 75, waitMs = 200) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (sh(`curl -s -o /dev/null -w "%{http_code}" -m 1 ${url}`) === "200") {
            return true;
        }
        sleep(waitMs);
    }

    return false;
}

/**
 * Asks SwiftBar to redraw now, instead of waiting for the next 10s tick.
 * @returns {void}
 */
function refreshMenu() {
    sh(`open -g "swiftbar://refreshplugin?name=swiftbar"`);
}

/**
 * Blocks the thread; the menu actions are synchronous by design.
 * @param {number} ms
 * @returns {void}
 */
function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Starts a long-lived process that outlives this script. Its output goes to the log given,
 * emptied first, or is dropped.
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {string=} pathPrefix
 * @param {string=} log
 * @returns {number} its pid
 */
function startDetached(command, args, cwd, pathPrefix = "", log = "") {
    const out   = log ? fs.openSync(log, "w") : "ignore";
    const child = spawn(command, args, {
        cwd,
        detached : true,
        stdio    : [ "ignore", out, out ],
        env      : { ...process.env, PATH : pathPrefix ? `${pathPrefix}:${PATH}` : PATH },
    });

    child.unref();
    if (typeof out === "number") {
        fs.closeSync(out);
    }
    return child.pid;
}

/**
 * The full paths of the folders in a folder, or none if it cannot be read.
 * @param {string} dir
 * @returns {string[]}
 */
function subDirsOf(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes : true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(dir, entry.name));
    } catch {
        return [];
    }
}

/**
 * The full paths of the files in a folder whose names start with the prefix.
 * @param {string} dir
 * @param {string} prefix
 * @returns {string[]}
 */
function filesIn(dir, prefix) {
    try {
        return fs.readdirSync(dir)
            .filter((f) => f.startsWith(prefix))
            .map((f) => path.join(dir, f));
    } catch {
        return [];
    }
}

/**
 * The label inside a flag file, or null when it is missing or stale, so an
 * action that died cannot leave the menu on "Starting…" forever.
 * @param {string} flagFile
 * @param {number} withinMs
 * @returns {string}
 */
function readFlag(flagFile, withinMs) {
    try {
        if (Date.now() - fs.statSync(flagFile).mtimeMs >= withinMs) {
            return null;
        }
        return fs.readFileSync(flagFile, "utf8").trim();
    } catch {
        return null;
    }
}

/**
 * A file's text, or "" if it cannot be read.
 * @param {string} file
 * @returns {string}
 */
function readFile(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
}

/**
 * The word with its first letter in upper case.
 * @param {string} word
 * @returns {string}
 */
function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
}



// The public API
export {
    readFile,
    readFlag,
    isRunning,
    waitForUrl,
    sleep,
    filesIn,
    refreshMenu,
    startDetached,
    subDirsOf,
    capitalize,
};
