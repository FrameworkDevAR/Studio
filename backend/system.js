"use strict";

// The stack's paths and the helpers every part of the server uses.

const { execFile } = require("child_process");
const fs   = require("fs");
const os   = require("os");
const path = require("path");

const { pathsOf, toolsOf } = require("./paths");


// Studio's folder, which holds backend/ and everything around it.
const ROOT = path.join(__dirname, "..");
const HOME = os.homedir();

// This machine's settings, which the plugin reads: the same file it looks for.
const CONFIG = process.env.STUDIO_CONFIG || path.join(ROOT, "config", "config.json");

// The paths of the stack: the config's, or Homebrew's own. Read once, so a
// change to them applies when Studio restarts.
const PATHS      = pathsOf(readJson(CONFIG));
// The editor for the config files and where phpMyAdmin answers, read the same way.
const TOOLS      = toolsOf(readJson(CONFIG));
const BREW       = PATHS.brew;
const HTTPD      = PATHS.httpd;
const APACHE_CTL = PATHS.apachectl;
const HTTPD_CONF = PATHS.httpdConf;
const VHOSTS     = PATHS.vhosts;
const PHPMYADMIN = TOOLS.phpMyAdmin;
const MYSQL_DATA = PATHS.mysqlData;
const DISK       = "/System/Volumes/Data";

// The SwiftBar plugin, asked for the apps so both list the same ones. It lives
// in Studio's folder, and SwiftBar's folder holds a link to it.
const SWIFTBAR = path.join(ROOT, "swiftbar.10s.js");

// The same PATH as the SwiftBar plugin, which starts this: the folder of the
// node running it first, wherever it was installed.
const PATH = `${path.dirname(process.execPath)}:${PATHS.homebrew}/bin:${PATHS.homebrew}/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;


// ----------------------------------------------------------------- helpers ---

/** Runs a command without a shell. Never throws: ok says how it went. */
function run(command, args = [], timeout = 15_000) {
    return new Promise((resolve) => {
        execFile(command, args, {
            encoding  : "utf8",
            timeout,
            maxBuffer : 32 * 1024 * 1024,
            env       : { ...process.env, PATH },
        }, (error, stdout, stderr) => {
            resolve({ ok : !error, stdout : stdout || "", stderr : stderr || (error ? error.message : "") });
        });
    });
}

/** The installed version of a formula, read off where its opt link points. */
function versionOf(formula) {
    try {
        return path.basename(fs.realpathSync(path.join(PATHS.homebrew, "opt", formula))).replace(/_\d+$/, "");
    } catch {
        return "";
    }
}

/** The last lines of a file, reading only its end, since logs grow large. */
function tailOf(file, count) {
    const size   = fs.statSync(file).size;
    const length = Math.min(size, count * 400);
    const buffer = Buffer.alloc(length);
    const fd     = fs.openSync(file, "r");
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);
    return buffer.toString("utf8").split("\n").filter(Boolean).slice(-count);
}

function filesIn(dir, prefix) {
    try {
        return fs.readdirSync(dir).filter((file) => file.startsWith(prefix)).map((file) => path.join(dir, file));
    } catch {
        return [];
    }
}

/** A JSON file's contents, or {} when it is missing or broken. */
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

function readFile(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
}

function formatBytes(value) {
    const units = [ "B", "KB", "MB", "GB" ];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

module.exports = {
    ROOT,
    HOME,
    CONFIG,
    PATHS,
    TOOLS,
    BREW,
    HTTPD,
    APACHE_CTL,
    HTTPD_CONF,
    VHOSTS,
    PHPMYADMIN,
    MYSQL_DATA,
    DISK,
    SWIFTBAR,
    run,
    versionOf,
    tailOf,
    filesIn,
    readJson,
    readFile,
    formatBytes,
};
