// Homebrew's updates of the stack: which of its formulas, and SwiftBar's cask, have a newer
// version, asked in the background at most once an hour, and updating them as a job the page
// follows, with the running services each changes started again on the new version, and each
// noted in the updates log. Only the versions the config's "versions" allows are offered: a
// part's patches when it gives none. One it leaves out, as a new minor version of PHP, is held,
// and moving its range updates it.

import fs from "node:fs";
import path from "node:path";

import {
    BREW, CONFIG, PATHS, UPDATES, readFile, readJson, run, versionOf
} from "../core/system.js";
import { runJob, spawnLines } from "../core/jobs.js";
import { movedTo, patchesOf, satisfies } from "../core/versions.js";
import { readConfig, writeConfig } from "../core/config.js";
import { readServices, serviceAction } from "./services.js";
import { readPecl, rebuildExtensions } from "./pecl.js";



/** What the stack has from Homebrew, by formula or cask, with the name the page gives each. */
const STACK = {
    httpd      : "Apache",
    php        : "PHP",
    mariadb    : "MariaDB",
    redis      : "Redis",
    node       : "Node.js",
    mkcert     : "mkcert",
    phpmyadmin : "phpMyAdmin",
    swiftbar   : "SwiftBar",
};

/** The ones that are casks, which brew upgrades with --cask. */
const CASKS = [ "swiftbar" ];

/**
 * The services an update changes, which run the old version until started again. Apache loads
 * PHP, and a graceful reload is not enough: the old PHP's files are gone by then, which stops
 * Apache, so it is stopped and started instead.
 */
const RESTARTS = {
    httpd   : "httpd",
    php     : "httpd",
    mariadb : "mariadb",
    redis   : "redis",
};

const HOUR = 60 * 60_000;



/**
 * One of the stack's packages that has a newer version: its name in Homebrew and on the page,
 * the version here and the newest, and whether it is pinned, which brew leaves as it is.
 * @typedef {{
 *     name: string, label: string, version: string, latest: string, pinned: boolean,
 * }} BrewUpdate
 */

/**
 * An update the config's range for it leaves out: the range, and the one that would take it.
 * @typedef {BrewUpdate & { range: string, next: string }} HeldUpdate
 */

/**
 * An update done, as the log keeps it: when, the package, the versions it went from and to,
 * and whether Studio or the setup did it.
 * @typedef {{ at: string, name: string, from: string, to: string, by: string }} UpdateRecord
 */



// ---------------------------------------------------------------- updates ---

/**
 * The newer versions, by name, as brew last gave them. brew asks Homebrew's site, so it runs in
 * the background at most once an hour, and the page shows the last answer.
 */
let outdated = { at : 0, busy : false, round : 0, packages : {} };

/**
 * The stack's updates for the page, starting a check when the last is an hour old: those the
 * config's ranges take, and those they hold.
 * @returns {{ checked: number, packages: BrewUpdate[], held: HeldUpdate[] }}
 */
function readUpdates() {
    checkUpdates();
    return { checked : outdated.at, packages : offered(), held : heldBack() };
}

/**
 * The updates offered: not a pinned one, which brew upgrade keeps at its version, nor one to a
 * version the config's range for it leaves out. The config is read each time, so a change to
 * it shows at once.
 * @returns {BrewUpdate[]}
 */
function offered() {
    const ranges = rangesOf();
    return outdatedNow().filter((one) => satisfies(one.latest, ranges[one.name]));
}

/**
 * The updates the config's ranges leave out, each with the range that would take it.
 * @returns {HeldUpdate[]}
 */
function heldBack() {
    const ranges = rangesOf();

    return outdatedNow().filter((one) => !satisfies(one.latest, ranges[one.name]))
        .map((one) => ({
            ...one, range : ranges[one.name], next : movedTo(ranges[one.name], one.latest),
        }));
}

/**
 * The stack's packages with a newer version, installed and not pinned.
 * @returns {BrewUpdate[]}
 */
function outdatedNow() {
    return Object.values(outdated.packages)
        .filter((one) => !one.pinned && isInstalled(one.name));
}

/**
 * The range of each package with an update: the config's, or its patches when it gives none,
 * as a new minor version of PHP or MariaDB can break what runs on it.
 * @returns {Object<string, string>}
 */
function rangesOf() {
    const versions = readJson(CONFIG).versions || {};
    return Object.fromEntries(Object.values(outdated.packages).map((one) => [
        one.name, versions[one.name] || patchesOf(one.version),
    ]));
}

/**
 * Asks brew which of the stack's packages have a newer version, in the background. One that
 * cannot reach Homebrew keeps the last answer, and tries again in an hour.
 * @returns {void}
 */
