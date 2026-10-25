// The settings panels the PHP page and MariaDB's options share: a field for
// each value, the changes waiting to be saved, and the dialog that adds one.

import { api, refresh } from "../core/api.js";
import { esc, mosaic, toast } from "../core/helpers.js";
import { SETTING_HINTS, settingsKeys } from "../core/state.js";



/**
 * What differs between the two: who reads the settings, where they show,
 * what saves them, and what the dialog lists and looks them up on.
 */
const SETTING_SCOPES = {
    php : {
        who      : "PHP",
        box      : "php-settings",
        changes  : "php-changes",
        save     : (changes) => ({ action : "php-settings", changes }),
        unknown  : "PHP does not know it: an extension may be missing",
        list     : "/api/php-directives",
        noun     : "setting",
        file     : "the overrides file",
        first    : "Core",
        stranger : "Not known to PHP",
        site     : "php.net",
        lookup   : (key) => `https://www.php.net/search.php?pattern=${encodeURIComponent(key)}`,
        filter   : "Filter settings, as upload or xdebug…",
        line     : /^\s*([\w.]+)\s*=/,
    },
    mariadb : {
        who      : "MariaDB",
        box      : "db-options",
        changes  : "db-changes",
        save     : (changes) => ({ action : "mariadb-options", changes }),
        unknown  : "Not a variable MariaDB shows, though it may take it as an option",
        list     : "/api/mariadb-options",
        noun     : "option",
        file     : "the options file",
        first    : "Server",
        stranger : "Not a variable",
        site     : "mariadb.com",
        lookup   : (key) => `https://mariadb.com/kb/en/search/?q=${encodeURIComponent(key)}`,
        filter   : "Filter options, as innodb or timeout…",
        line     : /^\s*([A-Za-z][\w.-]*)\s*(?:=|$)/,
    },
};



/**
 * A PHP setting or a MariaDB option, as the server gives it: its value, the
 * choices it takes, whether the file has it, and what it goes back to without it.
 * @typedef {{ key: string, value: string, inFile?: boolean, known?: boolean,
 *     options?: string[], timezone?: boolean, size?: boolean, base?: string,
 *     baseFrom?: string, owner?: string, comment?: string }} StudioSetting
 */



/**
 * The settings, in groups, then the file's other settings, a group for each
 * part they belong to: in the page's group of the same name, as Xdebug, or
 * in one of their own. Skipped while a field is focused or has an unsaved
 * change, and when nothing changed, so it does not flicker every 5s.
 * @param {string} scope "php" or "mariadb"
 * @param {{ title: string, keys: string[] }[]} fixed
 * @param {StudioSetting[]} settings
 * @param {StudioSetting[]} overrides
 * @param {string=} extra
 * @returns {void}
 */
function renderSettingGroups(scope, fixed, settings, overrides, extra = "") {
    const box  = document.getElementById(SETTING_SCOPES[scope].box);
    const key  = JSON.stringify([ settings, overrides ]);
    showSettingChanges(scope);
    const busy = box.contains(document.activeElement) || box.querySelector(".dirty");
    if (key === settingsKeys[scope] || busy) {
        return;
    }

    settingsKeys[scope] = key;
    const byKey  = Object.fromEntries(settings.map((setting) => [ setting.key, setting ]));
    const groups = fixed.map((group) => ({
        title : group.title,
        rows  : group.keys.filter((one) => byKey[one]).map((one) => byKey[one]),
    }))
        .filter((group) => group.rows.length);

    for (const group of byOwner(overrides, scope)) {
        const same = groups.find((one) => one.title === group.title);
        if (same) {
            same.rows.push(...group.rows);
        } else {
            groups.push(group);
        }
    }

    box.innerHTML = groups.map((group) => `
        <div class="panel">
            <div class="panel-head"><h2>${esc(group.title)}</h2></div>
            ${group.rows.map((row) => settingRow(row, scope)).join("")}
        </div>
    `).join("") + extra;
    mosaic(box);

    for (const field of /** @type {NodeListOf<HTMLInputElement>} */ (
        box.querySelectorAll("input, select, textarea")
    )) {
        field.addEventListener("input", markDirty);
        field.addEventListener("change", markDirty);
        field.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                // A long value's box saves too, rather than break the line.
                event.preventDefault();
                saveSettings(scope);
            }
            if (event.key === "Escape") {
                resetSetting(/** @type {HTMLElement} */ (field.closest(".setting")));
                showSettingChanges(scope);
            }
        });
    }
}

