// The Databases page: the databases, the users that reach them, and MariaDB's
// options, with the dialogs that create, change and drop the first two.

import { act, api } from "../core/api.js";
import { ask, bytes, esc, formDialog, setActive, toast } from "../core/helpers.js";
import { dbTab } from "../core/routes.js";
import { OPTION_GROUPS, settingsKeys, state } from "../core/state.js";
import { renderBrowseHead } from "../database/page.js";
import { renderSettingGroups } from "./settings.js";
import { hostSelect, passwordField, privilegeSummary } from "./users.js";



/**
 * A database as the page lists it, as the server reads it.
 * @typedef {import("../../../backend/database/databases.js").DatabaseEntry} DbPageEntry
 */

/**
 * A user as the server reads it, one per host.
 * @typedef {import("../../../backend/database/databases.js").DatabaseUser} DbPageUser
 */

/**
 * A user as the page lists it: its name@host, and the hosts an admin has.
 * @typedef {DbPageUser & { key: string, hosts: string[] }} DbPageAccount
 */

/**
 * A character set of MariaDB's, with its collations and the one it uses unless told.
 * @typedef {{ name: string, description: string, collations: string[],
 *     collation: string }} DbPageCharset
 */



/**
 * The page: MariaDB's version, the counts on the tabs, then the databases,
 * the users and the options.
 * @returns {void}
 */
function renderDatabases() {
    const { databases, mariadb, phpmyadmin } = state;
    /** @type {HTMLAnchorElement} */ (document.getElementById("phpmyadmin-link")).href
        = phpmyadmin.url;
    /** @type {HTMLAnchorElement} */ (document.getElementById("phpmyadmin-users-link")).href
        = `${phpmyadmin.url}/index.php?route=/server/privileges`;

    document.getElementById("db-version").textContent = mariadb.version
        ? `MariaDB ${mariadb.version}` : "";
    document.getElementById("db-problem").hidden       = databases.available;
    document.getElementById("tab-db-count").textContent     = databases.available
        ? String(databases.list.length) : "";
    document.getElementById("tab-user-count").textContent   = databases.available
        ? String(accountRows().length) : "";
    document.getElementById("tab-option-count").textContent = mariadb.available
        ? String(mariadb.settings.filter((option) => option.inFile).length
            + mariadb.overrides.length)
        : "";

    renderDbText();
    renderBrowseHead();
    renderDbList();
    renderUsers();

    if (mariadb.available) {
        renderSettingGroups("mariadb", OPTION_GROUPS, mariadb.settings, mariadb.overrides);
    } else {
        document.getElementById("db-options").innerHTML = "";
        settingsKeys.mariadb = "";
    }
}

/**
 * The line under the title, about the tab shown.
 * @returns {void}
 */
function renderDbText() {
    const file = state.mariadb.file.split("/").pop();
    document.getElementById("db-text").innerHTML = {
        databases : "MariaDB on port 3306. Sizes include indexes and refresh every 30 seconds; " +
            "a name opens its tables.",
        users     : "The users the sites log in as: the databases each reaches, and what it may " +
            "do there. root and your own user look after MariaDB, so they are left to phpMyAdmin.",
        options   : `Values saved here go to
            <code title="${esc(state.mariadb.file)}">${esc(file)}</code>, which MariaDB reads after
            <code>my.cnf</code>, so they win over it. MariaDB checks them first; the ones it can
            change as it runs apply at once, and the rest restart it.`,
    }[dbTab()];
}

/**
 * The databases, as cards: the name, which opens it in phpMyAdmin, its
 * tables and size, with a bar against the largest, its encoding, and its
 * users. An encoding other than utf8mb4 is marked, as it cannot hold every
 * character, emoji among them.
 * @returns {void}
 */
