// The grids' fading edges, the rows' menu, and the rows changed in place, in a dialog
// or a cell at a time.

import { api } from "../core/api.js";
import { ask, closeMenus, esc, formDialog, toast } from "../core/helpers.js";
import { codeArea, escapeCode, paintJson, paintMarkup } from "../core/paint.js";
import { openExportDialog } from "./export.js";
import { browse, loadTables, marked, pickRow, revealRow } from "./page.js";
import { isBig, loadRows, renderRows, rowsQuestion } from "./rows.js";
import { countOf } from "../pages/node.js";



/** @import { DbStructureColumn } from "./structure.js" */



// ------------------------------------------------------------------- fades ---

/** What sets a box's fades again once its size changes. */
const fadeSizes = new ResizeObserver((entries) => entries.forEach(
    (entry) => fadeEdges(/** @type {HTMLElement} */ (entry.target)),
));



/**
 * Fades a scrolling box's edges where more of it is hidden: the bottom and
 * the sides, and the top too, unless its header stays there. On the right,
 * the fade comes before a grid's edit buttons, which stay at that edge.
 *
 * Fades a box's edges now, and again as it scrolls or changes size.
 * @param {HTMLElement} box
 * @returns {void}
 */
function watchFades(box) {
    if (!box.dataset.fades) {
        box.dataset.fades = "1";
        box.addEventListener("scroll", () => fadeEdges(box), { passive : true });
        fadeSizes.observe(box);
    }

    fadeEdges(box);
}

/**
 * Sets a box's fades for where it is scrolled to now.
 * @param {HTMLElement} box
 * @returns {void}
 */
function fadeEdges(box) {
    const edge = (more) => (more ? "28px" : "0px");
    const head = box.querySelector("thead");

    box.style.setProperty("--fade-top", edge(!head && box.scrollTop > 1));
    const below = box.scrollTop + box.clientHeight < box.scrollHeight - 1;
    box.style.setProperty("--fade-bottom", edge(below));

    // The bottom fade ends above the totals, which stay whole at that edge.
    box.style.setProperty(
        "--fade-foot",
        `${below ? box.querySelector("tfoot")?.offsetHeight || 0 : 0}px`,
    );
    box.style.setProperty("--fade-floor", below ? "transparent" : "#000");

    box.style.setProperty("--fade-left", edge(box.scrollLeft > 1));
    const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
    box.style.setProperty("--fade-right", edge(right));
    box.style.setProperty("--fade-edge", right ? "transparent" : "#000");
}

/**
 * A row's primary key, by column, which the server finds it by.
 * @param {number} index
 * @returns {Object<string, string>}
 */
function rowKey(index) {
    const { structure, rows } = browse.rows;
    return Object.fromEntries(structure.primary.map((name) => [
        name,
        rows[index][structure.columns.findIndex((column) => column.name === name)],
    ]));
}

/**
 * The dialog that changes a row, read whole first, as the grid cuts long
 * values, or adds one, empty or a copy of another. Each column has a field
 * fitting its type, a NULL box when it takes NULL, and binary columns are
 * kept as they are. A new row's empty fields get their column's default,
 * as an auto_increment id, which a copy leaves empty, as its binary values.
 * @param {(number | null)=} index
 * @param {(number | null)=} copy
 * @returns {Promise<void>}
 */
