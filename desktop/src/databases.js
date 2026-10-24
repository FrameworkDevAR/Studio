"use strict";

// The Databases page: the databases, the users that reach them, and MariaDB's
// options, with the dialogs that create, change and drop the first two.

function renderDatabases() {
    const { databases, mariadb, phpmyadmin } = state;
    /** @type {HTMLAnchorElement} */ (document.getElementById("phpmyadmin-link")).href       = phpmyadmin.url;
    /** @type {HTMLAnchorElement} */ (document.getElementById("phpmyadmin-users-link")).href = `${phpmyadmin.url}/index.php?route=/server/privileges`;
    document.getElementById("db-version").textContent = mariadb.version ? `MariaDB ${mariadb.version}` : "";
    document.getElementById("db-problem").hidden       = databases.available;
    document.getElementById("tab-db-count").textContent     = databases.available ? String(databases.list.length) : "";
    document.getElementById("tab-user-count").textContent   = databases.available ? String(accountRows().length) : "";
    document.getElementById("tab-option-count").textContent = mariadb.available
        ? String(mariadb.settings.filter((option) => option.inFile).length + mariadb.overrides.length) : "";
    renderDbText();
    renderDbList();
    renderUsers();
    if (mariadb.available) {
        renderSettingGroups("mariadb", OPTION_GROUPS, mariadb.settings, mariadb.overrides);
    } else {
        document.getElementById("db-options").innerHTML = "";
        settingsKeys.mariadb = "";
    }
}

/** The line under the title, about the tab shown. */
function renderDbText() {
    const file = state.mariadb.file.split("/").pop();
    document.getElementById("db-text").innerHTML = {
        databases : "MariaDB on port 3306. Sizes include indexes and refresh every 30 seconds; a name opens the database in phpMyAdmin.",
        users     : "The users the sites log in as: the databases each reaches, and what it may do there. root and your own user look after MariaDB, so they are left to phpMyAdmin.",
        options   : `Values saved here go to <code title="${esc(state.mariadb.file)}">${esc(file)}</code>, which MariaDB reads after <code>my.cnf</code>, so they win over it. MariaDB checks them first; the ones it can change as it runs apply at once, and the rest restart it.`,
    }[dbTab()];
}

/**
 * The databases, as cards: the name, which opens it in phpMyAdmin, its
 * tables and size, with a bar against the largest, its encoding, and its
 * users. An encoding other than utf8mb4 is marked, as it cannot hold every
 * character, emoji among them.
 */
function renderDbList() {
    const { databases } = state;
    const search  = /** @type {HTMLInputElement} */ (document.getElementById("db-filter")).value.trim().toLowerCase();
    const list    = databases.list.filter((db) => !search || db.name.toLowerCase().includes(search) || db.users.some((user) => user.toLowerCase().includes(search)));
    const total   = databases.list.reduce((sum, db) => sum + db.size, 0);
    const largest = Math.max(1, ...databases.list.map((db) => db.size));
    document.getElementById("db-total").textContent = databases.available ? `${databases.list.length} · ${bytes(total)}` : "";
    document.getElementById("db-list").innerHTML = !databases.available
        ? `<div class="pkg-none">MariaDB is not running.</div>`
        : list.map((db) => `
            <div class="db-card">
                <div class="db-card-head">
                    <span class="db-icon"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg></span>
                    <span class="db-title">
                        <a class="db-name" href="${esc(db.url)}" target="_blank" rel="noopener" title="Open in phpMyAdmin">${esc(db.name)}</a>
                        <small>${db.tables === 1 ? "1 table" : `${db.tables} tables`} · ${bytes(db.size)}</small>
                    </span>
                    <span class="db-actions">
                        <button class="icon-btn" data-db-edit="${esc(db.name)}" title="Change its encoding and users" aria-label="Edit ${esc(db.name)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>
                        <button class="icon-btn remove" data-db-drop="${esc(db.name)}" title="Drop it" aria-label="Drop ${esc(db.name)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
                    </span>
                </div>
                <div class="meter"><div style="width:${Math.max(2, (db.size / largest) * 100)}%"></div></div>
                <div class="db-foot">
                    <span class="db-encoding" title="${db.charset.startsWith("utf8mb4") ? "" : "Not utf8mb4: some characters, emoji among them, do not fit"}">
                        <span class="tag ${db.charset.startsWith("utf8mb4") ? "" : "amber"}">${esc(db.charset)}</span>
                        <span class="db-collation" title="${esc(db.collation)}">${esc(db.collation.replace(`${db.charset}_`, ""))}</span>
                    </span>
                    <span class="db-people">${db.users.map((key) => `<button class="db-user" data-user-edit="${esc(key)}" title="Change ${esc(key)}">${esc(key.replace(/@[^@]*$/, ""))}</button>`).join("") || `<span class="muted">No user</span>`}</span>
                </div>
            </div>
        `).join("") || `<div class="pkg-none">No database has “${esc(search)}” in its name or users.</div>`;
}

