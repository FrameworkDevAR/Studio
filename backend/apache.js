"use strict";

const fs   = require("fs");
const path = require("path");

// Apache's modules, which of them the sites use, its vhosts and its reload.

const { HTTPD, APACHE_CTL, HTTPD_CONF, VHOSTS, run, readFile } = require("./system");
const { readServices }                                         = require("./services");



/**
 * Modules Apache cannot do without here. Turning one off would take PHP or
 * every site down, so the page does not offer it.
 */
const PROTECTED_MODULES = [ "php_module", "mpm_prefork_module", "unixd_module", "authz_core_module" ];

// Folders never searched for .htaccess files: they hold packages, not sites.
const SKIPPED_DIRS = [ "node_modules", "vendor", ".git" ];

/**
 * Apache's filters whose name is not their module's: the others are named
 * after it, as DEFLATE is deflate_module's. Sites use a filter by naming it in
 * a directive of mod_filter or core, so its own module never shows there.
 */
const FILTER_MODULES = {
    INFLATE         : "deflate_module",
    INCLUDES        : "include_module",
    BROTLI_COMPRESS : "brotli_module",
    RATE_LIMIT      : "ratelimit_module",
};
const FILTER_DIRECTIVES = /^(Add|Set)(Input|Output)Filter(ByType)?$|^Filter(Provider|Chain)$/i;

/** Each LoadModule line of httpd.conf, on or commented out. */
async function readModules() {
    const used = await readUsedModules();
    return readFile(HTTPD_CONF).split("\n")
        .map((line) => line.match(/^(#?)\s*LoadModule\s+(\w+)\s+(\S+)/))
        .filter(Boolean)
        .map(([ , hash, name, file ]) => ({
            name,
            file,
            enabled   : hash === "",
            protected : PROTECTED_MODULES.includes(name),
            used      : used.has(name),
        }))
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
}

/**
 * The modules the config, the vhosts or the sites' .htaccess files use, so the
 * page can ask before turning one off, and show what is missing: those of the
 * directives, of the filters the directives name, and of the <IfModule> blocks. `httpd -L` says
 * which module brings each directive, but only for the loaded ones -- which
 * are the ones that can be turned off. Kept for a minute, since the page asks
 * every 5s and walking the sites for .htaccess files is not free.
 */
let usedCache = { at : 0, data : new Set() };
async function readUsedModules() {
    if (Date.now() - usedCache.at < 60_000) {
        return usedCache.data;
    }
    const moduleOf = await readDirectives();
    // A filter can name a module that is off, as a site's DEFLATE does when
    // deflate_module is, and fails without it. An <IfModule> block is skipped
    // without its module by design, so it only counts for the loaded ones.
    const names    = new Set([ ...readFile(HTTPD_CONF).matchAll(/LoadModule\s+(\w+)/g) ].map((found) => found[1]));
    const loaded   = new Set(moduleOf.values());
    const files    = [ HTTPD_CONF, VHOSTS, ...findHtaccess(readVhosts().map((vhost) => vhost.root)) ];
    const used     = new Set();
    const use      = (name, from = names) => from.has(name) && used.add(name);
    for (const file of files) {
        for (const line of readFile(file).split("\n")) {
            // The first word of a line is its directive; <Tags> are directives too.
            const [ , directive, rest = "" ] = line.match(/^\s*<?(\w+)(.*)/) || [];
            if (!directive) {
                continue;
            }
            use(moduleOf.get(directive.toLowerCase()), loaded);
            if (/^IfModule$/i.test(directive)) {
                // <IfModule mod_deflate.c> or <IfModule deflate_module>, never <IfModule !…>
                const named = rest.match(/^\s+(?:mod_)?(\w+?)(?:\.c|_module)?\s*>/)?.[1];
                if (named) {
                    use(`${named}_module`, loaded);
                }
            }
            if (FILTER_DIRECTIVES.test(directive)) {
                for (const [ filter ] of rest.matchAll(/\b[A-Z][A-Z_]+\b/g)) {
                    use(FILTER_MODULES[filter] || `${filter.toLowerCase()}_module`);
                }
            }
        }
    }
    usedCache = { at : Date.now(), data : used };
    return used;
}

/**
 * Each directive of the loaded modules, lower-cased, with the module bringing
 * it. `httpd -L` names the module by its source file, like mod_rewrite.c or
 * prefork.c, which is matched to a LoadModule name: rewrite_module or
 * mpm_prefork_module. Core directives have no module to turn off.
 */
async function readDirectives() {
    const names    = new Set([ ...readFile(HTTPD_CONF).matchAll(/LoadModule\s+(\w+)/g) ].map((found) => found[1]));
    const moduleOf = new Map();
    for (const [ , directive, source ] of (await run(HTTPD, [ "-L" ])).stdout.matchAll(/^<?(\w+) \((\w+)\.c\)$/gm)) {
        const base = source.replace(/^mod_/, "");
        const name = [ `${base}_module`, `mpm_${base}_module` ].find((one) => names.has(one));
        if (name) {
            moduleOf.set(directive.toLowerCase(), name);
        }
    }
    return moduleOf;
}

/** The .htaccess files under the sites' folders, a few levels down, each once. */
function findHtaccess(roots, depth = 5) {
    const found = new Set();
    const walk  = (dir, level) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes : true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isFile() && entry.name === ".htaccess") {
                found.add(path.join(dir, entry.name));
            } else if (entry.isDirectory() && level < depth && !SKIPPED_DIRS.includes(entry.name)) {
                walk(path.join(dir, entry.name), level + 1);
            }
        }
    };
    for (const root of new Set(roots.filter(Boolean))) {
        walk(root, 1);
    }
    return [ ...found ];
}

