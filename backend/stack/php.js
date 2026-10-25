"use strict";

const fs = require("fs");
const path = require("path");

// The PHP version, its settings and the overrides file.

const { run, versionOf, filesIn, readFile } = require("../core/system");
const { reloadApache } = require("./apache");
const {
    PHP_SETTINGS, ownerOf, readSwitches, askPhp, readBase, phpIniFile, settingLine, iniValue,
    displayValue, iniKeys, readIniFile, fileSize
} = require("./ini");
const { readPecl, checkUpgrades, upgrades, extensionLines } = require("./pecl");


/**
 * The PHP version, its settings and extensions. A setting in the overrides
 * file shows the file's value, since the CLI changes some of them (it always
 * reports max_execution_time as 0); one that is not shows PHP's, and says
 * whether that comes from php.ini or is PHP's own default.
 * @returns {Promise<{
 *     version: string,
 *     iniFile: string,
 *     mainIni: string,
 *     timezones: string[],
 *     extensions: {
 *         name: string, version: string, added: boolean, pecl: boolean, latest: string,
 *         size: number,
 *     }[],
 *     missing: { name: string, pecl: boolean }[],
 *     problems: string[],
 *     checked: number,
 *     settings: {
 *         key: string, value: string, inFile: boolean, options: string[],
 *         timezone: boolean, base: string, baseFrom: string,
 *     }[],
 *     overrides: {
 *         key: string, value: string, known: boolean, owner: string, options: string[],
 *         base: string, baseFrom: string,
 *     }[],
 * }>}
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
    const wanted  = [ ...new Set([
        ...extensionLines(mainIni).map((line) => line.name),
        ...Object.keys(pecl),
    ]) ];
    const missing = wanted.filter((name) => !names.has(name))
        .map((name) => ({ name, pecl : name in pecl }));

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
        overrides : Object.entries(overrides).filter(([ key ]) => !(key in PHP_SETTINGS))
            .map(([ key, value ]) => ({
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
 * @returns {Promise<{
 *     key: string, value: string, inFile: boolean, owner: string, options: string[],
 *     timezone: boolean,
 * }[]>}
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
 * @param {{ key: string, value?: string, remove?: boolean }[]} changes
 * @returns {Promise<{ message: string }>}
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
        : list[0].remove ? `${list[0].key} override removed`
            : `${list[0].key} set to ${list[0].value}`;
    return { message : `${said}. ${reload.message}` };
}

/**
 * Writes one setting to the overrides file, as setPhpSettings does.
 * @param {string} key
 * @param {string} value
 * @returns {Promise<{ message: string }>}
 */
function setPhpSetting(key, value) {
    return setPhpSettings([ { key, value } ]);
}

/**
 * Refuses a setting the page knows not to take that value, or that PHP does not have.
 * @param {string} key
 * @param {string} value
 * @param {Object<string, string>} known
 * @returns {void}
 */
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

/**
 * The overrides file, for the page's editor.
 * @returns {{ file: string, exists: boolean, text: string }}
 */
function readOverrides() {
    const file = phpIniFile();
    return { file, exists : fs.existsSync(file), text : readFile(file) };
}

/**
 * Saves the overrides file from the page's editor, once PHP takes it.
 * @param {string} text
 * @returns {Promise<{ message: string }>}
 */
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
 * @param {string} text
 * @returns {Promise<{ problems: string[] }>}
 */
async function checkOverrides(text) {
    const [ now, next ] = await Promise.all([ askPhp(), askPhp(String(text ?? "")) ]);
    return { problems : next.problems.filter((problem) => !now.problems.includes(problem)) };
}

/**
 * Writes the overrides file once PHP starts with it without anything new to
 * complain about, keeping the one before as .bak, then reloads Apache.
 * @param {string} text
 * @returns {Promise<{ message: string }>}
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



// The public API
module.exports = {
    readPhp,
    readDirectives,
    setPhpSetting,
    setPhpSettings,
    readOverrides,
    saveOverrides,
    checkOverrides,
    phpIniFile,
};
