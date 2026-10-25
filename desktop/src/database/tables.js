// The tables' menu and what it does: add, rename, duplicate, empty, drop and maintain
// them; and switching to another database from the title.

import { api } from "../core/api.js";
import { ask, bytes, closeMenus, esc, formDialog, toast } from "../core/helpers.js";
import { navigate } from "../core/routes.js";
import { state } from "../core/state.js";
import { showMenuAt } from "./cells.js";
import { NUMBER_TYPE, TYPE_LENGTHS, typeOptions } from "./columns.js";
import { openCsvImport, openExportDialog } from "./export.js";
import { loadEngines } from "./info.js";
import { browse, browsePath, gridContext, loadTables, marked, showBrowse } from "./page.js";
import { loadRows } from "./rows.js";
import { loadCharsets } from "../pages/databases.js";
import { countOf } from "../pages/node.js";



// ---------------------------------------------------------------- table menu ---

/**
 * A table's menu, on a right click in the Tables tab or the side's list,
 * as Sequel Ace's: to open it, add a table, rename or duplicate this one,
 * copy its name or CREATE, and empty or drop it.
 */
let tableMenu = "";
let tableMenuNames = [];



/**
 * Opens a table's menu at a point, for it alone or for the tables marked with it.
 * @param {string} name
 * @param {number} x
 * @param {number} y
 * @param {string[]=} names The tables marked with it, for what is done to several.
 * @returns {void}
 */
function openTableMenu(name, x, y, names = [ name ]) {
    const table = browse.tables.find((one) => one.name === name);
    const here  = name === browse.table ? browse.tab : "";

    tableMenu      = name;
    tableMenuNames = names.length ? names : [ name ];

    const menu  = document.getElementById("row-menu");
    const views = tableMenuNames.every(
        (one) => browse.tables.find((item) => item.name === one)?.view,
    );
    const upkeep = `
        <hr>
        <button role="menuitem" data-table-act="optimize"
            ${views ? "disabled" : ""}>Optimize</button>
        <button role="menuitem" data-table-act="analyze"
            ${views ? "disabled" : ""}>Analyze</button>
        <button role="menuitem" data-table-act="check">Check</button>
        <button role="menuitem" data-table-act="repair" ${views ? "disabled" : ""}>Repair</button>
    `;

    if (tableMenuNames.length > 1) {
        const count = tableMenuNames.length;
        menu.innerHTML = `
            <button role="menuitem" data-table-act="export">Export ${count} Tables…</button>
            <button role="menuitem" data-table-act="copy">Copy Names</button>
            ${upkeep.replace(/>(Optimize|Analyze|Check|Repair)</g, `>$1 ${count} Tables<`)}
        `;
        showMenuAt(menu, x, y);
        return;
    }

    menu.innerHTML = `
        ${here === "rows" ? "" : `<button role="menuitem" data-table-act="rows">Open Rows</button>`}
        ${here === "structure" ? ""
            : `<button role="menuitem" data-table-act="structure">Open Structure</button>`}
        <hr>
        <button role="menuitem" data-table-act="add">Add Table…</button>
        <button role="menuitem" data-table-act="rename">Rename…</button>
        <button role="menuitem" data-table-act="duplicate">Duplicate…</button>
        <hr>
        <button role="menuitem" data-table-act="export">Export…</button>
        <button role="menuitem" data-table-act="import"
            ${table?.view ? "disabled" : ""}>Import CSV…</button>
        <hr>
        <button role="menuitem" data-table-act="copy">Copy Name</button>
        <button role="menuitem" data-table-act="create">Copy Create Syntax</button>
        ${upkeep}
        <hr>
        <button role="menuitem" data-table-act="empty" class="danger-item"
            ${table?.view ? "disabled" : ""}>Empty…</button>
        <button role="menuitem" data-table-act="drop" class="danger-item">Drop…</button>
    `;
    showMenuAt(menu, x, y);
}

/**
 * The button in a table's tabs that opens its menu, under it.
 * @returns {string}
 */
function tableMenuButton() {
    return `<button class="ghost" data-table-menu
        aria-haspopup="menu">Table<svg class="chevron"
        viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>`;
}

