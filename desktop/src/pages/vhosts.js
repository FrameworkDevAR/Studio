// The Sites page's vhosts: cards of them, listed and never requested, and the form that
// adds, changes and removes one. A project's own are changed in its form instead, which
// keeps the config in step with the vhosts file.

import { act, api } from "../core/api.js";
import { ask, esc, formDialog, icon, shortPath } from "../core/helpers.js";
import { state } from "../core/state.js";
import { folderField, openProjectDialog, projectTitle } from "./projects.js";

/** @import { PageProject } from "./projects.js" */



/**
 * A vhost as the server sends it: one block of the vhosts file.
 * @typedef {{
 *     name: string, port: number, root: string, ssl: boolean, url: string, exists: boolean,
 * }} PageVhost
 */

/**
 * A vhost's card: a name and its folder, with the blocks that serve it over http and https,
 * and the project it is of, if any.
 * @typedef {{
 *     name: string, root: string, exists: boolean, http: PageVhost|null,
 *     https: PageVhost|null, project: PageProject|undefined,
 * }} VhostRow
 */



// ------------------------------------------------------------------- cards ---

/**
 * The vhosts as cards, as the databases are: one per name and folder, with a link for each
 * way it is served, the project it is of, and its buttons.
 * @returns {void}
 */
function renderVhosts() {
    const rows = vhostRows();

    document.getElementById("vhost-count").textContent = String(rows.length);
    document.getElementById("vhost-list").innerHTML = rows.map(vhostCard).join("")
        || `<div class="pkg-none">No vhosts yet.</div>`;
}

/**
 * The cards: a vhost's http and https blocks together, by name and folder.
 * @returns {VhostRow[]}
 */
function vhostRows() {
    const rows = new Map();

    for (const vhost of /** @type {PageVhost[]} */ (state.vhosts)) {
        const key = `${vhost.name}:${vhost.ssl ? 80 : vhost.port}:${vhost.root}`;
        const row = rows.get(key) || {
            name    : vhost.name,
            root    : vhost.root,
            exists  : vhost.exists,
            http    : null,
            https   : null,
            project : ownerOf(vhost.name),
        };

        row[vhost.ssl ? "https" : "http"] = vhost;
        rows.set(key, row);
    }

    return [ ...rows.values() ];
}

/**
 * One card: a tile that opens the site, over https when it can, with a lock then and a
 * globe otherwise; its name and folder, marked when the folder is gone; its buttons, on
 * hover; and under them its links and its project.
 * @param {VhostRow} row
 * @returns {string}
 */
function vhostCard(row) {
    const main = row.https || row.http;
    const port = row.http && row.http.port !== 80
        ? `<span class="muted">:${row.http.port}</span>` : "";

    return `
        <div class="db-card vhost-card">
            <div class="db-card-head">
                <a class="db-icon vhost-open ${row.https ? "secure" : ""}"
                    href="${esc(main.url)}" target="_blank" rel="noopener"
                    title="Open ${esc(main.url)}" aria-label="Open ${esc(row.name)}">${
                    icon(row.https ? "lock" : "globe")}${icon("external")}</a>
                <span class="db-title">
                    <a class="db-name" href="${esc(main.url)}" target="_blank"
                        rel="noopener">${esc(row.name)}${port}</a>
                    <small title="${esc(row.root)}">${esc(shortPath(row.root))}${row.exists
                        ? "" : ` <span class="badge bad">missing</span>`}</small>
                </span>
                <span class="db-actions">${vhostButtons(row)}</span>
            </div>
            <div class="db-foot">
                <span class="vhost-links">${schemeLink(row.http)}${schemeLink(row.https)}</span>
                ${row.project ? `<span class="tag" title="${esc(projectTitle(row.project))}">${
                    esc(projectTitle(row.project))}</span>` : ""}
            </div>
        </div>
    `;
}

/**
 * A chip that opens a vhost the way it is served, or nothing when it is not: a globe for
 * http, a lock for https.
 * @param {PageVhost|null} vhost
 * @returns {string}
 */
function schemeLink(vhost) {
    if (!vhost) {
        return "";
    }

    return `<a class="vhost-link ${vhost.ssl ? "secure" : ""}" href="${esc(vhost.url)}"
        target="_blank" rel="noopener" title="Open ${esc(vhost.url)}">${
        icon(vhost.ssl ? "lock" : "globe")}${vhost.ssl ? "HTTPS" : "HTTP"}</a>`;
}

/**
 * A card's buttons: a project's vhost opens its project, as that is where it is changed; one
 * on localhost, which has no host name of its own, opens the vhosts file; another has its
 * own edit and remove.
 * @param {VhostRow} row
 * @returns {string}
 */
function vhostButtons(row) {
    if (row.project) {
        return `<button class="icon-btn" data-project-edit="${row.project.index}"
            title="Change it in ${esc(projectTitle(row.project))}"
            aria-label="Change ${esc(row.name)}">${icon("pencil")}</button>`;
    }
    if (onLocalhost(row)) {
        return `<button class="icon-btn" data-edit-apache="vhosts"
            title="Change it in the vhosts file"
            aria-label="Change ${esc(row.name)}">${icon("file")}</button>`;
    }

    const which = `data-vhost-root="${esc(row.root)}"`;
    return `
        <button class="icon-btn" data-vhost-edit="${esc(row.name)}" ${which}
            title="Change it" aria-label="Change ${esc(row.name)}">${icon("pencil")}</button>
        <button class="icon-btn remove" data-vhost-remove="${esc(row.name)}" ${which}
            title="Remove it" aria-label="Remove ${esc(row.name)}">${icon("trash")}</button>
    `;
}


// -------------------------------------------------------------------- form ---