async function openRowDialog(index = null, copy = null) {
    const { structure } = browse.rows;
    const key = index === null ? null : rowKey(index);
    let values;

    try {
        if (key) {
            const { row } = await api("/api/action", {
                action : "db-row",
                db     : browse.db,
                table  : browse.table,
                key,
            });
            values = row;
        } else {
            values = structure.columns.map(() => "");
        }

        if (copy !== null) {
            const { row } = await api("/api/action", {
                action : "db-row",
                db     : browse.db,
                table  : browse.table,
                key    : rowKey(copy),
            });
            values        = structure.columns.map((column, at) => (
                column.binary || column.extra.includes("auto_increment") ? "" : row[at]
            ));
        }
    } catch (error) {
        toast(error.message, true);
        return;
    }

    const from = copy === null ? ""
        : Object.entries(rowKey(copy)).map(([ name, value ]) => `${name} ${value}`).join(" · ");

    let title;
    let text;
    if (key) {
        title = `Change the row of ${structure.table}`;
        text  = Object.entries(key).map(([ name, value ]) => `${name} ${value}`).join(" · ");
    } else if (copy !== null) {
        title = `Duplicate the row of ${structure.table}`;
        text  = `A copy of ${from}. Empty fields get their column's default${
            structure.columns.some((column) => column.binary)
                ? "; binary values aren't copied" : ""
        }.`;
    } else {
        title = `New row in ${structure.table}`;
        text  = "Empty fields get their column's default.";
    }

    formDialog({
        title,
        text,
        body   : structure.columns.map((column, at) => rowField(column, values[at], !key)).join(""),
        ok     : key ? "Save" : "Add",
        remove : key ? { label : "Delete row", run : () => deleteRows([ index ]) } : null,
        ready  : (fields) => fields.addEventListener("change", (event) => {
            const box = /** @type {HTMLInputElement} */ (event.target);
            if (box.dataset.nullFor !== undefined) {
                /** @type {HTMLInputElement} */ (box.closest(".form-row")
                    .querySelector("[data-column]")).disabled = box.checked;
            }
        }),
        submit : async (form) => {
            const changed = {};

            structure.columns.forEach((column, at) => {
                const field = /** @type {HTMLInputElement} */ (form.querySelector(
                    `[data-column="${CSS.escape(column.name)}"]`,
                ));
                const none  = /** @type {HTMLInputElement} */ (form.querySelector(
                    `[data-null-for="${CSS.escape(column.name)}"]`,
                ));
                if (!field || column.binary) {
                    return;
                }

                const value = none?.checked ? null : field.value;
                if (key ? value !== values[at] : value !== "") {
                    changed[column.name] = value;
                }
            });

            if (key && !Object.keys(changed).length) {
                return { message : "Nothing changed" };
            }

            const result = await api("/api/action", {
                action : "db-row-save",
                db     : browse.db,
                table  : browse.table,
                key,
                values : changed,
            });

            loadRows();

            // The table's count, in the title and the list, with the row added.
            if (!key) {
                loadTables();
            }

            return result;
        },
    });
}

/**
 * A column's field: its choices for an enum, a box for long text, a line otherwise.
 * @param {DbStructureColumn} column
 * @param {string} value
 * @param {boolean} adding
 * @returns {string}
 */
function rowField(column, value, adding) {
    const name   = esc(column.name);
    const isNull = value === null;

    let hint = "";
    if (adding && column.binary) {
        hint = "left empty: binary values are set with SQL";
    } else if (adding && column.extra.includes("auto_increment")) {
        hint = "auto";
    } else if (adding && column.default !== null) {
        hint = `default: ${column.default}`;
    }

    const attrs  = `data-column="${name}" ${isNull || column.binary ? "disabled" : ""}
        spellcheck="false" placeholder="${esc(hint)}"`;
    const text   = value ?? "";
    let   field;
    const choices = column.type.match(/^enum\((.*)\)$/)?.[1]
        .match(/'((?:[^']|'')*)'/g)
        ?.map((one) => one.slice(1, -1).replace(/''/g, "'"));

    if (column.binary) {
        field = `<input ${attrs} value="${esc(value ? `${value}, kept as it is` : "")}">`;
    } else if (choices) {
        field = `<span class="field select"><select ${attrs}>${
            adding ? `<option value="">${esc(hint || "—")}</option>` : ""
        }${choices.map((one) => `<option ${one === text ? "selected" : ""}>${esc(one)}</option>`)
            .join("")}</select></span>`;
    } else if (/text|json|blob/.test(column.dataType) || text.length > 60 || text.includes("\n")) {
        field = `<textarea ${attrs}
            rows="${Math.min(8, Math.max(3, text.split("\n").length))}">${esc(text)}</textarea>`;
    } else {
        field = `<input ${attrs} value="${esc(text)}">`;
    }

    let nullBox = "";
    if (column.nullable && !column.binary) {
        nullBox = `<label class="check"><input type="checkbox"
            class="box" data-null-for="${name}"
            ${isNull ? "checked" : ""}><span>NULL</span></label>`;
    }

    return `
        <div class="form-row row-field">
            <span>${name} <small class="col-type">${esc(column.type)}${
                column.key === "PRI" ? " · key" : ""
            }</small></span>
            <div class="row-value">
                ${field}
                ${nullBox}
            </div>
        </div>
    `;
}

/**
 * Deletes a row once it is confirmed, from its dialog; gives whether it did.
 * Deletes rows, by their place on the page, once asked: one by its key, or how many.
 * @param {number[]} indexes
 * @returns {Promise<boolean>}
 */
