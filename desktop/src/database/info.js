"use strict";

// A table's information, as Sequel Ace's: its engine, encoding, comment and next id.

// -------------------------------------------------------------- information ---

/** The engines MariaDB has on, asked once, when the Information tab first needs them. */
let engineList = null;
/**
 * The engines, from the server the first time and as kept after: each with its comment, and
 * whether it is the default.
 * @returns {Promise<{ name: string, comment: string, preset: boolean }[]>}
 */
async function loadEngines() {
    engineList = engineList || await api("/api/engines");
    return engineList;
}

/**
 * The table's information, as Sequel Ace's Table Information has it: its
 * engine and encoding, which change here, its dates, its rows and sizes,
 * its next id and comment, which change here too, and its CREATE
 * statement. A view's is only read.
 * @returns {Promise<void>}
 */
async function loadInfo() {
    const box = document.getElementById("browse-info");
    if (!browse.table) {
        box.innerHTML = `<div class="pkg-none">This database has no tables yet.</div>`;
        return;
    }
    let structure, engines, charsets;
    try {
        [ structure, engines, charsets ] = await Promise.all([
            api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${
                encodeURIComponent(browse.table)}`),
            loadEngines(),
            loadCharsets(),
        ]);
    } catch (error) {
        box.innerHTML = `<div class="pkg-none">${esc(error.message)}</div>`;
        return;
    }
    // Only the last table asked for shows, when several were gone through quickly.
    const table = browse.tables.find((one) => one.name === structure.table);
    if (structure.table !== browse.table || !table) {
        return;
    }
    browse.structure = structure;
    const charset = table.collation.split("_")[0];
    const when    = (text) => text
        ? new Date(text.replace(" ", "T")).toLocaleString([], {
            dateStyle : "medium",
            timeStyle : "medium",
        })
        : "";
    const pair    = (label, value, id = "") => `<dt>${label}</dt><dd ${id ? `id="${id}"` : ""}
        class="${value ? "" : "none"}">${value || "—"}</dd>`;
    const names   = engines.some((one) => one.name === table.engine)
        ? engines
        : [ { name : table.engine, comment : "" }, ...engines ];
    const view    = table.view;
    box.innerHTML = `
        <div class="panel-head">
            <h2>${esc(table.name)} <span class="muted">· ${view ? "view" : "table"}</span></h2>
            <div class="actions">${view ? "" : `<span id="info-status"
                class="editor-status"></span><button data-info-save
                disabled>Save</button>`}${tableMenuButton()}</div>
        </div>
        <form id="info-form" class="info-form" autocomplete="off">
            <dl class="info-grid">
                ${view ? pair("Type", "View") : `
                    <dt>Type</dt>
                    <dd><span class="field select"><select name="engine">${
                        names.map((one) => `<option
                        value="${esc(one.name)}" title="${esc(one.comment)}"
                        ${one.name === table.engine ? "selected" : ""}>${esc(one.name)}</option>`)
                        .join("")}</select></span></dd>
                `}
                ${pair("Created at", esc(when(table.created)))}
                ${view ? pair("Encoding", "") : `
                    <dt>Encoding</dt>
                    <dd><span class="field select"><select name="charset">${
                        charsets.map((one) => `<option
                        value="${esc(one.name)}" ${one.name === charset ? "selected" : ""}>${
                        esc(one.description)} (${esc(one.name)})</option>`)
                        .join("")}</select></span></dd>
                `}
                ${pair("Updated at", esc(when(table.updated)))}
                ${view ? pair("Collation", "") : `
                    <dt>Collation</dt>
                    <dd><span class="field select"><select name="collation"></select></span></dd>
                `}
                <dt></dt>
                <dd>${view ? "" : `
                    <label class="check" id="info-convert" hidden>
                        <input type="checkbox" class="box" name="convert">
                        <span>Convert its columns too<small>Otherwise only new columns get
                            it</small></span>
                    </label>
                `}</dd>
            </dl>
            <dl class="info-grid info-stats">
                ${pair("Number of rows", view ? "" : rowsCell(table), "info-rows")}
                ${pair("Data size", view ? "" : bytes(table.data))}
                ${pair("Row format", esc(table.format))}
                ${pair("Max data size", view || !table.most ? "" : bytes(table.most))}
                ${pair("Avg. row length", view ? "" : bytes(table.average))}
                ${pair("Index size", view ? "" : bytes(table.index))}
                ${table.next === null ? pair("Auto increment", "") : `
                    <dt>Auto increment</dt>
                    <dd class="info-next-field">
                        <input name="next" type="number" min="1" step="1" value="${table.next}"
                            class="info-next" title="The id the next row gets">
                        <button type="button" class="ghost" data-reset-next
                            title="The id after the highest there, to save">Reset</button>
                    </dd>
                `}
                ${pair("Free data size", view ? "" : bytes(table.free))}
            </dl>
            ${view ? "" : `
                <dl class="info-wide">
                    <dt>Comment</dt>
                    <dd><span class="field"><textarea name="comment" rows="2" maxlength="2048"
                        placeholder="What the table holds"
                        spellcheck="false">${esc(table.comment)}</textarea></span></dd>
                </dl>
            `}
            <dl class="info-wide info-create">
                <dt>Create syntax<button type="button" class="ghost small"
                    data-copy-create>Copy</button></dt>
                <dd><pre>${paintSql(structure.create)}</pre></dd>
            </dl>
        </form>
    `;
    if (!view) {
        setUpInfoForm(table, charset);
    }
    watchFades(/** @type {HTMLElement} */ (box.querySelector(".info-create pre")));
}

/** The values the form started with, to send only what is changed. */
let infoStart = {};

/**
 * The form's collations follow its encoding, keeping the kind picked, as
 * general_ci; Save turns on once something changes, and converting the
 * columns is offered once the encoding does.
 * @param {{ collation: string }} table
 * @param {string} charset
 * @returns {void}
 */
function setUpInfoForm(table, charset) {
    const form = /** @type {HTMLFormElement} */ (document.getElementById("info-form"));
    const set  = /** @type {HTMLSelectElement} */ (form.elements.namedItem("charset"));
    const sort = /** @type {HTMLSelectElement} */ (form.elements.namedItem("collation"));
    const fill = (wanted) => {
        const one  = charsetList.find((item) => item.name === set.value);
        const kind = wanted.replace(/^[^_]+_/, "");
        const pick = one.collations.includes(wanted)
            ? wanted
            : one.collations.find((name) => name === `${one.name}_${kind}`) || one.collation;
        sort.innerHTML = one.collations
            .map((name) => `<option ${name === pick ? "selected" : ""}>${esc(name)}</option>`)
            .join("");
    };
    fill(table.collation);
    infoStart = infoValues();
    set.addEventListener("change", () => fill(sort.value));
    form.addEventListener("input", infoChanged);
    form.addEventListener("change", infoChanged);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        saveInfo();
    });
}

/**
 * The form's values, by option, null for one it does not have, as a view's.
 * @returns {Object<string, string>}
 */
function infoValues() {
    const data = new FormData(/** @type {HTMLFormElement} */ (
        document.getElementById("info-form")
    ));
    return Object.fromEntries([ "engine", "charset", "collation", "comment", "next" ]
        .map((name) => [ name, data.has(name) ? String(data.get(name)) : null ]));
}

/**
 * What the form changes, by option; the encoding as a pair, as it is set together.
 * @returns {{ engine?: string, charset?: string, collation?: string, comment?: string,
 *     next?: string }}
 */
function infoChanges() {
    const now     = infoValues();
    const changes = {};
    if (now.engine !== infoStart.engine) {
        changes.engine = now.engine;
    }
    if (now.charset !== infoStart.charset || now.collation !== infoStart.collation) {
        changes.charset   = now.charset;
        changes.collation = now.collation;
    }
    if (now.comment !== infoStart.comment) {
        changes.comment = now.comment;
    }
    if (now.next !== infoStart.next && now.next !== "") {
        changes.next = now.next;
    }
    return changes;
}

/**
 * Turns Save on once something is changed, and offers to convert the columns once the encoding is.
 * @returns {void}
 */
function infoChanged() {
    const changes = infoChanges();
    /** @type {HTMLButtonElement} */ (document.querySelector("[data-info-save]")).disabled
        = !Object.keys(changes).length;
    /** @type {HTMLElement} */ (document.getElementById("info-convert")).hidden = !changes.charset;
}

/**
 * Saves what changed. A new engine, or columns converted, rewrite the
 * table, which takes a while in a large one, so the status says so.
 * @returns {Promise<void>}
 */
async function saveInfo() {
    const changes = infoChanges();
    const button  = /** @type {HTMLButtonElement} */ (document.querySelector("[data-info-save]"));
    const status  = document.getElementById("info-status");
    const convert = Boolean(changes.charset)
        && /** @type {HTMLInputElement} */ (
            document.querySelector("#info-form [name=convert]")
        ).checked;
    button.disabled    = true;
    status.className   = "editor-status";
    status.textContent = changes.engine || convert ? "Rewriting the table…" : "Saving…";
    try {
        const result = await api("/api/action", {
            action : "db-table-change",
            db     : browse.db,
            table  : browse.table,
            ...changes,
            convert,
        });
        toast(result.message);
        await loadTables();
        await loadInfo();
    } catch (error) {
        status.className   = "editor-status bad";
        status.textContent = error.message;
        button.disabled    = false;
    }
}

/**
 * Puts the id after the highest one in the table in the next id's field,
 * as resetting it to where the rows are, to save with the rest.
 * @param {HTMLButtonElement} button
 * @returns {Promise<void>}
 */
async function resetNext(button) {
    button.disabled = true;
    try {
        const { next } = await api("/api/action", {
            action : "db-next-id",
            db     : browse.db,
            table  : browse.table,
        });
        const field    = /** @type {HTMLInputElement} */ (
            document.querySelector("#info-form [name=next]")
        );
        field.value    = String(next);
        field.dispatchEvent(new Event("input", { bubbles : true }));
    } catch (error) {
        toast(error.message, true);
    }
    button.disabled = false;
}

/**
 * Copies the table's CREATE statement.
 * @returns {void}
 */
function copyCreate() {
    navigator.clipboard.writeText(browse.structure.create).then(() => toast("Copied"));
}
