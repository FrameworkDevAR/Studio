// The Sites page's form for the projects of the config and their servers: adding one,
// changing it, and taking it out. The apps are found in a project's folders, so a project
// only says where they are.

import { act, api } from "../core/api.js";
import { ask, esc, formDialog, icon, setActive, toast } from "../core/helpers.js";
import { state } from "../core/state.js";



/**
 * A server of a project, as the server sends it: one with no command is a site, whose folder
 * is its vhost's, and url what it opens.
 * @typedef {{
 *     id: string, name: string, host: string, dir: string, command: string, url: string,
 * }} ProjectServer
 */

/**
 * A project of the config, as the server sends it: its place in the config, its folder as
 * typed and in full, its servers and sites, and its host.
 * @typedef {{
 *     index: number, name: string, dir: string, home: string, worktrees: boolean,
 *     sites: ProjectServer[], host: string, https: boolean,
 * }} PageProject
 */



// ---------------------------------------------------------------- projects ---

/**
 * The dialog for a new project, or to change one, in tabs: its name, folder and host; and
 * its sites, which open in place, a server being one with a command. All of it is saved
 * together.
 * @param {number=} index the project's place in the config, none for a new one
 * @param {boolean=} adding whether it opens with a new server to fill in
 * @returns {void}
 */
function openProjectDialog(index = -1, adding = false) {
    const project = state.projects[index];
    const rows    = (project?.sites || []).map((site, at) => serverRow(site, at));

    const body = `
        <div class="project-form" data-project>
            <div class="segmented">
                <button type="button" class="active" data-project-tab="project">Project</button>
                <button type="button" data-project-tab="sites">Sites <em
                    data-server-count>${rows.length}</em></button>
            </div>
            <div class="project-pane" data-project-pane="project">
                <label class="form-row"><span>Name</span><input name="name"
                    value="${esc(project?.name || "")}" maxlength="80" placeholder="Shop"
                    spellcheck="false"></label>
                <label class="form-row"><span>Folder</span>${folderField(project?.dir || "",
                    "~/Projects/Shop", false)}</label>
                <div class="host-line">
                    <label class="form-row"><span>Host</span><input name="host"
                        value="${esc(project?.host || "")}" maxlength="120"
                        placeholder="shop.local" spellcheck="false"></label>
                    <label class="check"><input type="checkbox" class="box" name="https"
                        ${!project || project.https ? "checked" : ""}><span>HTTPS</span></label>
                </div>
                <span class="muted server-hint">Saving a host sets up its vhost, its line in
                    the hosts file and its certificate, then reloads Apache.</span>
            </div>
            <div class="project-pane" data-project-pane="sites" hidden>
                <span class="muted server-hint">With a command, the menu starts it in its
                    folder and opens it at its host, or localhost, on the port it listens on.
                    Without one, Apache serves the folder at the host; with no folder either,
                    the host is only a link.</span>
                <div class="server-rows" data-server-rows>${rows.join("")}</div>
                <button type="button" class="ghost small server-new"
                    data-server-new>${icon("plus")}Add site</button>
            </div>
        </div>
    `;

    formDialog({
        title  : project ? `Change ${projectTitle(project)}` : "New project",
        text   : project ? ""
            : "A folder of apps, each in a subfolder with a package.json, its own sites and " +
                "servers, or both.",
        body,
        ok     : project ? "Save" : "Add",
        remove : project ? { label : "Remove", run : () => removeProject(index) } : null,
        ready  : (fields) => {
            setUpServers(fields, !project);

            // After the dialog puts the focus on its first field, so it ends up here.
            if (adding) {
                requestAnimationFrame(() => {
                    showTab(fields, "sites");
                    addServer(fields);
                });
            }
        },
        submit : (form) => {
            const data = new FormData(form);
            return api("/api/action", {
                action  : "project-save",
                index,
                name    : data.get("name"),
                dir     : data.get("dir"),
                host    : data.get("host"),
                https   : data.has("https"),
                sites   : [ ...form.querySelectorAll(".server-row") ].map(readServer),
            });
        },
    });
}

/**
 * Takes a project out of the config once the user is sure. Gives whether it was.
 * @param {number} index
 * @returns {Promise<boolean>}
 */
