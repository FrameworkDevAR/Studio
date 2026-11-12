// What each start of an app or a server left behind: a flag while it starts, the output it
// wrote, and why it stopped when it did not come up, so the menu can say so.

import fs from "node:fs";
import path from "node:path";

import { HOME } from "./config.js";
import { readFile, readFlag } from "./helpers.js";



// The output of each app's and server's last start, kept until the next.
const LOGS = "/tmp/studio-starts";

// How long a start may take to listen, as a flutter run builds first, before the menu stops
// showing it as starting.
const STARTING_MS = 90_000;

// A failure is shown until the next start, or dismissed, or this old.
const FAILED_MS = 3_600_000;



/**
 * Where a start of an app or server is: starting, or failed, with why.
 * @typedef {{ starting: boolean, failed: string | null }} Start
 */



// ------------------------------------------------------------------- flags ---

/**
 * Where a start of an app or a server is. An app is given by its folder, a server by its id.
 * @param {string} target
 * @returns {Start}
 */
function readStart(target) {
    return {
        starting : readFlag(startingFlagOf(target), STARTING_MS) !== null,
        failed   : readFlag(failedFlagOf(target), FAILED_MS),
    };
}

/**
 * Marks a start as begun, with the pid of what it started, and clears the last failure.
 * @param {string} target
 * @param {number} pid
 * @returns {void}
 */
function markStarting(target, pid) {
    fs.rmSync(failedFlagOf(target), { force : true });
    fs.writeFileSync(startingFlagOf(target), String(pid));
}

/**
 * The pid a start began, or 0 when it is no longer starting.
 * @param {string} target
 * @returns {number}
 */
function startedPid(target) {
    return Number(readFlag(startingFlagOf(target), STARTING_MS)) || 0;
}

/**
 * Ends a start: it came up, or gave up, or, with a reason, failed.
 * @param {string} target
 * @param {string=} reason
 * @returns {void}
 */
function endStart(target, reason = "") {
    fs.rmSync(startingFlagOf(target), { force : true });
    if (reason) {
        fs.writeFileSync(failedFlagOf(target), reason);
    }
}

/**
 * Forgets a start's failure, once it has been seen.
 * @param {string} target
 * @returns {void}
 */
function dismiss(target) {
    fs.rmSync(failedFlagOf(target), { force : true });
}



// -------------------------------------------------------------------- logs ---

/**
 * The file a start's output goes to, its folder made if missing.
 * @param {string} target
 * @returns {string}
 */
function logOf(target) {
    fs.mkdirSync(LOGS, { recursive : true });
    return path.join(LOGS, `${keyOf(target)}.log`);
}

/**
 * Why a start stopped, from its output: the first line naming an error, as Vite's "Error:
 * Port 3050 is already in use", or else the last it wrote.
 * @param {string} target
 * @returns {string}
 */
function reasonOf(target) {
    const lines = readFile(logOf(target))
        // The colors and cursor moves of a terminal, which the menu would print as they are.
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const error = lines.find((line) => /\b(error|cannot|failed|not found)\b/i.test(line));

    return (error || lines.at(-1) || "It stopped before it listened").slice(0, 200);
}



// ----------------------------------------------------------------- helpers ---

/**
 * The flag of a start in progress. A server's keeps its id, as before.
 * @param {string} target
 * @returns {string}
 */
function startingFlagOf(target) {
    return `/tmp/dev-${keyOf(target)}.starting`;
}

/**
 * The flag of a start that failed, holding why.
 * @param {string} target
 * @returns {string}
 */
function failedFlagOf(target) {
    return `/tmp/dev-${keyOf(target)}.failed`;
}

/**
 * A name for a target's files: a server's id, or an app's folder under the home, as
 * app-Projects-Shop-desktop.
 * @param {string} target
 * @returns {string}
 */
function keyOf(target) {
    if (!target.includes("/")) {
        return target;
    }

    const inHome = target.startsWith(`${HOME}/`) ? target.slice(HOME.length + 1) : target;
    return `app-${inHome.replace(/[^\w.-]+/g, "-")}`;
}



// The public API
export {
    readStart,
    markStarting,
    startedPid,
    endStart,
    dismiss,
    logOf,
    reasonOf,
};
