// The vhosts, as a project's form or the Sites page's own changes them, with what each needs
// to answer on its .local address: its blocks in the vhosts file, a certificate for https,
// and its name in the hosts file. The vhosts file stays the one record of them, comments and
// all.

import fs from "node:fs";
import path from "node:path";

import { PATHS, VHOSTS, run, readFile } from "../core/system.js";
import { expandHome } from "../core/paths.js";
import { readConfig } from "../core/config.js";
import { readVhosts, saveApacheFile } from "./apache.js";



// One <VirtualHost> with the line end after it, so taking it out leaves no empty line.
const BLOCK        = /<VirtualHost\s+[^:>]*:(\d+)>[\s\S]*?<\/VirtualHost>\n?/g;
const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const NEVER_DROP   = [ "localhost", "broadcasthost" ];



/**
 * A vhost as a project's form sends it: oldName and oldRoot say which it was, empty for a
 * new one; dir is its folder, as typed.
 * @typedef {{
 *     oldName: string, oldRoot: string, name: string, dir: string, https: boolean,
 * }} VhostForm
 */

/**
 * A vhost once checked: as the form's, with its folder in full.
 * @typedef {{
 *     oldName: string, oldRoot: string, name: string, root: string, https: boolean,
 * }} VhostRow
 */

/**
 * What one save does to the vhosts file: the vhosts to set, those to take out by their name
 * and folder, the section a new one goes in, and the folder its neighbours are in.
 * @typedef {{
 *     rows: VhostRow[], drops: { name: string, root: string }[], title: string, home: string,
 * }} VhostChange
 */



// --------------------------------------------------------------- one vhost ---

/**
 * Adds a vhost, or changes one, from the Sites page: one that is no project's, as a
 * project's are changed in its own form, which keeps the config in step.
 * @param {VhostForm} form
 * @returns {Promise<{ message: string }>}
 */
async function saveVhost(form) {
    const adding = !form.oldName;
    if (!adding) {
        checkLoose(form.oldName);
    }

    const name = String(form.name || "").trim().toLowerCase();
    const done = await saveVhosts({ forms : [ form ], drops : [], title : name, home : "" });
    if (!done) {
        return { message : "Nothing changed" };
    }

    return { message : `${adding ? "Added" : "Saved"} ${name}. ${done}` };
}

/**
 * Takes a vhost out, its http and https blocks both, and its name out of the hosts file. Its
 * folder and its certificate stay.
 * @param {{ name: string, root: string }} vhost
 * @returns {Promise<{ message: string }>}
 */
async function removeVhost({ name, root }) {
    checkLoose(name);

    const drops = [ { name, root } ];
    const done  = await saveVhosts({ forms : [], drops, title : "", home : "" });

    return { message : done ? `Removed ${name}. ${done}` : `${name} was not there` };
}

/**
 * Throws for a vhost the page may not change on its own: Apache's default, and a project's,
 * which its form changes, so the config never names a vhost that is gone.
 * @param {string} name
 * @returns {void}
 */
function checkLoose(name) {
    if (!HOST_PATTERN.test(name)) {
        throw new Error(`${name} is Apache's own, and stays`);
    }

    const owner = ownerOf(name);
    if (owner) {
        throw new Error(`${name} is ${owner}'s: change it in that project`);
    }
}

/**
 * The project a host name is of, as its own host or one of its sites, or "".
 * @param {string} name
 * @returns {string}
 */
function ownerOf(name) {
    const projects = readConfig().projects || [];
    const project  = projects.find((one) => one.host === name
        || (one.sites || []).some((site) => !site.command && site.host === name));

    return project ? project.name || project.dir || "a project" : "";
}


// ------------------------------------------------------------------ vhosts ---

/**
 * Sets a project's vhosts, and takes out the ones it no longer has: the certificates come
 * first, as Apache checks they are there; then the vhosts file, kept, checked and undone if
 * Apache will not have it, with a graceful
 * reload; and the hosts file last, once there is a vhost to point at. Without a change
 * nothing is touched, so saving a project's name never reloads Apache.
 * @param {{
 *     forms: VhostForm[], drops: { name: string, root: string }[], title: string,
 *     home: string,
 * }} change
 * @returns {Promise<string>} what happened, to tell, or "" when nothing did
 */
async function saveVhosts({ forms, drops, title, home }) {
    const rows = forms.map(cleanRow);

    checkHosts(rows);

    const before = readFile(VHOSTS);
    const after  = rewriteVhosts(before, { rows, drops, title, home });
    if (after === before) {
        return "";
    }

    for (const name of certsNeeded(before, rows)) {
        await makeCert(name);
    }

    const saved = await saveApacheFile("vhosts", after, "");
    const stale = [ ...rows.map((row) => row.oldName), ...drops.map((drop) => drop.name) ]
        .filter((name) => name && !namesIn(after).includes(name));
    const note  = updateHosts(rows.map((row) => row.name), stale);

    return [ saved.message, note ].filter(Boolean).join(" ");
}