/**
 * Opens the form of a vhost, to change it, or of a new one: its host, its folder and
 * whether it is served over https too. Changing one may remove it, or make it a project.
 * @param {string=} name
 * @param {string=} root
 * @returns {void}
 */
function openVhostDialog(name = "", root = "") {
    const row = vhostRows().find((one) => one.name === name && one.root === root);

    formDialog({
        title  : row ? `Change ${row.name}` : "New vhost",
        text   : row ? "" : "A site Apache serves from a folder, at a .local address.",
        body   : `
            <label class="form-row"><span>Host</span><input name="name"
                value="${esc(row?.name || "")}" required maxlength="120"
                placeholder="shop.local" spellcheck="false"></label>
            <label class="form-row"><span>Folder</span>${folderField(
                row ? shortPath(row.root) : "", "~/Sites/shop", true)}</label>
            <label class="check"><input type="checkbox" class="box" name="https"
                ${!row || row.https ? "checked" : ""}><span>HTTPS</span></label>
            <span class="muted server-hint">Saving sets up its vhost, its line in the hosts
                file and, for https, its certificate, then reloads Apache.</span>
            ${row ? projectSection(row) : ""}
        `,
        ok     : row ? "Save" : "Add",
        remove : row ? { label : "Remove", run : () => removeVhost(row.name, row.root) } : null,
        submit : (form) => {
            const data = new FormData(form);
            return api("/api/action", {
                action  : "vhost-save",
                oldName : row?.name || "",
                oldRoot : row?.root || "",
                name    : data.get("name"),
                dir     : data.get("dir"),
                https   : data.has("https"),
            });
        },
    });
}

/**
 * The foot of a vhost's form, set apart from its own fields: it is no project's, and may
 * join one as a site, or be made a project of its own.
 * @param {VhostRow} row
 * @returns {string}
 */
function projectSection(row) {
    const which    = `data-vhost-name="${esc(row.name)}" data-vhost-root="${esc(row.root)}"`;
    const projects = /** @type {PageProject[]} */ (state.projects);
    const options  = projects.map((project) => `<option value="${project.index}">${
        esc(projectTitle(project))}</option>`).join("");

    return `
        <section class="vhost-project">
            <h3>Project</h3>
            <p class="muted">It is no project's. In one, it is listed with the project's apps
                and changed in its dialog; the vhost stays as it is.</p>
            ${projects.length ? `<div class="vhost-join">
                <span class="field select"><select name="join"
                    aria-label="The project to add it to">${options}</select></span>
                <button type="button" class="ghost" data-vhost-join ${which}>${
                    icon("plus")}Add to it</button>
            </div>` : ""}
            <button type="button" class="ghost vhost-new-project" data-vhost-project
                ${which}>${icon("grid")}Make it a new project</button>
        </section>
    `;
}

/**
 * Removes a vhost once the user is sure. Gives whether it was.
 * @param {string} name
 * @param {string} root
 * @returns {Promise<boolean>}
 */
async function removeVhost(name, root) {
    const sure = await ask({
        title  : `Remove ${name}?`,
        text   : "Its blocks go from the vhosts file and its name from the hosts file, then " +
            "Apache reloads. Its folder and its certificate stay.",
        ok     : "Remove",
        danger : true,
    });
    if (sure) {
        await act({ action : "vhost-remove", name, root });
    }

    return sure;
}


/**
 * Opens a new project made from a vhost: its folder, its host and whether over https, and a
 * name from the host's first word, as Turnos for turnos.cnsi.local. Saving it takes the
 * vhost as the project's own, leaving the vhosts file as it is.
 * @param {string} name
 * @param {string} root
 * @returns {void}
 */
function makeProject(name, root) {
    const row = vhostRows().find((one) => one.name === name && one.root === root);

    // The vhost's form is the dialog the project's opens in, so it closes first.
    /** @type {HTMLDialogElement} */ (document.getElementById("form")).close();

    openProjectDialog(-1, false, {
        name  : titleOf(name),
        dir   : shortPath(root),
        host  : name,
        https : Boolean(row?.https),
    });
}


/**
 * Opens a project picked in a vhost's form at its sites, with the vhost as a new site of it
 * to look over before saving: its name from the host's first word, its host and folder.
 * Saving takes the vhost as the site's own.
 * @param {HTMLElement} button
 * @returns {void}
 */
function joinProject(button) {
    const pick = /** @type {HTMLSelectElement} */ (
        button.closest(".vhost-project").querySelector("select[name=join]")
    );
    const { vhostName : name = "", vhostRoot : root = "" } = button.dataset;

    /** @type {HTMLDialogElement} */ (document.getElementById("form")).close();
    openProjectDialog(Number(pick.value), true, {
        site : { name : titleOf(name), host : name, dir : shortPath(root) },
    });
}


// ----------------------------------------------------------------- helpers ---

/**
 * The project a host name is of, as its own host or one of its sites.
 * @param {string} name
 * @returns {PageProject|undefined}
 */
function ownerOf(name) {
    return /** @type {PageProject[]} */ (state.projects).find((project) => project.host === name
        || project.sites.some((site) => !site.command && site.host === name));
}

/**
 * A name from a host's first word, as Turnos for turnos.cnsi.local.
 * @param {string} host
 * @returns {string}
 */
function titleOf(host) {
    const word = host.split(".")[0];
    return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Whether a row is on localhost, or another name with no dot, which the form's host name
 * cannot be: only the file changes it.
 * @param {VhostRow} row
 * @returns {boolean}
 */
function onLocalhost(row) {
    return !row.name.includes(".");
}



// The public API
export {
    renderVhosts,
    openVhostDialog,
    removeVhost,
    makeProject,
    joinProject,
};