/**
 * The users, as cards like the databases': the name, which opens it to
 * change, its hosts, the databases it reaches and what it may do there.
 * root, on its three hosts, and Studio's own user show as one card each,
 * without buttons, as they look after MariaDB.
 */
function renderUsers() {
    const search = /** @type {HTMLInputElement} */ (document.getElementById("user-filter")).value.trim().toLowerCase();
    const rows   = accountRows().filter((user) => !search || user.name.toLowerCase().includes(search) || user.databases.some((db) => db.toLowerCase().includes(search)));
    const pencil = `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>`;
    const bin    = `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;
    document.getElementById("user-count").textContent = state.databases.available ? String(accountRows().length) : "";
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
                                : `<button class="db-name" data-user-edit="${esc(user.key)}" title="Change it">${esc(user.name)}</button>`}
                            <small>@${esc(user.hosts.join(", "))}</small>
                        </span>
                        ${user.admin ? `<span class="tag" title="Looks after MariaDB">admin</span>` : `
                            <span class="db-actions">
                                <button class="icon-btn" data-user-edit="${esc(user.key)}" title="Change it" aria-label="Edit ${esc(user.name)}">${pencil}</button>
                                <button class="icon-btn remove" data-user-drop="${esc(user.key)}" title="Drop it" aria-label="Drop ${esc(user.name)}">${bin}</button>
                            </span>
                        `}
                    </div>
                    <dl class="user-facts">
                        <dt>Reaches</dt>
                        <dd>${user.all ? `<span class="db-user">All databases</span>`
                            : user.databases.map((db) => `<span class="db-user">${esc(db)}</span>`).join("") || `<span class="muted">No database</span>`}</dd>
                        <dt>May</dt>
                        <dd><span class="db-user ${summary.tone}" title="${esc(user.privileges.join(", "))}">${esc(summary.text)}</span></dd>
                    </dl>
                </div>
            `;
        }).join("") || `<div class="pkg-none">No user has “${esc(search)}” in its name or databases.</div>`;
}

/** The users as the page lists them: the admins one line per name, every other one per host. */
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
async function loadCharsets() {
    charsetList = charsetList || await api("/api/charsets");
    return charsetList;
}

