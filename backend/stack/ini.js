"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// What PHP's settings accept, PHP itself asked for them and for its startup problems,
// and the ini files, read and written.

const { PATHS, versionOf, filesIn, readFile } = require("../core/system");


/**
 * The PHP settings the page shows on their own, each with what it accepts.
 * Any other setting can be added to the overrides file too, checked by PHP
 * itself as it is saved.
 */
const PHP_SETTINGS = {
    "memory_limit"        : { pattern : /^(-1|\d+[KMG]?)$/ },
    "upload_max_filesize" : { pattern : /^\d+[KMG]?$/ },
    "post_max_size"       : { pattern : /^\d+[KMG]?$/ },
    "max_execution_time"  : { pattern : /^\d+$/ },
    "max_input_time"      : { pattern : /^(-1|\d+)$/ },
    "display_errors"      : { options : [ "On", "Off" ] },
    "log_errors"          : { options : [ "On", "Off" ] },
    "error_reporting"     : {
        options : [ "E_ALL", "E_ALL & ~E_DEPRECATED", "E_ALL & ~E_NOTICE & ~E_DEPRECATED" ],
    },
    "date.timezone"       : { timezone : true },
    "xdebug.mode"         : {
        options : [ "off", "debug", "develop", "debug,develop", "coverage", "profile", "trace" ],
    },
};

/**
 * The settings that are switches, On or Off, which the page offers as a
 * select. PHP does not say what a setting takes, so they are the ones the
 * ini files write as On or Off, and these, which php.ini writes as 0 and 1,
 * leaves empty, or does not have.
 */
const SWITCHES = [
    "opcache.enable", "opcache.enable_cli", "opcache.validate_timestamps",
    "opcache.revalidate_path", "opcache.save_comments",
    "opcache.use_cwd", "opcache.validate_permission", "opcache.validate_root",
    "opcache.file_cache_only", "opcache.file_cache_consistency_checks",
    "opcache.enable_file_override", "opcache.protect_memory", "opcache.record_warnings",
    "opcache.huge_code_pages", "opcache.dups_fix",
    "session.auto_start", "session.use_cookies", "session.use_only_cookies",
    "session.use_strict_mode", "session.use_trans_sid",
    "session.cookie_secure", "session.cookie_httponly", "session.cookie_partitioned",
    "session.lazy_write",
    "xdebug.discover_client_host", "xdebug.show_error_trace", "xdebug.show_exception_trace",
    "xdebug.show_local_vars",
    "xdebug.collect_assignments", "xdebug.collect_return", "xdebug.dump_once",
    "xdebug.dump_undefined", "xdebug.force_display_errors",
    "xdebug.profiler_append", "xdebug.scream", "xdebug.use_compression",
    "pcre.jit", "report_memleaks", "soap.wsdl_cache_enabled", "sqlite3.defensive", "assert.active",
    "assert.exception", "assert.warning",
];

/**
 * What a setting is part of, for the page to group them: PHP itself, or the
 * extension that adds it, as PHP names them, a few made plainer.
 */
const OWNER_NAMES = {
    "Core"    : "Core", "standard" : "Core", "Zend OPcache" : "OPcache", "xdebug" : "Xdebug",
    "session" : "Session",
    "redis"   : "Redis", "imagick" : "Imagick", "date" : "Date", "pcre" : "PCRE",
    "openssl" : "OpenSSL", "curl" : "cURL",
    "gd"      : "GD", "soap" : "SOAP", "mysqli" : "MySQLi", "pgsql" : "PostgreSQL",
    "sqlite3" : "SQLite3",
};
function ownerOf(key, owners) {
    const owner = owners[key];
    return owner ? OWNER_NAMES[owner] || owner : "";
}

/** The switches: the list, and what the ini files write as On or Off. */
function readSwitches(mainIni) {
    const files = [
        mainIni,
        ...filesIn(path.dirname(phpIniFile()), "").filter((file) => file.endsWith(".ini")),
    ];
    const found = new Set(SWITCHES);
    for (const file of files) {
        for (const match of readFile(file)
            .matchAll(/^[ \t;]*([\w.]+)[ \t]*=[ \t]*(On|Off)[ \t]*$/gim)) {
            found.add(match[1]);
        }
    }
    return found;
}

const ERROR_LEVELS = JSON.stringify(PHP_SETTINGS.error_reporting.options);

/**
 * What PHP says about itself, as JSON on the last line: every setting, the
 * extensions loaded with their versions, and where its files are. Anything
 * before that line is PHP complaining as it started, about a setting it
 * could not take or an extension it could not load.
 */
const PHP_SCRIPT = `
    $values = ini_get_all(null, false);
    foreach (json_decode($argv[1], true) as $level) {
        if ((int)$values["error_reporting"] === eval("return $level;")) {
            $values["error_reporting"] = $level;
            break;
        }
    }
    $extensions = [];
    $owners     = [];
    foreach (get_loaded_extensions() as $name) {
        $extensions[$name] = (string)phpversion($name);
        foreach (array_keys(@ini_get_all(strtolower($name), false) ?: []) as $key) {
            $owners[$key] = $name;
        }
    }
    echo "\\n", json_encode([
        "version"    => PHP_VERSION,
        "values"     => $values,
        "extensions" => $extensions,
        "owners"     => $owners,
        "zend"       => get_loaded_extensions(true),
        "timezones"  => timezone_identifiers_list(),
        "extDir"     => ini_get("extension_dir"),
        "mainIni"    => (string)php_ini_loaded_file(),
    ]);
`;

