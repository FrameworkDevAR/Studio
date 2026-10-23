"use strict";

// The PHP page: its settings, where each comes from, and the extensions.

function renderPhp() {
    const { php } = state;
    document.getElementById("php-version").textContent = php.version || "";
    document.getElementById("tab-overrides-count").textContent = String(php.settings.filter((setting) => setting.inFile).length + php.overrides.length);
    renderPhpText();
    renderPhpProblems();
    renderSettings();
    renderExtensions();

    if (/** @type {HTMLDialogElement} */ (document.getElementById("pecl-dialog")).open) {
        renderPeclList();
    }
}

/** The line under the title, about the tab shown. */
function renderPhpText() {
    const { php } = state;
    const file    = php.iniFile.split("/").pop();
    document.getElementById("php-text").innerHTML = phpTab() === "settings"
        ? `Values saved here go to <code title="${esc(php.iniFile)}">${esc(file)}</code>, which PHP reads after <code title="${esc(php.mainIni)}">php.ini</code>, so they win over it. The × takes one out, back to php.ini's value. Changes wait in a panel until saved, then Apache reloads.`
        : `The extensions PHP loads. The ones added with pecl are built from their source for this PHP version, and can be updated or removed here; the rest come with PHP.`;
}

/**
 * What PHP complained about as it started, and the extensions php.ini or pecl
 * ask for that it could not load: after a new minor version, each has to be
 * built again for it.
 */
function renderPhpProblems() {
    const { php } = state;
    const box     = document.getElementById("php-problem");
    const missing = php.missing.map((ext) => `
        <div class="problem-line">
            <span><b>${esc(ext.name)}</b> is not loaded. ${ext.pecl ? "It was built for another PHP version, or its file is gone." : "php.ini asks for it, but pecl did not install it."}</span>
            ${ext.pecl ? `<button class="small" data-pecl-rebuild="${esc(ext.name)}" ${updating.has(`pecl:${ext.name}`) ? "disabled" : ""}>${updating.has(`pecl:${ext.name}`) ? "Building…" : "Build again"}</button>` : ""}
        </div>
    `);
    // Each failed extension also has a warning, said already by its line.
    const names    = php.missing.map((ext) => ext.name);
    const problems = php.problems
        .filter((line) => !names.some((name) => line.includes(`'${name}`) || line.includes(`${name}.so`)))
        .map((line) => `<div class="problem-line"><span>${esc(line)}</span></div>`);
    box.hidden    = !missing.length && !problems.length;
    box.innerHTML = box.hidden ? "" : `<b>PHP has something to say as it starts</b>${[ ...missing, ...problems ].join("")}`;
}

/**
 * The settings, in groups, then the overrides file's other settings, a group
 * for each extension they are part of. Skipped
 * while a field is focused or has an unsaved change, and when nothing
 * changed, so it does not flicker every 5s.
 */