/**
 * The dialog for a new database, or to change one: its name, which MariaDB
 * cannot change later, its encoding, and its users. A new one can have a
 * user made for it, named after it, with a password made up, or be given
 * to one there already.
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
    const body     = `
        <label class="form-row">
            <span>Name</span>
            <input name="name" value="${esc(name)}" ${db ? "readonly title=\"MariaDB cannot rename a database\"" : ""} required maxlength="64" pattern="[\\w$\\-]+" placeholder="shop" spellcheck="false">
        </label>
        <div class="form-pair">
            <label class="form-row">
                <span>Character set</span>
                <span class="field select"><select name="charset">${charsets.map((one) => `<option value="${esc(one.name)}" title="${esc(one.description)}" ${one.name === charset ? "selected" : ""}>${esc(one.name)}</option>`).join("")}</select></span>
            </label>
            <label class="form-row">
                <span>Collation</span>
                <span class="field select"><select name="collation"></select></span>
            </label>
        </div>
        ${db?.tables ? `
            <label class="check" id="db-convert" hidden>
                <input type="checkbox" class="box" name="convert">
                <span>Convert its ${db.tables === 1 ? "table" : `${db.tables} tables`} too<small>MariaDB gives the new encoding to new tables only</small></span>
            </label>
        ` : ""}
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
            const mode = /** @type {HTMLElement} */ (form.querySelector("[data-user-mode].active"))?.dataset.userMode || "none";
            return api("/api/action", {
                action    : "db-create",
                name      : data.get("name"),
                charset   : set,
                collation : sort,
                user      : mode === "new" ? { mode, name : data.get("user"), host : data.get("host"), password : data.get("password") }
                    : mode === "existing" ? { mode, account : data.get("account") } : null,
            });
        },
    });
}

/**
 * Who may use a database: a box for each user given databases one by one.
 * The ones that reach every database are only named under it, as they are
 * changed in Users.
 */
function databaseUsersField(db, accounts) {
    const some = accounts.filter((user) => !user.all);
    const all  = accounts.filter((user) => user.all);
    return `
        <div class="form-row">
            <span>Users</span>
            ${some.length ? `
                <div class="check-list">
                    ${some.map((user) => `
                        <label class="check">
                            <input type="checkbox" class="box" name="users" value="${esc(`${user.name}@${user.host}`)}" ${user.databases.includes(db.name) ? "checked" : ""}>
                            <span>${esc(user.name)}<small>@${esc(user.host)}</small></span>
                        </label>
                    `).join("")}
                </div>
            ` : `<small class="form-note">Every user reaches all databases, this one among them. Give one only some in Users, and it can be ticked here.</small>`}
            ${some.length && all.length ? `<small class="form-note">${all.length === 1 ? `${esc(all[0].name)} reaches` : `${all.length} more users reach`} every database, this one among them.</small>` : ""}
        </div>
    `;
}

/** A new database's user: none, a new one, or one there already. */
function newUserField(accounts) {
    return `
        <div class="form-row">
            <span>User</span>
            <div class="segmented">
                <button type="button" data-user-mode="new" class="active">New user</button>
                <button type="button" data-user-mode="existing" ${accounts.length ? "" : "disabled"}>Existing user</button>
                <button type="button" data-user-mode="none">None</button>
            </div>
        </div>
        <div class="form-pair" data-mode-pane="new">
            <label class="form-row"><span>User name</span><input name="user" required maxlength="80" pattern="[\\w.$\\-]+" placeholder="shop_user" spellcheck="false" data-auto></label>
            <label class="form-row"><span>Host</span>${hostSelect("localhost")}</label>
            ${passwordField(true)}
        </div>
        <div data-mode-pane="existing" hidden>
            <label class="form-row">
                <span>User</span>
                <span class="field select"><select name="account">${accounts.map((user) => `<option value="${esc(`${user.name}@${user.host}`)}">${esc(user.name)}@${esc(user.host)}</option>`).join("")}</select></span>
            </label>
        </div>
    `;
}

/**
 * The fields' listeners: the collations follow the character set, the
 * conversion is offered once the encoding changes, and a new user's name
 * follows the database's, as shop_user, until it is typed over.
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
        sort.innerHTML = one.collations.map((name) => `<option ${name === pick ? "selected" : ""}>${esc(name)}</option>`).join("");
    };
    const changed = () => {
        if (convert) {
            /** @type {HTMLElement} */ (convert).hidden = set.value === db.charset && sort.value === db.collation;
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

/** Shows the fields of the user picked for a new database, and makes them the ones sent. */
function pickUserMode(button) {
    const form = button.closest("form");
    setActive(button);
    for (const pane of /** @type {NodeListOf<HTMLElement>} */ (form.querySelectorAll("[data-mode-pane]"))) {
        pane.hidden = pane.dataset.modePane !== button.dataset.userMode;
        pane.querySelectorAll("input, select").forEach((field) => { /** @type {HTMLInputElement} */ (field).disabled = pane.hidden; });
    }
}

