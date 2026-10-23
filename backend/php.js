"use strict";

const { execFile } = require("child_process");
const fs   = require("fs");
const os   = require("os");
const path = require("path");

// The PHP version, its settings and the overrides file, and the extensions
// added with pecl.

const { PATHS, run, versionOf, filesIn, readFile } = require("./system");
const { reloadApache }                             = require("./apache");
const { runJob, spawnLines }                       = require("./jobs");



const PECL = path.join(PATHS.homebrew, "bin", "pecl");

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
    "error_reporting"     : { options : [ "E_ALL", "E_ALL & ~E_DEPRECATED", "E_ALL & ~E_NOTICE & ~E_DEPRECATED" ] },
    "date.timezone"       : { timezone : true },
    "xdebug.mode"         : { options : [ "off", "debug", "develop", "debug,develop", "coverage", "profile", "trace" ] },
};

/**
 * The settings that are switches, On or Off, which the page offers as a
 * select. PHP does not say what a setting takes, so they are the ones the
 * ini files write as On or Off, and these, which php.ini writes as 0 and 1,
 * leaves empty, or does not have.
 */
const SWITCHES = [
    "opcache.enable", "opcache.enable_cli", "opcache.validate_timestamps", "opcache.revalidate_path", "opcache.save_comments",
    "opcache.use_cwd", "opcache.validate_permission", "opcache.validate_root", "opcache.file_cache_only", "opcache.file_cache_consistency_checks",
    "opcache.enable_file_override", "opcache.protect_memory", "opcache.record_warnings", "opcache.huge_code_pages", "opcache.dups_fix",
    "session.auto_start", "session.use_cookies", "session.use_only_cookies", "session.use_strict_mode", "session.use_trans_sid",
    "session.cookie_secure", "session.cookie_httponly", "session.cookie_partitioned", "session.lazy_write",
    "xdebug.discover_client_host", "xdebug.show_error_trace", "xdebug.show_exception_trace", "xdebug.show_local_vars",
    "xdebug.collect_assignments", "xdebug.collect_return", "xdebug.dump_once", "xdebug.dump_undefined", "xdebug.force_display_errors",
    "xdebug.profiler_append", "xdebug.scream", "xdebug.use_compression",
    "pcre.jit", "report_memleaks", "soap.wsdl_cache_enabled", "sqlite3.defensive", "assert.active", "assert.exception", "assert.warning",
];

/**
 * What a setting is part of, for the page to group them: PHP itself, or the
 * extension that adds it, as PHP names them, a few made plainer.
 */
const OWNER_NAMES = {
    "Core"    : "Core", "standard" : "Core", "Zend OPcache" : "OPcache", "xdebug" : "Xdebug", "session" : "Session",
    "redis"   : "Redis", "imagick" : "Imagick", "date" : "Date", "pcre" : "PCRE", "openssl" : "OpenSSL", "curl" : "cURL",
    "gd"      : "GD", "soap" : "SOAP", "mysqli" : "MySQLi", "pgsql" : "PostgreSQL", "sqlite3" : "SQLite3",
};
function ownerOf(key, owners) {
    const owner = owners[key];
    return owner ? OWNER_NAMES[owner] || owner : "";
}

