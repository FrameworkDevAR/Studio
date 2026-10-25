"use strict";

const fs = require("fs");
const path = require("path");

// Homebrew's Node.js: its version, npm and corepack, and the global packages.

const { PATHS, run, versionOf, readJson } = require("../core/system");
const { runJob, spawnLines } = require("../core/jobs");



const NODE = path.join(PATHS.homebrew, "bin", "node");

/**
 * The Node.js version and the packages installed with npm -g. Asking npm
 * takes a moment, so the answer is kept for a minute.
 */
let nodeCache = { at : 0, data : null };
async function readNode() {
    const data = await readNodeKept();
    if (!data.broken && data.version) {
        checkOutdated();
        checkSizes(data.root, data.globals);
    }
    return {
        ...data,
        globals : data.globals.map((pkg) => ({
            ...pkg,
            latest : outdated.packages[pkg.name] || "",
            size   : sizes.packages[pkg.name] || 0,
        })),
        checked : outdated.at,
    };
}

async function readNodeKept() {
    if (Date.now() - nodeCache.at < 60_000 && nodeCache.data) {
        return nodeCache.data;
    }

    const check = await run(NODE, [ "-v" ], 5_000);
    // A node that cannot start, as after an upgrade of a library it uses.
    const broken = versionOf("node") && !check.ok ? brokenReason(check.stderr) : "";
    const globals = check.ok ? await readGlobals() : { root : "", packages : [] };

    nodeCache = { at : Date.now(), data : {
        version  : check.ok ? check.stdout.trim().replace(/^v/, "") : versionOf("node"),
        broken,
        npm      : toolVersion("npm"),
        corepack : toolVersion("corepack"),
        root     : globals.root,
        globals  : globals.packages,
    } };
    return nodeCache.data;
}

/**
 * The newest version of each global package that has a newer one. npm asks
 * the registry for it, which takes seconds and needs the network, so it runs
 * in the background at most once an hour and the page shows the last answer.
 * A linked package is left out: npm compares it with whatever package on the
 * registry has its name, which is often another one.
 */
let outdated = { at : 0, busy : false, round : 0, packages : {} };
function checkOutdated() {
    const cli = realPathOf(path.join(PATHS.homebrew, "bin", "npm"));
    if (!cli || outdated.busy || Date.now() - outdated.at < 60 * 60_000) {
        return;
    }
    outdated.busy = true;
    const round   = outdated.round;
    // npm outdated exits with 1 when something is outdated, so its output is
    // read whatever the exit.
    run(NODE, [ cli, "outdated", "-g", "--json" ], 60_000).then((result) => {
        // npm changed the packages while this ran, so its answer is old: the
        // next read asks again.
        if (round !== outdated.round) {
            outdated.busy = false;
            return;
        }
        try {
            const found = JSON.parse(result.stdout || "{}");
            outdated.packages = Object.fromEntries(Object.entries(found)
                .filter(([ , info ]) => !isLink(info.location))
                .map(([ name, info ]) => [ name, info.latest ]));
            outdated.at = Date.now();
        } catch {
            // Offline or npm failed: tried again on a later read.
        }
        outdated.busy = false;
    });
}

/**
 * The room each global package takes on disk, with what it brought along.
 * du takes a couple of seconds over them all, so it runs in the background,
 * again only after npm changed something. A linked package is left out: its
 * folder is a project of its own, not something npm installed.
 */
let sizes = { at : 0, busy : false, packages : {} };
function checkSizes(root, globals) {
    if (!root || sizes.busy || sizes.at) {
        return;
    }
    const names = globals.filter((pkg) => !pkg.linked).map((pkg) => pkg.name);
    if (!names.length) {
        return;
    }
    sizes.busy = true;
    run("du", [ "-sk", ...names.map((name) => path.join(root, name)) ], 60_000).then((result) => {
        sizes.packages = Object.fromEntries(result.stdout.trim().split("\n").filter(Boolean)
            .map((line) => {
                const [ kb, file ] = line.split("\t");
                return [ path.relative(root, file), Number(kb) * 1024 ];
            }));
        sizes.at   = Date.now();
        sizes.busy = false;
    });
}

/**
 * Packages on the registry for what is being typed into the install field.
 * npm's search matches whole words, so it is asked for more than are shown,
 * and those are put in a better order: the exact name, then names starting
 * with the text, then the most downloaded. Answers are kept for 10 minutes.
 */
const searches = new Map();
async function searchPackages(text) {
    const query = String(text || "").trim().toLowerCase().slice(0, 100);
    if (query.length < 2) {
        return [];
    }
    const kept = searches.get(query);
    if (kept && Date.now() - kept.at < 10 * 60_000) {
        return kept.list;
    }
    const response = await fetch(
        `https://registry.npmjs.org/-/v1/search?size=25&text=${encodeURIComponent(query)}`,
        { signal : AbortSignal.timeout(8_000) },
    );
    if (!response.ok) {
        throw new Error("npm's search did not answer");
    }
    const rank = (name) => (name === query ? 0 : name.startsWith(query) ? 1 : 2);
    const list = (await response.json()).objects
        .map(({ package : pkg, downloads }) => ({
            name        : pkg.name,
            version     : pkg.version,
            description : pkg.description || "",
            keywords    : (pkg.keywords || []).slice(0, 6),
            publisher   : pkg.publisher?.username || "",
            date        : pkg.date || "",
            license     : pkg.license || "",
            weekly      : downloads?.weekly || 0,
        }))
        .sort((a, b) => rank(a.name) - rank(b.name) || b.weekly - a.weekly)
        .slice(0, 12);
    if (searches.size > 200) {
        searches.clear();
    }
    searches.set(query, { at : Date.now(), list });
    return list;
}