/**
 * Drops a database once it is confirmed, offering to drop its users with it:
 * none is ticked, since a user may serve another site too.
 */
async function dropDatabase(name) {
    const db    = state.databases.list.find((one) => one.name === name);
    const users = db.users.filter((key) => !state.databases.users.find((user) => `${user.name}@${user.host}` === key)?.admin);
    const sure  = await ask({
        title  : `Drop ${name}?`,
        text   : db.tables ? `Its ${db.tables === 1 ? "table" : `${db.tables} tables`}, ${bytes(db.size)}, are gone for good.` : "It has no tables.",
        body   : users.length ? `
            <div class="form-row">
                <span>Drop these users too</span>
                <div class="check-list">${users.map((key) => `<label class="check"><input type="checkbox" class="box" value="${esc(key)}"><span>${esc(key)}</span></label>`).join("")}</div>
            </div>
        ` : "",
        ok     : "Drop",
        danger : true,
    });
    if (sure) {
        const going = [ ...document.querySelectorAll("#ask-body input:checked") ].map((box) => /** @type {HTMLInputElement} */ (box).value);
        act({ action : "db-drop", name, users : going });
    }
}

// ------------------------------------------------------------------- users ---

/**
 * The dialog for a new user, or to change one: its name and host, its
 * password, a new one made up or typed, what it may reach -- every
 * database, or the ones ticked -- and what it may do there.
 */
function openUserDialog(key = "") {
    const user = state.databases.users.find((one) => `${one.name}@${one.host}` === key);
    const all  = user ? user.all : false;
    const body = `
        <div class="form-pair">
            <label class="form-row"><span>Name</span><input name="name" value="${esc(user?.name || "")}" required maxlength="80" pattern="[\\w.$\\-]+" placeholder="shop_user" spellcheck="false"></label>
            <label class="form-row"><span>Host</span>${hostSelect(user?.host || "localhost")}</label>
            ${passwordField(!user)}
        </div>
        <div class="form-row">
            <span>Databases</span>
            <div class="segmented">
                <button type="button" data-access="some" class="${all ? "" : "active"}">Only these</button>
                <button type="button" data-access="all" class="${all ? "active" : ""}">All databases</button>
            </div>
            <div class="check-list" data-access-list ${all ? "hidden" : ""}>
                ${state.databases.list.map((db) => `
                    <label class="check">
                        <input type="checkbox" class="box" name="databases" value="${esc(db.name)}" ${user?.databases.includes(db.name) ? "checked" : ""}>
                        <span>${esc(db.name)}</span>
                    </label>
                `).join("") || `<span class="muted">No databases yet.</span>`}
            </div>
        </div>
        ${privilegesField(user)}
    `;
    formDialog({
        title  : user ? `Change ${user.name}` : "New user",
        text   : user ? "" : "A user for a site to log in as, and what it may do to the databases it reaches.",
        body,
        ok     : user ? "Save" : "Create",
        ready  : (fields) => {
            const form = fields.closest("form");
            syncPrivileges(form);
            // A user given privileges of its own shows them at once.
            if (form.querySelector("[data-preset].active")?.getAttribute("data-preset") === "custom") {
                toggleAdvanced(form.querySelector("[data-advanced]"), true);
            }
            fields.querySelector("[data-privileges]").addEventListener("change", () => markPreset(form));
        },
        submit : (form) => {
            const data  = new FormData(form);
            const every = isEveryDatabase(form);
            return api("/api/action", {
                action     : user ? "user-change" : "user-create",
                account    : key,
                name       : data.get("name"),
                host       : data.get("host"),
                password   : data.get("password"),
                all        : every,
                databases  : data.getAll("databases"),
                privileges : pickedPrivileges(form, every),
            });
        },
    });
}

/** Every database, or only the ones ticked; the server's privileges come and go with it. */
function pickAccess(button) {
    setActive(button);
    /** @type {HTMLElement} */ (button.closest(".form-row").querySelector("[data-access-list]")).hidden = button.dataset.access === "all";
    syncPrivileges(button.closest("form"));
}