/**
 * Opens the table's menu under its button, or closes it when the button opened it.
 * @param {HTMLElement} button
 * @returns {void}
 */
function toggleTableMenu(button) {
    const menu = document.getElementById("row-menu");
    if (!menu.hidden && menu.dataset.from === "button") {
        closeMenus();
        return;
    }

    const box = button.getBoundingClientRect();
    openTableMenu(browse.table, box.left, box.bottom + 6);

    // Kept inside the window: under the button, to its right edge when it would run out.
    menu.style.left = `${Math.max(
        8,
        Math.min(box.left, box.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8),
    )}px`;
    menu.dataset.from = "button";
}

/**
 * Does what was picked in a table's menu, to the table or to the tables marked.
 * @param {string} act
 * @returns {Promise<void>}
 */
async function tableAction(act) {
    const name  = tableMenu;
    const names = tableMenuNames;

    if ([ "optimize", "analyze", "check", "repair" ].includes(act)) {
        return maintainTables(act, names);
    }
    if (act === "rows" || act === "structure") {
        return navigate(browsePath(act, name));
    }
    if (act === "add") {
        return openTableDialog();
    }
    if (act === "rename" || act === "duplicate") {
        return openTableNameDialog(name, act === "duplicate");
    }
    if (act === "empty") {
        return emptyTable(name);
    }
    if (act === "import") {
        return openCsvImport(name);
    }
    if (act === "export") {
        // From the rows, their choices; elsewhere, the table among the database's.
        if (name === browse.table && browse.tab === "rows" && names.length === 1) {
            return openExportDialog({ rows : browse.filters.length ? "filtered" : "all" });
        }

        return openExportDialog({ tables : names });
    }
    if (act === "drop") {
        return dropTable(name);
    }

    let text = names.join("\n");
    if (act === "create") {
        try {
            const table = await api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${
                encodeURIComponent(name)
            }`);
            text = table.create;
        } catch (error) {
            toast(error.message, true);
            return;
        }
    }

    await navigator.clipboard.writeText(text);
    toast("Copied");
}

/**
 * Optimizes, analyzes, checks or repairs tables, as MariaDB does each, and
 * shows what it said of each: OK, or its note, warning or error. The sizes
 * are read again after, as optimizing gives space back.
 * @param {string} op "optimize", "analyze", "check" or "repair".
 * @param {string[]} names
 * @returns {Promise<void>}
 */
async function maintainTables(op, names) {
    const doing = {
        optimize : "Optimizing",
        analyze  : "Analyzing",
        check    : "Checking",
        repair   : "Repairing",
    }[op];
    const what  = names.length === 1 ? names[0] : `${names.length} tables`;
    const shown = ask({
        title  : `${doing} ${what}…`,
        body   : `<p class="muted">MariaDB is working on it.
            A large table takes a while.</p>`,
        ok     : "Done",
        closeX : true,
    });

    const okBtn = /** @type {HTMLButtonElement} */ (document.getElementById("ask-ok"));
    okBtn.disabled = true;

    let answer;
    try {
        answer = await api("/api/action", {
            action : "db-table-upkeep",
            db     : browse.db,
            op,
            tables : names,
        });
    } catch (error) {
        document.getElementById("ask-title").textContent = `${doing} ${what} failed`;
        document.getElementById("ask-body").innerHTML    = `<p
            class="editor-status bad">${esc(error.message)}</p>`;
        okBtn.disabled = false;
        return;
    }

    const time  = answer.time < 1000 ? `${answer.time} ms`
        : `${(answer.time / 1000).toFixed(1)} s`;
    const worst = (said) => {
        if (said.some((one) => one.type === "error")) {
            return "bad";
        }

        if (said.some((one) => one.type === "warning")) {
            return "warn";
        }

        return "ok";
    };
    const fine  = answer.results.filter((one) => worst(one.said) === "ok").length;

    document.getElementById("ask-title").textContent = `${doing.replace(/ing$/, "ed")} ${what}`;
    document.getElementById("ask-text").textContent  = `${fine} of ${
        countOf(answer.results.length, "table")
    } OK · ${time}`;
    document.getElementById("ask-body").innerHTML    = `
        <div class="upkeep-list">${answer.results.map((one) => `
            <div class="upkeep-row ${worst(one.said)}">
                <span class="upkeep-table">${esc(one.table)}</span>
                <span class="upkeep-said">${one.said.map((line) => `<span
                    class="${line.type}">${esc(line.type === "status" ? line.text
                        : `${line.type}: ${line.text}`)}</span>`).join("")}</span>
            </div>
        `).join("")}</div>
    `;

    okBtn.disabled = false;
    loadTables();
    await shown;
}

/**
 * A new table, as Sequel Ace starts one: its name and a first column, an
 * id by default, with the primary key on it, then its engine, collation
 * and comment. Its structure opens next, to add the rest.
 * @returns {Promise<void>}
 */
async function openTableDialog() {
    let charsets, engines;

    try {
        [ charsets, engines ] = await Promise.all([ loadCharsets(), loadEngines() ]);
    } catch (error) {
        toast(error.message, true);
        return;
    }

    const collation = state?.databases.list.find((one) => one.name === browse.db)?.collation || "";

    formDialog({
        title  : `New table in ${browse.db}`,
        body   : `
            <label class="form-row"><span>Name</span><input name="name" maxlength="64"
                placeholder="orders" spellcheck="false" required></label>
            <div class="column-type">
                <label class="form-row"><span>First column</span><input name="column" value="id"
                    maxlength="64" spellcheck="false" required></label>
                <label class="form-row"><span>Type</span><span class="field select"><select
                    name="type">${typeOptions("int")}</select></span></label>
                <label class="form-row"><span>Length / values</span><input name="length"
                    spellcheck="false"></label>
            </div>
            <div class="column-checks">
                <label class="check"><input type="checkbox" class="box" name="primary"
                    checked><span>Primary key</span></label>
                <label class="check" data-table-number><input type="checkbox" class="box"
                    name="unsigned" checked><span>Unsigned</span></label>
                <label class="check" data-table-number><input type="checkbox" class="box"
                    name="increment" checked><span>Auto increment</span></label>
            </div>
            <div class="form-pair">
                <label class="form-row"><span>Engine</span><span class="field select"><select
                    name="engine">
                    ${engines.map((one) => `<option value="${esc(one.name)}"
                        title="${esc(one.comment)}"
                        ${one.preset ? "selected" : ""}>${esc(one.name)}</option>`).join("")}
                </select></span></label>
                <label class="form-row"><span>Collation</span><span class="field select"><select
                    name="collation">
                    <option value="">The database's${collation ? `, ${esc(collation)}`
                        : ""}</option>
                    ${charsets.map((set) => `<optgroup
                        label="${esc(set.description)} (${esc(set.name)})">${set.collations.map(
                            (one) => `<option>${esc(one)}</option>`,
                        ).join("")}</optgroup>`).join("")}
                </select></span></label>
            </div>
            <label class="form-row"><span>Comment</span><input name="comment" maxlength="2048"
                placeholder="What the table holds" spellcheck="false"></label>
        `,
        ok     : "Create",
        ready  : (fields) => {
            const form = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const size = /** @type {HTMLInputElement} */ (form.elements.namedItem("length"));
            const type = /** @type {HTMLSelectElement} */ (form.elements.namedItem("type"));
            const keyed = /** @type {HTMLInputElement} */ (form.elements.namedItem("primary"));
            const count = /** @type {HTMLInputElement} */ (form.elements.namedItem("increment"));

            // Auto increment needs the key; unsigned and auto increment, a number.
            const update = () => {
                const hint = TYPE_LENGTHS[type.value];
                size.disabled    = !hint;
                size.placeholder = hint ? hint[0] : "None for this type";

                for (const box of /** @type {NodeListOf<HTMLElement>} */ (
                    fields.querySelectorAll("[data-table-number]")
                )) {
                    box.hidden = !NUMBER_TYPE.test(type.value);
                }

                count.disabled = !keyed.checked;
            };

            form.addEventListener("input", update);
            type.addEventListener("change", () => {
                size.value = TYPE_LENGTHS[type.value]?.[1] || "";
                update();
            });
            update();
        },
        submit : async (form) => {
            const data    = new FormData(form);
            const type    = String(data.get("type"));
            const sized   = String(data.get("length") ?? "").trim();
            const number  = NUMBER_TYPE.test(type);
            const primary = data.get("primary") === "on";
            const name    = String(data.get("name"));
            const result  = await api("/api/action", {
                action    : "db-table-create",
                db        : browse.db,
                name,
                primary,
                engine    : String(data.get("engine")),
                collation : String(data.get("collation")),
                comment   : String(data.get("comment")),
                column    : {
                    name      : String(data.get("column")),
                    type      : `${type}${sized && TYPE_LENGTHS[type] ? `(${sized})` : ""}${
                        number && data.get("unsigned") === "on" ? " unsigned" : ""
                    }`,
                    nullable  : !primary,
                    value     : primary ? "none" : "null",
                    increment : number && primary && data.get("increment") === "on",
                },
            });

            await loadTables();
            navigate(browsePath("structure", result.table));
            return result;
        },
    });
}

/**
 * A table's new name, or its copy's, with its rows or not; a view copies as its query.
 * @param {string} name
 * @param {boolean} copy
 * @returns {void}
 */
function openTableNameDialog(name, copy) {
    const view = browse.tables.find((one) => one.name === name)?.view;

    formDialog({
        title  : copy ? `Duplicate ${name}` : `Rename ${name}`,
        text   : copy && !view
            ? "Its columns, indexes and options are copied; its foreign keys and triggers are not."
            : "",
        body   : `
            <label class="form-row"><span>${copy ? "Name of the copy" : "New name"}</span><input
                name="name" value="${esc(copy ? `${name}_copy` : name)}" maxlength="64"
                spellcheck="false" required></label>
            ${copy && !view ? `<label class="check"><input type="checkbox" class="box" name="data"
                checked><span>With its rows</span></label>` : ""}
        `,
        ok     : copy ? "Duplicate" : "Rename",
        ready  : (fields) => /** @type {HTMLInputElement} */ (
            fields.querySelector("input[name=name]")
        ).select(),
        submit : async (form) => {
            const data   = new FormData(form);
            const result = await api("/api/action", {
                action : copy ? "db-table-copy" : "db-table-rename",
                db     : browse.db,
                table  : name,
                name   : String(data.get("name")),
                data   : data.get("data") === "on",
            });

            marked["overview-grid"] = {
                key     : result.table,
                context : gridContext("overview-grid"),
            };

            await tableGone(copy ? null : name, result.table);
            return result;
        },
    });
}

/**
 * Empties a table once asked, and reads the tables and its rows again.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function emptyTable(name) {
    const table = browse.tables.find((one) => one.name === name);
    const sure  = await ask({
        title  : `Empty ${name}?`,
        text   : `Its ${table?.exact ? "" : "~"}${
            (table?.rows || 0).toLocaleString()
        } rows are gone for good, and its auto_increment starts again at 1.`,
        ok     : "Empty",
        danger : true,
    });
    if (!sure) {
        return;
    }

    try {
        const { message } = await api("/api/action", {
            action : "db-table-empty",
            db     : browse.db,
            table  : name,
        });
        toast(message);
    } catch (error) {
        toast(error.message, true);
        return;
    }

    await loadTables();

    if (browse.table === name && browse.tab === "rows") {
        loadRows();
    }
}

/**
 * Drops a table or a view once asked.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function dropTable(name) {
    const view = browse.tables.find((one) => one.name === name)?.view;
    const sure = await ask({
        title  : `Drop the ${view ? "view" : "table"} ${name}?`,
        text   : view ? "Only the view goes: the tables it reads keep their rows."
            : "The table and all its rows are gone for good.",
        ok     : "Drop",
        danger : true,
    });
    if (!sure) {
        return;
    }

    try {
        const { message } = await api("/api/action", {
            action : "db-table-drop",
            db     : browse.db,
            table  : name,
        });
        toast(message);
    } catch (error) {
        toast(error.message, true);
        return;
    }

    await tableGone(name, null);
}

/**
 * The tables read again after one is renamed, copied or dropped; the
 * page showing a table renamed follows it, and one dropped goes back to
 * the Tables tab.
 * @param {string} old The table renamed or dropped, or null for a copy.
 * @param {string} name The table's new name, or null when it is dropped.
 * @returns {Promise<void>}
 */
async function tableGone(old, name) {
    const open = old !== null && browse.table === old;
    if (open) {
        browse.table     = name || "";
        browse.structure = null;
        browse.rows      = null;
    }

    await loadTables();

    if (open && [ "structure", "rows", "info" ].includes(browse.tab)) {
        if (name) {
            history.replaceState(null, "", browsePath(browse.tab, name));
            showBrowse();
        } else {
            navigate(browsePath("tables"));
        }
    }
}

// ------------------------------------------------------- switching databases ---

/**
 * The databases to switch to, from the title: filtered as typed, each with
 * its size and tables, the one open marked. ↑ and ↓ move, Enter goes.
 */
let switchAt = 0;
/**
 * Opens the databases to switch to, with the filter empty, or closes them.
 * @returns {void}
 */
function toggleDbSwitch() {
    const menu = document.getElementById("db-switch");
    if (!menu.hidden) {
        closeMenus();
        return;
    }

    closeMenus(menu);
    menu.hidden = false;

    const filter = /** @type {HTMLInputElement} */ (document.getElementById("db-switch-filter"));
    filter.value = "";
    renderDbSwitch();
    filter.focus();
}

/**
 * The databases whose name has what is typed in the filter.
 * @returns {{ name: string, size: number, tables: number, charset: string,
 *             collation: string, users: string[], url: string }[]}
 */
function switchList() {
    const search = /** @type {HTMLInputElement} */ (document.getElementById("db-switch-filter"))
        .value.trim().toLowerCase();
    return (state?.databases.list || []).filter((one) => one.name.toLowerCase().includes(search));
}

/**
 * Draws the databases to switch to, one of them marked.
 * @param {(number | null)=} at The one marked, by its place, or the database open.
 * @returns {void}
 */
function renderDbSwitch(at = null) {
    const list = switchList();
    switchAt   = at ?? Math.max(0, list.findIndex((one) => one.name === browse.db));
    switchAt   = Math.min(switchAt, list.length - 1);
    const box  = document.getElementById("db-switch-list");

    box.innerHTML = list.map((one, place) => `
        <button type="button" role="option" data-db-go="${esc(one.name)}"
            class="${place === switchAt ? "active" : ""} ${one.name === browse.db ? "current"
                : ""}">
            <span class="db-switch-name">${esc(one.name)}</span>
            <small>${countOf(one.tables, "table")} · ${bytes(one.size)}</small>
        </button>
    `).join("") || `<div class="menu-none">No database matches.</div>`;
    box.querySelector(".active")?.scrollIntoView({ block : "nearest" });
}

/**
 * Opens another database: in the SQL tab when there, else its tables, as the table open is this
 * one's.
 * @param {string} name
 * @returns {void}
 */
function switchDatabase(name) {
    closeMenus();
    if (name && name !== browse.db) {
        navigate(browse.tab === "sql"
            ? `/${[ "database", name, "sql" ].map(encodeURIComponent).join("/")}`
            : `/database/${encodeURIComponent(name)}`);
    }
}

/**
 * The keys of the databases to switch to: ↑ and ↓ move, Enter goes, Escape closes.
 * @param {KeyboardEvent} event
 * @returns {void}
 */
function dbSwitchKeys(event) {
    const list = switchList();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        renderDbSwitch(Math.max(
            0,
            Math.min(list.length - 1, switchAt + (event.key === "ArrowDown" ? 1 : -1)),
        ));
    } else if (event.key === "Enter") {
        event.preventDefault();
        switchDatabase(list[switchAt]?.name);
    } else if (event.key === "Escape") {
        closeMenus();
    }
}



// The public API
export {
    openTableMenu,
    tableMenuButton,
    toggleTableMenu,
    tableAction,
    openTableDialog,
    toggleDbSwitch,
    renderDbSwitch,
    switchDatabase,
    dbSwitchKeys,
};
