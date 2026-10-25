"use strict";

// Changing a table's columns: in a dialog, in place, moved by dragging, or dropped.

// ---------------------------------------------------------- changing columns ---

/**
 * Whether the table shown is a view, whose columns are only read.
 * @returns {boolean}
 */
function structureIsView() {
    return Boolean(browse.tables.find((one) => one.name === browse.structure?.table)?.view);
}

/** The types to pick, in phpMyAdmin's groups, the most used first; "-" parts a group. */
/** @type {[string, string[]][]} */
const COLUMN_TYPES = [
    [ "Common", [ "int", "varchar", "text", "date" ] ],
    [ "Numeric", [
        "tinyint", "smallint", "mediumint", "int", "bigint", "-",
        "decimal", "float", "double", "-",
        "bit",
    ] ],
    [ "Date and time", [ "date", "datetime", "timestamp", "time", "year" ] ],
    [ "String", [
        "char", "varchar", "-",
        "tinytext", "text", "mediumtext", "longtext", "-",
        "binary", "varbinary", "-",
        "tinyblob", "blob", "mediumblob", "longblob", "-",
        "enum", "set", "-",
        "uuid", "inet4", "inet6",
    ] ],
    [ "Spatial", [
        "geometry", "point", "linestring", "polygon",
        "multipoint", "multilinestring", "multipolygon", "geometrycollection",
    ] ],
    [ "JSON", [ "json" ] ],
];
const TEXT_TYPE = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i;
const NUMBER_TYPE = /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double)$/;
// What the length or values of a type are, as a hint, and what one picked anew starts with; a type
// without is given none.
const TYPE_LENGTHS = {
    tinyint   : [ "4" ],
    smallint  : [ "6" ],
    mediumint : [ "9" ],
    int       : [ "11" ],
    bigint    : [ "20" ],
    decimal   : [ "10,2", "10,2" ],
    float     : [ "10,2" ],
    double    : [ "10,2" ],
    bit       : [ "1", "1" ],
    char      : [ "36" ],
    varchar   : [ "255", "255" ],
    binary    : [ "16", "16" ],
    varbinary : [ "255", "255" ],
    text      : [ "65535" ],
    blob      : [ "65535" ],
    enum      : [ "'one','two'", "'one','two'" ],
    set       : [ "'one','two'", "'one','two'" ],
    datetime  : [ "0 to 6 decimals" ],
    timestamp : [ "0 to 6 decimals" ],
    time      : [ "0 to 6 decimals" ],
};

/**
 * The types to pick from, grouped as phpMyAdmin's, the one given picked, under its own group when
 * it is none of them.
 * @param {string} base
 * @returns {string}
 */
function typeOptions(base) {
    const known  = COLUMN_TYPES.some(([ , types ]) => types.includes(base.toLowerCase()));
    let   chosen = false;

    return `${known ? "" : `<optgroup label="This column's"><option value="${esc(base)}" selected>${
        esc(base.toUpperCase())
    }</option></optgroup>`}${COLUMN_TYPES.map(([ group, types ]) => `<optgroup label="${group}">${
    types.map((type) => {
        if (type === "-") {
            return `<option disabled>──────</option>`;
        }

        // Only the first of a type's places, as Common has them again, is picked.
        const on = !chosen && type === base.toLowerCase();
        chosen ||= on;
        return `<option value="${type}" ${on ? "selected" : ""}>${type.toUpperCase()}</option>`;
    }).join("")}</optgroup>`).join("")}`;
}

/**
 * The dialog that adds a column or changes one, as Sequel Ace's columns
 * do: its name and type, whether it takes NULL, what it starts with -- a
 * value, NULL, an expression as current_timestamp() -- or what it is
 * generated from, auto_increment, ON UPDATE, its collation when it holds
 * text, its comment, and its place among the others. A copy starts as the
 * column it copies, after it.
 * @param {string=} name
 * @param {{ copy?: boolean, after?: string }=} options
 * @returns {Promise<void>}
 */
