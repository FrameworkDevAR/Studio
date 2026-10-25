"use strict";

// A table's structure: its columns, indexes and foreign keys.

// --------------------------------------------------------------- structure ---

/**
 * A column of a table's structure, as the server reads it: its type as MariaDB writes it and its
 * bare type, what it starts with, its key, extra, comment and collation, and whether it is binary.
 * @typedef {{ name: string, type: string, dataType: string, nullable: boolean,
 *     default: string, value: { kind: string, value: string }, key: string, extra: string,
 *     comment: string, collation: string, binary: boolean }} DbStructureColumn
 */

/**
 * The table's columns, filtered as typed, and its indexes, to add and
 * drop, each scrolling its own; its CREATE TABLE is in Information.
 * @returns {Promise<void>}
 */
async function loadStructure() {
    const box = document.getElementById("browse-structure");
    if (!browse.table) {
        box.innerHTML = `<div class="panel"><div class="pkg-none">This database has no tables
            yet.</div></div>`;
        return;
    }

    let structure;
    try {
        structure = await api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${
            encodeURIComponent(browse.table)
        }`);
    } catch (error) {
        box.innerHTML =
            `<div class="panel"><div class="pkg-none">${esc(error.message)}</div></div>`;
        return;
    }

    // Only the last table asked for shows, when several were gone through quickly.
    if (structure.table !== browse.table) {
        return;
    }

    // The filter stays as typed when the same table is drawn again, as after a change.
    const typed = browse.structure?.table === structure.table
        ? /** @type {HTMLInputElement} */ (document.getElementById("structure-filter"))?.value
            || ""
        : "";

    browse.structure = structure;
    const view = browse.tables.find((one) => one.name === structure.table)?.view;

    // A foreign key is added from the indexes' head while the table has none, if it is InnoDB.
    let foreignAdd = "";
    if (!view && !structure.foreign.length
        && browse.tables.find((one) => one.name === structure.table)?.engine === "InnoDB") {
        foreignAdd = `<button class="ghost small" data-fk-add>Add foreign key</button>`;
    }

    let foreignButton = "";
    if (structure.foreign.length && !view) {
        foreignButton = `<button class="ghost small" data-fk-add>Add foreign key</button>`;
    }

    box.innerHTML = `
        <div class="panel structure-columns">
            <div class="panel-head">
                <h2>${esc(structure.table)} <span class="muted">· ${
                    countOf(structure.columns.length, "column")
                }${size(structure.table)}</span></h2>
                <div class="head-tools">
                    <input id="structure-filter" type="search" placeholder="Filter columns…"
                        spellcheck="false" autocomplete="off">
                    ${view ? "" : `<button class="ghost" data-column-add>Add column</button>`}
                    ${tableMenuButton()}
                </div>
            </div>
            <div class="grid-wrap"><div class="grid-scroll"><table id="structure-grid"
                class="data-grid structure fill">
                <thead><tr>${[ "Column", "Type", "Null", "Default", "Extra", "Comment" ]
                    .map((name) => `<th><span class="th">${name}</span></th>`)
                    .join("")}</tr></thead>
                <tbody id="structure-columns"></tbody>
            </table></div></div>
        </div>
        <div class="structure-keys ${structure.foreign.length ? "" : "alone"}">
        <div class="panel structure-indexes">
            <div class="panel-head">
                <h2>Indexes <span class="muted">${structure.indexes.length}</span></h2>
                ${view ? "" : `<div class="head-tools">
                    ${foreignAdd}
                    <button class="ghost small" data-index-add>Add index</button>
                </div>`}
            </div>
            <div class="index-list">${structure.indexes.map((index) => `
                <div class="structure-line">
                    <code>${esc(index.name)}</code>
                    <span>${index.columns.map(esc).join(", ")}</span>
                    <span class="tag">${structureIndexTag(index)}</span>
                    <button class="icon-btn remove" data-index-drop="${esc(index.name)}"
                        title="Drop it" aria-label="Drop the index ${esc(index.name)}"><svg
                        viewBox="0 0 24 24"><path
                        d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
                </div>
            `).join("") || `<div class="pkg-none">No indexes.</div>`}</div>
        </div>
        ${structure.foreign.length ? `<div class="panel structure-indexes">
            <div class="panel-head">
                <h2>Foreign keys <span class="muted">${structure.foreign.length}</span></h2>
                ${foreignButton}
            </div>
            <div class="index-list">${structure.foreign.map((key) => `
                <div class="structure-line fk-line" data-fk-edit="${esc(key.name)}"
                    title="Click to change it">
                    <div class="fk-text">
                        <span class="fk-map">${key.columns.map(esc).join(", ")} →
                            <a href="${esc(browsePath("structure", key.table))}"
                                class="fk-target">${esc(key.table)}</a>.${
                                    key.references.map(esc).join(", ")
                                }</span>
                        <small title="${esc(key.name)} · on delete ${
                            esc(fkRule(key.onDelete))
                        } · on update ${
                            esc(fkRule(key.onUpdate))
                        }">${esc(key.name)} · on delete ${esc(fkRule(key.onDelete))}
                            · on update ${esc(fkRule(key.onUpdate))}</small>
                    </div>
                    <button class="icon-btn remove" data-fk-drop="${esc(key.name)}"
                        title="Drop it" aria-label="Drop the foreign key ${esc(key.name)}"><svg
                        viewBox="0 0 24 24"><path
                        d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
                </div>
            `).join("")}</div>
        </div>` : ""}
        </div>
    `;

    /** @type {HTMLInputElement} */ (document.getElementById("structure-filter")).value = typed;
    document.getElementById("structure-filter").addEventListener("input", renderStructureColumns);
    renderStructureColumns();
    box.querySelectorAll(".grid-scroll, .index-list")
        .forEach((one) => watchFades(/** @type {HTMLElement} */ (one)));
}

/**
 * The tag an index shows in the structure: primary, unique, or its type.
 * @param {{ name: string, unique: boolean, type: string }} index
 * @returns {string}
 */
function structureIndexTag(index) {
    if (index.name === "PRIMARY") {
        return "primary";
    }
    if (index.unique) {
        return "unique";
    }
    return index.type.toLowerCase();
}

/**
 * The dialog that adds an index: its kind, the columns it is on, in the
 * order they are ticked, which is the order that counts for an index, and
 * its name, made from them until it is typed over.
 * @returns {void}
 */
function openIndexDialog() {
    const structure = browse.structure;
    const kinds     = [
        [ "index", "Index" ],
        [ "unique", "Unique" ],
        [ "fulltext", "Full text" ],
        ...(structure.primary.length ? [] : [ [ "primary", "Primary key" ] ]),
    ];

    formDialog({
        title : `New index on ${structure.table}`,
        text  : "MariaDB builds it at once, which takes a while in a large table.",
        body  : `
            <div class="form-row">
                <span>Kind</span>
                <div class="segmented">${kinds.map(([ value, label ], index) => `<button
                    type="button" data-index-kind="${value}"
                    class="${index ? "" : "active"}">${label}</button>`).join("")}</div>
            </div>
            <div class="form-row">
                <span>Columns, in order</span>
                <div class="check-list index-columns">
                    ${structure.columns.map((column) => `
                        <label class="check">
                            <input type="checkbox" class="box" value="${esc(column.name)}">
                            <span>${esc(column.name)}<small>${esc(column.type)}</small></span>
                            <em class="order"></em>
                        </label>
                    `).join("")}
                </div>
            </div>
            <label class="form-row" data-index-name><span>Name</span><input name="name"
                maxlength="64" pattern="[\\w$]+" placeholder="Made from the columns"
                spellcheck="false" data-auto></label>
        `,
        ok    : "Add",
        ready : (fields) => {
            const order = [];
            const name  = /** @type {HTMLInputElement} */ (fields.querySelector("[name=name]"));

            fields.querySelector(".index-columns").addEventListener("change", (event) => {
                const box = /** @type {HTMLInputElement} */ (event.target);
                if (box.checked) {
                    order.push(box.value);
                } else {
                    order.splice(order.indexOf(box.value), 1);
                }

                // Each ticked column shows its place in the index.
                fields.querySelectorAll(".index-columns input").forEach((one) => {
                    const at = order.indexOf(/** @type {HTMLInputElement} */ (one).value);
                    /** @type {HTMLElement} */ (one.closest(".check").querySelector(".order"))
                        .textContent = at === -1 ? "" : String(at + 1);
                });

                if (name.dataset.auto !== undefined) {
                    name.value = order.join("_").slice(0, 64);
                }

                fields.dataset.order = JSON.stringify(order);
            });

            name.addEventListener("input", () => delete name.dataset.auto);
        },
        submit : async (form) => {
            const kind   = /** @type {HTMLElement} */ (
                form.querySelector("[data-index-kind].active")
            ).dataset.indexKind;
            const result = await api("/api/action", {
                action  : "db-index-add",
                db      : browse.db,
                table   : browse.table,
                kind,
                name    : /** @type {HTMLInputElement} */ (form.querySelector("[name=name]")).value,
                columns : JSON.parse(
                    /** @type {HTMLElement} */ (form.querySelector("#form-body")).dataset.order
                        || "[]",
                ),
            });

            loadStructure();
            loadTables();
            return result;
        },
    });
}

/**
 * A kind picked; a primary key has no name of its own.
 * @param {HTMLElement} button
 * @returns {void}
 */
function pickIndexKind(button) {
    setActive(button);
    /** @type {HTMLElement} */ (button.closest("form").querySelector("[data-index-name]")).hidden =
        button.dataset.indexKind === "primary";
}

/**
 * Drops an index, or the primary key, once the user is sure.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function dropIndex(name) {
    const sure = await ask({
        title  : name === "PRIMARY"
            ? `Drop the primary key of ${browse.table}?`
            : `Drop the index ${name}?`,
        text   : name === "PRIMARY"
            ? "Its rows can no longer be changed here, as they cannot be told apart."
            : "Queries that use it get slower. Its data stays.",
        ok     : "Drop",
        danger : true,
    });
    if (sure) {
        await act({ action : "db-index-drop", db : browse.db, table : browse.table, name });
        loadStructure();
        loadTables();
    }
}

// --------------------------------------------------------------- foreign keys ---

/**
 * A rule, short, as the list shows it.
 * @param {string} rule
 * @returns {string}
 */
function fkRule(rule) {
    return {
        "RESTRICT"  : "restrict",
        "NO ACTION" : "no action",
        "CASCADE"   : "cascade",
        "SET NULL"  : "set null",
    }[rule] || rule.toLowerCase();
}

/**
 * A foreign key added, or one changed: its columns here, each paired with
 * the one it refers to in the table picked -- its primary key at first --
 * what a delete and an update there do here, and its name, made from the
 * table and columns until it is typed over.
 * @param {string=} name The key to change, or none for a new one.
 * @returns {Promise<void>}
 */
async function openForeignKeyDialog(name = null) {
    const structure = browse.structure;
    const old       = structure.foreign.find((key) => key.name === name);
    const targets   = browse.tables.filter((one) => !one.view && one.engine === "InnoDB");
    const rules     = [
        [ "RESTRICT", "Restrict", "Refused while rows here refer to it" ],
        [ "CASCADE", "Cascade", "Done to the rows here too" ],
        [ "SET NULL", "Set NULL", "The column here is cleared" ],
        [ "NO ACTION", "No action", "As restrict, in MariaDB" ],
    ];
    const guess     = targets.find((one) => structure.columns
        .some((column) => column.name === `${one.name.replace(/s$/, "")}_id`))
        || targets.find((one) => one.name !== structure.table)
        || targets[0];
    const start     = old || {
        columns    : [ "" ],
        table      : guess?.name || "",
        references : [ "" ],
        onDelete   : "RESTRICT",
        onUpdate   : "RESTRICT",
    };

    const ruleSelect = (field, value) => `<span class="field select"><select name="${field}">${
        rules.map(([ rule, label, hint ]) => `<option value="${rule}" title="${hint}"
            ${rule === value ? "selected" : ""}>${label}</option>`).join("")
    }</select></span>`;

    let refColumns = [];
    const loadRef  = async (table) => {
        try {
            const ref  = await api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${
                encodeURIComponent(table)
            }`);
            refColumns = ref.columns.map((column) => ({
                name    : column.name,
                type    : column.type,
                primary : ref.primary.includes(column.name),
            }));
        } catch {
            refColumns = [];
        }
    };

    if (!targets.length) {
        toast("Foreign keys need InnoDB tables, and this database has none", true);
        return;
    }

    await loadRef(start.table);
    formDialog({
        title  : old ? `Change the foreign key ${old.name}`
            : `New foreign key on ${structure.table}`,
        text   : "Each column here refers to one in the other table, of the same type, " +
            "which has an index on it.",
        body   : `
            <label class="form-row"><span>Refers to the table</span><span
                class="field select"><select name="refTable">
                ${targets.map((one) => `<option value="${esc(one.name)}"
                    ${one.name === start.table ? "selected" : ""}>${esc(one.name)}</option>`)
                    .join("")}
            </select></span></label>
            <div class="form-row"><span>Columns</span><div class="fk-pairs"
                data-fk-pairs></div></div>
            <button type="button" class="ghost small fk-more"
                data-fk-more>Add a column pair</button>
            <div class="form-pair">
                <label class="form-row"><span>On delete there</span>${
                    ruleSelect("onDelete", start.onDelete)
                }</label>
                <label class="form-row"><span>On update there</span>${
                    ruleSelect("onUpdate", start.onUpdate)
                }</label>
            </div>
            <label class="form-row"><span>Name</span><input name="name"
                value="${esc(old?.name || "")}" maxlength="64" pattern="[\\w$]+"
                placeholder="Made from the table and columns" spellcheck="false"
                ${old ? "" : "data-auto"}></label>
        `,
        ok     : old ? "Save" : "Add",
        ready  : (fields) => {
            const form  = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const pairs = /** @type {HTMLElement} */ (fields.querySelector("[data-fk-pairs]"));
            const label = /** @type {HTMLInputElement} */ (form.elements.namedItem("name"));
            // A pair: a column here, an arrow, the column there; the first there is the primary
            // key, as it most often is.
            const pair  = (here, there) => {
                const primary = refColumns.find((column) => column.primary)?.name
                    || refColumns[0]?.name
                    || "";
                return `
                    <div class="fk-pair">
                        <span class="field select"><select data-fk-here>${structure.columns
                            .map((column) => `<option value="${esc(column.name)}"
                                ${column.name === here ? "selected" : ""}>${
                                    esc(column.name)
                                } · ${esc(column.type)}</option>`)
                            .join("")}</select></span>
                        <span class="fk-arrow">→</span>
                        <span class="field select"><select data-fk-there>${refColumns
                            .map((column) => `<option value="${esc(column.name)}"
                                ${column.name === (there || primary) ? "selected" : ""}>${
                                    esc(column.name)
                                } · ${esc(column.type)}</option>`)
                            .join("")}</select></span>
                        <button type="button" class="icon-btn" data-fk-less
                            title="Take this pair out" aria-label="Take this pair out"><svg
                            viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
                    </div>
                `;
            };
            const table = () => /** @type {HTMLSelectElement} */ (
                form.elements.namedItem("refTable")
            ).value;
            // A new key's column here starts as the one named for the table, as customer_id for
            // customers.
            const named = () => structure.columns
                .find((column) => column.name === `${table().replace(/s$/, "")}_id`)?.name || "";
            const draw  = (list) => {
                pairs.innerHTML = list.map(([ here, there ]) => pair(here, there)).join("");
                pairs.querySelectorAll("[data-fk-less]")
                    .forEach((one) => (/** @type {HTMLElement} */ (one).hidden = list.length < 2));
                rename();
            };

            const current = () => [ ...pairs.querySelectorAll(".fk-pair") ].map((one) => [
                /** @type {HTMLSelectElement} */ (one.querySelector("[data-fk-here]")).value,
                /** @type {HTMLSelectElement} */ (one.querySelector("[data-fk-there]")).value,
            ]);

            const rename = () => {
                if (label.dataset.auto !== undefined) {
                    label.value = `fk_${structure.table}_${
                        current().map(([ here ]) => here).join("_")
                    }`.replace(/[^\w$]/g, "_").slice(0, 64);
                }
            };

            draw(old ? old.columns.map((column, at) => [ column, old.references[at] ])
                : [ [ named() || structure.columns[0]?.name, "" ] ]);

            /** @type {HTMLSelectElement} */ (
                form.elements.namedItem("refTable")
            ).addEventListener("change", async () => {
                await loadRef(table());
                draw(current().map(([ here ], at) => [ at === 0 && named() ? named() : here, "" ]));
            });

            pairs.addEventListener("change", rename);
            label.addEventListener("input", () => delete label.dataset.auto);

            fields.addEventListener("click", (event) => {
                const target = /** @type {HTMLElement} */ (event.target);
                if (target.closest("[data-fk-more]")) {
                    draw([ ...current(), [ structure.columns[0]?.name, "" ] ]);
                } else if (target.closest("[data-fk-less]")) {
                    target.closest(".fk-pair").remove();
                    draw(current());
                }
            });
        },
        submit : async (form) => {
            const data  = new FormData(form);
            const pairs = [ ...form.querySelectorAll(".fk-pair") ];

            const result = await api("/api/action", {
                action     : "db-fk-save",
                db         : browse.db,
                table      : structure.table,
                name       : String(data.get("name")),
                refTable   : String(data.get("refTable")),
                columns    : pairs.map((one) => /** @type {HTMLSelectElement} */ (
                    one.querySelector("[data-fk-here]")
                ).value),
                refColumns : pairs.map((one) => /** @type {HTMLSelectElement} */ (
                    one.querySelector("[data-fk-there]")
                ).value),
                onDelete   : String(data.get("onDelete")),
                onUpdate   : String(data.get("onUpdate")),
                replace    : old?.name || "",
            });

            loadStructure();
            return result;
        },
        remove : old ? { label : "Drop", run : () => dropForeignKey(old.name) } : null,
    });
}