function renderSettings() {
    const { php } = state;
    const box  = document.getElementById("php-settings");
    const key  = JSON.stringify([ php.settings, php.overrides ]);
    showSettingChanges();
    const busy = box.contains(document.activeElement) || box.querySelector(".dirty");
    if (key === settingsKey || busy) {
        return;
    }
    settingsKey = key;
    const byKey  = Object.fromEntries(php.settings.map((setting) => [ setting.key, setting ]));
    const groups = SETTING_GROUPS.map((group) => ({ title : group.title, rows : group.keys.filter((one) => byKey[one]).map((one) => byKey[one]) }));
    // The file's other settings, each with the others of its extension: in
    // the page's group of the same name, as Xdebug, or in one of its own.
    for (const group of byOwner(php.overrides)) {
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
            ${group.rows.map(settingRow).join("")}
        </div>
    `).join("") + `<datalist id="timezones">${php.timezones.map((zone) => `<option value="${esc(zone)}">`).join("")}</datalist>`;
    mosaic(box);

    for (const field of /** @type {NodeListOf<HTMLInputElement>} */ (box.querySelectorAll("input, select"))) {
        field.addEventListener("input", markDirty);
        field.addEventListener("change", markDirty);
        field.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                saveSettings();
            }
            if (event.key === "Escape") {
                resetSetting(/** @type {HTMLElement} */ (field.closest(".setting")));
                showSettingChanges();
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
 */
function settingField(setting) {
    const value = String(setting.value);
    if (setting.options) {
        const options = setting.options.includes(value) ? setting.options : [ value, ...setting.options ];
        return `<span class="field select"><select>${options.map((option) => `<option ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></span>`;
    }
    if (setting.timezone) {
        return `<span class="field"><input list="timezones" value="${esc(value)}" spellcheck="false"></span>`;
    }
    if (SIZE_SETTINGS.includes(setting.key) || /^\d+[KMG]$/i.test(value)) {
        const [ , number, unit ] = value.match(/^(-?\d+)([KMG]?)$/i) || [ "", value, "" ];
        return `
            <span class="field size">
                <input type="number" step="1" min="${setting.key === "memory_limit" ? -1 : 0}" value="${esc(number)}">
                <select aria-label="Unit">${[ [ "", "B" ], [ "K", "KB" ], [ "M", "MB" ], [ "G", "GB" ] ].map(([ one, label ]) => `<option value="${one}" ${one === unit.toUpperCase() ? "selected" : ""}>${label}</option>`).join("")}</select>
            </span>
        `;
    }
    if (/^-?\d+$/.test(value)) {
        return `<span class="field"><input type="number" step="1" value="${esc(value)}"></span>`;
    }
    return `<span class="field"><input value="${esc(value)}" spellcheck="false"></span>`;
}

/**
 * One setting: its name, with what it is for and where its value comes from,
 * or what it goes back to without the override, which the x does.
 */
function settingRow(setting) {
    const inFile = setting.inFile ?? true;
    const value  = String(setting.value);
    const field  = settingField(setting);
    const base   = setting.known === false ? "" : String(setting.base ?? "");
    const shown  = base === "" ? "empty" : base;
    const origin = inFile
        ? setting.known === false
            ? "PHP does not know it: an extension may be missing"
            : setting.baseFrom === "php.ini" ? `php.ini has ${shown}` : `PHP's default is ${shown}`
        : setting.baseFrom === "php.ini" ? "From php.ini" : "PHP's default";
    const hint   = [ SETTING_HINTS[setting.key], origin ].filter(Boolean).map(esc).join(" · ");
    const undo   = inFile ? `
        <button class="icon-btn unset" data-unset title="Remove the override${setting.known === false ? "" : `: back to ${esc(shown)}`}" aria-label="Remove the override">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
    ` : "";
    const from   = setting.known === false ? "" : setting.baseFrom === "php.ini" ? "php.ini" : "PHP's default";
    return `
        <div class="setting ${inFile ? "set" : ""}" data-key="${esc(setting.key)}" data-value="${esc(value)}" data-base="${esc(base)}" data-from="${esc(from)}">
            <label class="setting-key">${esc(setting.key)}</label>
            <small class="setting-hint">${hint}</small>
            ${undo}
            ${field}
        </div>
    `;
}

/** A setting's value as its field holds it: a size's number and unit as one, 512M. */
function fieldValue(row) {
    const size = row.querySelector(".field.size");
    if (size) {
        const number = /** @type {HTMLInputElement} */ (size.querySelector("input")).value.trim();
        const unit   = /** @type {HTMLSelectElement} */ (size.querySelector("select")).value;
        return number === "" || number === "-1" ? number : `${number}${unit}`;
    }
    return /** @type {HTMLInputElement} */ (row.querySelector("input, select")).value;
}

/** Puts a value in a setting's field, adding it to a list that lacks it. */
function setFieldValue(row, value) {
    const size = row.querySelector(".field.size");
    if (size) {
        const [ , number, unit ] = String(value).match(/^(-?\d+)([KMG]?)$/i) || [ "", value, "" ];
        /** @type {HTMLInputElement} */ (size.querySelector("input")).value  = number;
        /** @type {HTMLSelectElement} */ (size.querySelector("select")).value = unit.toUpperCase();
        return;
    }
    const field = /** @type {HTMLSelectElement} */ (row.querySelector("input, select"));
    if (field.tagName === "SELECT" && ![ ...field.options ].some((option) => option.value === value)) {
        field.add(new Option(value, value));
    }
    field.value = value;
}

/**
 * Marks a setting whose value differs from the saved one. The changes panel
 * shows while any does, and saves them all at once.
 */
function markDirty(event) {
    const row = event.target.closest(".setting");
    row.classList.toggle("dirty", fieldValue(row) !== row.dataset.value);
    showSettingChanges();
}

/**
 * The x of an override: like a change, it is only marked, to be saved with
 * the others. The field shows the value it goes back to, and the x turns
 * into an undo, which keeps the override after all.
 */
function toggleUnset(row) {
    if (row.classList.contains("removing")) {
        resetSetting(row);
    } else {
        setFieldValue(row, row.dataset.base);
        row.classList.add("dirty", "removing");
        row.querySelectorAll("input, select").forEach((field) => { /** @type {HTMLInputElement} */ (field).disabled = true; });
        const button = /** @type {HTMLElement} */ (row.querySelector("[data-unset]"));
        button.title     = "Keep the override";
        button.innerHTML = `<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`;
    }
    showSettingChanges();
}

/** Puts a setting back as it was saved, undoing a change or an x. */
function resetSetting(row) {
    setFieldValue(row, row.dataset.value);
    row.classList.remove("dirty", "removing");
    row.querySelectorAll("input, select").forEach((field) => { /** @type {HTMLInputElement} */ (field).disabled = false; });
    const button = row.querySelector("[data-unset]");
    if (button) {
        /** @type {HTMLElement} */ (button).title = "Remove the override";
        button.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    }
}

/**
 * The changes panel: how many, and each setting with its old and new value,
 * or, for an override going, the value it goes back to and from where.
 */
function showSettingChanges() {
    const rows = /** @type {HTMLElement[]} */ ([ ...document.querySelectorAll("#php-settings .setting.dirty") ]);
    document.getElementById("php-changes").hidden = !rows.length;
    document.getElementById("php-changes-count").textContent = rows.length === 1 ? "1 unsaved change" : `${rows.length} unsaved changes`;
    document.getElementById("php-changes-list").innerHTML = rows.map((row) => {
        const { key, value, base, from } = row.dataset;
        const to = row.classList.contains("removing")
            ? from ? `${esc(base || "empty")} <i>from ${esc(from)}</i>` : "<i>removed</i>"
            : esc(fieldValue(row) || "empty");
        return `<span class="change"><code>${esc(key)}</code> ${esc(value || "empty")} <b>→ ${to}</b></span>`;
    }).join("");
}

/**
 * Saves every change together, the overrides to remove with them: PHP checks
 * them as one file and Apache reloads once. When PHP refuses one, nothing is
 * written and the changes stay in their fields, to fix.
 */
async function saveSettings() {
    const rows   = /** @type {HTMLElement[]} */ ([ ...document.querySelectorAll("#php-settings .setting.dirty") ]);
    const button = /** @type {HTMLButtonElement} */ (document.querySelector("[data-php-save]"));
    if (!rows.length || button.disabled) {
        return;
    }
    const changes = rows.map((row) => (row.classList.contains("removing")
        ? { key : row.dataset.key, remove : true }
        : { key : row.dataset.key, value : fieldValue(row) }));
    button.disabled = true;
    try {
        const result = await api("/api/action", { action : "php-settings", changes });
        toast(result.message);
        rows.forEach((row) => row.classList.remove("dirty", "removing"));
        /** @type {HTMLElement} */ (document.activeElement)?.blur();
        settingsKey = "";
        showSettingChanges();
        await refresh();
    } catch (error) {
        toast(error.message, true);
    } finally {
        button.disabled = false;
    }
}

/** Puts every changed setting back as it was saved. */
function discardSettings() {
    document.querySelectorAll("#php-settings .setting.dirty").forEach((row) => resetSetting(/** @type {HTMLElement} */ (row)));
    showSettingChanges();
}

// ------------------------------------------------------------ add setting ---

/**
 * The dialog that picks a setting from all PHP knows, filtered as typed,
 * then takes its value. On the page it saves the setting; in the editor it
 * gives it, to be written into the text.
 */
let pick = { list : [], key : "", inEditor : false, resolve : null };

function addSetting() {
    pickSetting({ inEditor : false });
}

async function pickSetting({ inEditor, text = "" }) {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("pick"));
    const filter = /** @type {HTMLInputElement} */ (document.getElementById("pick-filter"));
    finishPick(null);
    let list;
    try {
        list = await api("/api/php-directives");
    } catch (error) {
        toast(error.message, true);
        return null;
    }
    // In the editor, the text being edited says what is overridden.
    if (inEditor) {
        const keys = new Set(text.split("\n").map((line) => line.match(/^\s*([\w.]+)\s*=/)?.[1]).filter(Boolean));
        list = list.map((one) => ({ ...one, inFile : keys.has(one.key) }));
    }
    pick = { list, key : "", inEditor, resolve : null };
    document.getElementById("pick-title").textContent = inEditor ? "Insert a setting" : "Add a setting";
    document.getElementById("pick-text").textContent  = inEditor
        ? "Pick one of the settings PHP knows, then its value, to write it into the file."
        : `Pick one of the ${list.length} settings PHP knows, then its value. It is saved to the overrides file.`;
    filter.value = "";
    choosePick("");
    renderPickList();
    dialog.showModal();
    filter.focus();
    return new Promise((resolve) => {
        pick.resolve = resolve;
    });
}

function finishPick(answer) {
    const resolve = pick.resolve;
    pick.resolve  = null;
    resolve?.(answer);
}

function renderPickList() {
    const text   = /** @type {HTMLInputElement} */ (document.getElementById("pick-filter")).value.trim().toLowerCase();
    const shown  = pick.list.filter((one) => one.key.toLowerCase().includes(text));
    const groups = byOwner(shown);
    document.getElementById("pick-list").innerHTML = !shown.length
        ? `<div class="pkg-none">No setting has “${esc(text)}” in its name.</div>`
        : groups.map((group) => `
            <div class="pick-group" role="group" aria-label="${esc(group.title)}">
                <div class="pick-group-head">${esc(group.title)}<span>${group.rows.length}</span></div>
                ${group.rows.map((one) => `
                    <button type="button" class="pick-row ${one.key === pick.key ? "active" : ""}" data-pick-key="${esc(one.key)}" role="option">
                        <span class="pick-name">${esc(one.key)}${one.inFile ? ` <span class="tag blue">override</span>` : ""}</span>
                        <span class="pick-value">${one.value === "" ? "<i>empty</i>" : esc(one.value)}</span>
                    </button>
                `).join("")}
            </div>
        `).join("");
}

/**
 * Settings grouped by what they are part of: PHP itself first, then each
 * extension by name, and last the ones PHP does not know.
 */
function byOwner(settings) {
    const groups = new Map();
    for (const one of settings) {
        const title = one.known === false || !one.owner ? "Not known to PHP" : one.owner;
        groups.set(title, [ ...groups.get(title) || [], one ]);
    }
    const rank = (title) => (title === "Core" ? 0 : title === "Not known to PHP" ? 2 : 1);
    return [ ...groups ]
        .map(([ title, rows ]) => ({ title, rows }))
        .sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title, undefined, { sensitivity : "base" }));
}