async function deleteRows(indexes) {
    const keys = indexes.map(rowKey);
    const sure = await ask({
        title  : keys.length === 1 ? `Delete the row of ${browse.table}?`
            : `Delete ${keys.length} rows of ${browse.table}?`,
        text   : `${keys.length === 1
            ? Object.entries(keys[0]).map(([ name, value ]) => `${name} ${value}`).join(" · ")
            : "They are"}${keys.length === 1 ? ". It is" : ""} gone for good.`,
        ok     : "Delete",
        danger : true,
    });
    if (!sure) {
        return false;
    }

    try {
        const body = keys.length === 1 ? { key : keys[0] } : { keys };
        const { message } = await api("/api/action", {
            action : "db-row-delete",
            db     : browse.db,
            table  : browse.table,
            ...body,
        });
        toast(message);
    } catch (error) {
        toast(error.message, true);
        return false;
    }

    delete marked["rows-grid"];
    loadRows();
    loadTables();

    return true;
}

// ---------------------------------------------------------------- row menu ---

/** The rows the rows' menu acts on, by index, and the column clicked. */
let rowMenu = { indexes : [ 0 ], at : -1 };

/**
 * Keeps the rows, and the column, the row's menu acts on.
 * @param {{ indexes: number[], at: number }} value
 * @returns {void}
 */
function setRowMenu(value) {
    rowMenu = value;
}

/**
 * The rows' menu, on a right click, as Sequel Ace's: the rows marked copied
 * as text, with their column names, or as an INSERT, with or without their
 * auto_increment ids; the values of the column clicked, as they are or as
 * SQL; then to change or duplicate a row, or delete them, when the table
 * has a key.
 *
 * Opens the rows' menu at a point, for the rows marked and the column clicked.
 * @param {number[]} indexes
 * @param {number} at
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function openRowMenu(indexes, at, x, y) {
    const { structure } = browse.rows;
    const keyed  = rowsKeyed() ? "" : "disabled";
    const one    = indexes.length === 1 ? keyed : "disabled";
    const column = structure.columns[at];
    const many   = indexes.length > 1 ? "s" : "";
    const menu   = document.getElementById("row-menu");

    // The NULL item, only for a column clicked that can be set to NULL.
    let nullItem = "";
    if (column && column.nullable && rowsKeyed() && !column.binary
        && ![ "virtual", "stored" ].includes(column.value.kind)) {
        nullItem = `<button role="menuitem" data-row-act="null">Set '${esc(column.name)}' to NULL${
            many ? ` in ${indexes.length} Rows` : ""
        }</button>`;
    }

    rowMenu = { indexes, at };
    menu.innerHTML = `
        <button role="menuitem"
            data-row-act="copy">Copy${many ? ` ${indexes.length} Rows` : ""}</button>
        <button role="menuitem" data-row-act="names">Copy with Column Names</button>
        <button role="menuitem" data-row-act="insert">Copy as SQL INSERT</button>
        ${structure.columns.some((one) => one.extra.includes("auto_increment"))
            ? `<button role="menuitem"
                data-row-act="insert-new">Copy as SQL INSERT (no auto_increment)</button>`
            : ""}
        ${column ? `
            ${nullItem}
            <button role="menuitem"
                data-row-act="value">Copy '${esc(column.name)}' Value${many}</button>
            <button role="menuitem"
                data-row-act="value-sql">Copy '${esc(column.name)}' Value${many} as SQL</button>
        ` : ""}
        <button role="menuitem"
            data-row-act="export">Export${many ? ` ${indexes.length} Rows` : " Row"}…</button>
        <hr>
        <button role="menuitem" data-row-act="edit" ${one}>Edit…</button>
        <button role="menuitem" data-row-act="duplicate" ${one}>Duplicate…</button>
        <button role="menuitem" data-row-act="delete" class="danger-item"
            ${keyed}>Delete${many ? ` ${indexes.length} Rows` : ""}…</button>
    `;
    showMenuAt(menu, x, y);
}

/**
 * Opens a right click's menu at the pointer, kept inside the window.
 * @param {HTMLElement} menu
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function showMenuAt(menu, x, y) {
    closeMenus(menu);
    menu.dataset.from = "";
    menu.hidden     = false;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top  = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
}

/**
 * Does what was picked in a row's menu.
 * @param {string} act
 * @returns {Promise<boolean | void>}
 */