function checkUpdates() {
    const names = Object.keys(STACK).filter(isInstalled);
    if (!names.length || outdated.busy || Date.now() - outdated.at < HOUR) {
        return;
    }

    outdated.busy = true;
    const round   = outdated.round;

    run(BREW, [ "outdated", "--json=v2", ...names ], 120_000).then((result) => {
        if (round === outdated.round) {
            const found = parseOutdated(result.stdout);
            if (found) {
                outdated.packages = found;
            }
            outdated.at = Date.now();
        }

        outdated.busy = false;
    });
}

/**
 * The packages of brew's answer, by name, or null when it is not one: brew writes JSON, with
 * the versions installed, the newest, and whether each is pinned.
 * @param {string} text
 * @returns {Object<string, BrewUpdate> | null}
 */
function parseOutdated(text) {
    let answer;
    try {
        answer = JSON.parse(text.slice(text.indexOf("{")));
    } catch {
        return null;
    }

    /** @type {Object<string, BrewUpdate>} */
    const packages = {};

    for (const one of [ ...(answer.formulae || []), ...(answer.casks || []) ]) {
        if (one.name in STACK) {
            packages[one.name] = {
                name    : one.name,
                label   : STACK[one.name],
                version : [].concat(one.installed_versions).pop() || "",
                latest  : String(one.current_version || ""),
                pinned  : Boolean(one.pinned),
            };
        }
    }

    return packages;
}

/**
 * Updates some of the stack's packages, one after the other, as a job the page follows. Once
 * done, each is noted in the log, PHP's settings and extensions follow a new minor version of
 * it, and the running services they change are started again, so they run the new versions.
 * @param {string | string[]} names
 * @returns {Promise<{ job: string }>}
 */
async function updateStack(names) {
    const chosen = [].concat(names).map(String);
    const offers = offered().map((one) => one.name);
    if (!chosen.length || chosen.some((name) => !offers.includes(name))) {
        throw new Error("Nothing to update");
    }

    // The versions before, for what changed once it is done.
    const before = Object.fromEntries(chosen.map((name) => [
        name, outdated.packages[name].version,
    ]));
    const steps  = chosen.map((name) => ({
        name,
        args : CASKS.includes(name) ? [ "upgrade", "--cask", name ] : [ "upgrade", name ],
    }));

    // The new PHP's pecl does not know the extensions built for the last, so they are read now.
    let extensions = [];
    if (chosen.includes("php")) {
        const pecl = await readPecl();
        extensions = Object.keys(pecl);
    }

    return runJob("brew", steps, {
        runStep : async (step) => {
            const lines = [];
            const code  = await spawnLines(BREW, step.args, {
                timeout : 30 * 60_000,
                onLine  : (line) => lines.push(line),
            });
            return code === 0 ? "" : brewError(lines);
        },
        after   : async (worked) => {
            worked.forEach((name) => delete outdated.packages[name]);
            outdated.at = 0;
            outdated.round++;
            recordUpdates(worked, before);

            // PHP's extensions are built before Apache starts again, so it loads them.
            let php = "";
            if (worked.includes("php")) {
                php = await movePhp(before.php, extensions);
            }

            const restarted = await restartServices(worked);

            return [ restarted, php ].filter(Boolean).join(". ");
        },
        done    : (worked) => (worked.length === 1
            ? `${STACK[worked[0]]} updated`
            : `${worked.length} packages updated`),
    });
}

/**
 * Updates packages the config's ranges hold, as PHP to a new minor version: their ranges move
 * to take the new versions, so later updates follow them, and they update as any other.
 * @param {string | string[]} names
 * @returns {Promise<{ job: string }>}
 */
async function moveStack(names) {
    const chosen = [].concat(names).map(String);
    const held   = heldBack().filter((one) => chosen.includes(one.name));
    if (!chosen.length || held.length !== chosen.length) {
        throw new Error("Nothing to move");
    }

    // The ranges go before the projects, as the setup writes them.
    const config   = readConfig();
    const versions = { ...config.versions };
    held.forEach((one) => { versions[one.name] = one.next; });

    const { projects, ...rest } = config;
    await writeConfig(projects === undefined
        ? { ...rest, versions }
        : { ...rest, versions, projects });

    return updateStack(chosen);
}

/**
 * Starts again the running services that the updated packages change. Gives what it did.
 * @param {string[]} worked
 * @returns {Promise<string>}
 */
async function restartServices(worked) {
    const services  = await readServices();
    const wanted    = [ ...new Set(worked.map((name) => RESTARTS[name]).filter(Boolean)) ];
    const restarted = [];

    for (const formula of wanted.filter((one) => services[one]?.running)) {
        await serviceAction(formula, "restart");
        restarted.push(STACK[formula]);
    }

    return restarted.length ? `${restarted.join(" and ")} restarted` : "";
}

