"use strict";

const fs   = require("fs");
const path = require("path");

// The logs: their sizes, their last lines, and clearing them.

const { PATHS, MYSQL_DATA, tailOf, filesIn, formatBytes } = require("./system");



/**
 * The logs, by name. The access log is not shown on the page -- it only holds
 * requests -- but it grows the fastest, so its size is reported and it can be
 * cleared like the others.
 */
const LOGS = {
    apache  : PATHS.apacheLog,
    access  : PATHS.accessLog,
    mariadb : () => filesIn(MYSQL_DATA, "").find((file) => file.endsWith(".err")),
    redis   : PATHS.redisLog,
};

function logFile(name) {
    const source = LOGS[name];
    return typeof source === "function" ? source() : source;
}

/**
 * Each log's size, and that of the copies newsyslog keeps of it once rotated
 * (error_log.0.gz, error_log.1.gz, ...), which sit next to it.
 */
function readLogSizes() {
    const sizes = {};
    for (const name of Object.keys(LOGS)) {
        const file = logFile(name);
        if (!file || !fs.existsSync(file)) {
            sizes[name] = { file : file || "", size : 0, archived : 0 };
            continue;
        }
        const archived = filesIn(path.dirname(file), `${path.basename(file)}.`)
            .reduce((sum, copy) => sum + fs.statSync(copy).size, 0);
        sizes[name] = { file, size : fs.statSync(file).size, archived };
    }
    return sizes;
}

/** The last lines of a log, by name. */
function readLog(name, lines) {
    const file = logFile(name);
    if (!file || !fs.existsSync(file)) {
        return { name, file : file || "", lines : [] };
    }
    const count = Math.min(Math.max(lines, 10), 2000);
    return { name, file, lines : tailOf(file, count) };
}

/**
 * Empties a log where it is, and deletes its rotated copies. Truncating rather
 * than replacing the file matters: Apache, MariaDB and Redis keep it open and
 * write at its end, so they carry on into the emptied file without a restart.
 */
async function clearLog(name) {
    const file = LOGS[name] ? logFile(name) : null;
    if (!file || !fs.existsSync(file)) {
        throw new Error("Unknown log");
    }
    const freed  = readLogSizes()[name];
    fs.truncateSync(file, 0);
    for (const copy of filesIn(path.dirname(file), `${path.basename(file)}.`)) {
        fs.rmSync(copy, { force : true });
    }
    return { message : `Cleared ${path.basename(file)}, freeing ${formatBytes(freed.size + freed.archived)}.` };
}

module.exports = {
    readLogSizes,
    readLog,
    clearLog,
};