/** The settings that are sizes, as 512M: a number with a unit to pick. */
const SIZE_SETTINGS = [ "memory_limit", "upload_max_filesize", "post_max_size" ];

/**
 * The field for a setting's value, fitting it: a list of the choices, a
 * timezone, a size, a number, or a text. The page's rows and the dialog that
 * adds one use it alike.
 * @param {StudioSetting} setting
 * @returns {string}
 */
function settingField(setting) {
    const value = String(setting.value);

    if (setting.options) {
        const options = setting.options.includes(value)
            ? setting.options
            : [ value, ...setting.options ];
        return `<span class="field select"><select>${options
            .map((option) =>
                `<option ${option === value ? "selected" : ""}>${esc(option)}</option>`)
            .join("")}</select></span>`;
    }

    if (setting.timezone) {
        return `<span class="field"><input list="timezones" value="${esc(value)}"
            spellcheck="false"></span>`;
    }

    if (setting.size || SIZE_SETTINGS.includes(setting.key) || /^\d+[KMG]$/i.test(value)) {
        const [ , number, unit ] = value.match(/^(-?\d+)([KMG]?)$/i) || [ "", value, "" ];
        return `
            <span class="field size">
                <input type="number" step="1" min="${setting.key === "memory_limit" ? -1 : 0}"
                    value="${esc(number)}">
                <select aria-label="Unit">${[
                    [ "", "B" ], [ "K", "KB" ], [ "M", "MB" ], [ "G", "GB" ],
                ].map(([ one, label ]) => `<option value="${one}"
                    ${one === unit.toUpperCase() ? "selected" : ""}>${label}</option>`)
                    .join("")}</select>
            </span>
        `;
    }

    if (/^-?\d+$/.test(value)) {
        return `<span class="field"><input type="number" step="1"
            value="${esc(value)}"></span>`;
    }

    // A long value, as sql_mode's list of modes, wraps in a box the row's width.
    if (value.length > 24) {
        return `<span class="field"><textarea rows="${Math.min(4, Math.ceil(value.length / 34))}"
            spellcheck="false">${esc(value)}</textarea></span>`;
    }
    return `<span class="field"><input value="${esc(value)}" spellcheck="false"></span>`;
}

/**
 * One setting: its name, with what it is for and where its value comes from
 * -- a file, as php.ini, or the default -- or what it goes back to without
 * the override, which the x does.
 * @param {StudioSetting} setting
 * @param {string} scope
 * @returns {string}
 */
function settingRow(setting, scope) {
    const { who, unknown } = SETTING_SCOPES[scope];
    const inFile = setting.inFile ?? true;
    const value  = String(setting.value);
    const field  = settingField(setting);
    const base   = setting.known === false ? "" : String(setting.base ?? "");
    const shown  = base === "" ? "empty" : base;
    const preset = setting.baseFrom === "default";

    let origin;
    if (inFile && setting.known === false) {
        origin = unknown;
    } else if (inFile) {
        origin = preset ? `${who}'s default is ${shown}` : `${setting.baseFrom} has ${shown}`;
    } else {
        origin = preset ? `${who}'s default` : `From ${setting.baseFrom}`;
    }

    const hint = [ SETTING_HINTS[setting.key], origin ].filter(Boolean).map(esc).join(" · ");

    let undo = "";
    if (inFile) {
        undo = `
            <button class="icon-btn unset" data-unset
                title="Remove the override${
                    setting.known === false ? "" : `: back to ${esc(shown)}`}"
                aria-label="Remove the override">
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
        `;
    }

    let from = "";
    if (setting.known !== false) {
        from = preset ? `${who}'s default` : setting.baseFrom;
    }

    return `
        <div class="setting ${inFile ? "set" : ""}
            ${!setting.options && value.length > 24 ? "wide" : ""}"
            data-key="${esc(setting.key)}" data-value="${esc(value)}"
            data-base="${esc(base)}" data-from="${esc(from)}">
            <label class="setting-key">${esc(setting.key)}</label>
            <small class="setting-hint">${hint}</small>
            ${undo}
            ${field}
        </div>
    `;
}

/**
 * A setting's value as its field holds it: a size's number and unit as one, 512M.
 * @param {Element} row
 * @returns {string}
 */
function fieldValue(row) {
    const size = row.querySelector(".field.size");
    if (size) {
        const number = /** @type {HTMLInputElement} */ (size.querySelector("input")).value
            .trim();
        const unit   = /** @type {HTMLSelectElement} */ (size.querySelector("select")).value;
        return number === "" || number === "-1" ? number : `${number}${unit}`;
    }
    return /** @type {HTMLInputElement} */ (row.querySelector("input, select, textarea")).value;
}