async function rowAction(act) {
    const { indexes, at } = rowMenu;

    if (act === "edit") {
        return openRowDialog(indexes[0]);
    }
    if (act === "duplicate") {
        return openRowDialog(null, indexes[0]);
    }
    if (act === "delete") {
        return deleteRows(indexes);
    }
    if (act === "export") {
        return openExportDialog({ rows : "picked" });
    }
    if (act === "null") {
        const column = browse.rows.structure.columns[at];

        try {
            const { message } = await api("/api/action", {
                action : "db-rows-set",
                db     : browse.db,
                table  : browse.table,
                keys   : indexes.map(rowKey),
                column : column.name,
                value  : null,
            });
            toast(message);
        } catch (error) {
            toast(error.message, true);
            return;
        }

        loadRows();
        return;
    }

    const { structure } = browse.rows;
    let rows = indexes.map((index) => browse.rows.rows[index]);

    // The rows whole, as the grid cuts long text and shows binary values by their size.
    if (rowsKeyed()) {
        try {
            const whole = await api("/api/action", {
                action : "db-row",
                db     : browse.db,
                table  : browse.table,
                keys   : indexes.map(rowKey),
                hex    : true,
            });
            rows = whole.rows;
        } catch (error) {
            toast(error.message, true);
            return;
        }
    }

    const columns = structure.columns.map((column, place) => ({ column, place }));
    const plain   = (column, value) => {
        if (value === null) {
            return "NULL";
        }
        if (column.binary && rowsKeyed()) {
            return `0x${value}`;
        }
        return value;
    };
    const sql     = (column, value) => {
        if (value === null) {
            return "NULL";
        }
        if (column.binary && rowsKeyed()) {
            return value ? `0x${value}` : "''";
        }
        if (/int|decimal|float|double/.test(column.dataType)
            && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value)) {
            return value;
        }
        return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
            .replace(/\n/g, "\\n").replace(/\r/g, "\\r")}'`;
    };
    const ident   = (name) => `\`${name.replace(/`/g, "``")}\``;
    const line    = (row) => columns.map(({ column, place }) => plain(column, row[place]))
        .join("\t");
    // One INSERT for all, a row of values on each line, as Sequel Ace's.
    const insert  = (list) => `INSERT INTO ${ident(structure.table)} (${
        list.map(({ column }) => ident(column.name)).join(", ")
    }) VALUES${rows.length > 1 ? "\n\t" : " "}${
        rows.map((row) => `(${
            list.map(({ column, place }) => sql(column, row[place])).join(", ")
        })`).join(",\n\t")
    };`;

    const text = {
        "copy"       : () => rows.map(line).join("\n"),
        "names"      : () => [
            columns.map(({ column }) => column.name).join("\t"),
            ...rows.map(line),
        ].join("\n"),
        "insert"     : () => insert(columns),
        "insert-new" : () => insert(columns.filter(
            ({ column }) => !column.extra.includes("auto_increment"),
        )),
        "value"      : () => rows.map((row) => plain(structure.columns[at], row[at])).join("\n"),
        "value-sql"  : () => rows.map((row) => sql(structure.columns[at], row[at])).join(", "),
    }[act]();

    await navigator.clipboard.writeText(text);
    toast(rows.length > 1 ? `Copied ${rows.length} rows` : "Copied");
}

// -------------------------------------------------------- changing in place ---

/**
 * Whether the rows shown can be changed: a table's, with a primary key to find each by.
 * @returns {boolean}
 */
function rowsKeyed() {
    const { structure } = browse.rows;
    return structure.primary.length > 0
        && !browse.tables.find((one) => one.name === structure.table)?.view;
}

/** The cell being changed where it is, while one is, or null. */
let editing = null;

/**
 * A cell changed where it is, as in Sequel Ace, by a double click, in a
 * field as wide as its column: Enter or a click away saves it, Escape
 * leaves it, Tab saves it and goes to the next cell, Shift-Tab to the one
 * before, and ↑ and ↓ to the same column of the row above or below. A big
 * value changes in a dialog instead, and a binary one only in the row's.
 *
 * Changes a cell where it is, or in a dialog when its value is big or binary.
 * @param {HTMLElement} td
 * @returns {void}
 */