async function openColumnDialog(name = null, { copy = false, after = null } = {}) {
    const structure = browse.structure;
    const old       = structure.columns.find((one) => one.name === name);
    const adding    = !old || copy;

    let charsets;
    try {
        charsets = await loadCharsets();
    } catch (error) {
        toast(error.message, true);
        return;
    }

    const tableCollation = browse.tables.find((one) => one.name === structure.table)?.collation
        || "";
    const column = old ? { ...old, name : copy ? `${old.name}_copy` : old.name } : {
        name      : "",
        type      : "varchar(255)",
        nullable  : true,
        value     : { kind : "null", value : "" },
        extra     : "",
        comment   : "",
        collation : "",
    };

    const others = structure.columns.filter((one) => one.name !== name || copy);
    const place  = copy ? name : after ?? (adding ? structure.columns.at(-1)?.name : "");
    const kinds  = [
        [ "none", "No default" ],
        [ "null", "NULL" ],
        [ "value", "A value" ],
        [ "expression", "An expression" ],
        [ "virtual", "Generated, virtual" ],
        [ "stored", "Generated, stored" ],
    ];
    const picked = column.collation && column.collation !== tableCollation ? column.collation : "";

    // The type apart: its name, its length or values in brackets, and unsigned or zerofill after.
    const [ , base = column.type, length = "", flags = "" ] = column.type
        .match(/^([a-z][a-z0-9 ]*?)\s*(?:\((.*)\))?((?:\s+(?:unsigned|signed|zerofill))*)$/i) || [];

    formDialog({
        title  : adding ? `New column in ${structure.table}` : `Change the column ${old.name}`,
        text   :
            "MariaDB rewrites the table to change its columns, which takes a while in a large one.",
        body   : `
            <div class="column-type">
                <label class="form-row"><span>Name</span><input name="name"
                    value="${esc(column.name)}" maxlength="64" spellcheck="false" required></label>
                <label class="form-row"><span>Type</span><span class="field select"><select
                    name="type">${typeOptions(base)}</select></span></label>
                <label class="form-row"><span>Length / values</span><input name="length"
                    value="${esc(length)}" spellcheck="false"></label>
            </div>
            <div class="form-pair">
                <label class="form-row"><span>Starts with</span><span class="field select"><select
                    name="value">${kinds.map(([ value, label ]) => `<option value="${value}" ${
                        value === column.value.kind ? "selected" : ""
                    }>${label}</option>`).join("")}</select></span></label>
                <label class="form-row" data-column-preset><span></span><input name="preset"
                    value="${esc(column.value.value)}" spellcheck="false"></label>
            </div>
            <div class="column-checks" data-column-checks>
                <label class="check"><input type="checkbox" class="box" name="nullable"
                    ${column.nullable ? "checked" : ""}><span>Allows NULL</span></label>
                <label class="check" data-column-unsigned><input type="checkbox" class="box"
                    name="unsigned"
                    ${/unsigned/i.test(flags) ? "checked" : ""}><span>Unsigned</span></label>
                <label class="check"><input type="checkbox" class="box" name="increment"
                    ${/auto_increment/i.test(column.extra) && !copy
                        ? "checked" : ""}><span>Auto increment</span></label>
                <label class="check" data-column-update><input type="checkbox" class="box"
                    name="update" ${/on update/i.test(column.extra)
                        ? "checked" : ""}><span>On update, the time</span></label>
            </div>
            <div class="form-pair">
                <label class="form-row"><span>Place</span><span class="field select"><select
                    name="after">
                    ${adding ? "" : `<option value="">Where it is</option>`}
                    <option value="first">First</option>
                    ${others.map((one) => `<option value="${esc(one.name)}"
                        ${one.name === place ? "selected" : ""}>After ${esc(one.name)}</option>`)
                        .join("")}
                </select></span></label>
                <label class="form-row" data-column-collation><span>Collation</span><span
                    class="field select"><select name="collation">
                    <option value="">The table's${tableCollation
                        ? `, ${esc(tableCollation)}` : ""}</option>
                    ${charsets.map((set) => `<optgroup
                        label="${esc(set.description)} (${esc(set.name)})">${set.collations
                            .map((one) => `<option
                                ${one === picked ? "selected" : ""}>${esc(one)}</option>`)
                            .join("")}</optgroup>`).join("")}
                </select></span></label>
            </div>
            <label class="form-row"><span>Comment</span><input name="comment"
                value="${esc(column.comment)}" maxlength="1024" placeholder="What it holds"
                spellcheck="false"></label>
        `,
        ok     : adding ? "Add" : "Save",
        ready  : (fields) => {
            // Only the fields that count for the type and the start show.
            const form   = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const size   = /** @type {HTMLInputElement} */ (form.elements.namedItem("length"));
            const update = () => {
                const kind = /** @type {HTMLSelectElement} */ (
                    form.elements.namedItem("value")
                ).value;
                const type = /** @type {HTMLSelectElement} */ (
                    form.elements.namedItem("type")
                ).value;
                const hint = TYPE_LENGTHS[type];

                size.disabled    = !hint;
                size.placeholder = hint ? hint[0] : "None for this type";
                /** @type {HTMLElement} */ (
                    fields.querySelector("[data-column-unsigned]")
                ).hidden = !NUMBER_TYPE.test(type);

                const made = kind === "virtual" || kind === "stored";
                const box  = /** @type {HTMLElement} */ (
                    fields.querySelector("[data-column-preset]")
                );
                box.style.visibility = kind === "none" || kind === "null" ? "hidden" : "";
                box.querySelector("span").textContent = made ? "Made from"
                    : kind === "expression" ? "Expression"
                        : "Value";
                /** @type {HTMLInputElement} */ (box.querySelector("input")).placeholder = made
                    ? "`price` * `count`"
                    : kind === "expression" ? "current_timestamp()" : "";

                /** @type {HTMLElement} */ (
                    fields.querySelector("[data-column-checks]")
                ).hidden = made;
                /** @type {HTMLElement} */ (
                    fields.querySelector("[data-column-update]")
                ).hidden = !/^(timestamp|datetime)$/.test(type);
                /** @type {HTMLElement} */ (
                    fields.querySelector("[data-column-collation]")
                ).style.visibility = TEXT_TYPE.test(type) ? "" : "hidden";
            };

            form.addEventListener("input", update);

            // A type picked anew starts with its usual length, or none when it takes none.
            /** @type {HTMLSelectElement} */ (
                form.elements.namedItem("type")
            ).addEventListener("change", (event) => {
                size.value = TYPE_LENGTHS[
                    /** @type {HTMLSelectElement} */ (event.target).value
                ]?.[1] || "";
                update();
            });
            update();
        },
        submit : async (form) => {
            const data  = new FormData(form);
            const name  = String(data.get("type"));
            const text  = TEXT_TYPE.test(name);
            const sized = String(data.get("length") ?? "").trim();

            // Unsigned for a number, and zerofill kept when it had it.
            const marks = NUMBER_TYPE.test(name)
                ? `${data.get("unsigned") === "on" ? " unsigned" : ""}${
                    /zerofill/i.test(flags) ? " zerofill" : ""
                }`
                : "";

            const definition = {
                name      : String(data.get("name")),
                type      : `${name}${sized && TYPE_LENGTHS[name] ? `(${sized})` : ""}${marks}`,
                nullable  : data.get("nullable") === "on",
                value     : String(data.get("value")),
                preset    : String(data.get("preset")),
                increment : data.get("increment") === "on",
                update    : data.get("update") === "on" && /^(timestamp|datetime)$/.test(name),
                // Named even when it is the table's, as a column changed without one would get the
                // table's anyway.
                collation : text ? String(data.get("collation")) || tableCollation : "",
                comment   : String(data.get("comment")),
            };

            const result = await api("/api/action", {
                action : "db-column-save",
                db     : browse.db,
                table  : browse.table,
                column : adding ? null : old.name,
                definition,
                after  : String(data.get("after")),
            });

            marked["structure-grid"] = {
                key     : definition.name,
                context : gridContext("structure-grid"),
            };
            loadStructure();
            loadTables();
            return result;
        },
    });
}