/**
 * Picks a setting: its value now goes in the field to change, with the
 * choices the page knows for it.
 */
function choosePick(key) {
    const one    = pick.list.find((item) => item.key === key);
    const value  = document.getElementById("pick-value");
    const button = /** @type {HTMLButtonElement} */ (document.getElementById("pick-ok"));
    pick.key     = one ? key : "";
    document.getElementById("pick-key").innerHTML = one
        ? `<a href="https://www.php.net/search.php?pattern=${encodeURIComponent(key)}" target="_blank" rel="noopener" title="Look it up on php.net">${esc(key)}</a>`
        : "Pick a setting";
    value.innerHTML = one
        ? settingField(one)
        : `<span class="field"><input disabled></span>`;
    button.disabled    = !one;
    button.textContent = pick.inEditor ? "Insert" : one?.inFile ? "Change" : "Add";
    setPickStatus("");
    for (const row of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("#pick-list .pick-row"))) {
        row.classList.toggle("active", row.dataset.pickKey === pick.key);
    }
    const field = /** @type {HTMLInputElement} */ (value.querySelector("input, select"));
    if (one) {
        field.focus();
        field.select?.();
    }
}

function setPickStatus(text, bad = true) {
    const status = document.getElementById("pick-status");
    status.textContent = text;
    status.className   = `editor-status ${text && bad ? "bad" : ""}`;
    status.hidden      = !text;
}