/** The switches: the list, and what the ini files write as On or Off. */
function readSwitches(mainIni) {
    const files = [ mainIni, ...filesIn(path.dirname(phpIniFile()), "").filter((file) => file.endsWith(".ini")) ];
    const found = new Set(SWITCHES);
    for (const file of files) {
        for (const match of readFile(file).matchAll(/^[ \t;]*([\w.]+)[ \t]*=[ \t]*(On|Off)[ \t]*$/gim)) {
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
        for (const file of filesIn(scanDir, "").filter((one) => one.endsWith(".ini") && one !== phpIniFile())) {
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
        }, (error, stdout, stderr) => resolve({ ok : !error, stdout : stdout || "", stderr : stderr || "" }));
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
        .map((line) => line.trim().replace(/\s+/g, " ").replace(/^PHP:?\s+/, "").replace(/^syntax error, (.*?), expecting .*? in /, "Syntax error, $1, in ").replace(/\s+in Unknown on line \d+$/, ""))
        .map((line) => (dir ? line.split(path.join(dir, path.basename(phpIniFile()))).join(path.basename(phpIniFile())) : line))
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

/**
 * The PHP version, its settings and extensions. A setting in the overrides
 * file shows the file's value, since the CLI changes some of them (it always
 * reports max_execution_time as 0); one that is not shows PHP's, and says
 * whether that comes from php.ini or is PHP's own default.
 */
async function readPhp() {
    const { data : php, problems } = await askPhp();
    const values    = php.values || {};
    const overrides = readIniFile();
    const mainIni   = php.mainIni || "";
    const inMainIni = iniKeys(readFile(mainIni));
    const base      = await readBase(mainIni);
    const switches  = readSwitches(mainIni);
    const origin    = (key) => ({
        base     : displayValue(key, inMainIni[key] ?? base[key], switches),
        baseFrom : key in inMainIni ? "php.ini" : "default",
    });

    const pecl = await readPecl();
    checkUpgrades();

    // The extensions that are not part of PHP: their files in its extension
    // folder, put there by pecl, or by hand.
    const added = new Set(filesIn(php.extDir || "", "")
        .filter((file) => file.endsWith(".so"))
        .map((file) => path.basename(file, ".so").toLowerCase()));
    const loaded = Object.entries(php.extensions || {}).map(([ name, version ]) => {
        const id = name.toLowerCase();
        return {
            name,
            version : added.has(id) ? version : "",
            added   : added.has(id),
            pecl    : id in pecl,
            latest  : added.has(id) ? upgrades.packages[id] || "" : "",
            size    : added.has(id) ? fileSize(path.join(php.extDir, `${id}.so`)) : 0,
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // The extensions php.ini or pecl have, which PHP did not load: after an
    // upgrade to a new minor version, which needs them built again.
    const names   = new Set(loaded.map((ext) => ext.name.toLowerCase()));
    const wanted  = [ ...new Set([ ...extensionLines(mainIni).map((line) => line.name), ...Object.keys(pecl) ]) ];
    const missing = wanted.filter((name) => !names.has(name)).map((name) => ({ name, pecl : name in pecl }));

    return {
        version    : php.version || versionOf("php"),
        iniFile    : phpIniFile(),
        mainIni,
        timezones  : php.timezones || [],
        extensions : loaded,
        missing,
        problems,
        checked    : upgrades.at,
        settings   : Object.entries(PHP_SETTINGS).map(([ key, rule ]) => ({
            key,
            value    : key in overrides ? overrides[key] : displayValue(key, values[key]),
            inFile   : key in overrides,
            options  : rule.options || null,
            timezone : Boolean(rule.timezone),
            ...origin(key),
        })),
        // The file's other lines, which the page lists apart.
        overrides : Object.entries(overrides).filter(([ key ]) => !(key in PHP_SETTINGS)).map(([ key, value ]) => ({
            key,
            value   : displayValue(key, value, switches),
            known   : key in values,
            owner   : ownerOf(key, php.owners || {}),
            options : switches.has(key) ? [ "On", "Off" ] : null,
            ...origin(key),
        })),
    };
}
/**
 * Every setting PHP knows, with its value now, the choices it takes when
 * known, and whether the overrides file has it, for the dialog that adds one.
 */
async function readDirectives() {
    const { data } = await askPhp();
    const overrides = readIniFile();
    const switches  = readSwitches(data.mainIni || "");
    return Object.entries(data.values || {}).map(([ key, value ]) => ({
        key,
        value    : displayValue(key, key in overrides ? overrides[key] : value, switches),
        inFile   : key in overrides,
        owner    : ownerOf(key, data.owners || {}),
        options  : PHP_SETTINGS[key]?.options || (switches.has(key) ? [ "On", "Off" ] : null),
        timezone : Boolean(PHP_SETTINGS[key]?.timezone),
    }));
}

/**
 * Writes some settings to the overrides file, replacing their lines or adding
 * them, then reloads Apache once so the sites pick them up. The CLI reads them
 * on its next run. A setting of the page's own is checked against what it
 * accepts; any is checked by PHP, which has to start with them all without a
 * complaint, or none is written.
 */
async function setPhpSettings(changes) {
    const list = [].concat(changes || []).map((change) => ({
        key    : String(change?.key || ""),
        value  : String(change?.value ?? "").trim(),
        remove : Boolean(change?.remove),
    }));
    if (!list.length) {
        throw new Error("Nothing to save");
    }
    const known = (await askPhp()).data.values || {};
    let content = readFile(phpIniFile());
    for (const { key, value, remove } of list) {
        // An override taken out, so php.ini's value is back.
        if (remove) {
            if (!/^[a-z_][\w.]*$/i.test(key) || !settingLine(key).test(content)) {
                throw new Error(`${key} is not in the overrides file`);
            }
            content = content.replace(new RegExp(`${settingLine(key).source}\\n?`, "gm"), "");
            continue;
        }
        checkSetting(key, value, known);
        const line    = `${key} = ${iniValue(value)}`;
        const pattern = settingLine(key);
        content = pattern.test(content)
            ? content.replace(pattern, line)
            : `${content.replace(/\n*$/, "\n")}${line}\n`.replace(/^\n/, "");
    }

    const reload = await writeOverrides(content);
    const said   = list.length > 1 ? `${list.length} changes saved`
        : list[0].remove ? `${list[0].key} override removed` : `${list[0].key} set to ${list[0].value}`;
    return { message : `${said}. ${reload.message}` };
}

function setPhpSetting(key, value) {
    return setPhpSettings([ { key, value } ]);
}

/** Refuses a setting the page knows not to take that value, or that PHP does not have. */
function checkSetting(key, value, known) {
    const rule = PHP_SETTINGS[key];
    if (!/^[a-z_][\w.]*$/i.test(key)) {
        throw new Error(`${key} is not a setting name`);
    }
    if (/[\r\n]/.test(value) || value.length > 1000) {
        throw new Error(`The value of ${key} has to fit on one line`);
    }
    if (rule?.pattern && !rule.pattern.test(value)) {
        throw new Error(`${value} is not a valid ${key}`);
    }
    if (rule?.options && !rule.options.includes(value)) {
        throw new Error(`${value} is not one of the ${key} options`);
    }
    if (!rule && !(key in known)) {
        throw new Error(`PHP has no setting ${key}`);
    }
}

/** The overrides file, for the page's editor. */
function readOverrides() {
    const file = phpIniFile();
    return { file, exists : fs.existsSync(file), text : readFile(file) };
}

async function saveOverrides(text) {
    if (typeof text !== "string") {
        throw new Error("No text to save");
    }
    const reload = await writeOverrides(text.replace(/\r\n/g, "\n"));
    return { message : `Saved ${path.basename(phpIniFile())}. ${reload.message}` };
}

/**
 * What PHP would complain about with this text as the overrides file, apart
 * from what it complains about already, which this text did not cause.
 */
async function checkOverrides(text) {
    const [ now, next ] = await Promise.all([ askPhp(), askPhp(String(text ?? "")) ]);
    return { problems : next.problems.filter((problem) => !now.problems.includes(problem)) };
}

/**
 * Writes the overrides file once PHP starts with it without anything new to
 * complain about, keeping the one before as .bak, then reloads Apache.
 */
async function writeOverrides(text) {
    const { problems } = await checkOverrides(text);
    if (problems.length) {
        throw new Error(`PHP does not take it: ${problems[0]}`);
    }
    const file = phpIniFile();
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, `${file}.bak`);
    } else {
        fs.mkdirSync(path.dirname(file), { recursive : true });
    }
    fs.writeFileSync(file, text);
    return reloadApache();
}


// -------------------------------------------------------------- extensions ---

/**
 * The extensions pecl installed, by name, with their versions. Asking pecl
 * takes a moment, so the answer is kept for a minute, or until pecl changes
 * something.
 */
let peclCache = { at : 0, packages : {} };
async function readPecl() {
    if (Date.now() - peclCache.at < 60_000) {
        return peclCache.packages;
    }
    const result   = fs.existsSync(PECL) ? await run(PECL, [ "list", "-c", "pecl" ], 20_000) : { stdout : "" };
    const packages = {};
    for (const line of result.stdout.split("\n")) {
        const found = line.match(/^(\S+)\s+(\d\S*)\s+(stable|beta|alpha|devel|snapshot)\s*$/);
        if (found) {
            packages[found[1].toLowerCase()] = found[2];
        }
    }
    peclCache = { at : Date.now(), packages };
    return packages;
}

/**
 * The newest version of each pecl extension that has a newer one. pecl asks
 * its site, which needs the network, so it runs in the background at most
 * once an hour and the page shows the last answer.
 */
let upgrades = { at : 0, busy : false, round : 0, packages : {} };
function checkUpgrades() {
    if (!fs.existsSync(PECL) || upgrades.busy || Date.now() - upgrades.at < 60 * 60_000) {
        return;
    }
    upgrades.busy = true;
    const round   = upgrades.round;
    run(PECL, [ "list-upgrades", "-c", "pecl" ], 60_000).then((result) => {
        if (round === upgrades.round && !/Could not|failed/i.test(result.stdout)) {
            // A line for each: the name, the version here, the newest.
            upgrades.packages = {};
            for (const line of result.stdout.split("\n")) {
                const found = line.match(/^\s*(\S+)\s+(\d\S*)\s+\(\w+\)\s+(\d\S*)\s+\(\w+\)/);
                if (found) {
                    upgrades.packages[found[1].toLowerCase()] = found[3];
                }
            }
            upgrades.at = Date.now();
        }
        upgrades.busy = false;
    });
}

/**
 * The extension name pecl knows, as redis or xdebug-3.4.0. Anything else --
 * a path, a channel, a flag -- is refused.
 */
const EXTENSION_SPEC = /^[a-z][\w]*(-\d[\w.]*)?$/i;

function installExtension(spec) {
    const wanted = String(spec || "").trim();
    if (!EXTENSION_SPEC.test(wanted)) {
        throw new Error("Not an extension name");
    }
    return runPecl([ { name : wanted.replace(/-\d.*/, ""), args : [ "install", wanted ] } ], (worked) => `${worked[0]} installed`);
}

/** Builds the newest version of some installed pecl extensions. */
async function updateExtensions(names) {
    const pecl   = await readPecl();
    const chosen = [].concat(names).map((name) => String(name).toLowerCase());
    if (!chosen.length || chosen.some((name) => !(name in pecl))) {
        throw new Error("Nothing to update");
    }
    return runPecl(chosen.map((name) => ({ name, args : [ "upgrade", name ] })), (worked) => {
        worked.forEach((name) => delete upgrades.packages[name]);
        return worked.length === 1 ? `${worked[0]} updated` : `${worked.length} extensions updated`;
    });
}

/**
 * Builds an extension again, for the PHP installed now: after a new minor
 * version, the one built for the last cannot load.
 */
function reinstallExtension(name) {
    const wanted = String(name || "").toLowerCase();
    if (!EXTENSION_SPEC.test(wanted)) {
        throw new Error("Not an extension name");
    }
    return runPecl([ { name : wanted, args : [ "install", "-f", wanted ] } ], (worked) => `${worked[0]} built again`);
}

/** Removes a pecl extension, and its line in php.ini with it. */
async function uninstallExtension(name) {
    const pecl   = await readPecl();
    const wanted = String(name || "").toLowerCase();
    if (!(wanted in pecl)) {
        throw new Error("Only an extension pecl installed can be removed");
    }
    return runPecl([ { name : wanted, args : [ "uninstall", wanted ] } ], (worked) => {
        delete upgrades.packages[wanted];
        return `${worked[0]} removed`;
    });
}

/**
 * Runs pecl as a job the page follows, an extension a step. It builds each
 * from its source, which can take a minute. pecl asks questions as it goes,
 * about options to build with, so each is answered with its default. Once
 * done, php.ini loads what is installed and nothing that is not, and Apache
 * reloads to pick it up.
 */
function runPecl(steps, done) {
    return runJob("pecl", steps, {
        runStep : async (step) => {
            const lines = [];
            const code  = await spawnLines(PECL, step.args, {
                // phpize, autoconf and pkg-config, which a build needs, are Homebrew's.
                env     : { ...process.env, PATH : `${PATHS.homebrew}/bin:${PATHS.homebrew}/sbin:${process.env.PATH}` },
                input   : "\n".repeat(50),
                timeout : 15 * 60_000,
                onLine  : (line) => lines.push(line),
            });
            const ok = lines.some((line) => /^(install|upgrade|uninstall) ok:/.test(line))
                || (step.args[0] === "upgrade" && lines.some((line) => /is already installed and is (the same as|newer than)/.test(line)));
            if (code === 0 && ok) {
                return "";
            }
            return peclError(lines);
        },
        after : async (worked) => {
            peclCache.at = 0;
            upgrades.at  = 0;
            upgrades.round++;
            if (worked.length) {
                await syncExtensionLines();
                await reloadApache();
            }
        },
        done,
    });
}

/** What went wrong in a pecl run, from its last error lines. */
function peclError(lines) {
    const errors = lines.filter((line) => /error|not found|failed|No releases|does not exist|requires/i.test(line) && !/^checking /.test(line));
    return errors.slice(-2).join(" ").replace(/\s+/g, " ").slice(0, 400) || "pecl failed";
}

/**
 * Makes php.ini load each extension pecl installed, and none it removed:
 * pecl writes these lines itself, but not always. A Zend extension, as
 * xdebug, is loaded with zend_extension, which pecl does not always know.
 */
async function syncExtensionLines() {
    const { mainIni, extDir = "" } = (await askPhp()).data;
    if (!mainIni || !fs.existsSync(mainIni)) {
        return;
    }
    const pecl    = await readPecl();
    const lines   = extensionLines(mainIni);
    let   content = readFile(mainIni);
    const before  = content;

    // Lines for extensions that are gone, in php.ini only: the overrides
    // file and the rest of conf.d are the user's own.
    for (const line of lines.filter((one) => one.file === mainIni && !(one.name in pecl) && !fs.existsSync(path.join(extDir, `${one.name}.so`)))) {
        content = content.split("\n").filter((text) => text !== line.text).join("\n");
    }
    // Lines for extensions that have none.
    const named   = new Set(lines.map((line) => line.name));
    const missing = Object.keys(pecl).filter((name) => !named.has(name) && fs.existsSync(path.join(extDir, `${name}.so`)));
    if (missing.length) {
        const zend = new Set([ "xdebug", "opcache", "ioncube", "blackfire" ]);
        content = missing.map((name) => `${zend.has(name) ? "zend_extension" : "extension"}="${name}.so"`).join("\n") + `\n${content}`;
    }
    if (content !== before) {
        fs.copyFileSync(mainIni, `${mainIni}.bak`);
        fs.writeFileSync(mainIni, content);
        baseCache.key = "";
    }
}

/**
 * The lines that load an extension, in php.ini and the files of conf.d, as
 * extension="redis.so" or zend_extension=xdebug, each with its name.
 */
function extensionLines(mainIni) {
    const files   = [ mainIni, ...filesIn(path.dirname(phpIniFile()), "").filter((file) => file.endsWith(".ini")) ];
    const found   = [];
    for (const file of files) {
        for (const text of readFile(file).split("\n")) {
            const match = text.match(/^\s*(zend_)?extension\s*=\s*"?([^";\s]+)"?/);
            if (match) {
                found.push({ file, text, name : path.basename(match[2]).replace(/\.so$/, "").replace(/^php_/, "").toLowerCase() });
            }
        }
    }
    return found;
}

/**
 * Extensions on PECL for what is being typed into the install field. PECL
 * lists only the names of all its packages, so those are matched and put in
 * order -- the exact name, then names starting with the text -- and the
 * first few are asked for their newest release. Kept for 10 minutes; the
 * list of names for a day.
 */
let peclNames  = { at : 0, list : [] };
const releases = new Map();
async function searchExtensions(text) {
    const query = String(text || "").trim().toLowerCase().slice(0, 60);
    if (query.length < 2) {
        return [];
    }
    if (Date.now() - peclNames.at > 24 * 60 * 60_000) {
        const xml = await peclRest("p/packages.xml");
        peclNames = { at : Date.now(), list : [ ...xml.matchAll(/<p>([^<]+)<\/p>/g) ].map((match) => match[1]) };
    }
    const rank  = (name) => (name === query ? 0 : name.startsWith(query) ? 1 : 2);
    const names = peclNames.list
        .filter((name) => name.toLowerCase().includes(query))
        .sort((a, b) => rank(a.toLowerCase()) - rank(b.toLowerCase()) || a.localeCompare(b))
        .slice(0, 10);
    return Promise.all(names.map(releaseOf));
}

/** A PECL package's newest release: its version, date, summary and licence. */
async function releaseOf(name) {
    const id   = name.toLowerCase();
    const kept = releases.get(id);
    if (kept && Date.now() - kept.at < 10 * 60_000) {
        return kept.info;
    }
    const stable  = await peclRest(`r/${id}/stable.txt`).catch(() => "");
    const version = stable.trim() || (await peclRest(`r/${id}/latest.txt`).catch(() => "")).trim();
    const xml     = version ? await peclRest(`r/${id}/${version}.xml`).catch(() => "") : "";
    const tag     = (key) => decodeXml(xml.match(new RegExp(`<${key}>([^<]*)</${key}>`))?.[1] || "").trim();
    const info    = {
        name,
        version,
        stable  : Boolean(stable.trim()),
        summary : tag("s"),
        license : tag("l"),
        date    : tag("da").replace(" ", "T"),
    };
    releases.set(id, { at : Date.now(), info });
    return info;
}

async function peclRest(file) {
    const response = await fetch(`https://pecl.php.net/rest/${file}`, { signal : AbortSignal.timeout(8_000) });
    if (!response.ok) {
        throw new Error("PECL did not answer");
    }
    return response.text();
}

function decodeXml(text) {
    return text.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
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
    readPhp,
    readDirectives,
    setPhpSetting,
    setPhpSettings,
    readOverrides,
    saveOverrides,
    checkOverrides,
    installExtension,
    updateExtensions,
    reinstallExtension,
    uninstallExtension,
    searchExtensions,
    phpIniFile,
};