/**
 * A column's definition as it is, with some of it changed: what a change
 * in place or a move sends, so the rest of the column stays as it was.
 * @param {DbStructureColumn} column
 * @param {Object<string, *>=} changes
 * @returns {{ name: string, type: string, nullable: boolean, value: string, preset: string,
 *     increment: boolean, update: boolean, collation: string, comment: string }}
 */
function columnDefinition(column, changes = {}) {
    const definition = {
        name      : column.name,
        type      : column.type,
        nullable  : column.nullable,
        value     : column.value.kind,
        preset    : column.value.value,
        increment : /auto_increment/i.test(column.extra),
        update    : /on update/i.test(column.extra),
        collation : column.collation,
        comment   : column.comment,
        ...changes,
    };

    if (!TEXT_TYPE.test(definition.type)) {
        definition.collation = "";
    }

    // A column made to refuse NULL no longer starts with it.
    if (!definition.nullable && definition.value === "null") {
        definition.value = "none";
    }

    if (!/^(timestamp|datetime)\b/i.test(definition.type)) {
        definition.update = false;
    }

    return definition;
}

/**
 * A column's start as it is typed in its cell: nothing, NULL, or the value or expression itself.
 * @param {DbStructureColumn} column
 * @returns {string}
 */
function defaultText(column) {
    return column.value.kind === "none" ? ""
        : column.value.kind === "null" ? "NULL"
            : column.value.value;
}