function renderDbList() {
    const { databases } = state;
    const search  = /** @type {HTMLInputElement} */ (document.getElementById("db-filter")).value
        .trim().toLowerCase();
    const list    = databases.list.filter((db) => !search
        || db.name.toLowerCase().includes(search)
        || db.users.some((user) => user.toLowerCase().includes(search)));
    const total   = databases.list.reduce((sum, db) => sum + db.size, 0);
    const largest = Math.max(1, ...databases.list.map((db) => db.size));

    document.getElementById("db-total").textContent = databases.available
        ? `${databases.list.length} · ${bytes(total)}` : "";
    document.getElementById("db-list").innerHTML = !databases.available
        ? `<div class="pkg-none">MariaDB is not running.</div>`
        : list.map((db) => `
            <div class="db-card">
                <div class="db-card-head">
                    <span class="db-icon"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5"
                        rx="7.5" ry="3"/><path
                        d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13"/><path
                        d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg></span>
                    <span class="db-title">
                        <a class="db-name" href="/database/${encodeURIComponent(db.name)}"
                            title="Open its tables">${esc(db.name)}</a>
                        <small>${db.tables === 1 ? "1 table" : `${db.tables} tables`}
                            · ${bytes(db.size)}</small>
                    </span>
                    <span class="db-actions">
                        <button class="icon-btn" data-db-edit="${esc(db.name)}"
                            title="Change its encoding and users"
                            aria-label="Edit ${esc(db.name)}"><svg viewBox="0 0 24 24"><path
                            d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>
                        <button class="icon-btn remove" data-db-drop="${esc(db.name)}"
                            title="Drop it" aria-label="Drop ${esc(db.name)}"><svg
                            viewBox="0 0 24 24"><path
                            d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
                    </span>
                </div>
                <div class="meter"><div
                    style="width:${Math.max(2, (db.size / largest) * 100)}%"></div></div>
                <div class="db-foot">
                    <span class="db-encoding" title="${db.charset.startsWith("utf8mb4") ? ""
                        : "Not utf8mb4: some characters, emoji among them, do not fit"}">
                        <span class="tag ${db.charset.startsWith("utf8mb4") ? ""
                            : "amber"}">${esc(db.charset)}</span>
                        <span class="db-collation"
                            title="${esc(db.collation)}">${esc(db.collation
                                .replace(`${db.charset}_`, ""))}</span>
                    </span>
                    <span class="db-people">${db.users.map((key) => `<button class="db-user"
                        data-user-edit="${esc(key)}"
                        title="Change ${esc(key)}">${esc(key.replace(/@[^@]*$/, ""))}</button>`)
                        .join("") || `<span class="muted">No user</span>`}</span>
                </div>
            </div>
        `).join("")
            || `<div class="pkg-none">No database has “${esc(search)}” in its name or
                users.</div>`;
}

/**
 * The users, as cards like the databases': the name, which opens it to
 * change, its hosts, the databases it reaches and what it may do there.
 * root, on its three hosts, and Studio's own user show as one card each,
 * without buttons, as they look after MariaDB.
 * @returns {void}
 */