/**
 * A form's vhost, checked, with its folder in full.
 * @param {VhostForm} form
 * @returns {VhostRow}
 */
function cleanRow(form) {
    const name = String(form.name || "").trim().toLowerCase();
    const root = expandHome(String(form.dir || "").trim()).replace(/(.)\/+$/, "$1");

    if (!HOST_PATTERN.test(name)) {
        throw new Error(`${name || "A vhost"} is not a host name, as shop.local`);
    }
    if (!root.startsWith("/") || !fs.existsSync(root)) {
        throw new Error(`There is no folder ${root || `for ${name}`}`);
    }

    return {
        oldName : String(form.oldName || ""),
        oldRoot : String(form.oldRoot || ""),
        name,
        root,
        https   : Boolean(form.https),
    };
}

/**
 * Throws when a host name is used twice: the second vhost would never answer.
 * @param {VhostRow[]} rows
 * @returns {void}
 */
function checkHosts(rows) {
    const names = rows.map((row) => row.name);
    const twice = names.find((name, at) => names.indexOf(name) !== at);
    if (twice) {
        throw new Error(`Two vhosts are called ${twice}`);
    }

    for (const row of rows) {
        const taken = readVhosts().find((vhost) => vhost.name === row.name
            && !rows.some((one) => one.oldName === vhost.name && one.oldRoot === vhost.root));
        if (taken) {
            throw new Error(`${row.name} is already the vhost of ${taken.root}`);
        }
    }
}

/**
 * The vhosts file with a change made: only the blocks of the vhosts changed are touched.
 * A block keeps whatever else it holds, and its certificate unless its name changes; a new
 * one goes after the project's others, or under a new section of its own.
 * @param {string} text
 * @param {VhostChange} change
 * @returns {string}
 */
function rewriteVhosts(text, { rows, drops, title, home }) {
    const had  = [ ...text.matchAll(BLOCK) ].map(([ block ]) => blockInfo(block));
    let result = text.replace(BLOCK, (block) => {
        const info = blockInfo(block);
        const row  = rows.find((one) => one.oldName === info.name && one.oldRoot === info.root);

        if (drops.some((drop) => drop.name === info.name && drop.root === info.root)) {
            return "";
        }
        if (!row) {
            return block;
        }

        return info.ssl && !row.https ? "" : retarget(block, info, row);
    });

    for (const row of rows) {
        const own = had.filter((one) => one.name === row.oldName && one.root === row.oldRoot);

        if (!own.some((one) => !one.ssl)) {
            result = addBlock(result, httpBlock(row), title, home || row.root);
        }
        if (row.https && !own.some((one) => one.ssl)) {
            result = addBlock(result, httpsBlock(row), title, home || row.root);
        }
    }

    return result;
}

/**
 * What a block says of itself.
 * @param {string} block
 * @returns {{ name: string, root: string, ssl: boolean }}
 */
function blockInfo(block) {
    return {
        name : block.match(/^\s*ServerName\s+(\S+)/m)?.[1] || "localhost",
        root : block.match(/^\s*DocumentRoot\s+"?([^"\n]+)"?/m)?.[1] || "",
        ssl  : /^\s*SSLEngine\s+on/im.test(block),
    };
}

/**
 * A block with its name and folder changed, and, when the name changes, its certificate.
 * @param {string} block
 * @param {{ name: string, root: string, ssl: boolean }} info
 * @param {VhostRow} row
 * @returns {string}
 */
function retarget(block, info, row) {
    const set = (key, value) => (text) => text.replace(
        new RegExp(`^(\\s*${key}\\s+).*$`, "m"),
        (line, start) => `${start}${value}`,
    );

    const steps = [ set("ServerName", row.name), set("DocumentRoot", `"${row.root}"`) ];
    if (info.ssl && row.name !== info.name) {
        steps.push(set("SSLCertificateFile", `"${certFile(row.name)}"`));
        steps.push(set("SSLCertificateKeyFile", `"${keyFile(row.name)}"`));
    }

    return steps.reduce((text, step) => step(text), block);
}

/**
 * The file with a new block in it: after the last one in the project's folder, or at the end
 * under the project's title.
 * @param {string} text
 * @param {string} block
 * @param {string} title
 * @param {string} home
 * @returns {string}
 */
function addBlock(text, block, title, home) {
    const last = [ ...text.matchAll(BLOCK) ]
        .filter((match) => isInside(blockInfo(match[0]).root, home)).at(-1);

    if (!last) {
        return `${text.replace(/\s*$/, "\n")}\n\n# ${title}\n${block}`;
    }

    const end = last.index + last[0].length;
    return `${text.slice(0, end)}${block}${text.slice(end)}`;
}

/**
 * A vhost's block for http, written as the file's own are.
 * @param {VhostRow} row
 * @returns {string}
 */
function httpBlock(row) {
    return [
        "<VirtualHost *:80>",
        `    ServerName ${row.name}`,
        `    DocumentRoot "${row.root}"`,
        "</VirtualHost>",
        "",
    ].join("\n");
}