/**
 * What is typed in a default's cell: empty for none, NULL, a call as current_timestamp() for an
 * expression, else a value.
 * @param {string} text
 * @param {DbStructureColumn} column
 * @returns {{ value: string, preset: string }}
 */
function defaultOf(text, column) {
    if (text === defaultText(column)) {
        return { value : column.value.kind, preset : column.value.value };
    }
    return text === "" ? { value : "none", preset : "" }
        : /^null$/i.test(text) ? { value : "null", preset : "" }
            : /^[a-z_][a-z0-9_]*\(.*\)$/i.test(text.trim())
                ? { value : "expression", preset : text.trim() }
                : { value : "value", preset : text };
}

/**
 * A column's cell changed where it is, as in Sequel Ace, by a double
 * click: its name, its type as MariaDB writes it, whether it takes NULL,
 * what it starts with, and its comment. Enter or a click away saves it,
 * Escape leaves it, Tab goes to the next cell and ↑ ↓ to the one above or
 * below; the extra, and a generated column's expression, change in the
 * column's dialog.
 */
let columnEdit = null;
/**
 * Opens a column's cell to change it in place, or the column's dialog for what the cell cannot
 * change.
 * @param {HTMLElement} td
 * @returns {void}
 */
function editColumnCell(td) {
    if (columnEdit || structureIsView()) {
        return;
    }

    const tr     = /** @type {HTMLElement} */ (td.closest("tr"));
    const name   = tr.dataset.key;
    const field  = td.dataset.field;
    const column = browse.structure.columns.find((one) => one.name === name);
    if (!field || field === "default"
        && (column.value.kind === "virtual" || column.value.kind === "stored")) {
        openColumnDialog(name);
        return;
    }

    /** @type {any} An input, or a select for NULL. */
    let input;
    if (field === "null") {
        input = document.createElement("select");
        input.innerHTML = `<option>yes</option><option>no</option>`;
        input.value     = column.nullable ? "yes" : "no";
    } else {
        input = document.createElement("input");
        input.value       = {
            name    : column.name,
            type    : column.type,
            comment : column.comment,
            default : defaultText(column),
        }[field];
        input.placeholder = field === "default" ? "none" : "";
        input.spellcheck  = false;
    }

    input.className   = "cell-input";
    // The cell's width less its padding while changed, so the column keeps its.
    input.style.width = `${td.clientWidth - 4}px`;

    const cells = () => [ ...document.querySelectorAll("#structure-grid tbody td[data-field]") ];
    const edit  = {
        name,
        field,
        old  : input.value,
        input,
        done : false,
        at   : cells().indexOf(td),
        row  : [ ...tr.parentElement.children ].indexOf(tr),
    };

    columnEdit   = edit;
    tr.draggable = false;
    td.classList.add("editing");
    td.replaceChildren(input);
    input.focus();

    if (input instanceof HTMLInputElement) {
        input.select();
    }

    // Where to go after: a cell along, or the same one a row up or down, found again once the grid
    // is drawn again.
    const along = (by) => () => {
        const next = /** @type {HTMLElement} */ (cells()[edit.at + by]);
        if (next) {
            changeColumnAt(next);
        }
    };

    const down = (by) => () => {
        const row  = document.querySelectorAll("#structure-grid tbody tr[data-key]")[edit.row + by];
        const next = /** @type {HTMLElement} */ (row?.querySelector(`td[data-field="${field}"]`));
        if (next) {
            changeColumnAt(next);
        }
    };

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            saveColumnCell(edit);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            edit.done  = true;
            columnEdit = null;
            renderStructureColumns();
        } else if (event.key === "Tab") {
            event.preventDefault();
            saveColumnCell(edit, along(event.shiftKey ? -1 : 1));
        } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && field !== "null"
            && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            saveColumnCell(edit, down(event.key === "ArrowUp" ? -1 : 1));
        }
    });

    if (input instanceof HTMLSelectElement) {
        input.addEventListener("change", () => saveColumnCell(edit));
    }

    input.addEventListener("blur", () => saveColumnCell(edit));
}