/**
 * Puts a value in a setting's field, adding it to a list that lacks it.
 * @param {Element} row
 * @param {string} value
 * @returns {void}
 */
function setFieldValue(row, value) {
    const size = row.querySelector(".field.size");
    if (size) {
        const [ , number, unit ] = String(value).match(/^(-?\d+)([KMG]?)$/i)
            || [ "", value, "" ];
        /** @type {HTMLInputElement} */ (size.querySelector("input")).value  = number;
        /** @type {HTMLSelectElement} */ (size.querySelector("select")).value = unit.toUpperCase();
        return;
    }

    const field = /** @type {HTMLSelectElement} */ (row.querySelector("input, select, textarea"));
    if (field.tagName === "SELECT"
        && ![ ...field.options ].some((option) => option.value === value)) {
        field.add(new Option(value, value));
    }

    field.value = value;
}

/**
 * Which page's settings a row is one of, by the box holding it.
 * @param {Element} row
 * @returns {string}
 */
function scopeOf(row) {
    return Object.keys(SETTING_SCOPES)
        .find((scope) => row.closest(`#${SETTING_SCOPES[scope].box}`));
}

/**
 * Marks a setting whose value differs from the saved one. The changes panel
 * shows while any does, and saves them all at once.
 * @param {Event & { target: * }} event
 * @returns {void}
 */
function markDirty(event) {
    const row = event.target.closest(".setting");
    row.classList.toggle("dirty", fieldValue(row) !== row.dataset.value);
    showSettingChanges(scopeOf(row));
}

/**
 * The x of an override: like a change, it is only marked, to be saved with
 * the others. The field shows the value it goes back to, and the x turns
 * into an undo, which keeps the override after all.
 * @param {HTMLElement} row
 * @returns {void}
 */
function toggleUnset(row) {
    if (row.classList.contains("removing")) {
        resetSetting(row);
    } else {
        setFieldValue(row, row.dataset.base);
        row.classList.add("dirty", "removing");
        row.querySelectorAll("input, select, textarea").forEach((field) => {
            /** @type {HTMLInputElement} */ (field).disabled = true;
        });

        const button = /** @type {HTMLElement} */ (row.querySelector("[data-unset]"));
        button.title     = "Keep the override";
        button.innerHTML = `<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path
            d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`;
    }

    showSettingChanges(scopeOf(row));
}

/**
 * Puts a setting back as it was saved, undoing a change or an x.
 * @param {HTMLElement} row
 * @returns {void}
 */
function resetSetting(row) {
    setFieldValue(row, row.dataset.value);
    row.classList.remove("dirty", "removing");
    row.querySelectorAll("input, select, textarea").forEach((field) => {
        /** @type {HTMLInputElement} */ (field).disabled = false;
    });

    const button = row.querySelector("[data-unset]");
    if (button) {
        /** @type {HTMLElement} */ (button).title = "Remove the override";
        button.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    }
}

/**
 * The rows of a page's settings with a change not saved yet.
 * @param {string} scope
 * @returns {HTMLElement[]}
 */
function dirtyRows(scope) {
    return /** @type {HTMLElement[]} */ ([
        ...document.querySelectorAll(`#${SETTING_SCOPES[scope].box} .setting.dirty`),
    ]);
}

/**
 * The changes panel: how many, and each setting with its old and new value,
 * or, for an override going, the value it goes back to and from where.
 * @param {string} scope
 * @returns {void}
 */
function showSettingChanges(scope) {
    const rows = dirtyRows(scope);
    const id   = SETTING_SCOPES[scope].changes;

    document.getElementById(id).hidden = !rows.length;
    document.getElementById(`${id}-count`).textContent = rows.length === 1
        ? "1 unsaved change"
        : `${rows.length} unsaved changes`;

    document.getElementById(`${id}-list`).innerHTML = rows.map((row) => {
        const { key, value, base, from } = row.dataset;
        let to;
        if (row.classList.contains("removing")) {
            to = from ? `${esc(base || "empty")} <i>from ${esc(from)}</i>` : "<i>removed</i>";
        } else {
            to = esc(fieldValue(row) || "empty");
        }

        return `<span class="change"><code>${esc(key)}</code> ${esc(value || "empty")}
            <b>→ ${to}</b></span>`;
    }).join("");
}

/**
 * Saves every change together, the overrides to remove with them: they are
 * checked as one file, and PHP's Apache reloads, or MariaDB restarts, once.
 * When one is refused, nothing is written and the changes stay in their
 * fields, to fix.
 * @param {string} scope
 * @returns {Promise<void>}
 */