function isEveryDatabase(form) {
    return form.querySelector("[data-access].active")?.getAttribute("data-access") === "all";
}

// -------------------------------------------------------------- privileges ---

/**
 * What the presets give, as most sites need: everything, the data and what
 * a framework's migrations do not need, or only reading.
 */
const PRIVILEGE_PRESETS = {
    write : [ "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE TEMPORARY TABLES", "LOCK TABLES", "EXECUTE", "SHOW VIEW" ],
    read  : [ "SELECT", "SHOW VIEW" ],
};
const PRESET_NAMES = { all : "All privileges", write : "Read and write", read : "Read only" };

/** The privileges one database, or every one, can be given, GRANT OPTION aside. */
function scopePrivileges(all) {
    return state.databases.privileges
        .filter((one) => one.only !== (all ? "database" : "server") && one.name !== "GRANT OPTION")
        .map((one) => one.name);
}

/** The preset a set of privileges is, or "custom". */
function presetOf(privileges, all) {
    const own  = privileges.filter((one) => one !== "GRANT OPTION").sort().join(",");
    const sets = { all : scopePrivileges(all), ...PRIVILEGE_PRESETS };
    return Object.keys(sets).find((name) => [ ...sets[name] ].sort().join(",") === own) || "custom";
}

/** What a user may do, in a word, for its card: in red only when it may do nothing. */
function privilegeSummary(user) {
    const preset = presetOf(user.privileges, user.all);
    const grant  = user.privileges.includes("GRANT OPTION") && !user.admin ? ", and grant them" : "";
    const count  = user.privileges.filter((one) => one !== "GRANT OPTION").length;
    if (!count) {
        return { text : "Nothing", tone : "none" };
    }
    return { text : `${PRESET_NAMES[preset] || `${count} privileges`}${grant}`, tone : "" };
}

/**
 * The privileges: a preset to pick, and under Advanced, a box for each,
 * by group. A user whose databases differ is shown the first one's, which
 * saving gives them all.
 */