/**
 * Marks a column's row, scrolls to it, and changes its cell.
 * @param {HTMLElement} td
 * @returns {void}
 */
function changeColumnAt(td) {
    const tr = /** @type {HTMLElement} */ (td.closest("tr"));
    pickRow(tr);
    revealRow(/** @type {HTMLTableElement} */ (tr.closest("table")), tr);
    editColumnCell(td);
}

/**
 * Saves a column's cell changed in place, if it is, with the rest of the column as it was, then
 * goes on, if asked.
 * @param {{ name: string, field: string, old: string,
 *     input: HTMLInputElement | HTMLSelectElement, done: boolean, at: number,
 *     row: number }} edit
 * @param {(() => void)=} then
 * @returns {Promise<void>}
 */
async function saveColumnCell(edit, then = null) {
    if (edit.done) {
        return;
    }

    edit.done = true;
    const text = edit.input.value;
    if (text !== edit.old) {
        const column  = browse.structure.columns.find((one) => one.name === edit.name);
        const changes = edit.field === "name" ? { name : text }
            : edit.field === "type" ? { type : text.trim() }
                : edit.field === "null" ? { nullable : text === "yes" }
                    : edit.field === "comment" ? { comment : text }
                        : defaultOf(text, column);
        edit.input.disabled = true;

        try {
            await api("/api/action", {
                action     : "db-column-save",
                db         : browse.db,
                table      : browse.table,
                column     : edit.name,
                definition : columnDefinition(column, changes),
            });
        } catch (error) {
            // It stays open, to fix.
            toast(error.message, true);
            edit.done           = false;
            edit.input.disabled = false;
            edit.input.focus();
            return;
        }

        columnEdit = null;

        if (edit.field === "name") {
            marked["structure-grid"] = { key : text, context : gridContext("structure-grid") };
        }

        await loadStructure();
    } else {
        columnEdit = null;
        renderStructureColumns();
    }

    then?.();
}

/**
 * A column dragged to another place, as in Sequel Ace: the line it would
 * land on shows above or below the row under the pointer, and dropping it
 * moves it there, after the column before, or first.
 */