/** The ports Apache listens on, from its Listen lines. */
function readListen() {
    return [ ...readFile(HTTPD_CONF).matchAll(/^Listen\s+(?:\S+:)?(\d+)/gm) ].map((found) => Number(found[1]));
}

/** The virtual hosts, from the vhosts file. */
function readVhosts() {
    const vhosts = [];
    const blocks = readFile(VHOSTS).matchAll(/<VirtualHost\s+[^:>]*:(\d+)>([\s\S]*?)<\/VirtualHost>/g);
    for (const [ , port, body ] of blocks) {
        const name = body.match(/^\s*ServerName\s+(\S+)/m)?.[1] || "localhost";
        const root = body.match(/^\s*DocumentRoot\s+"?([^"\n]+)"?/m)?.[1] || "";
        const ssl  = /^\s*SSLEngine\s+on/im.test(body);
        vhosts.push({
            name,
            port   : Number(port),
            root,
            ssl,
            url    : siteUrl(name, Number(port), ssl),
            exists : fs.existsSync(root),
        });
    }
    return vhosts;
}

function siteUrl(name, port, ssl) {
    const scheme      = ssl ? "https" : "http";
    const defaultPort = ssl ? 443 : 80;
    return `${scheme}://${name}${port === defaultPort ? "" : `:${port}`}/`;
}

/**
 * Turns a module on or off by commenting its LoadModule line. A backup is kept,
 * and the change is undone when Apache's config check fails, so a bad toggle
 * can never leave Apache unable to start.
 */
async function setModule(name, enabled) {
    if (!/^\w+$/.test(name)) {
        throw new Error("Invalid module name");
    }
    if (!enabled && PROTECTED_MODULES.includes(name)) {
        throw new Error(`${name} is needed by Apache itself`);
    }

    const original = readFile(HTTPD_CONF);
    const pattern  = new RegExp(`^#?\\s*(LoadModule\\s+${name}\\s)`, "m");
    if (!pattern.test(original)) {
        throw new Error(`${name} is not in httpd.conf`);
    }
    const updated = original.replace(pattern, `${enabled ? "" : "#"}$1`);

    fs.writeFileSync(`${HTTPD_CONF}.bak-studio`, original);
    fs.writeFileSync(HTTPD_CONF, updated);

    const check = await run(APACHE_CTL, [ "configtest" ]);
    if (!check.ok) {
        fs.writeFileSync(HTTPD_CONF, original);
        throw new Error(`Apache rejected the change, so it was undone: ${check.stderr.trim()}`);
    }

    // The loaded modules changed, and with them what httpd -L reports.
    usedCache.at = 0;
    const reload = await reloadApache();
    return { message : `${name} turned ${enabled ? "on" : "off"}. ${reload.message}` };
}

/**
 * Reloads Apache gracefully, so running requests finish first. Checks the
 * config before, since a graceful restart with a broken one stops Apache.
 */
async function reloadApache() {
    const services = await readServices();
    if (!services.httpd.running) {
        return { message : "Apache is not running, so it will pick this up when it starts." };
    }
    const check = await run(APACHE_CTL, [ "configtest" ]);
    if (!check.ok) {
        throw new Error(`Apache config has an error, so it was not reloaded: ${check.stderr.trim()}`);
    }
    await run(APACHE_CTL, [ "-k", "graceful" ]);
    return { message : "Apache reloaded." };
}

module.exports = {
    readModules,
    readListen,
    readVhosts,
    setModule,
    reloadApache,
};