function renderUsers() {
    const search = /** @type {HTMLInputElement} */ (document.getElementById("user-filter")).value
        .trim().toLowerCase();
    const rows   = accountRows().filter((user) => !search
        || user.name.toLowerCase().includes(search)
        || user.databases.some((db) => db.toLowerCase().includes(search)));
    const pencil = `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path
        d="M13.5 6.5l4 4"/></svg>`;
    const bin    = `<svg viewBox="0 0 24 24"><path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;

    document.getElementById("user-count").textContent = state.databases.available
        ? String(accountRows().length) : "";
    document.getElementById("db-users").innerHTML = !state.databases.available
        ? `<div class="pkg-none">MariaDB is not running.</div>`
        : rows.map((user) => {
            const summary = privilegeSummary(user);
            return `
                <div class="db-card user-card ${user.admin ? "admin" : ""}">
                    <div class="db-card-head">
                        <span class="user-badge">${esc(user.name.slice(0, 1).toUpperCase())}</span>
                        <span class="db-title">
                            ${user.admin
                                ? `<span class="db-name">${esc(user.name)}</span>`
                                : `<button class="db-name" data-user-edit="${esc(user.key)}"
                                    title="Change it">${esc(user.name)}</button>`}
                            <small>@${esc(user.hosts.join(", "))}</small>
                        </span>
                        ${user.admin
                            ? `<span class="tag" title="Looks after MariaDB">admin</span>` : `
                            <span class="db-actions">
                                <button class="icon-btn" data-user-edit="${esc(user.key)}"
                                    title="Change it"
                                    aria-label="Edit ${esc(user.name)}">${pencil}</button>
                                <button class="icon-btn remove" data-user-drop="${esc(user.key)}"
                                    title="Drop it"
                                    aria-label="Drop ${esc(user.name)}">${bin}</button>
                            </span>
                        `}
                    </div>
                    <dl class="user-facts">
                        <dt>Reaches</dt>
                        <dd>${user.all ? `<span class="db-user">All databases</span>`
                            : user.databases.map((db) => `<span class="db-user">${esc(db)}</span>`)
                                .join("") || `<span class="muted">No database</span>`}</dd>
                        <dt>May</dt>
                        <dd><span class="db-user ${summary.tone}"
                            title="${esc(user.privileges.join(", "))}">${esc(
                                summary.text)}</span></dd>
                    </dl>
                </div>
            `;
        }).join("")
            || `<div class="pkg-none">No user has “${esc(search)}” in its name or
                databases.</div>`;
}

/**
 * The users as the page lists them: the admins one line per name, every other one per host.
 * @returns {DbPageAccount[]}
 */
function accountRows() {
    const rows = [];

    for (const user of state.databases.users) {
        const key  = `${user.name}@${user.host}`;
        const same = user.admin && rows.find((row) => row.admin && row.name === user.name);
        if (same) {
            same.hosts.push(user.host);
        } else {
            rows.push({ ...user, key, hosts : [ user.host ] });
        }
    }

    return rows;
}

// --------------------------------------------------------------- databases ---

/** The character sets and their collations, asked once, when a dialog first needs them. */
let charsetList = null;
/**
 * The character sets, from the server the first time, then as kept.
 * @returns {Promise<DbPageCharset[]>}
 */
async function loadCharsets() {
    if (!charsetList) {
        charsetList = await api("/api/charsets");
    }

    return charsetList;
}

/**
 * The dialog for a new database, or to change one: its name, which MariaDB
 * cannot change later, its encoding, and its users. A new one can have a
 * user made for it, named after it, with a password made up, or be given
 * to one there already.
 * @param {string=} name
 * @returns {Promise<void>}
 */
async function openDatabaseDialog(name = "") {
    let charsets;
    try {
        charsets = await loadCharsets();
    } catch (error) {
        toast(error.message, true);
        return;
    }

    const { databases } = state;
    const db       = databases.list.find((one) => one.name === name);
    const accounts = state.databases.users.filter((user) => !user.admin);
    const charset  = db?.charset || databases.charset;

    let convertField = "";
    if (db?.tables) {
        convertField = `
            <label class="check" id="db-convert" hidden>
                <input type="checkbox" class="box" name="convert">
                <span>Convert its ${db.tables === 1 ? "table" : `${db.tables} tables`}
                    too<small>MariaDB gives the new encoding to new tables only</small></span>
            </label>
        `;
    }

    const body = `
        <label class="form-row">
            <span>Name</span>
            <input name="name" value="${esc(name)}"
                ${db ? "readonly title=\"MariaDB cannot rename a database\"" : ""} required
                maxlength="64" pattern="[\\w$\\-]+" placeholder="shop" spellcheck="false">
        </label>
        <div class="form-pair">
            <label class="form-row">
                <span>Character set</span>
                <span class="field select"><select name="charset">${charsets.map((one) => `<option
                    value="${esc(one.name)}" title="${esc(one.description)}"
                    ${one.name === charset ? "selected" : ""}>${esc(one.name)}</option>`)
                    .join("")}</select></span>
            </label>
            <label class="form-row">
                <span>Collation</span>
                <span class="field select"><select name="collation"></select></span>
            </label>
        </div>
        ${convertField}
        ${db ? databaseUsersField(db, accounts) : newUserField(accounts)}
    `;

    formDialog({
        title  : db ? `Change ${db.name}` : "New database",
        text   : db ? "" : "A database for a site, and the user it logs in as.",
        body,
        ok     : db ? "Save" : "Create",
        ready  : (fields) => setUpDatabaseFields(fields, db),
        submit : (form) => {
            const data = new FormData(form);
            const set  = String(data.get("charset"));
            const sort = String(data.get("collation"));

            if (db) {
                const changed = set !== db.charset || sort !== db.collation;
                return api("/api/action", {
                    action    : "db-change",
                    name      : db.name,
                    charset   : changed ? set : "",
                    collation : changed ? sort : "",
                    convert   : changed && data.get("convert") === "on",
                    users     : data.getAll("users"),
                });
            }

            const mode = /** @type {HTMLElement} */ (form.querySelector("[data-user-mode].active"))
                ?.dataset.userMode || "none";

            let user = null;
            if (mode === "new") {
                user = {
                    mode,
                    name     : data.get("user"),
                    host     : data.get("host"),
                    password : data.get("password"),
                };
            } else if (mode === "existing") {
                user = { mode, account : data.get("account") };
            }

            return api("/api/action", {
                action    : "db-create",
                name      : data.get("name"),
                charset   : set,
                collation : sort,
                user,
            });
        },
    });
}

/**
 * Who may use a database: a box for each user given databases one by one.
 * The ones that reach every database are only named under it, as they are
 * changed in Users.
 * @param {DbPageEntry} db
 * @param {DbPageUser[]} accounts
 * @returns {string}
 */
function databaseUsersField(db, accounts) {
    const some = accounts.filter((user) => !user.all);
    const all  = accounts.filter((user) => user.all);

    let others = "";
    if (some.length && all.length) {
        others = `<small class="form-note">${all.length === 1
            ? `${esc(all[0].name)} reaches` : `${all.length} more users reach`} every database,
            this one among them.</small>`;
    }

    return `
        <div class="form-row">
            <span>Users</span>
            ${some.length ? `
                <div class="check-list">
                    ${some.map((user) => `
                        <label class="check">
                            <input type="checkbox" class="box" name="users"
                                value="${esc(`${user.name}@${user.host}`)}"
                                ${user.databases.includes(db.name) ? "checked" : ""}>
                            <span>${esc(user.name)}<small>@${esc(user.host)}</small></span>
                        </label>
                    `).join("")}
                </div>
            ` : `<small class="form-note">Every user reaches all databases, this one among them.
                Give one only some in Users, and it can be ticked here.</small>`}
            ${others}
        </div>
    `;
}

/**
 * A new database's user: none, a new one, or one there already.
 * @param {DbPageUser[]} accounts
 * @returns {string}
 */
function newUserField(accounts) {
    return `
        <div class="form-row">
            <span>User</span>
            <div class="segmented">
                <button type="button" data-user-mode="new" class="active">New user</button>
                <button type="button" data-user-mode="existing"
                    ${accounts.length ? "" : "disabled"}>Existing user</button>
                <button type="button" data-user-mode="none">None</button>
            </div>
        </div>
        <div class="form-pair" data-mode-pane="new">
            <label class="form-row"><span>User name</span><input name="user" required maxlength="80"
                pattern="[\\w.$\\-]+" placeholder="shop_user" spellcheck="false" data-auto></label>
            <label class="form-row"><span>Host</span>${hostSelect("localhost")}</label>
            ${passwordField(true)}
        </div>
        <div data-mode-pane="existing" hidden>
            <label class="form-row">
                <span>User</span>
                <span class="field select"><select name="account">${accounts.map((user) => `<option
                    value="${esc(`${user.name}@${user.host}`)}">${esc(user.name)}@${esc(
                        user.host)}</option>`)
                    .join("")}</select></span>
            </label>
        </div>
    `;
}

/**
 * The fields' listeners: the collations follow the character set, the
 * conversion is offered once the encoding changes, and a new user's name
 * follows the database's, as shop_user, until it is typed over.
 * @param {HTMLElement} fields
 * @param {DbPageEntry} db
 * @returns {void}
 */
function setUpDatabaseFields(fields, db) {
    const set     = /** @type {HTMLSelectElement} */ (fields.querySelector("[name=charset]"));
    const sort    = /** @type {HTMLSelectElement} */ (fields.querySelector("[name=collation]"));
    const convert = fields.querySelector("#db-convert");
    // A collation kept across character sets by its kind, as general_ci.
    const fill    = (wanted) => {
        const one  = charsetList.find((item) => item.name === set.value);
        const kind = wanted.replace(/^[^_]+_/, "");
        const pick = one.collations.includes(wanted) ? wanted
            : one.collations.find((name) => name === `${one.name}_${kind}`) || one.collation;
        sort.innerHTML = one.collations
            .map((name) => `<option ${name === pick ? "selected" : ""}>${esc(name)}</option>`)
            .join("");
    };
    const changed = () => {
        if (convert) {
            /** @type {HTMLElement} */ (convert).hidden = set.value === db.charset
                && sort.value === db.collation;
        }
    };

    fill(db?.collation || (set.value === state.databases.charset ? state.databases.collation : ""));
    set.addEventListener("change", () => {
        fill(sort.value);
        changed();
    });
    sort.addEventListener("change", changed);

    const name = /** @type {HTMLInputElement} */ (fields.querySelector("[name=name]"));
    const user = /** @type {HTMLInputElement} */ (fields.querySelector("[name=user]"));
    if (user) {
        name.addEventListener("input", () => {
            if (user.dataset.auto !== undefined) {
                user.value = name.value ? `${name.value}_user` : "";
            }
        });
        user.addEventListener("input", () => delete user.dataset.auto);
    }
}

/**
 * Shows the fields of the user picked for a new database, and makes them the ones sent.
 * @param {HTMLElement} button
 * @returns {void}
 */
function pickUserMode(button) {
    const form = button.closest("form");
    setActive(button);

    for (const pane of /** @type {NodeListOf<HTMLElement>} */ (
        form.querySelectorAll("[data-mode-pane]")
    )) {
        pane.hidden = pane.dataset.modePane !== button.dataset.userMode;
        pane.querySelectorAll("input, select").forEach((field) => {
            /** @type {HTMLInputElement} */ (field).disabled = Boolean(pane.hidden);
        });
    }
}

/**
 * Drops a database once it is confirmed, offering to drop its users with it:
 * none is ticked, since a user may serve another site too.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function dropDatabase(name) {
    const db    = state.databases.list.find((one) => one.name === name);
    const users = db.users.filter((key) => !state.databases.users
        .find((user) => `${user.name}@${user.host}` === key)?.admin);

    let text = "It has no tables.";
    if (db.tables) {
        text = `Its ${db.tables === 1 ? "table"
            : `${db.tables} tables`}, ${bytes(db.size)}, are gone for good.`;
    }

    const sure = await ask({
        title  : `Drop ${name}?`,
        text,
        body   : users.length ? `
            <div class="form-row">
                <span>Drop these users too</span>
                <div class="check-list">${users.map((key) => `<label class="check"><input
                    type="checkbox" class="box"
                    value="${esc(key)}"><span>${esc(key)}</span></label>`)
                    .join("")}</div>
            </div>
        ` : "",
        ok     : "Drop",
        danger : true,
    });
    if (sure) {
        const going = [ ...document.querySelectorAll("#ask-body input:checked") ]
            .map((box) => /** @type {HTMLInputElement} */ (box).value);
        act({ action : "db-drop", name, users : going });
    }
}



// The public API
export {
    renderDatabases,
    renderDbText,
    renderDbList,
    renderUsers,
    charsetList,
    loadCharsets,
    openDatabaseDialog,
    pickUserMode,
    dropDatabase,
};