/**
 * Drops a foreign key, once the user is sure. Gives whether it was dropped.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function dropForeignKey(name) {
    const key  = browse.structure.foreign.find((one) => one.name === name);
    const sure = await ask({
        title  : `Drop the foreign key ${name}?`,
        text   : `${browse.table} no longer has to match ${
            key?.table || "the other table"
        }. Its rows and the index on its columns stay.`,
        ok     : "Drop",
        danger : true,
    });
    if (!sure) {
        return false;
    }

    try {
        const { message } = await api("/api/action", {
            action : "db-fk-drop",
            db     : browse.db,
            table  : browse.table,
            name,
        });
        toast(message);
    } catch (error) {
        toast(error.message, true);
        return false;
    }

    loadStructure();
    return true;
}

/**
 * Opens the row a foreign key's value refers to: the other table's rows,
 * filtered to it, as Sequel Ace's arrow in a cell does.
 */
let pendingFilters = null;
/**
 * Opens the rows a cell's foreign key refers to, if its column has a key of its own and the cell
 * a value.
 * @param {number} at The column's place.
 * @param {number} index The row's place.
 * @returns {void}
 */
function followForeignKey(at, index) {
    const { structure, rows } = browse.rows;
    const column = structure.columns[at];
    const key    = structure.foreign.find((one) => one.columns.length === 1
        && one.columns[0] === column.name);
    const value  = rows[index][at];
    if (!key || value === null) {
        return;
    }

    pendingFilters = {
        table   : key.table,
        filters : [ {
            on     : true,
            column : key.references[0],
            op     : "=",
            value  : String(value),
            value2 : "",
        } ],
    };
    navigate(browsePath("rows", key.table));
}