/**
 * A vhost's block for https, written as the file's own are.
 * @param {VhostRow} row
 * @returns {string}
 */
function httpsBlock(row) {
    return [
        "<VirtualHost *:443>",
        `    ServerName ${row.name}`,
        `    DocumentRoot "${row.root}"`,
        "    SSLEngine on",
        `    SSLCertificateFile "${certFile(row.name)}"`,
        `    SSLCertificateKeyFile "${keyFile(row.name)}"`,
        "</VirtualHost>",
        "",
    ].join("\n");
}


// ------------------------------------------------------------ certificates ---

/**
 * The host names that need a certificate of their own: new to https, or renamed. One whose
 * block stays as it is keeps the certificate it has, shared or not.
 * @param {string} text the vhosts file before the change
 * @param {VhostRow[]} rows
 * @returns {string[]}
 */
function certsNeeded(text, rows) {
    const had = [ ...text.matchAll(BLOCK) ].map(([ block ]) => blockInfo(block));

    return rows.filter((row) => row.https && (row.name !== row.oldName || !had
        .some((one) => one.ssl && one.name === row.oldName && one.root === row.oldRoot)))
        .map((row) => row.name);
}

/**
 * Makes a host's certificate with mkcert, whose own authority the browsers here trust. One
 * that is there already is kept.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function makeCert(name) {
    if (fs.existsSync(certFile(name)) && fs.existsSync(keyFile(name))) {
        return;
    }

    fs.mkdirSync(PATHS.certs, { recursive : true });
    const made = await run("mkcert", [
        "-cert-file", certFile(name),
        "-key-file", keyFile(name),
        name,
    ], 60_000);

    if (!made.ok) {
        throw new Error(`The certificate of ${name} was not made, so nothing was saved: ${
            made.stderr.trim()
        }`);
    }
}

/**
 * Where a host's certificate goes.
 * @param {string} name
 * @returns {string}
 */
function certFile(name) {
    return path.join(PATHS.certs, `${name}.pem`);
}

/**
 * Where a host's certificate's key goes.
 * @param {string} name
 * @returns {string}
 */
function keyFile(name) {
    return path.join(PATHS.certs, `${name}-key.pem`);
}


// -------------------------------------------------------------------- hosts ---

/**
 * Points the new names at this Mac and forgets those no vhost uses any more. The vhosts are
 * saved by now, so a hosts file that cannot be written, as after a macOS update, is not
 * a failure: it says what is left to do.
 * @param {string[]} adds
 * @param {string[]} drops
 * @returns {string} what is left to do by hand, or ""
 */
function updateHosts(adds, drops) {
    try {
        const before = fs.readFileSync(PATHS.hosts, "utf8");
        const after  = rewriteHosts(before, adds, drops);
        if (after !== before) {
            fs.writeFileSync(PATHS.hosts, after);
        }
        return "";
    } catch {
        return `${PATHS.hosts} could not be written: add ${adds.join(", ")} to it by hand.`;
    }
}

/**
 * Points hosts that need no vhost at this Mac, as a server's, and forgets those no longer
 * used: a name a vhost still has stays. Nothing is written without a change.
 * @param {string[]} adds
 * @param {string[]} drops
 * @returns {string} what is left to do by hand, or ""
 */
function saveHosts(adds, drops) {
    const served = namesIn(readFile(VHOSTS));
    const gone   = drops.filter((name) => !served.includes(name));

    return adds.length || gone.length ? updateHosts(adds, gone) : "";
}

/**
 * The hosts file with names added to its 127.0.0.1 line and others taken off it. Every other
 * line, and the names on that one, stay as they are.
 * @param {string} text
 * @param {string[]} adds
 * @param {string[]} drops
 * @returns {string}
 */
function rewriteHosts(text, adds, drops) {
    const line = text.match(/^127\.0\.0\.1([ \t]+)(.*)$/m);
    if (!line) {
        return `${text.replace(/\s*$/, "\n")}127.0.0.1\t${adds.join(" ")}\n`;
    }

    const gone  = drops.filter((name) => !NEVER_DROP.includes(name) && !adds.includes(name));
    const kept  = line[2].trim().split(/\s+/).filter((name) => !gone.includes(name));
    const names = [ ...kept, ...adds.filter((name) => !kept.includes(name)) ];

    return text.replace(line[0], () => `127.0.0.1${line[1]}${names.join(" ")}`);
}


// ----------------------------------------------------------------- helpers ---

/**
 * The host names of a vhosts file's blocks.
 * @param {string} text
 * @returns {string[]}
 */
function namesIn(text) {
    return [ ...text.matchAll(BLOCK) ].map(([ block ]) => blockInfo(block).name);
}

/**
 * Whether a folder is another, or inside it.
 * @param {string} dir
 * @param {string} home
 * @returns {boolean}
 */
function isInside(dir, home) {
    return dir === home || dir.startsWith(`${home}/`);
}



// The public API
export {
    saveVhost,
    removeVhost,
    saveVhosts,
    saveHosts,
    rewriteVhosts,
    rewriteHosts,
};
