"use strict";

// The small helpers the rest shares: running commands, waiting, reading files.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const { sh, PATH } = require("./config");


/** True when at least one process matches the pgrep pattern. */
function isRunning(pattern) {
    return sh(`pgrep ${pattern}`) !== "";
}

/**
 * Polls a URL until it answers, or gives up. The wait is long because a start
 * right after a stop also waits out the port's TIME_WAIT.
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

/** Asks SwiftBar to redraw now, instead of waiting for the next 10s tick. */
function refreshMenu() {
    sh(`open -g "swiftbar://refreshplugin?name=swiftbar"`);
}

/** Blocks the thread; the menu actions are synchronous by design. */
function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Starts a long-lived process that outlives this script. Output is dropped. */
function startDetached(command, args, cwd, pathPrefix = "") {
    spawn(command, args, {
        cwd,
        detached : true,
        stdio    : "ignore",
        env      : { ...process.env, PATH : pathPrefix ? `${pathPrefix}:${PATH}` : PATH },
    }).unref();
}

function subDirsOf(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes : true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(dir, entry.name));
    } catch {
        return [];
    }
}

function filesIn(dir, prefix) {
    try {
        return fs.readdirSync(dir)
            .filter((f) => f.startsWith(prefix))
            .map((f) => path.join(dir, f));
    } catch {
        return [];
    }
}

function readFile(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
}

function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
}


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