let columnDrag = "";
/**
 * Moves the column dragged to the row it is dropped on, above it or below, unless that is where
 * it is already.
 * @param {HTMLElement} tr
 * @param {boolean} below
 * @returns {void}
 */
function dropColumnAt(tr, below) {
    const columns = browse.structure.columns.map((one) => one.name);
    const target  = tr.dataset.key;
    const at      = columns.indexOf(target);
    const after   = below ? target : at > 0 ? columns[at - 1] : "first";
    const name    = columnDrag;

    // Dropped where it is already: before or after itself.
    if (!name || name === target || after === columns[columns.indexOf(name) - 1]
        || after === "first" && columns[0] === name) {
        return;
    }

    api("/api/action", {
        action : "db-column-move",
        db     : browse.db,
        table  : browse.table,
        column : name,
        after,
    })
        .then((result) => {
            toast(result.message);
            marked["structure-grid"] = { key : name, context : gridContext("structure-grid") };
            loadStructure();
        })
        .catch((error) => toast(error.message, true));
}

/**
 * The menu of a column, on a right click: to change, copy or add one after it, to move it, or to
 * drop it.
 */
let columnMenu = "";
/**
 * Opens a column's menu where the pointer is.
 * @param {string} name
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function openColumnMenu(name, x, y) {
    const columns = browse.structure.columns;
    const at      = columns.findIndex((one) => one.name === name);

    columnMenu = name;
    const menu = document.getElementById("row-menu");
    menu.innerHTML = `
        <button role="menuitem" data-column-act="edit">Edit…</button>
        <button role="menuitem" data-column-act="duplicate">Duplicate…</button>
        <button role="menuitem" data-column-act="add">Add Column After…</button>
        <hr>
        <button role="menuitem" data-column-act="up" ${at === 0 ? "disabled" : ""}>Move Up</button>
        <button role="menuitem" data-column-act="down"
            ${at === columns.length - 1 ? "disabled" : ""}>Move Down</button>
        <hr>
        <button role="menuitem" data-column-act="copy">Copy Name</button>
        <hr>
        <button role="menuitem" data-column-act="drop" class="danger-item"
            ${columns.length === 1 ? "disabled" : ""}>Drop…</button>
    `;

    showMenuAt(menu, x, y);
}

/**
 * Does what was picked in a column's menu, to the column it was opened on.
 * @param {string} act
 * @returns {Promise<void>}
 */
async function columnAction(act) {
    const name    = columnMenu;
    const columns = browse.structure.columns;
    const at      = columns.findIndex((one) => one.name === name);

    if (act === "edit") {
        return openColumnDialog(name);
    }
    if (act === "duplicate") {
        return openColumnDialog(name, { copy : true });
    }
    if (act === "add") {
        return openColumnDialog(null, { after : name });
    }
    if (act === "copy") {
        await navigator.clipboard.writeText(name);
        return toast("Copied");
    }
    if (act === "drop") {
        return dropColumn(name);
    }

    // Up goes after the one two above, or first; down after the one below.
    const after = act === "up" ? (at > 1 ? columns[at - 2].name : "first") : columns[at + 1].name;

    try {
        toast((await api("/api/action", {
            action : "db-column-move",
            db     : browse.db,
            table  : browse.table,
            column : name,
            after,
        })).message);
    } catch (error) {
        toast(error.message, true);
        return;
    }

    loadStructure();
}

/**
 * Drops a column, once the user is sure.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function dropColumn(name) {
    const sure = await ask({
        title  : `Drop the column ${name}?`,
        text   : `Its values in every row of ${
            browse.table
        } are gone for good, and the indexes on it change.`,
        ok     : "Drop",
        danger : true,
    });
    if (!sure) {
        return;
    }

    try {
        toast((await api("/api/action", {
            action : "db-column-drop",
            db     : browse.db,
            table  : browse.table,
            column : name,
        })).message);
    } catch (error) {
        toast(error.message, true);
        return;
    }

    loadStructure();
    loadTables();
}