/**
 * Gives the setting to the editor, or saves it, keeping the dialog open with
 * PHP's complaint when it does not take the value.
 */
async function submitPick() {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("pick"));
    const value  = fieldValue(document.getElementById("pick-value")).trim();
    const button = /** @type {HTMLButtonElement} */ (document.getElementById("pick-ok"));
    if (!pick.key || button.disabled) {
        return;
    }
    if (pick.inEditor) {
        finishPick({ key : pick.key, value });
        dialog.close();
        return;
    }
    button.disabled = true;
    setPickStatus("Checking with PHP…", false);
    try {
        const result = await api("/api/action", { action : "php-setting", key : pick.key, value });
        dialog.close();
        toast(result.message);
        settingsKey = "";
        await refresh();
    } catch (error) {
        setPickStatus(error.message);
    } finally {
        button.disabled = false;
    }
}

// -------------------------------------------------------------- extensions ---

/**
 * The extensions: first the ones added to PHP, with their versions, sizes
 * and buttons, then, apart, the ones that come with it.
 */
function renderExtensions() {
    const { php } = state;
    const added   = php.extensions.filter((ext) => ext.added);
    const builtIn = php.extensions.filter((ext) => !ext.added);
    const behind  = added.filter((ext) => ext.latest).length;
    document.getElementById("ext-count").textContent       = String(php.extensions.length);
    document.getElementById("ext-panel-count").textContent = String(php.extensions.length);
    document.getElementById("pecl-outdated").innerHTML = !added.some((ext) => ext.pecl)
        ? ""
        : !php.checked
            ? "Checking for updates…"
            : behind
                ? `<b>${behind} outdated</b> <button data-pecl-update-all>${isUpdating("pecl") ? "Updating…" : "Update extensions"}</button>`
                : "All up to date";
    // The ones being installed, from the dialog, open or closed, until PHP
    // loads them, in their places among the others.
    const names    = new Set(php.extensions.map((ext) => ext.name.toLowerCase()));
    const building = [ ...updating ]
        .filter((key) => key.startsWith("pecl-install:") && !names.has(key.slice(13)))
        .map((key) => ({ name : key.slice(13), building : true }));
    // The filter keeps the extensions whose name holds what is typed.
    const filter   = /** @type {HTMLInputElement} */ (document.getElementById("php-ext-filter")).value.trim().toLowerCase();
    const matches  = (ext) => ext.name.toLowerCase().includes(filter);
    const rows     = [ ...added, ...building ].filter(matches).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity : "base" }));
    const others   = builtIn.filter(matches);
    document.getElementById("php-extensions").innerHTML = !rows.length && !others.length
        ? `<div class="pkg-none">No extensions match “${esc(filter)}”.</div>`
        : [
        rows.length ? `<div class="pkg-list wide">${rows.map((ext) => (ext.building ? packageRow({
            name    : ext.name,
            url     : `https://pecl.php.net/package/${ext.name}`,
            tag     : "pecl",
            size    : 0,
            version : "Building…",
            actions : `<span class="pkg-building" title="Being built and installed" aria-label="Building"></span>`,
        }) : packageRow({
            name    : ext.name,
            url     : ext.pecl ? `https://pecl.php.net/package/${ext.name}` : "",
            tag     : ext.pecl ? "pecl" : "added",
            size    : ext.size,
            version : ext.version,
            latest  : ext.latest,
            actions : extensionButtons(ext),
        }))).join("")}</div>` : "",
        others.length ? `<div class="pkg-list">${others.map((ext) => packageRow({ name : ext.name, tag : "", actions : null })).join("")}</div>` : "",
        ].join("");
    markColumnEnds(document.getElementById("php-extensions"));
}

/** An added extension's buttons: update when newer, and remove, for pecl's. */
function extensionButtons(ext) {
    if (!ext.pecl) {
        return "";
    }
    const id       = ext.name.toLowerCase();
    const busy     = updating.has(`pecl:${id}`);
    const removing = updating.has(`pecl-remove:${id}`);
    return `
        ${ext.latest ? `
            <button class="icon-btn update ${busy ? "busy" : ""}" title="Update to the newest" aria-label="Update ${esc(ext.name)}" data-pecl-update="${esc(id)}" ${busy ? "disabled" : ""}>
                <svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
            </button>
        ` : ""}
        <button class="icon-btn remove ${removing ? "busy" : ""}" title="Uninstall" aria-label="Uninstall ${esc(ext.name)}" data-pecl-remove="${esc(id)}" ${removing ? "disabled" : ""}>
            <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
    `;
}

async function uninstallExtension(name) {
    if (!await ask({ title : `Uninstall ${name}?`, text : "Its file and its line in php.ini go, and Apache reloads without it.", ok : "Uninstall", danger : true })) {
        return;
    }
    updating.add(`pecl-remove:${name}`);
    renderPhp();
    try {
        await followJob({ action : "pecl-remove", name });
    } finally {
        updating.delete(`pecl-remove:${name}`);
        renderPhp();
    }
}

/** Builds an extension again for this PHP version, as pecl install does. */
async function rebuildExtension(name) {
    updating.add(`pecl:${name}`);
    renderPhp();
    try {
        await followJob({ action : "pecl-rebuild", name });
    } finally {
        updating.delete(`pecl:${name}`);
        renderPhp();
    }
}

// ---------------------------------------------------------------- install ---

let peclSearchTimer = null;
let peclFound       = [];
let peclAsked       = "";

function openPeclDialog() {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("pecl-dialog"));
    dialog.querySelector(".logo-tile").innerHTML = logoSvg("php");
    dialog.showModal();
    /** @type {HTMLInputElement} */ (dialog.querySelector("input")).select();
    renderPeclList();
}

/** Searches PECL as the field changes, a moment after the typing stops. */
function searchPecl(now = false) {
    const text = /** @type {HTMLInputElement} */ (document.querySelector("#pecl-search input")).value.trim();
    clearTimeout(peclSearchTimer);
    if (text.length < 2) {
        peclAsked = text;
        peclFound = [];
        renderPeclList();
        return;
    }
    peclSearchTimer = setTimeout(async () => {
        peclAsked = text;
        renderPeclList(true);
        try {
            const list = await api(`/api/pecl-search?q=${encodeURIComponent(text)}`);
            if (peclAsked === text) {
                peclFound = list;
                renderPeclList();
            }
        } catch (error) {
            if (peclAsked === text) {
                peclFound = [];
                renderPeclList(false, error.message);
            }
        }
    }, now ? 0 : 300);
}

/**
 * The results, as the npm dialog shows its own. An extension whose newest
 * release is years old likely does not build on a PHP this new, which it
 * says beside the date.
 */
function renderPeclList(loading = false, failed = "") {
    const box = document.getElementById("pecl-list");
    if (failed || loading || !peclFound.length) {
        const text = failed || (loading ? "Searching…" : peclAsked.length >= 2 ? `No extensions match “${esc(peclAsked)}”.` : "Search PECL for an extension to build and add to PHP. Most others are part of PHP already.");
        box.innerHTML = `<div class="npm-empty">${text}</div>`;
        return;
    }
    const minor = (state.php.version || "").split(".").slice(0, 2).join(".");
    box.innerHTML = peclFound.map((ext) => {
        const years = ext.date ? (Date.now() - Date.parse(ext.date)) / (365 * 86_400_000) : 0;
        return `
            <div class="npm-item">
                <div class="npm-item-body">
                    <a class="npm-name" href="https://pecl.php.net/package/${esc(ext.name)}" target="_blank" rel="noopener">${esc(ext.name)}</a>
                    ${ext.summary ? `<p>${esc(ext.summary)}</p>` : ""}
                    <div class="npm-meta">
                        ${[
                            ext.version ? `latest <b>${esc(ext.version)}</b>${ext.stable ? "" : ` <span class="tag amber">beta</span>`}` : "no releases",
                            ext.date ? `${ago(ext.date)}${years > 3 ? ` <span class="tag amber" title="Old extensions often do not build on new PHP versions">may not build on PHP ${esc(minor)}</span>` : ""}` : "",
                            ext.license ? esc(ext.license) : "",
                        ].filter(Boolean).join(`<i class="sep">·</i>`)}
                    </div>
                </div>
                ${peclActions(ext)}
            </div>
        `;
    }).join("");
}

/**
 * What a result offers: Install, or for one here its version, Update when
 * PECL has a newer one, and Uninstall. One that comes with PHP says so.
 */
function peclActions(ext) {
    const id   = ext.name.toLowerCase();
    const mine = state.php.extensions.find((one) => one.name.toLowerCase() === id);
    if (updating.has(`pecl-install:${id}`)) {
        return `<div class="npm-actions"><button class="npm-install" disabled>Building…</button></div>`;
    }
    if (!mine) {
        return `<div class="npm-actions"><button class="npm-install" data-pecl-install="${esc(ext.name)}" ${ext.version ? "" : "disabled"}>Install</button></div>`;
    }
    if (!mine.pecl) {
        return `<div class="npm-actions"><span class="npm-here">${mine.added ? "Added by hand, not with pecl" : "Part of PHP already"}</span></div>`;
    }
    const newer    = ext.version && isNewer(ext.version, mine.version);
    const busy     = updating.has(`pecl:${id}`);
    const removing = updating.has(`pecl-remove:${id}`);
    return `
        <div class="npm-actions">
            <span class="npm-here">Installed <b>${esc(mine.version)}</b>${newer ? `<span class="pkg-latest">→ ${esc(ext.version)}</span>` : " · newest"}</span>
            <span class="npm-buttons">
                ${newer ? `<button class="small" data-pecl-update="${esc(id)}" ${busy ? "disabled" : ""}>${busy ? "Updating…" : "Update"}</button>` : ""}
                <button class="small danger" data-pecl-remove="${esc(id)}" ${removing ? "disabled" : ""}>${removing ? "Removing…" : "Uninstall"}</button>
            </span>
        </div>
    `;
}

/**
 * Builds and installs an extension from the dialog, which stays open. A
 * PECL release that is only a beta is named with its version, since pecl
 * installs stable ones by name alone.
 */
async function installPecl(name) {
    const id  = name.toLowerCase();
    const ext = peclFound.find((one) => one.name.toLowerCase() === id);
    if (updating.has(`pecl-install:${id}`)) {
        return;
    }
    updating.add(`pecl-install:${id}`);
    renderPeclList();
    renderExtensions();
    try {
        await followJob({ action : "pecl-install", name : ext && !ext.stable ? `${id}-${ext.version}` : id });
    } finally {
        updating.delete(`pecl-install:${id}`);
        renderPeclList();
        renderExtensions();
    }
}