async function removeProject(index) {
    const project = state.projects[index];
    const count   = project.sites.filter((site) => site.command).length;

    let servers = "";
    if (count === 1) {
        servers = " and its server";
    } else if (count) {
        servers = ` and its ${count} servers`;
    }

    const sure = await ask({
        title  : `Remove ${projectTitle(project)}?`,
        text   : `Studio and the menu no longer list its apps${servers}. Its folder and its ` +
            "vhosts stay as they are, and what runs keeps running.",
        ok     : "Remove",
        danger : true,
    });
    if (sure) {
        await act({ action : "project-remove", index });
    }

    return sure;
}

/**
 * What a project is called: its name, or its folder's.
 * @param {PageProject} project
 * @returns {string}
 */
function projectTitle(project) {
    return project.name || project.dir.split("/").filter(Boolean).at(-1) || "the project";
}


// ----------------------------------------------------------------- servers ---

/**
 * A server in the project's dialog, a line that opens in place: its name, its host, its
 * folder and its command, as typed in a shell. Without a command it is a site, which Apache
 * serves. data-old holds its place in the project's list, so the server knows which it was;
 * a new server's id is made from its name.
 * @param {ProjectServer=} server none for a new one
 * @param {number=} at its place in the project's list
 * @param {string=} dir a new one's folder
 * @returns {string}
 */
function serverRow(server, at = -1, dir = "") {
    return `
        <details class="fold server-row" data-old="${at >= 0 ? at : ""}" ${server ? "" : "open"}>
            ${foldHead(server?.name || "New site", server?.command || server?.host || "")}
            <div class="form-pair">
                <label class="form-row"><span>Name</span><input name="server-name"
                    value="${esc(server?.name || "")}" required maxlength="80"
                    placeholder="Shop Docs" spellcheck="false"></label>
                <label class="form-row"><span>Host</span><input name="server-host"
                    value="${esc(server?.host || "")}" maxlength="120"
                    placeholder="docs.shop.local" spellcheck="false"></label>
                <label class="form-row wide"><span>Folder</span>${folderField(
                    server?.dir || dir,
                    "~/Projects/Shop/docs",
                    false,
                    "server-dir",
                )}</label>
                <label class="form-row wide"><span>Command</span><input name="server-command"
                    value="${esc(server?.command || "")}" maxlength="2000"
                    placeholder="npm run dev --port=3000, or none for Apache to serve the folder"
                    spellcheck="false"
                    title="As in a shell: quote an argument that has spaces"></label>
            </div>
        </details>
    `;
}

/**
 * The head of a server's line: its title, a line under it, and its × button.
 * @param {string} title
 * @param {string} line
 * @returns {string}
 */
function foldHead(title, line) {
    return `
        <summary>
            <svg class="server-chevron" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
            <span class="server-title">
                <strong data-fold-title>${esc(title)}</strong>
                <small data-fold-line>${esc(line)}</small>
            </span>
            <button type="button" class="icon-btn" data-fold-drop title="Remove the site"
                aria-label="Remove the site"><svg viewBox="0 0 24 24"><path
                d="M6 6l12 12M18 6L6 18"/></svg></button>
        </summary>
    `;
}

/**
 * Makes the dialog's tabs and servers work in place: adding and taking out a line, its title
 * following what is typed. A line with something
 * missing shows, tab and all, or the browser could not point at the field it complains about.
 * The listeners go on the form's own box, as the dialog keeps its fields' element from one
 * opening to the next. A new project's host follows its folder until it is typed in.
 * @param {HTMLElement} fields
 * @param {boolean} adding whether the project is a new one
 * @returns {void}
 */
function setUpServers(fields, adding) {
    const box = fields.querySelector("[data-project]");
    let hostTyped = false;

    box.addEventListener("click", (event) => {
        const clicked = /** @type {Element} */ (event.target);
        const tab     = /** @type {HTMLElement|null} */ (clicked.closest("[data-project-tab]"));

        if (tab) {
            showTab(fields, tab.dataset.projectTab);
        } else if (clicked.closest("[data-server-new]")) {
            addServer(fields);
        } else if (clicked.closest("[data-fold-drop]")) {
            // The button is in the line's summary, which would toggle first.
            event.preventDefault();
            clicked.closest(".fold").remove();
            countServers(fields);
        }
    });

    box.addEventListener("input", (event) => {
        const field = /** @type {HTMLInputElement} */ (event.target);
        const row   = /** @type {HTMLElement|null} */ (field.closest(".fold"));
        if (row) {
            followRow(row);
        }
        if (field.name === "host") {
            hostTyped = true;
        }
        if (field.name === "dir" && adding && !hostTyped) {
            /** @type {HTMLInputElement} */ (fields.querySelector("[name=host]")).value =
                hostFrom(field.value);
        }
    });

    box.addEventListener("invalid", (event) => {
        const field = /** @type {Element} */ (event.target);
        const pane  = /** @type {HTMLElement} */ (field.closest("[data-project-pane]"));
        const row   = field.closest("details");

        showTab(fields, pane.dataset.projectPane);
        if (row) {
            row.open = true;
        }
    }, true);
}

