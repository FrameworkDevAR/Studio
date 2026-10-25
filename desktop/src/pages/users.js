"use strict";

// The Databases page's users: their dialog, the privileges they are given, and their
// passwords.

// ------------------------------------------------------------------- users ---

/**
 * The dialog for a new user, or to change one: its name and host, its
 * password, a new one made up or typed, what it may reach -- every
 * database, or the ones ticked -- and what it may do there.
 * @param {string=} key the user's name@host, none for a new one
 * @returns {void}
 */
function openUserDialog(key = "") {
    const user = state.databases.users.find((one) => `${one.name}@${one.host}` === key);
    const all  = user ? user.all : false;
    const body = `
        <div class="form-pair">
            <label class="form-row"><span>Name</span><input name="name"
                value="${esc(user?.name || "")}" required maxlength="80" pattern="[\\w.$\\-]+"
                placeholder="shop_user" spellcheck="false"></label>
            <label class="form-row"><span>Host</span>${hostSelect(user?.host
                || "localhost")}</label>
            ${passwordField(!user)}
        </div>
        <div class="form-row">
            <span>Databases</span>
            <div class="segmented">
                <button type="button" data-access="some"
                    class="${all ? "" : "active"}">Only these</button>
                <button type="button" data-access="all"
                    class="${all ? "active" : ""}">All databases</button>
            </div>
            <div class="check-list" data-access-list ${all ? "hidden" : ""}>
                ${state.databases.list.map((db) => `
                    <label class="check">
                        <input type="checkbox" class="box" name="databases" value="${esc(db.name)}"
                            ${user?.databases.includes(db.name) ? "checked" : ""}>
                        <span>${esc(db.name)}</span>
                    </label>
                `).join("") || `<span class="muted">No databases yet.</span>`}
            </div>
        </div>
        ${privilegesField(user)}
    `;

    formDialog({
        title  : user ? `Change ${user.name}` : "New user",
        text   : user ? ""
            : "A user for a site to log in as, and what it may do to the databases it reaches.",
        body,
        ok     : user ? "Save" : "Create",
        ready  : (fields) => {
            const form = fields.closest("form");
            syncPrivileges(form);

            // A user given privileges of its own shows them at once.
            if (form.querySelector("[data-preset].active")?.getAttribute("data-preset")
                === "custom") {
                toggleAdvanced(form.querySelector("[data-advanced]"), true);
            }

            fields.querySelector("[data-privileges]")
                .addEventListener("change", () => markPreset(form));
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

/**
 * Every database, or only the ones ticked; the server's privileges come and go with it.
 * @param {HTMLElement} button
 * @returns {void}
 */
function pickAccess(button) {
    setActive(button);
    /** @type {HTMLElement} */ (button.closest(".form-row")
        .querySelector("[data-access-list]")).hidden = button.dataset.access === "all";
    syncPrivileges(button.closest("form"));
}

/**
 * Whether the dialog's user reaches every database, rather than the ones ticked.
 * @param {HTMLFormElement} form
 * @returns {boolean}
 */
function isEveryDatabase(form) {
    return form.querySelector("[data-access].active")?.getAttribute("data-access") === "all";
}

// -------------------------------------------------------------- privileges ---

/**
 * What the presets give, as most sites need: everything, the data and what
 * a framework's migrations do not need, or only reading.
 */
const PRIVILEGE_PRESETS = {
    write : [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "CREATE TEMPORARY TABLES",
        "LOCK TABLES",
        "EXECUTE",
        "SHOW VIEW",
    ],
    read  : [ "SELECT", "SHOW VIEW" ],
};
const PRESET_NAMES = { all : "All privileges", write : "Read and write", read : "Read only" };

/**
 * The privileges one database, or every one, can be given, GRANT OPTION aside.
 * @param {boolean} all
 * @returns {string[]}
 */
function scopePrivileges(all) {
    return state.databases.privileges
        .filter((one) => one.only !== (all ? "database" : "server") && one.name !== "GRANT OPTION")
        .map((one) => one.name);
}

/**
 * The preset a set of privileges is, or "custom".
 * @param {string[]} privileges
 * @param {boolean} all
 * @returns {string}
 */
function presetOf(privileges, all) {
    const own  = privileges.filter((one) => one !== "GRANT OPTION").sort().join(",");
    const sets = { all : scopePrivileges(all), ...PRIVILEGE_PRESETS };
    return Object.keys(sets).find((name) => [ ...sets[name] ].sort().join(",") === own) || "custom";
}

/**
 * What a user may do, in a word, for its card: in red only when it may do nothing.
 * @param {DbPageUser} user
 * @returns {{ text: string, tone: string }}
 */
function privilegeSummary(user) {
    const preset = presetOf(user.privileges, user.all);
    const grant  = user.privileges.includes("GRANT OPTION") && !user.admin
        ? ", and grant them" : "";
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
 * @param {DbPageUser} user
 * @returns {string}
 */
function privilegesField(user) {
    const held   = user ? user.privileges : scopePrivileges(false);
    const groups = [ ...new Set(state.databases.privileges.map((one) => one.group)) ];
    return `
        <div class="form-row">
            <span>Privileges</span>
            <div class="privilege-head">
                <div class="segmented">
                    ${[ "all", "write", "read" ].map((name) => `<button type="button"
                        data-preset="${name}">${PRESET_NAMES[name]}</button>`).join("")}
                    <button type="button" data-preset="custom">Custom</button>
                </div>
                <button type="button" class="ghost small" data-advanced
                    aria-expanded="false">Advanced</button>
            </div>
            ${user?.mixed ? `<small class="form-note">Its databases have different privileges. These
                are the first one's, and saving gives them all these.</small>` : ""}
            <div class="privilege-groups" data-privileges hidden>
                ${groups.map((group) => `
                    <fieldset class="privilege-group" data-group="${esc(group)}">
                        <legend>${esc(group)}</legend>
                        ${state.databases.privileges.filter((one) => one.group === group)
                            .map((one) => `
                            <label class="check" data-only="${one.only}">
                                <input type="checkbox" class="box" name="privileges"
                                    value="${esc(one.name)}"
                                    ${held.includes(one.name) ? "checked" : ""}>
                                <span>${esc(one.name)}</span>
                            </label>
                        `).join("")}
                    </fieldset>
                `).join("")}
            </div>
        </div>
    `;
}

/**
 * The boxes of the privileges that apply now: the server's only with every database.
 * @param {HTMLFormElement} form
 * @param {boolean=} every
 * @returns {HTMLInputElement[]}
 */
function privilegeBoxes(form, every = isEveryDatabase(form)) {
    return /** @type {HTMLInputElement[]} */ ([ ...form.querySelectorAll("[name=privileges]") ])
        .filter((box) => /** @type {HTMLElement} */ (box.closest("[data-only]")).dataset.only
            !== (every ? "database" : "server"));
}

/**
 * The privileges ticked, of the ones that apply.
 * @param {HTMLFormElement} form
 * @param {boolean} every
 * @returns {string[]}
 */
function pickedPrivileges(form, every) {
    return privilegeBoxes(form, every).filter((box) => box.checked).map((box) => box.value);
}

/**
 * Shows the privileges that apply to what the user reaches, keeps a preset
 * picked as that preset, which differs with every database, and marks the
 * preset the boxes now are.
 * @param {HTMLFormElement} form
 * @returns {void}
 */
function syncPrivileges(form) {
    const every = isEveryDatabase(form);

    for (const box of /** @type {NodeListOf<HTMLElement>} */ (
        form.querySelectorAll("[data-only]")
    )) {
        box.hidden = box.dataset.only === (every ? "database" : "server");
    }

    /** @type {HTMLElement} */ (form.querySelector("[data-group=Server]")).hidden = !every;
    const active = /** @type {HTMLElement} */ (form.querySelector("[data-preset].active"));
    if (active && active.dataset.preset !== "custom") {
        applyPreset(form, active.dataset.preset);
    }

    markPreset(form);
}

/**
 * Ticks the boxes of a preset, and only those, leaving GRANT OPTION as it is.
 * @param {HTMLFormElement} form
 * @param {string} preset
 * @returns {void}
 */
function applyPreset(form, preset) {
    const wanted = preset === "all" ? scopePrivileges(isEveryDatabase(form))
        : PRIVILEGE_PRESETS[preset];

    for (const box of privilegeBoxes(form)) {
        if (box.value !== "GRANT OPTION") {
            box.checked = wanted.includes(box.value);
        }
    }
}

/**
 * Marks the preset the ticked boxes are, or Custom.
 * @param {HTMLFormElement} form
 * @returns {void}
 */
function markPreset(form) {
    const preset = presetOf(pickedPrivileges(form, isEveryDatabase(form)), isEveryDatabase(form));
    setActive(form.querySelector(`[data-preset="${preset}"]`));
}

/**
 * A preset ticks its boxes; Custom opens them, to tick by hand.
 * @param {HTMLElement} button
 * @returns {void}
 */
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

/**
 * Opens or closes the boxes of the privileges, under Advanced.
 * @param {Element} button
 * @param {boolean=} open
 * @returns {void}
 */
function toggleAdvanced(button, open = button.getAttribute("aria-expanded") !== "true") {
    button.setAttribute("aria-expanded", String(open));
    /** @type {HTMLElement} */ (button.closest(".form-row")
        .querySelector("[data-privileges]")).hidden = !open;
}

/**
 * Drops a user once it is confirmed; its databases stay.
 * @param {string} key the user's name@host
 * @returns {Promise<void>}
 */
async function dropUser(key) {
    const user = state.databases.users.find((one) => `${one.name}@${one.host}` === key);
    const sure = await ask({
        title  : `Drop ${user.name}?`,
        text   : `The sites that log in as ${user.name} can no longer reach ${user.all
            ? "any database"
            : user.databases.length ? user.databases.join(", ")
                : "MariaDB"}. Its databases stay.`,
        ok     : "Drop",
        danger : true,
    });
    if (sure) {
        act({ action : "user-drop", account : key });
    }
}

/**
 * The hosts a user logs in from: this Mac by its socket or by TCP, or anywhere.
 * @param {string} host
 * @returns {string}
 */
function hostSelect(host) {
    const hosts = [
        [ "localhost", "localhost" ],
        [ "127.0.0.1", "127.0.0.1" ],
        [ "%", "Anywhere (%)" ],
    ];

    if (!hosts.some(([ one ]) => one === host)) {
        hosts.push([ host, host ]);
    }

    return `<span class="field select"><select name="host">${hosts
        .map(([ one, label ]) => `<option value="${esc(one)}"
            ${one === host ? "selected" : ""}>${esc(label)}</option>`)
        .join("")}</select></span>`;
}

/**
 * A password, shown, as this is a machine's own MariaDB: a new user's made
 * up already, to copy before saving; a user's own is kept unless one is
 * typed.
 * @param {boolean} required
 * @returns {string}
 */
function passwordField(required) {
    return `
        <label class="form-row wide">
            <span>Password</span>
            <span class="password">
                <input name="password" value="${required ? makePassword() : ""}"
                    ${required ? "required" : "placeholder=\"Leave empty to keep it\""}
                    spellcheck="false" autocomplete="off">
                <button type="button" class="ghost small" data-make-password
                    title="Make up another">New</button>
                <button type="button" class="ghost small" data-copy-password
                    title="Copy it">Copy</button>
            </span>
        </label>
    `;
}

/**
 * A password made up: 20 letters and digits, leaving out the ones that look alike.
 * @returns {string}
 */
function makePassword() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    return [ ...crypto.getRandomValues(new Uint8Array(20)) ]
        .map((byte) => letters[byte % letters.length])
        .join("");
}

/**
 * Copies the password beside the button, which says so for a moment.
 * @param {HTMLElement} button
 * @returns {Promise<void>}
 */
async function copyPassword(button) {
    const field = /** @type {HTMLInputElement} */ (button.parentElement.querySelector("input"));
    if (!field.value) {
        return;
    }

    await navigator.clipboard.writeText(field.value);
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
}