/**
 * Installs the newest version of some global packages, or of every outdated
 * one. Only installed packages can be named, and not linked ones, so a
 * request can never install something new this way.
 */
async function updatePackages(names) {
    const { globals } = await readNodeKept();
    const installed   = globals.filter((pkg) => !pkg.linked).map((pkg) => pkg.name);
    const chosen      = names === "all" ? Object.keys(outdated.packages) : [].concat(names);
    if (!chosen.length || chosen.some((name) => !installed.includes(name))) {
        throw new Error("Nothing to update");
    }
    // One npm run each, so each package shows its own progress and one that
    // fails leaves the others updated.
    const steps = chosen.map((name) => ({ name, args : [ "install", `${name}@latest` ] }));
    return runNpm(steps, (updated) => {
        // Off the list at once, rather than until npm is asked again.
        updated.forEach((name) => delete outdated.packages[name]);
        return updated.length === 1 ? `${updated[0]} updated`
            : `${updated.length} packages updated`;
    });
}

/**
 * A package from the registry, by its name and an optional version or tag,
 * as typescript or eslint@9. Paths, git addresses and flags are refused: the
 * spec has to start with a letter, a digit or a scope.
 */
const PACKAGE_SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*+-]+)?$/i;

function installPackage(spec) {
    const wanted = String(spec || "").trim();
    if (!PACKAGE_SPEC.test(wanted)) {
        throw new Error("Not a package name");
    }
    return runNpm([ { name : wanted, args : [ "install", wanted ] } ], () => `${wanted} installed`);
}

/**
 * Removes a global package, or the link of a linked one, never its folder.
 * npm itself stays, since without it nothing could be installed again.
 */
async function uninstallPackage(name) {
    const { globals } = await readNodeKept();
    if (name === "npm" || !globals.some((pkg) => pkg.name === name)) {
        throw new Error("Not a package that can be removed");
    }
    return runNpm([ { name, args : [ "uninstall", name ] } ], () => {
        delete outdated.packages[name];
        return `${name} removed`;
    });
}

/**
 * Runs npm on the global packages, as a job the page follows, a package a
 * step. Whatever npm changed, the packages, their sizes and the outdated ones
 * are asked for again.
 */
function runNpm(steps, done) {
    return runJob("npm", steps, {
        runStep : async (step) => {
            const lines = [];
            const code  = await spawnNpm(step.args, (line) => lines.push(line));
            return code === 0 ? ""
                : lines.filter((line) => /ERR!/.test(line)).slice(0, 3).join(" ") || "npm failed";
        },
        after : async () => {
            nodeCache.at = 0;
            sizes.at     = 0;
            outdated.at  = 0;
            outdated.round++;
        },
        done,
    });
}

/**
 * Runs npm and hands on each line it writes. Its colors and progress bar
 * are left out, since they are meant for a terminal.
 */
function spawnNpm(args, onLine) {
    const cli = realPathOf(path.join(PATHS.homebrew, "bin", "npm"));
    return spawnLines(NODE, [
        cli, ...args, "-g", "--no-fund", "--no-audit", "--no-progress", "--color=false",
    ], {
        // Install scripts run node by name, so Homebrew's comes first.
        env : { ...process.env, PATH : `${PATHS.homebrew}/bin:${process.env.PATH}` },
        onLine,
    });
}

/**
 * A tool that comes with Node.js, from its package.json, so it is known even
 * when node itself does not start.
 */
function toolVersion(name) {
    const cli = realPathOf(path.join(PATHS.homebrew, "bin", name));
    let dir   = path.dirname(cli);
    while (cli && dir !== path.dirname(dir)) {
        const file = path.join(dir, "package.json");
        if (fs.existsSync(file)) {
            return readJson(file).version || "";
        }
        dir = path.dirname(dir);
    }
    return "";
}

/** The packages npm installed with -g, and the folder they live in. */
async function readGlobals() {
    const cli = realPathOf(path.join(PATHS.homebrew, "bin", "npm"));
    if (!cli) {
        return { root : "", packages : [] };
    }
    const [ list, root ] = await Promise.all([
        run(NODE, [ cli, "ls", "-g", "--depth=0", "--json" ], 20_000),
        run(NODE, [ cli, "root", "-g" ], 10_000),
    ]);
    let packages = [];
    try {
        packages = Object.entries(JSON.parse(list.stdout).dependencies || {})
            .map(([ name, info ]) => ({
                name,
                version : info.version || "",
                // A package added with npm link, which points to a folder.
                linked  : Boolean(info.resolved?.startsWith("file:")),
            // By name, so a package comes before its plugins: eslint, then eslint-plugin-react.
            })).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch {
        // npm could not say; the list stays empty.
    }
    return { root : root.stdout.trim(), packages };
}

/** Why node does not start, as macOS's loader says it, on one line. */
function brokenReason(stderr) {
    const line = stderr.split("\n").find((one) => /Library not loaded/.test(one))
        || stderr.split("\n")[0] || "";
    return line.replace(/^dyld\[\d+\]:\s*/, "")
        .replace(/^Library not loaded: .*\//, "Library not loaded: ")
        .trim();
}

function isLink(file) {
    try {
        return fs.lstatSync(file).isSymbolicLink();
    } catch {
        return false;
    }
}

function realPathOf(file) {
    try {
        return fs.realpathSync(file);
    } catch {
        return "";
    }
}

module.exports = {
    readNode,
    updatePackages,
    installPackage,
    uninstallPackage,
    searchPackages,
};