function privilegesField(user) {
    const held   = user ? user.privileges : scopePrivileges(false);
    const groups = [ ...new Set(state.databases.privileges.map((one) => one.group)) ];
    return `
        <div class="form-row">
            <span>Privileges</span>
            <div class="privilege-head">
                <div class="segmented">
                    ${[ "all", "write", "read" ].map((name) => `<button type="button" data-preset="${name}">${PRESET_NAMES[name]}</button>`).join("")}
                    <button type="button" data-preset="custom">Custom</button>
                </div>
                <button type="button" class="ghost small" data-advanced aria-expanded="false">Advanced</button>
            </div>
            ${user?.mixed ? `<small class="form-note">Its databases have different privileges. These are the first one's, and saving gives them all these.</small>` : ""}
            <div class="privilege-groups" data-privileges hidden>
                ${groups.map((group) => `
                    <fieldset class="privilege-group" data-group="${esc(group)}">
                        <legend>${esc(group)}</legend>
                        ${state.databases.privileges.filter((one) => one.group === group).map((one) => `
                            <label class="check" data-only="${one.only}">
                                <input type="checkbox" class="box" name="privileges" value="${esc(one.name)}" ${held.includes(one.name) ? "checked" : ""}>
                                <span>${esc(one.name)}</span>
                            </label>
                        `).join("")}
                    </fieldset>
                `).join("")}
            </div>
        </div>
    `;
}

/** The boxes of the privileges that apply now: the server's only with every database. */
function privilegeBoxes(form, every = isEveryDatabase(form)) {
    return /** @type {HTMLInputElement[]} */ ([ ...form.querySelectorAll("[name=privileges]") ])
        .filter((box) => /** @type {HTMLElement} */ (box.closest("[data-only]")).dataset.only !== (every ? "database" : "server"));
}

function pickedPrivileges(form, every) {
    return privilegeBoxes(form, every).filter((box) => box.checked).map((box) => box.value);
}

/**
 * Shows the privileges that apply to what the user reaches, keeps a preset
 * picked as that preset, which differs with every database, and marks the
 * preset the boxes now are.
 */
function syncPrivileges(form) {
    const every = isEveryDatabase(form);
    for (const box of /** @type {NodeListOf<HTMLElement>} */ (form.querySelectorAll("[data-only]"))) {
        box.hidden = box.dataset.only === (every ? "database" : "server");
    }
    /** @type {HTMLElement} */ (form.querySelector("[data-group=Server]")).hidden = !every;
    const active = /** @type {HTMLElement} */ (form.querySelector("[data-preset].active"));
    if (active && active.dataset.preset !== "custom") {
        applyPreset(form, active.dataset.preset);
    }
    markPreset(form);
}

function applyPreset(form, preset) {
    const wanted = preset === "all" ? scopePrivileges(isEveryDatabase(form)) : PRIVILEGE_PRESETS[preset];
    for (const box of privilegeBoxes(form)) {
        if (box.value !== "GRANT OPTION") {
            box.checked = wanted.includes(box.value);
        }
    }
}

function markPreset(form) {
    const preset = presetOf(pickedPrivileges(form, isEveryDatabase(form)), isEveryDatabase(form));
    setActive(form.querySelector(`[data-preset="${preset}"]`));
}

/** A preset ticks its boxes; Custom opens them, to tick by hand. */
function pickPreset(button) {
    const form = button.closest("form");
    if (button.dataset.preset === "custom") {
        toggleAdvanced(form.querySelector("[data-advanced]"), true);
        setActive(button);
        return;
    }
    applyPreset(form, button.dataset.preset);
    markPreset(form);
}

function toggleAdvanced(button, open = button.getAttribute("aria-expanded") !== "true") {
    button.setAttribute("aria-expanded", String(open));
    /** @type {HTMLElement} */ (button.closest(".form-row").querySelector("[data-privileges]")).hidden = !open;
}

async function dropUser(key) {
    const user = state.databases.users.find((one) => `${one.name}@${one.host}` === key);
    const sure = await ask({
        title  : `Drop ${user.name}?`,
        text   : `The sites that log in as ${user.name} can no longer reach ${user.all ? "any database" : user.databases.length ? user.databases.join(", ") : "MariaDB"}. Its databases stay.`,
        ok     : "Drop",
        danger : true,
    });
    if (sure) {
        act({ action : "user-drop", account : key });
    }
}

/** The hosts a user logs in from: this Mac by its socket or by TCP, or anywhere. */
function hostSelect(host) {
    const hosts = [ [ "localhost", "localhost" ], [ "127.0.0.1", "127.0.0.1" ], [ "%", "Anywhere (%)" ] ];
    if (!hosts.some(([ one ]) => one === host)) {
        hosts.push([ host, host ]);
    }
    return `<span class="field select"><select name="host">${hosts.map(([ one, label ]) => `<option value="${esc(one)}" ${one === host ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></span>`;
}

/**
 * A password, shown, as this is a machine's own MariaDB: a new user's made
 * up already, to copy before saving; a user's own is kept unless one is
 * typed.
 */
function passwordField(required) {
    return `
        <label class="form-row wide">
            <span>Password</span>
            <span class="password">
                <input name="password" value="${required ? makePassword() : ""}" ${required ? "required" : "placeholder=\"Leave empty to keep it\""} spellcheck="false" autocomplete="off">
                <button type="button" class="ghost small" data-make-password title="Make up another">New</button>
                <button type="button" class="ghost small" data-copy-password title="Copy it">Copy</button>
            </span>
        </label>
    `;
}

function makePassword() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    return [ ...crypto.getRandomValues(new Uint8Array(20)) ].map((byte) => letters[byte % letters.length]).join("");
}

async function copyPassword(button) {
    const field = /** @type {HTMLInputElement} */ (button.parentElement.querySelector("input"));
    if (!field.value) {
        return;
    }
    await navigator.clipboard.writeText(field.value);
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
}