function editCell(td) {
    if (!rowsKeyed() || editing) {
        return;
    }

    const index  = Number(td.closest("tr").dataset.row);
    const at     = Number(td.dataset.at);
    const column = browse.rows.structure.columns[at];
    const value  = browse.rows.rows[index][at];

    if (column.binary) {
        openRowDialog(index);
        return;
    }
    if (isBig(value)) {
        editValue(index, at);
        return;
    }

    const input = document.createElement("input");
    input.className   = "cell-input";
    input.value       = value ?? "";
    input.placeholder = value === null ? "NULL" : "";
    input.spellcheck  = false;

    const edit = { index, at, old : value, input, done : false };
    editing = edit;

    // The cell's width less its padding while changed, so the column keeps its.
    input.style.width = `${td.clientWidth - 4}px`;
    td.classList.add("editing");
    td.replaceChildren(input);
    input.focus();
    input.select();

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            saveCell(edit);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            edit.done = true;
            editing   = null;
            renderRows();
        } else if (event.key === "Tab") {
            event.preventDefault();
            saveCell(edit, () => nextCell(index, at, event.shiftKey ? -1 : 1));
        } else if ((event.key === "ArrowUp" || event.key === "ArrowDown")
            && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            saveCell(edit, () => cellBelow(index, at, event.key === "ArrowUp" ? -1 : 1));
        }
    });

    input.addEventListener("blur", () => saveCell(edit));
}

/**
 * Saves a cell changed in place, if it is, then goes on to the cell asked for, if any.
 * @param {{ index: number, at: number, old: string, input: HTMLInputElement,
 *     done: boolean }} edit
 * @param {(() => void)=} then
 * @returns {Promise<void>}
 */
async function saveCell(edit, then = null) {
    if (edit.done) {
        return;
    }

    edit.done = true;
    const text = edit.input.value;
    if (edit.old === null ? text !== "" : text !== edit.old) {
        edit.input.disabled = true;

        try {
            await saveValue(edit.index, edit.at, text);
        } catch (error) {
            // It stays open, to fix.
            toast(error.message, true);
            edit.done           = false;
            edit.input.disabled = false;
            edit.input.focus();
            return;
        }
    }

    editing = null;
    renderRows();
    then?.();
}

/**
 * The cell after or before one, as shown, on to the next row or the one before at either end,
 * to change; binary ones are passed.
 * @param {number} index
 * @param {number} at
 * @param {number} by
 * @returns {void}
 */
function nextCell(index, at, by) {
    const columns = browse.rows.structure.columns;
    const cells   = /** @type {HTMLElement[]} */ ([
        ...document.querySelectorAll("#rows-grid tbody td[data-at]"),
    ])
        .filter((td) => !columns[Number(td.dataset.at)].binary || Number(td.dataset.at) === at);
    const here  = cells.findIndex((td) => Number(td.closest("tr").dataset.row) === index
        && Number(td.dataset.at) === at);
    const next  = cells[here + by];
    if (next) {
        changeAt(next);
    }
}

/**
 * The cell of the same column in the row above or below, to change.
 * @param {number} index
 * @param {number} at
 * @param {number} by
 * @returns {void}
 */
function cellBelow(index, at, by) {
    const rows = /** @type {HTMLElement[]} */ ([
        ...document.querySelectorAll("#rows-grid tbody tr[data-row]"),
    ]);
    const tr   = rows[rows.findIndex((one) => Number(one.dataset.row) === index) + by];
    const td   = /** @type {HTMLElement} */ (tr?.querySelector(`td[data-at="${at}"]`));
    if (td) {
        changeAt(td);
    }
}

/**
 * Marks a cell's row, scrolls to it, and changes the cell.
 * @param {HTMLElement} td
 * @returns {void}
 */
function changeAt(td) {
    const tr = /** @type {HTMLElement} */ (td.closest("tr"));
    pickRow(tr);
    revealRow(/** @type {HTMLTableElement} */ (tr.closest("table")), tr);
    editCell(td);
}

/**
 * Saves one value of a row, found by its key as it was, and shows it at
 * once; then reads the row again, for what MariaDB made of it, as a
 * number trimmed or a date put in its form.
 * @param {number} index
 * @param {number} at
 * @param {string} value
 * @returns {Promise<void>}
 */