async function saveSettings(scope) {
    const rows   = dirtyRows(scope);
    const button = /** @type {HTMLButtonElement} */ (
        document.querySelector(`[data-save-settings="${scope}"]`)
    );
    if (!rows.length || button.disabled) {
        return;
    }

    const changes = rows.map((row) => (row.classList.contains("removing")
        ? { key : row.dataset.key, remove : true }
        : { key : row.dataset.key, value : fieldValue(row) }));
    button.disabled = true;

    try {
        const result = await api("/api/action", SETTING_SCOPES[scope].save(changes));
        toast(result.message);
        rows.forEach((row) => row.classList.remove("dirty", "removing"));
        /** @type {HTMLElement} */ (document.activeElement)?.blur();
        settingsKeys[scope] = "";
        showSettingChanges(scope);
        await refresh();
    } catch (error) {
        toast(error.message, true);
    } finally {
        button.disabled = false;
    }
}

/**
 * Puts every changed setting back as it was saved.
 * @param {string} scope
 * @returns {void}
 */
function discardSettings(scope) {
    dirtyRows(scope).forEach(resetSetting);
    showSettingChanges(scope);
}

// ------------------------------------------------------------ add setting ---

/**
 * The dialog that picks a setting from all PHP or MariaDB knows, filtered as
 * typed, then takes its value. On the page it saves the setting; in the
 * editor it gives it, to be written into the text.
 */
let pick = { list : [], key : "", inEditor : false, scope : "php", resolve : null };

/**
 * Opens the dialog for a page's settings, or for the editor's text, and gives
 * the setting picked with its value once it is, or null when it closes.
 * @param {{ inEditor?: boolean, text?: string, scope?: string }} start
 * @returns {Promise<{ key: string, value: string }>}
 */
async function pickSetting({ inEditor = false, text = "", scope = "php" }) {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("pick"));
    const filter = /** @type {HTMLInputElement} */ (document.getElementById("pick-filter"));
    const { list : url, noun, who, file, filter : placeholder, line } = SETTING_SCOPES[scope];

    finishPick(null);
    let list;

    try {
        list = await api(url);
    } catch (error) {
        toast(error.message, true);
        return null;
    }

    // In the editor, the text being edited says what is overridden.
    if (inEditor) {
        const name = (key) => (scope === "mariadb" ? key.toLowerCase().replace(/-/g, "_") : key);
        const keys = new Set(text.split("\n")
            .map((one) => one.match(line)?.[1])
            .filter(Boolean)
            .map(name));
        list = list.map((one) => ({ ...one, inFile : keys.has(one.key) }));
    }

    pick = { list, key : "", inEditor, scope, resolve : null };
    document.getElementById("pick-title").textContent
        = `${inEditor ? "Insert" : "Add"} ${noun === "option" ? "an option" : "a setting"}`;
    document.getElementById("pick-text").textContent  = inEditor
        ? `Pick one of the ${noun}s ${who} knows, then its value, to write it into the file.`
        : `Pick one of the ${list.length} ${noun}s ${who} knows, then its value. `
            + `It is saved to ${file}.`;

    filter.placeholder = placeholder;
    filter.value       = "";
    choosePick("");
    renderPickList();
    dialog.showModal();
    filter.focus();

    return new Promise((resolve) => {
        pick.resolve = resolve;
    });
}

/**
 * Gives the dialog's answer to whoever is waiting on it, once.
 * @param {{ key: string, value: string }} answer
 * @returns {void}
 */
function finishPick(answer) {
    const resolve = pick.resolve;
    pick.resolve  = null;
    resolve?.(answer);
}

/**
 * The dialog's list: the settings with the filter in their name, grouped.
 * @returns {void}
 */
function renderPickList() {
    const text   = /** @type {HTMLInputElement} */ (document.getElementById("pick-filter")).value
        .trim()
        .toLowerCase();
    const shown  = pick.list.filter((one) => one.key.toLowerCase().includes(text));
    const groups = byOwner(shown, pick.scope);

    document.getElementById("pick-list").innerHTML = !shown.length
        ? `<div class="pkg-none">No ${SETTING_SCOPES[pick.scope].noun} has “${esc(text)}”
            in its name.</div>`
        : groups.map((group) => `
            <div class="pick-group" role="group" aria-label="${esc(group.title)}">
                <div class="pick-group-head">${esc(group.title)}<span>${
                    group.rows.length
                }</span></div>
                ${group.rows.map((one) => `
                    <button type="button" class="pick-row ${one.key === pick.key ? "active" : ""}"
                        data-pick-key="${esc(one.key)}" role="option"
                        ${one.comment ? `title="${esc(one.comment)}"` : ""}>
                        <span class="pick-name">${esc(one.key)}${one.inFile
                            ? ` <span class="tag blue">override</span>` : ""}</span>
                        <span class="pick-value">${one.value === ""
                            ? "<i>empty</i>" : esc(one.value)}</span>
                    </button>
                `).join("")}
            </div>
        `).join("");
}