/**
 * Moves PHP to a new minor version, as 8.5 to 8.6: Studio's PHP settings go to the new one's
 * folder, unless it has some already, and its pecl extensions are built again. Gives how it
 * went, with those that did not build, which the PHP page offers again; "" for a patch.
 * @param {string} from the version before
 * @param {string[]} extensions pecl's extensions, read before the update
 * @returns {Promise<string>}
 */
async function movePhp(from, extensions) {
    const [ old, now ] = [ from, versionOf("php") ].map((version) => version
        .split(".").slice(0, 2).join("."));
    if (!old || !now || old === now) {
        return "";
    }

    const pattern = PATHS.phpIni;
    if (pattern.includes("{php}")) {
        const source = pattern.replaceAll("{php}", old);
        const target = pattern.replaceAll("{php}", now);
        if (fs.existsSync(source) && !fs.existsSync(target)) {
            fs.mkdirSync(path.dirname(target), { recursive : true });
            fs.copyFileSync(source, target);
        }
    }

    const { built, failed } = await rebuildExtensions(extensions);
    let note = `PHP is ${now} now`;
    if (built.length) {
        note += `, with ${listOf(built)} built again`;
    }
    if (failed.length) {
        note += `. ${listOf(failed)} did not build: try again on the PHP page`;
    }

    return note;
}


// ----------------------------------------------------------------- history ---

/**
 * Notes each package updated in the log, with the version it went from and the one installed
 * now. A log that cannot be written leaves the update as it is.
 * @param {string[]} worked
 * @param {Object<string, string>} before
 * @returns {void}
 */
function recordUpdates(worked, before) {
    const at    = new Date().toISOString();
    const lines = worked.map((name) => JSON.stringify({
        at, name, from : before[name], to : installedOf(name), by : "Studio",
    }));

    try {
        fs.appendFileSync(UPDATES, lines.map((line) => `${line}\n`).join(""));
    } catch {
        // The update is done, which matters more than its note.
    }
}

/**
 * The last updates of the log, newest first, each with its package's name on the page. A line
 * that is not JSON, as one cut short, is left out.
 * @param {number=} count
 * @returns {(UpdateRecord & { label: string })[]}
 */
function readHistory(count = 8) {
    const records = [];

    for (const line of readFile(UPDATES).split("\n").filter(Boolean)) {
        try {
            records.push(JSON.parse(line));
        } catch {
            // Skipped.
        }
    }

    return records.slice(-count).reverse()
        .map((one) => ({ ...one, label : STACK[one.name] || one.name }));
}

/**
 * Each installed package of the stack with its version and the config's range for it, "" when
 * it gives none, for the Settings page.
 * @returns {{ name: string, label: string, version: string, range: string }[]}
 */
function readVersions() {
    const versions = readJson(CONFIG).versions || {};

    return Object.keys(STACK).filter(isInstalled).map((name) => ({
        name,
        label   : STACK[name],
        version : installedOf(name),
        range   : versions[name] || "",
    }));
}


// ----------------------------------------------------------------- helpers ---

/**
 * The version of a package installed: a formula's opt link names it, a cask's folder holds
 * one named by it.
 * @param {string} name
 * @returns {string}
 */
function installedOf(name) {
    if (!CASKS.includes(name)) {
        return versionOf(name);
    }

    try {
        return fs.readdirSync(path.join(PATHS.homebrew, "Caskroom", name))
            .filter((one) => !one.startsWith(".")).sort().pop()?.split(",")[0] || "";
    } catch {
        return "";
    }
}

/**
 * Whether a package of the stack is installed: a formula has its opt link, a cask its folder.
 * @param {string} name
 * @returns {boolean}
 */
function isInstalled(name) {
    const folder = CASKS.includes(name) ? [ "Caskroom", name ] : [ "opt", name ];
    return fs.existsSync(path.join(PATHS.homebrew, ...folder));
}

/**
 * Names as a sentence lists them: "apcu", "apcu and redis", "apcu, igbinary and redis".
 * @param {string[]} names
 * @returns {string}
 */
function listOf(names) {
    return names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : names.join("");
}

/**
 * What went wrong in a brew run, from its last error lines.
 * @param {string[]} lines
 * @returns {string}
 */
function brewError(lines) {
    const errors = lines.filter((line) => /^Error:|error:/i.test(line));
    return (errors.length ? errors : lines).slice(-2).join(" ").replace(/\s+/g, " ")
        .slice(0, 400) || "brew failed";
}



// The public API
export {
    readUpdates,
    updateStack,
    moveStack,
    readVersions,
    readHistory,
};