/**
 * Shows one of the dialog's tabs.
 * @param {HTMLElement} fields
 * @param {string} tab "project" or "sites"
 * @returns {void}
 */
function showTab(fields, tab) {
    setActive(/** @type {HTMLElement} */ (fields.querySelector(`[data-project-tab="${tab}"]`)));

    for (const pane of /** @type {NodeListOf<HTMLElement>} */ (
        fields.querySelectorAll("[data-project-pane]")
    )) {
        pane.hidden = pane.dataset.projectPane !== tab;
    }
}

/**
 * Keeps the tab's count up with its servers and sites.
 * @param {HTMLElement} fields
 * @returns {void}
 */
function countServers(fields) {
    fields.querySelector("[data-server-count]").textContent = String(
        fields.querySelectorAll(".fold").length,
    );
}

/**
 * Adds a line for a new server, in the project's folder, and goes to its name.
 * @param {HTMLElement} fields
 * @returns {void}
 */
function addServer(fields) {
    const dir = /** @type {HTMLInputElement} */ (fields.querySelector("[name=dir]")).value;
    const row = serverRow(undefined, -1, dir);

    fields.querySelector("[data-server-rows]").insertAdjacentHTML("beforeend", row);
    countServers(fields);
    /** @type {HTMLElement} */ (
        fields.querySelector(".server-row:last-child [name=server-name]")
    ).focus();
}

/**
 * Keeps a line's title up with its fields: its name, and its command or else its host.
 * @param {HTMLElement} row
 * @returns {void}
 */
function followRow(row) {
    const server = readServer(row);

    row.querySelector("[data-fold-title]").textContent = server.name || "New site";
    row.querySelector("[data-fold-line]").textContent  = server.command.trim() || server.host;
}

/**
 * A line of the dialog as it is filled in, as the server takes it.
 * @param {Element} row
 * @returns {{ old: string, name: string, host: string, dir: string, command: string }}
 */
function readServer(row) {
    const value = (key) => /** @type {HTMLInputElement} */ (
        row.querySelector(`[name=server-${key}]`)
    ).value.trim();

    return {
        old     : /** @type {HTMLElement} */ (row).dataset.old,
        name    : value("name"),
        host    : value("host"),
        dir     : value("dir"),
        command : value("command"),
    };
}

/**
 * The host a folder suggests: ~/Projects/Shop gives shop.local.
 * @param {string} dir
 * @returns {string}
 */
function hostFrom(dir) {
    const words = dir.split("/").filter(Boolean).at(-1)?.toLowerCase().normalize("NFD")
        .replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    return words && words !== "~" ? `${words}.local` : "";
}


// ----------------------------------------------------------------- folders ---

/**
 * A folder's field, to type or paste a path in, with a button that picks one instead.
 * @param {string} dir
 * @param {string} placeholder
 * @param {boolean} required
 * @param {string=} name the field's name
 * @returns {string}
 */
function folderField(dir, placeholder, required, name = "dir") {
    return `
        <span class="folder">
            <input name="${name}" value="${esc(dir)}" ${required ? "required" : ""} maxlength="400"
                placeholder="${esc(placeholder)}" spellcheck="false">
            <button type="button" class="ghost small" data-pick-folder
                title="Pick it in a Finder dialog">${icon("folder")}Choose…</button>
        </span>
    `;
}

/**
 * Picks a folder in the Mac's own dialog, which the server opens, as a page is never told
 * where a picked file is. It starts at the folder in the field, and puts the one chosen
 * there; cancelling leaves the field as it was.
 * @param {HTMLButtonElement} button
 * @returns {Promise<void>}
 */
async function pickFolder(button) {
    const field = /** @type {HTMLInputElement} */ (button.parentElement.querySelector("input"));
    button.disabled = true;

    try {
        const { dir } = await api("/api/action", { action : "pick-folder", dir : field.value });
        if (dir) {
            field.value = dir;
            field.dispatchEvent(new Event("input", { bubbles : true }));
        }
    } catch (error) {
        toast(error.message, true);
    } finally {
        button.disabled = false;
        field.focus();
    }
}




// The public API
export {
    openProjectDialog,
    projectTitle,
    pickFolder,
};