/**
 * Settings grouped by what they are part of: PHP or MariaDB itself first,
 * then each extension or engine by name, and last the ones it does not know.
 * @param {StudioSetting[]} settings
 * @param {string} scope
 * @returns {{ title: string, rows: StudioSetting[] }[]}
 */
function byOwner(settings, scope) {
    const { first, stranger } = SETTING_SCOPES[scope];
    const groups = new Map();

    for (const one of settings) {
        const title = one.known === false || !one.owner ? stranger : one.owner;
        groups.set(title, [ ...groups.get(title) || [], one ]);
    }

    const rank = (title) => {
        if (title === first) {
            return 0;
        }
        return title === stranger ? 2 : 1;
    };
    return [ ...groups ]
        .map(([ title, rows ]) => ({ title, rows }))
        .sort((a, b) => rank(a.title) - rank(b.title)
            || a.title.localeCompare(b.title, undefined, { sensitivity : "base" }));
}

/**
 * Picks a setting: its value now goes in the field to change, with the
 * choices the page knows for it.
 * @param {string} key
 * @returns {void}
 */
function choosePick(key) {
    const one    = pick.list.find((item) => item.key === key);
    const value  = document.getElementById("pick-value");
    const button = /** @type {HTMLButtonElement} */ (document.getElementById("pick-ok"));
    const { noun, site, lookup } = SETTING_SCOPES[pick.scope];
    pick.key     = one ? key : "";

    let keyHtml;
    if (one) {
        keyHtml = `<a href="${esc(lookup(key))}" target="_blank" rel="noopener"
            title="Look it up on ${site}">${esc(key)}</a>`;
    } else {
        keyHtml = `Pick ${noun === "option" ? "an option" : "a setting"}`;
    }

    document.getElementById("pick-key").innerHTML = keyHtml;

    value.innerHTML = one
        ? settingField(one)
        : `<span class="field"><input disabled></span>`;

    button.disabled = !one;
    if (pick.inEditor) {
        button.textContent = "Insert";
    } else {
        button.textContent = one?.inFile ? "Change" : "Add";
    }

    setPickStatus("");

    for (const row of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("#pick-list .pick-row")
    )) {
        row.classList.toggle("active", row.dataset.pickKey === pick.key);
    }

    const field = /** @type {HTMLInputElement} */ (value.querySelector("input, select, textarea"));
    if (one) {
        field.focus();
        field.select?.();
    }
}

/**
 * Says how the dialog's setting is doing under its value, as a complaint unless told not to.
 * @param {string} text
 * @param {boolean=} bad
 * @returns {void}
 */
function setPickStatus(text, bad = true) {
    const status = document.getElementById("pick-status");
    status.textContent = text;
    status.className   = `editor-status ${text && bad ? "bad" : ""}`;
    status.hidden      = !text;
}

/**
 * Gives the setting to the editor, or saves it, keeping the dialog open with
 * the complaint when PHP or MariaDB does not take the value.
 * @returns {Promise<void>}
 */
async function submitPick() {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("pick"));
    const value  = fieldValue(document.getElementById("pick-value")).trim();
    const button = /** @type {HTMLButtonElement} */ (document.getElementById("pick-ok"));
    const { who, save } = SETTING_SCOPES[pick.scope];
    if (!pick.key || button.disabled) {
        return;
    }

    if (pick.inEditor) {
        finishPick({ key : pick.key, value });
        dialog.close();
        return;
    }

    button.disabled = true;
    setPickStatus(`Checking with ${who}…`, false);

    try {
        const result = await api("/api/action", save([ { key : pick.key, value } ]));
        dialog.close();
        toast(result.message);
        settingsKeys[pick.scope] = "";
        await refresh();
    } catch (error) {
        setPickStatus(error.message);
    } finally {
        button.disabled = false;
    }
}



// The public API
export {
    renderSettingGroups,
    toggleUnset,
    saveSettings,
    discardSettings,
    pickSetting,
    finishPick,
    renderPickList,
    choosePick,
    submitPick,
};
