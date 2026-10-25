"use strict";

const fs = require("fs");
const path = require("path");

// PHP's extensions added with pecl: read, installed, updated, built again and removed,
// and found in pecl's channel.

const { PATHS, run, filesIn, readFile } = require("../core/system");
const { runJob, spawnLines } = require("../core/jobs");
const { reloadApache } = require("./apache");
const { askPhp, forgetBase, phpIniFile } = require("./ini");


const PECL = path.join(PATHS.homebrew, "bin", "pecl");


// -------------------------------------------------------------- extensions ---

/**
 * The extensions pecl installed, by name, with their versions. Asking pecl
 * takes a moment, so the answer is kept for a minute, or until pecl changes
 * something.
 */
let peclCache = { at : 0, packages : {} };
/**
 * The version of each extension pecl installed, by name, kept for a minute.
 * @returns {Promise<Object<string, string>>}
 */
async function readPecl() {
    if (Date.now() - peclCache.at < 60_000) {
        return peclCache.packages;
    }

    const result   = fs.existsSync(PECL) ? await run(PECL, [ "list", "-c", "pecl" ], 20_000)
        : { stdout : "" };
    /** @type {Object<string, string>} */
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
/**
 * Asks pecl for the extensions with a newer version in the background, at most once an hour.
 * @returns {void}
 */
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

/**
 * Installs an extension from PECL, by its spec, as a job the page follows.
 * @param {string} spec
 * @returns {{ job: string }}
 */
function installExtension(spec) {
    const wanted = String(spec || "").trim();
    if (!EXTENSION_SPEC.test(wanted)) {
        throw new Error("Not an extension name");
    }

    return runPecl(
        [ { name : wanted.replace(/-\d.*/, ""), args : [ "install", wanted ] } ],
        (worked) => `${worked[0]} installed`,
    );
}

/**
 * Builds the newest version of some installed pecl extensions.
 * @param {string | string[]} names
 * @returns {Promise<{ job: string }>}
 */
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
 * @param {string} name
 * @returns {{ job: string }}
 */
function reinstallExtension(name) {
    const wanted = String(name || "").toLowerCase();
    if (!EXTENSION_SPEC.test(wanted)) {
        throw new Error("Not an extension name");
    }

    return runPecl(
        [ { name : wanted, args : [ "install", "-f", wanted ] } ],
        (worked) => `${worked[0]} built again`,
    );
}

/**
 * Removes a pecl extension, and its line in php.ini with it.
 * @param {string} name
 * @returns {Promise<{ job: string }>}
 */
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
 * @param {import("../core/jobs").JobStep[]} steps
 * @param {(worked: string[]) => string} done
 * @returns {{ job: string }}
 */
function runPecl(steps, done) {
    return runJob("pecl", steps, {
        runStep : async (step) => {
            const lines = [];
            const code  = await spawnLines(PECL, step.args, {
                // phpize, autoconf and pkg-config, which a build needs, are Homebrew's.
                env     : {
                    ...process.env,
                    PATH : `${PATHS.homebrew}/bin:${PATHS.homebrew}/sbin:${process.env.PATH}`,
                },
                input   : "\n".repeat(50),
                timeout : 15 * 60_000,
                onLine  : (line) => lines.push(line),
            });

            const ok = lines.some((line) => /^(install|upgrade|uninstall) ok:/.test(line))
                || (step.args[0] === "upgrade" && lines.some(
                    (line) => /is already installed and is (the same as|newer than)/.test(line),
                ));
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

/**
 * What went wrong in a pecl run, from its last error lines.
 * @param {string[]} lines
 * @returns {string}
 */
function peclError(lines) {
    const errors = lines.filter(
        (line) => /error|not found|failed|No releases|does not exist|requires/i.test(line)
            && !/^checking /.test(line),
    );
    return errors.slice(-2).join(" ").replace(/\s+/g, " ").slice(0, 400) || "pecl failed";
}

/**
 * Makes php.ini load each extension pecl installed, and none it removed:
 * pecl writes these lines itself, but not always. A Zend extension, as
 * xdebug, is loaded with zend_extension, which pecl does not always know.
 * @returns {Promise<void>}
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
    for (const line of lines.filter((one) => one.file === mainIni && !(one.name in pecl)
        && !fs.existsSync(path.join(extDir, `${one.name}.so`)))) {
        content = content.split("\n").filter((text) => text !== line.text).join("\n");
    }

    // Lines for extensions that have none.
    const named   = new Set(lines.map((line) => line.name));
    const missing = Object.keys(pecl)
        .filter((name) => !named.has(name) && fs.existsSync(path.join(extDir, `${name}.so`)));
    if (missing.length) {
        const zend = new Set([ "xdebug", "opcache", "ioncube", "blackfire" ]);
        content = missing
            .map((name) => `${zend.has(name) ? "zend_extension" : "extension"}="${name}.so"`)
            .join("\n") + `\n${content}`;
    }

    if (content !== before) {
        fs.copyFileSync(mainIni, `${mainIni}.bak`);
        fs.writeFileSync(mainIni, content);
        forgetBase();
    }
}

/**
 * The lines that load an extension, in php.ini and the files of conf.d, as
 * extension="redis.so" or zend_extension=xdebug, each with its name.
 * @param {string} mainIni
 * @returns {{ file: string, text: string, name: string }[]}
 */
function extensionLines(mainIni) {
    const files   = [
        mainIni,
        ...filesIn(path.dirname(phpIniFile()), "").filter((file) => file.endsWith(".ini")),
    ];
    const found   = [];

    for (const file of files) {
        for (const text of readFile(file).split("\n")) {
            const match = text.match(/^\s*(zend_)?extension\s*=\s*"?([^";\s]+)"?/);
            if (match) {
                found.push({
                    file,
                    text,
                    name : path.basename(match[2]).replace(/\.so$/, "").replace(/^php_/, "")
                        .toLowerCase(),
                });
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
/**
 * The extensions on PECL that best match a text, each with its newest release.
 * @param {string} text
 * @returns {Promise<PeclRelease[]>}
 */
async function searchExtensions(text) {
    const query = String(text || "").trim().toLowerCase().slice(0, 60);
    if (query.length < 2) {
        return [];
    }

    if (Date.now() - peclNames.at > 24 * 60 * 60_000) {
        const xml = await peclRest("p/packages.xml");
        peclNames = {
            at   : Date.now(),
            list : [ ...xml.matchAll(/<p>([^<]+)<\/p>/g) ].map((match) => match[1]),
        };
    }

    const rank  = (name) => (name === query ? 0 : name.startsWith(query) ? 1 : 2);
    const names = peclNames.list
        .filter((name) => name.toLowerCase().includes(query))
        .sort((a, b) => rank(a.toLowerCase()) - rank(b.toLowerCase()) || a.localeCompare(b))
        .slice(0, 10);

    return Promise.all(names.map(releaseOf));
}

/**
 * A release of a PECL package, as the search gives it: its version, whether it is stable,
 * its summary, licence and date.
 * @typedef {{
 *     name: string, version: string, stable: boolean, summary: string, license: string,
 *     date: string,
 * }} PeclRelease
 */

/**
 * A PECL package's newest release: its version, date, summary and licence.
 * @param {string} name
 * @returns {Promise<PeclRelease>}
 */
async function releaseOf(name) {
    const id   = name.toLowerCase();
    const kept = releases.get(id);
    if (kept && Date.now() - kept.at < 10 * 60_000) {
        return kept.info;
    }

    const stable  = await peclRest(`r/${id}/stable.txt`).catch(() => "");
    const version = stable.trim() || (await peclRest(`r/${id}/latest.txt`).catch(() => "")).trim();
    const xml     = version ? await peclRest(`r/${id}/${version}.xml`).catch(() => "") : "";
    const tag     = (key) => decodeXml(xml.match(new RegExp(`<${key}>([^<]*)</${key}>`))?.[1] || "")
        .trim();
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

/**
 * A file of PECL's REST service, as text.
 * @param {string} file
 * @returns {Promise<string>}
 */
async function peclRest(file) {
    const response = await fetch(`https://pecl.php.net/rest/${file}`, {
        signal : AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
        throw new Error("PECL did not answer");
    }
    return response.text();
}

/**
 * Turns the XML's entities back into the characters they stand for.
 * @param {string} text
 * @returns {string}
 */
function decodeXml(text) {
    return text.replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}



// The public API
module.exports = {
    readPecl,
    checkUpgrades,
    upgrades,
    extensionLines,
    installExtension,
    updateExtensions,
    reinstallExtension,
    uninstallExtension,
    searchExtensions,
};