async function saveValue(index, at, value) {
    const { structure, rows } = browse.rows;

    await api("/api/action", {
        action : "db-row-save",
        db     : browse.db,
        table  : browse.table,
        key    : rowKey(index),
        values : { [structure.columns[at].name] : value },
    });

    rows[index][at] = value;

    const asked = JSON.stringify(rowsQuestion());
    api("/api/action", {
        action : "db-row",
        db     : browse.db,
        table  : browse.table,
        key    : rowKey(index),
    }).then(({ row }) => {
        if (asked === JSON.stringify(rowsQuestion()) && browse.rows.rows === rows) {
            rows[index] = row;
            if (!editing) {
                renderRows();
            }
        }
    }).catch(() => {
        // The value as typed stays.
    });
}

/**
 * A big value changed in a dialog, in a text like the editor's, with its
 * line numbers and JSON or HTML painted: the whole of it, read first if
 * the grid cut it, JSON laid out to read and saved back as compact as it
 * was, and NULL as a box when the column takes it. ⌘S saves.
 * @param {number} index
 * @param {number} at
 * @returns {Promise<void>}
 */
async function editValue(index, at) {
    const { structure, rows, cut } = browse.rows;
    const column = structure.columns[at];
    let value = rows[index][at];
    if (value !== null && value.length > cut) {
        try {
            const { row } = await api("/api/action", {
                action : "db-row",
                db     : browse.db,
                table  : browse.table,
                key    : rowKey(index),
            });
            value = row[at];
        } catch (error) {
            toast(error.message, true);
            return;
        }
    }

    let json  = false;
    let shown = value ?? "";

    if (/^\s*[[{]/.test(shown)) {
        try {
            shown = JSON.stringify(JSON.parse(shown), null, 2);
            json  = true;
        } catch {
            // Not JSON after all: changed as text.
        }
    }

    const compact = json && !/\n/.test(value);
    const markup  = !json && /^\s*<[!?A-Za-z]/.test(shown);

    let nullBox = "";
    if (column.nullable) {
        nullBox = `<label class="check"><input type="checkbox" class="box" name="null"
            ${value === null ? "checked" : ""}><span>NULL</span></label>`;
    }

    formDialog({
        title  : column.name,
        text   : `${column.type}${json ? " · JSON" : ""} · ${
            countOf((value ?? "").length, "character")
        }`,
        body   : `
            <div class="editor-body value-code">
                <pre class="editor-lines" aria-hidden="true"></pre>
                <div class="editor-code">
                    <pre class="editor-paint" aria-hidden="true"></pre>
                    <textarea name="value" spellcheck="false" autocomplete="off"
                        autocapitalize="off" wrap="off">${esc(shown)}</textarea>
                </div>
            </div>
            ${nullBox}
        `,
        ok     : "Save",
        ready  : (fields) => {
            const dialog = fields.closest("dialog");
            dialog.classList.add("wide");
            dialog.addEventListener(
                "close",
                () => dialog.classList.remove("wide"),
                { once : true },
            );

            const box = /** @type {HTMLElement} */ (fields.querySelector(".value-code"));
            let paint;
            if (json) {
                paint = paintJson;
            } else if (markup) {
                paint = paintMarkup;
            } else {
                paint = escapeCode;
            }
            codeArea(
                box,
                paint,
                json ? "  " : "    ",
            );

            // ⌘S or ⌘↩ saves, as in the editor.
            box.querySelector("textarea").addEventListener("keydown", (event) => {
                if ((event.metaKey || event.ctrlKey)
                    && (event.key === "s" || event.key === "Enter")) {
                    event.preventDefault();
                    /** @type {HTMLFormElement} */ (fields.closest("form")).requestSubmit();
                }
            });
        },
        submit : async (form) => {
            const data = new FormData(form);
            let text   = String(data.get("value"));

            if (json && data.get("null") !== "on") {
                try {
                    const parsed = JSON.parse(text);
                    text = compact ? JSON.stringify(parsed) : text;
                } catch (error) {
                    throw new Error(`It is not JSON any more: ${error.message}`);
                }
            }

            const next = data.get("null") === "on" ? null : text;
            if (next === value) {
                return { message : "Nothing changed" };
            }

            await saveValue(index, at, next);
            renderRows();
            return { message : `Saved ${column.name}` };
        },
    });

    const area = /** @type {HTMLTextAreaElement} */ (document.querySelector(
        "#form .value-code textarea",
    ));
    area.focus();
    area.setSelectionRange(0, 0);
}



// The public API
export {
    watchFades,
    fadeEdges,
    rowKey,
    openRowDialog,
    deleteRows,
    setRowMenu,
    openRowMenu,
    showMenuAt,
    rowAction,
    rowsKeyed,
    editCell,
    editValue,
};
