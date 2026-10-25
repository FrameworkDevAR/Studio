// Apache's modules, which of them the sites use, its vhosts, its config files and its reload.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { HTTPD, APACHE_CTL, HTTPD_CONF, VHOSTS, run, readFile } from "../core/system.js";
import { readServices } from "./services.js";



/**
 * Modules Apache cannot do without here. Turning one off would take PHP or
 * every site down, so the page does not offer it.
 */
const PROTECTED_MODULES = [
    "php_module",
    "mpm_prefork_module",
    "unixd_module",
    "authz_core_module",
];

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



/**
 * Each LoadModule line of httpd.conf, on or commented out.
 * @returns {Promise<{
 *     name: string, file: string, enabled: boolean, protected: boolean, used: boolean,
 * }[]>}
 */
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
        // By name alone, so a module keeps its place as it is turned on or off.
        .sort((a, b) => a.name.localeCompare(b.name));
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
/**
 * The names of the modules in use, kept for a minute.
 * @returns {Promise<Set<string>>}
 */
async function readUsedModules() {
    if (Date.now() - usedCache.at < 60_000) {
        return usedCache.data;
    }

    const moduleOf = await readDirectives();

    // A filter can name a module that is off, as a site's DEFLATE does when
    // deflate_module is, and fails without it. An <IfModule> block is skipped
    // without its module by design, so it only counts for the loaded ones.
    const names    = new Set([ ...readFile(HTTPD_CONF).matchAll(/LoadModule\s+(\w+)/g) ]
        .map((found) => found[1]));
    const loaded   = new Set(moduleOf.values());
    const files    = [
        HTTPD_CONF,
        VHOSTS,
        ...findHtaccess(readVhosts().map((vhost) => vhost.root)),
    ];
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
 * @returns {Promise<Map<string, string>>}
 */
async function readDirectives() {
    const names    = new Set([ ...readFile(HTTPD_CONF).matchAll(/LoadModule\s+(\w+)/g) ]
        .map((found) => found[1]));
    const moduleOf = new Map();

    const listed = await run(HTTPD, [ "-L" ]);
    for (const [ , directive, source ] of listed.stdout.matchAll(/^<?(\w+) \((\w+)\.c\)$/gm)) {
        const base = source.replace(/^mod_/, "");
        const name = [ `${base}_module`, `mpm_${base}_module` ].find((one) => names.has(one));
        if (name) {
            moduleOf.set(directive.toLowerCase(), name);
        }
    }

    return moduleOf;
}

/**
 * The .htaccess files under the sites' folders, a few levels down, each once.
 * @param {string[]} roots
 * @param {number=} depth
 * @returns {string[]}
 */
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

/**
 * The ports Apache listens on, from its Listen lines.
 * @returns {number[]}
 */
function readListen() {
    return [ ...readFile(HTTPD_CONF).matchAll(/^Listen\s+(?:\S+:)?(\d+)/gm) ]
        .map((found) => Number(found[1]));
}

/**
 * The virtual hosts, from the vhosts file.
 * @returns {{
 *     name: string, port: number, root: string, ssl: boolean, url: string, exists: boolean,
 * }[]}
 */
function readVhosts() {
    const vhosts = [];
    const blocks = readFile(VHOSTS)
        .matchAll(/<VirtualHost\s+[^:>]*:(\d+)>([\s\S]*?)<\/VirtualHost>/g);

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

/**
 * A site's address, its port left out when it is the scheme's own.
 * @param {string} name
 * @param {number} port
 * @param {boolean} ssl
 * @returns {string}
 */
function siteUrl(name, port, ssl) {
    const scheme      = ssl ? "https" : "http";
    const defaultPort = ssl ? 443 : 80;
    return `${scheme}://${name}${port === defaultPort ? "" : `:${port}`}/`;
}

/**
 * Turns a module on or off by commenting its LoadModule line. A backup is kept,
 * and the change is undone when Apache's config check fails, so a bad toggle
 * can never leave Apache unable to start.
 * @param {string} name
 * @param {boolean} enabled
 * @returns {Promise<{ message: string }>}
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
 * The config files httpd.conf includes, on or commented out: each with the
 * note above it, as httpd.conf has one for each, and the module it waits
 * for when inside an <IfModule>. A path of several files, with a *, cannot
 * be edited here.
 */
const INCLUDE_LINE = /^(\s*)(#?)\s*(Include(?:Optional)?)\s+"?([^"\s]+)"?\s*$/;
/**
 * Each Include line of httpd.conf, with its file, its note and its module.
 * @returns {{
 *     file: string, name: string, enabled: boolean, note: string, module: string,
 *     editable: boolean,
 * }[]}
 */
function readIncludes() {
    const text  = readFile(HTTPD_CONF);
    const lines = text.split("\n");
    const found = [];

    lines.forEach((line, index) => {
        const match = line.match(INCLUDE_LINE);
        if (!match) {
            return;
        }

        const [ , , hash, , written ] = match;

        // The notes above it, past an <IfModule> line, and a lone #.
        let above = index - 1;
        let module = "";
        const guard = lines[above]?.match(/^\s*<IfModule\s+!?([\w.]+)>/i);
        if (guard) {
            module = guard[1].replace(/^mod_|\.c$|_module$/g, "");
            above -= 1;
        }

        const note = lines[above]?.match(/^\s*#\s*([^#].*?)\s*$/)?.[1] || "";
        const file = includedPath(text, written);
        found.push({
            file,
            name     : path.basename(file),
            enabled  : hash === "",
            note     : /^(Include|LoadModule)\b/.test(note) ? "" : note,
            module,
            editable : !/[*?[]/.test(file) && fs.existsSync(file),
        });
    });

    return found;
}

/**
 * Where an Include line's path is: as written, or in ServerRoot when relative.
 * @param {string} text
 * @param {string} written
 * @returns {string}
 */
function includedPath(text, written) {
    const root = text.match(/^\s*ServerRoot\s+"?([^"\n]+?)"?\s*$/m)?.[1] || "";
    return path.isAbsolute(written) ? written : path.join(root, written);
}

/**
 * Turns an included config file on or off by commenting its Include line,
 * checked and undone as a module's change is, then Apache reloads.
 * @param {string} file
 * @param {boolean} enabled
 * @returns {Promise<{ message: string }>}
 */
async function setInclude(file, enabled) {
    const original = readFile(HTTPD_CONF);
    const lines    = original.split("\n");
    const index    = lines.findIndex((line) => line.match(INCLUDE_LINE)
        && includedPath(original, line.match(INCLUDE_LINE)[4]) === file);
    if (index === -1) {
        throw new Error(`${path.basename(String(file))} is not included in httpd.conf`);
    }

    lines[index] = lines[index].replace(INCLUDE_LINE, (line, lead, hash, directive, written) =>
        `${lead}${enabled ? "" : "#"}${directive} ${written}`);

    fs.writeFileSync(`${HTTPD_CONF}.bak-studio`, original);
    fs.writeFileSync(HTTPD_CONF, lines.join("\n"));

    const check = await run(APACHE_CTL, [ "configtest" ]);
    if (!check.ok) {
        fs.writeFileSync(HTTPD_CONF, original);
        throw new Error(`Apache rejected it, so it was undone: ${
            apacheProblems(check.stderr)[0] || "configtest failed"
        }`);
    }

    usedCache.at = 0;
    const reload = await reloadApache();
    return {
        message : `${path.basename(file)} turned ${enabled ? "on" : "off"}. ${reload.message}`,
    };
}

/**
 * The config files the page edits: httpd.conf, the vhosts, and any single
 * file httpd.conf includes, on or not -- never another file.
 * @param {string} kind
 * @param {string} file
 * @returns {string}
 */
function apacheFile(kind, file) {
    if (kind === "httpd") {
        return HTTPD_CONF;
    }
    if (kind === "vhosts") {
        return VHOSTS;
    }
    if (kind === "include" && readIncludes().some((one) => one.file === file && one.editable)) {
        return file;
    }
    throw new Error("Not a config file Apache includes");
}

/**
 * A config file, for the page's editor.
 * @param {string} kind
 * @param {string} file
 * @returns {{ file: string, exists: boolean, text: string }}
 */
function readApacheFile(kind, file) {
    const found = apacheFile(kind, file);
    return { file : found, exists : fs.existsSync(found), text : readFile(found) };
}

/**
 * What Apache says of a config file's text, before it is saved: httpd checks
 * a copy of its config with the text in place of the file -- for an included
 * one, httpd.conf including the copy instead, and on even when the file is
 * off, so it is known to work before it is turned on. Gives Apache's complaints,
 * with the copy's path put back as the file's name; none when it reads.
 * @param {string} kind
 * @param {string} text
 * @param {string} target
 * @returns {Promise<{ problems: string[] }>}
 */
async function checkApacheFile(kind, text, target) {
    const file = apacheFile(kind, target);
    if (typeof text !== "string" || text.length > 1_000_000) {
        throw new Error("The text is missing or too long");
    }

    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "studio-apache-"));

    try {
        const copy = path.join(folder, path.basename(file));
        fs.writeFileSync(copy, text);
        let conf = copy;

        if (file !== HTTPD_CONF) {
            conf = path.join(folder, "httpd.conf");
            const main     = readFile(HTTPD_CONF);
            const included = main.split("\n").map((line) => {
                const match = line.match(INCLUDE_LINE);
                return match && includedPath(main, match[4]) === file
                    ? `${match[1]}${match[3]} ${copy}`
                    : line;
            }).join("\n");
            fs.writeFileSync(conf, included === main ? `${main}\nInclude ${copy}\n` : included);
        }

        const check = await run(HTTPD, [ "-t", "-f", conf ]);
        if (check.ok) {
            return { problems : [] };
        }

        const problems = apacheProblems(check.stderr, copy, path.basename(file));
        return { problems : problems.length ? problems : [ "Apache does not take it" ] };
    } finally {
        fs.rmSync(folder, { recursive : true, force : true });
    }
}

/**
 * Apache's complaints, one per problem: without its AH codes and the lines
 * that only say the check failed, a copy's path named as its file, and
 * "Syntax error on line 12 of httpd.conf:" joined with its reason.
 * @param {string} stderr
 * @param {string=} copy
 * @param {string=} name
 * @returns {string[]}
 */
function apacheProblems(stderr, copy = "", name = "") {
    return stderr.split("\n")
        .map((line) => (copy ? line.split(copy).join(name) : line).replace(/^AH\d+:\s*/, "").trim())
        .filter((line) => line && line !== "Syntax OK" && !/^Action '-t' failed/.test(line)
            && !/^The Apache error log/.test(line)
            && !/Could not reliably determine the server's fully qualified domain name/.test(line))
        .reduce((list, line) => {
            if (list.length && list[list.length - 1].endsWith(":")) {
                list[list.length - 1] += ` ${line}`;
            } else {
                list.push(line);
            }
            return list;
        }, []);
}

/**
 * Saves a config file from the page's editor, once Apache takes it. The
 * previous one is kept beside it, and put back should Apache's own check
 * fail all the same; then Apache reloads.
 * @param {string} kind
 * @param {string} text
 * @param {string} target
 * @returns {Promise<{ message: string }>}
 */
async function saveApacheFile(kind, text, target) {
    const file      = apacheFile(kind, target);
    const { problems } = await checkApacheFile(kind, text, target);
    if (problems.length) {
        throw new Error(`Apache does not take it, so it was not saved: ${problems[0]}`);
    }

    const original = readFile(file);
    const content  = text.endsWith("\n") ? text : `${text}\n`;

    fs.writeFileSync(`${file}.bak-studio`, original);
    fs.writeFileSync(file, content);

    const check = await run(APACHE_CTL, [ "configtest" ]);
    if (!check.ok) {
        fs.writeFileSync(file, original);
        throw new Error(`Apache rejected the change, so it was undone: ${check.stderr.trim()}`);
    }

    usedCache.at = 0;
    const reload = await reloadApache();
    return { message : `Saved ${path.basename(file)}. ${reload.message}` };
}

/**
 * Reloads Apache gracefully, so running requests finish first. Checks the
 * config before, since a graceful restart with a broken one stops Apache.
 * @returns {Promise<{ message: string }>}
 */
async function reloadApache() {
    const services = await readServices();
    if (!services.httpd.running) {
        return { message : "Apache is not running, so it will pick this up when it starts." };
    }

    const check = await run(APACHE_CTL, [ "configtest" ]);
    if (!check.ok) {
        throw new Error(`Apache config has an error, so it was not reloaded: ${
            check.stderr.trim()
        }`);
    }

    await run(APACHE_CTL, [ "-k", "graceful" ]);
    return { message : "Apache reloaded." };
}



// The public API
export {
    readModules,
    readListen,
    readVhosts,
    setModule,
    reloadApache,
    readIncludes,
    setInclude,
    apacheFile,
    readApacheFile,
    checkApacheFile,
    saveApacheFile,
};