/**
 * Runs PHP's script, optionally with other overrides than the file's: null
 * leaves the file out, as if there were none, and a text stands in for it.
 * PHP reads every .ini file of a folder it is given, so it gets a folder of
 * its own with copies of the others and this one.
 */
async function askPhp(overrides = undefined) {
    let dir = "";
    const env = {};
    if (overrides !== undefined) {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-php-"));
        const scanDir = path.dirname(phpIniFile());
        for (const file of filesIn(scanDir, "")
            .filter((one) => one.endsWith(".ini") && one !== phpIniFile())) {
            fs.copyFileSync(file, path.join(dir, path.basename(file)));
        }
        if (overrides !== null) {
            fs.writeFileSync(path.join(dir, path.basename(phpIniFile())), overrides);
        }
        env.PHP_INI_SCAN_DIR = dir;
    }
    const result = await runPhp([ "-r", PHP_SCRIPT, "--", ERROR_LEVELS ], env);
    if (dir) {
        fs.rmSync(dir, { recursive : true, force : true });
    }
    const lines = `${result.stderr}\n${result.stdout}`.split("\n");
    const json  = [ ...lines ].reverse().find((line) => line.startsWith("{")) || "{}";
    let data    = {};
    try {
        data = JSON.parse(json);
    } catch {
        // PHP did not start at all; the problems say why.
    }
    return { data, problems : startupProblems(lines.filter((line) => line !== json), dir) };
}

/** PHP, run by its Homebrew path, with some more of the environment. */
function runPhp(args, env = {}) {
    return new Promise((resolve) => {
        execFile(path.join(PATHS.homebrew, "bin", "php"), args, {
            encoding  : "utf8",
            timeout   : 15_000,
            maxBuffer : 32 * 1024 * 1024,
            env       : { ...process.env, ...env },
        }, (error, stdout, stderr) => resolve({
            ok     : !error,
            stdout : stdout || "",
            stderr : stderr || "",
        }));
    });
}

/**
 * PHP's complaints as it starts, each once: it says most of them twice, on
 * its error output as "PHP Warning:" and on its output as "Warning:". The
 * place, "in Unknown on line 0", says nothing, and a copy of the file in a
 * folder of Studio's is named as the overrides file.
 */
function startupProblems(lines, dir) {
    const seen = new Set();
    return lines
        .map((line) => line.trim().replace(/\s+/g, " ").replace(/^PHP:?\s+/, "")
            .replace(/^syntax error, (.*?), expecting .*? in /, "Syntax error, $1, in ")
            .replace(/\s+in Unknown on line \d+$/, ""))
        .map((line) => (dir ? line.split(path.join(dir, path.basename(phpIniFile())))
            .join(path.basename(phpIniFile())) : line))
        .filter((line) => line && !seen.has(line) && seen.add(line));
}


/**
 * What each setting would be without the overrides file, for the page to say
 * what removing an override goes back to. It changes only when php.ini does,
 * so it is kept until then.
 */
let baseCache = { key : "", values : {} };
async function readBase(mainIni) {
    const key = `${mainIni}:${fileTime(mainIni)}`;
    if (baseCache.key !== key) {
        const { data } = await askPhp(null);
        baseCache = { key, values : data.values || {} };
    }
    return baseCache.values;
}

/** Forgets what the settings were without the overrides, as php.ini has just changed. */
function forgetBase() {
    baseCache.key = "";
}


// ----------------------------------------------------------------- helpers ---

/**
 * Brew keeps a config folder per minor version (etc/php/8.5), so this follows
 * whichever one is linked, as the SwiftBar plugin does.
 */
function phpIniFile() {
    const minor = versionOf("php").split(".").slice(0, 2).join(".");
    return PATHS.phpIni.replace("{php}", minor);
}

/** A setting's line in an ini file. */
function settingLine(key) {
    return new RegExp(`^[ \\t]*${key.replace(/\./g, "\\.")}[ \\t]*=.*$`, "m");
}

/**
 * A value as an ini file needs it: quoted when it holds what the file would
 * read otherwise, as a ; that starts a comment.
 */
function iniValue(value) {
    return /[;#=]|^\s|\s$/.test(value) && !value.includes("\"") ? `"${value}"` : value;
}

/**
 * What PHP reports for a setting as the page shows it: its 1 and "" turned
 * back into On and Off for a setting that takes those.
 */
function displayValue(key, value, switches = new Set()) {
    if (switches.has(key) || PHP_SETTINGS[key]?.options?.includes("On")) {
        return /^(1|on|yes|true)$/i.test(String(value ?? "")) ? "On" : "Off";
    }
    return value === null || value === undefined ? "" : String(value);
}

/** The key = value lines of an ini text, its last line winning, as for PHP. */
function iniKeys(text) {
    const values = {};
    for (const line of text.split("\n")) {
        const found = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
        if (found && !/^(zend_)?extension$/.test(found[1])) {
            values[found[1]] = found[2].replace(/^"(.*)"$/, "$1");
        }
    }
    return values;
}

function readIniFile() {
    return iniKeys(readFile(phpIniFile()));
}

function fileTime(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return 0;
    }
}

function fileSize(file) {
    try {
        return fs.statSync(file).size;
    } catch {
        return 0;
    }
}


module.exports = {
    PHP_SETTINGS,
    ownerOf,
    readSwitches,
    askPhp,
    readBase,
    forgetBase,
    phpIniFile,
    settingLine,
    iniValue,
    displayValue,
    iniKeys,
    readIniFile,
    fileTime,
    fileSize,
};
