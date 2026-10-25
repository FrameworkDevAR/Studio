"use strict";

// The small helpers the rest shares: running commands, waiting, reading files.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const { sh, PATH } = require("./config");


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
 * Starts a long-lived process that outlives this script. Output is dropped.
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {string=} pathPrefix
 * @returns {void}
 */
function startDetached(command, args, cwd, pathPrefix = "") {
    spawn(command, args, {
        cwd,
        detached : true,
        stdio    : "ignore",
        env      : { ...process.env, PATH : pathPrefix ? `${pathPrefix}:${PATH}` : PATH },
    }).unref();
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
module.exports = {
    readFile,
    isRunning,
    waitForUrl,
    sleep,
    filesIn,
    refreshMenu,
    startDetached,
    subDirsOf,
    capitalize,
};