/**
 * A table's size on disk, data and indexes, for a title; nothing for a view.
 * @param {string} name
 * @returns {string}
 */
function size(name) {
    const table = browse.tables.find((one) => one.name === name);
    return table && !table.view ? ` · ${bytes(table.size)}` : "";
}

/**
 * The columns whose name, type or comment has the text typed.
 * @returns {void}
 */
function renderStructureColumns() {
    const structure = browse.structure;
    const search    = /** @type {HTMLInputElement} */ (document.getElementById("structure-filter"))
        .value.trim().toLowerCase();
    const shown     = structure.columns
        .filter((column) => [ column.name, column.type, column.comment ]
            .some((text) => text.toLowerCase().includes(search)));
    const key       = `<span class="key" title="Primary key"><svg viewBox="0 0 24 24"><circle
        cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg></span>`;

    // A row drags to another place, while every column shows, so where it lands is plain.
    const drag = !search && !structureIsView();
    document.getElementById("structure-columns").innerHTML = shown.map((column) => `
        <tr data-key="${esc(column.name)}" ${drag ? `draggable="true"` : ""}>
            <td data-field="name"><strong>${esc(column.name)}</strong>${
                structure.primary.includes(column.name) ? key : ""
            }</td>
            <td data-field="type">${esc(column.type)}</td>
            <td data-field="null">${column.nullable ? "yes" : `<span class="null">no</span>`}</td>
            <td data-field="default">${defaultCell(column)}</td>
            <td>${esc(column.extra)}</td>
            <td data-field="comment" class="comment"
                title="${esc(column.comment)}">${esc(column.comment)}</td>
        </tr>
    `).join("")
        || `<tr><td class="empty" colspan="6">No column has “${esc(search)}”.</td></tr>`;
    markRow(document.getElementById("structure-grid"));
}

/**
 * What a column starts with, as the grid shows it: nothing and NULL muted, an empty text named, a
 * generated column's expression after "as".
 * @param {DbStructureColumn} column
 * @returns {string}
 */
function defaultCell(column) {
    const { kind, value } = column.value;
    if (kind === "none") {
        return `<span class="null">none</span>`;
    }
    if (kind === "null") {
        return `<span class="null">NULL</span>`;
    }
    if (kind === "virtual" || kind === "stored") {
        return `<span class="null">as</span> ${esc(value)}`;
    }
    return value === "" ? `<span class="null">empty</span>` : esc(value);
}
