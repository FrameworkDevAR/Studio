"use strict";

const fs   = require("fs");
const path = require("path");

// The PHP version, settings and extensions, and changing a setting.

const { PATHS, run, versionOf, filesIn, readFile } = require("./system");
const { reloadApache }                             = require("./apache");



/**
 * The PHP settings the page can change, each with what it accepts. They are
 * written to the local conf.d file, which loads last and so wins over php.ini.
 */
const PHP_SETTINGS = {
    "memory_limit"        : { pattern : /^(-1|\d+[KMG]?)$/ },
    "upload_max_filesize" : { pattern : /^\d+[KMG]?$/ },
    "post_max_size"       : { pattern : /^\d+[KMG]?$/ },
    "max_execution_time"  : { pattern : /^\d+$/ },
    "max_input_time"      : { pattern : /^(-1|\d+)$/ },
    "display_errors"      : { options : [ "On", "Off" ] },
    "log_errors"          : { options : [ "On", "Off" ] },
    "error_reporting"     : { options : [ "E_ALL", "E_ALL & ~E_DEPRECATED", "E_ALL & ~E_NOTICE & ~E_DEPRECATED" ] },
    "date.timezone"       : { timezone : true },
    "xdebug.mode"         : { options : [ "off", "debug", "develop", "debug,develop", "coverage", "profile", "trace" ] },
};

/**
 * The PHP version, settings and extensions. The settings are read from the
 * conf.d file when set there, since the CLI overrides some of them (it always
 * reports max_execution_time as 0), and from PHP itself when not.
 */
async function readPhp() {
    const script = `
        $keys = json_decode($argv[1], true);
        $levels = json_decode($argv[2], true);
        $values = [];
        foreach ($keys as $key) {
            $values[$key] = ini_get($key);
        }
        foreach ($levels as $level) {
            if ((int)$values["error_reporting"] === eval("return $level;")) {
                $values["error_reporting"] = $level;
                break;
            }
        }
        echo json_encode([
            "version"    => PHP_VERSION,
            "values"     => $values,
            "extensions" => get_loaded_extensions(),
            "timezones"  => timezone_identifiers_list(),
            "extDir"     => ini_get("extension_dir"),
        ]);
    `;
    const result = await run("php", [ "-r", script, "--", JSON.stringify(Object.keys(PHP_SETTINGS)), JSON.stringify(PHP_SETTINGS.error_reporting.options) ]);
    const php    = JSON.parse(result.stdout || "{}");
    const file   = readIniFile();

    // The extensions built with pecl, which PHP's next minor version cannot
    // load -- each has to be built again after that upgrade.
    const pecl = filesIn(php.extDir || "", "")
        .filter((so) => so.endsWith(".so"))
        .map((so) => path.basename(so, ".so"));

    return {
        version    : php.version,
        iniFile    : phpIniFile(),
        timezones  : php.timezones || [],
        extensions : (php.extensions || []).sort((a, b) => a.localeCompare(b)),
        pecl,
        settings   : Object.entries(PHP_SETTINGS).map(([ key, rule ]) => ({
            key,
            value     : key in file ? file[key] : effectiveValue(rule, php.values?.[key]),
            inFile    : key in file,
            options   : rule.options || null,
            timezone  : Boolean(rule.timezone),
        })),
    };
}

/**
 * Writes one PHP setting to the conf.d file, replacing its line or adding one,
 * then reloads Apache so the sites pick it up. The CLI reads it on its next run.
 */
async function setPhpSetting(key, value) {
    const rule = PHP_SETTINGS[key];
    if (!rule) {
        throw new Error(`${key} cannot be changed here`);
    }
    if (rule.pattern && !rule.pattern.test(value)) {
        throw new Error(`${value} is not a valid ${key}`);
    }
    if (rule.options && !rule.options.includes(value)) {
        throw new Error(`${value} is not one of the ${key} options`);
    }
    if (rule.timezone) {
        const check = await run("php", [ "-r", "exit(in_array($argv[1], timezone_identifiers_list()) ? 0 : 1);", "--", value ]);
        if (!check.ok) {
            throw new Error(`${value} is not a timezone PHP knows`);
        }
    }

    const file    = phpIniFile();
    const content = readFile(file);
    const line    = `${key} = ${value}`;
    const pattern = new RegExp(`^\\s*${key.replace(".", "\\.")}\\s*=.*$`, "m");
    const updated = pattern.test(content)
        ? content.replace(pattern, line)
        : `${content.replace(/\n*$/, "\n")}${line}\n`;

    fs.copyFileSync(file, `${file}.bak`);
    fs.writeFileSync(file, updated);

    const reload = await reloadApache();
    return { message : `${key} set to ${value}. ${reload.message}` };
}

/**
 * Brew keeps a config folder per minor version (etc/php/8.5), so this follows
 * whichever one is linked, as the SwiftBar plugin does.
 */
function phpIniFile() {
    const minor = versionOf("php").split(".").slice(0, 2).join(".");
    return PATHS.phpIni.replace("{php}", minor);
}

/** What PHP reports for a setting, with its 1 and "" turned back into On and Off. */
function effectiveValue(rule, value) {
    if (rule.options?.includes("On")) {
        return [ "1", "On", "on" ].includes(String(value)) ? "On" : "Off";
    }
    return String(value ?? "");
}

/** The key = value lines of the conf.d file. */
function readIniFile() {
    const values = {};
    for (const line of readFile(phpIniFile()).split("\n")) {
        const found = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
        if (found) {
            values[found[1]] = found[2].replace(/^"(.*)"$/, "$1");
        }
    }
    return values;
}

module.exports = {
    readPhp,
    setPhpSetting,
    phpIniFile,
};
