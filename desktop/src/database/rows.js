"use strict";

// A table's rows: read a page at a time, sorted, filtered by rules, and their columns'
// widths and values.

// -------------------------------------------------------------------- rows ---

/**
 * Reads the page of rows asked for, and replaces the rows in place, with
 * no fade, so nothing blinks. The total comes after: without filters, the estimate MariaDB
 * keeps; with them, counted apart, as that takes as long as filtering.
 * @returns {Promise<void>}
 */
async function loadRows() {
    if (!browse.table) {
        document.getElementById("rows-title").textContent = "";
        document.getElementById("rows-filters").innerHTML = "";
        document.getElementById("rows-grid").innerHTML    = `<tbody><tr><td class="empty">This
            database has no tables yet. Make one with SQL, or import a dump.</td></tr></tbody>`;
        document.getElementById("rows-pager").innerHTML   = "";
        return;
    }
    const asked  = rowsQuestion();
    const grid   = document.getElementById("rows-grid");
    const timer  = setTimeout(() => grid.classList.add("loading"), 250);
    try {
        const rows = await api(`/api/db-rows?${new URLSearchParams(asked)}`);
        // Only the answer to the last question shows, when several were asked one after another.
        if (JSON.stringify(asked) !== JSON.stringify(rowsQuestion())) {
            return;
        }
        browse.rows  = rows;
        browse.total = browse.filters.length ? null : undefined;
        renderFilterBar();
        renderRows();
        if (browse.filters.length) {
            countRows(asked);
        }
    } catch (error) {
        grid.innerHTML = `<tbody><tr><td class="empty bad">${esc(error.message)}</td></tr></tbody>`;
    } finally {
        clearTimeout(timer);
        grid.classList.remove("loading");
    }
}

/**
 * The rows asked of the server: the table, the page, the sort and the filters.
 * @typedef {{ db: string, table: string, page: string, sort: string, dir: string,
 *     filters: string, match: string }} DbRowsQuestion
 */

/**
 * The rows the page asks for now, as the server is asked for them.
 * @returns {DbRowsQuestion}
 */
function rowsQuestion() {
    return {
        db      : browse.db,
        table   : browse.table,
        page    : String(browse.page),
        sort    : browse.sort,
        dir     : browse.dir,
        filters : JSON.stringify(browse.filters),
        match   : browse.match,
    };
}

/**
 * Counts the rows the filters leave, and shows the total if they are still the ones asked for.
 * @param {DbRowsQuestion} asked
 * @returns {Promise<void>}
 */
async function countRows(asked) {
    try {
        const { count } = await api(`/api/db-count?${new URLSearchParams(asked)}`);
        if (JSON.stringify(asked) === JSON.stringify(rowsQuestion())) {
            browse.total = count;
            renderPager();
        }
    } catch {
        // The rows show without their total.
    }
}

/**
 * The page of rows: a header to sort by and to resize, the key's columns
 * marked, then each row, NULL apart from text and long values cut, with
 * its buttons at the end. A table without a primary key is only read, as
 * its rows cannot be told apart to change one.
 * @returns {void}
 */
function renderRows() {
    const { structure, rows, cut } = browse.rows;
    const table  = browse.tables.find((one) => one.name === structure.table);
    const keyed  = structure.primary.length > 0 && !table?.view;
    const clock  = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path
        d="M12 7.5V12l3 2"/></svg>`;
    const arrow  = (name) => (browse.sort === name
        ? `<span class="sort-dir">${browse.dir === "desc" ? "↓" : "↑"}</span>`
        : "");
    const dates  = browse.dates[tableKey()] || [];
    // The columns the filter at the bottom leaves, by their place in the row.
    const search = /** @type {HTMLInputElement} */ (document.getElementById("column-filter"))
        .value.trim().toLowerCase();
    const shown  = structure.columns.map((column, at) => at)
        .filter((at) => structure.columns[at].name.toLowerCase().includes(search));
    renderRowsTitle();
    /** @type {HTMLElement} */ (document.querySelector("[data-row-new]")).hidden = !keyed;
    const note = document.getElementById("rows-note");
    note.hidden      = keyed;
    note.textContent = table?.view ? "A view, so its rows are only read here."
        : "It has no primary key, so its rows are only read here.";

    // The columns that alone are a foreign key, whose values open the row they refer to.
    const linked = new Set(structure.foreign
        .filter((key) => key.columns.length === 1)
        .map((key) => structure.columns.findIndex((column) => column.name === key.columns[0])));
    const grid = document.getElementById("rows-grid");
    grid.innerHTML = `
        <thead><tr>
            ${shown.map((at) => structure.columns[at])
                .map((column, place) => [ column, shown[place] ])
                .map(([ column, at ]) => `
                <th data-col="${esc(column.name)}">
                    <button class="sort ${browse.sort === column.name ? "active" : ""}"
                        data-sort="${esc(column.name)}"
                        title="${esc(column.type)}${column.comment
                            ? ` · ${esc(column.comment)}` : ""}">
                        ${structure.primary.includes(column.name)
                            ? `<span class="key"
                                title="Primary key"><svg viewBox="0 0 24 24"><circle cx="8" cy="15"
                                r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg></span>`
                            : ""}${esc(column.name)}${arrow(column.name)}
                    </button>
                    ${isTimestamps(rows, at) ? `<button
                        class="icon-btn as-date ${dates.includes(column.name) ? "on" : ""}"
                        data-as-date="${esc(column.name)}"
                        title="${dates.includes(column.name) ? "Show the numbers"
                            : "Show these timestamps as dates"}"
                        aria-label="Show as dates">${clock}</button>` : ""}
                    <span class="col-resize" data-resize
                        title="Drag to resize, double-click to fit"></span>
                </th>
            `).join("")}
        </tr></thead>
        <tbody>
            ${rows.map((row, index) => `
                <tr data-row="${index}" data-key="${index}">
                    ${shown.map((at) => withLink(
                        cellOf(
                            row[at], structure.columns[at], cut, at,
                            dates.includes(structure.columns[at].name),
                        ),
                        linked.has(at) && row[at] !== null,
                        at,
                    )).join("")}
                </tr>
            `).join("") || `<tr><td class="empty" colspan="${shown.length}">${browse.filters.length
                ? "No row matches the filters." : "No rows yet."}</td></tr>`}
        </tbody>
    `;
    applyWidths(grid, browse.widths[tableKey()]);
    markRow(grid);
    renderPager();
    watchFades(/** @type {HTMLElement} */ (grid.parentElement));
}

/**
 * The table open, with its database, as the key of what is kept for it.
 * @returns {string}
 */
function tableKey() {
    return `${browse.db}.${browse.table}`;
}

/**
 * The table's name and its rows, exact or estimated, over its rows.
 * @returns {void}
 */
function renderRowsTitle() {
    const name  = browse.rows.structure.table;
    const table = browse.tables.find((one) => one.name === name);
    document.getElementById("rows-title").innerHTML = `${esc(name)} <span
        class="muted">${table && !table.view
            ? `· ${table.exact ? "" : "~"}${countOf(table.rows, "row")}` : ""}</span>`;
}

/**
 * Which rows these are, of how many, and the buttons to the pages either side.
 * @returns {void}
 */
function renderPager() {
    const { rows, page, size, more } = browse.rows;
    const table = browse.tables.find((one) => one.name === browse.table);
    const first = (page - 1) * size;
    const total = browse.total === undefined
        ? (table && !table.view ? `${table.exact ? "" : "~"}${table.rows.toLocaleString()}` : "")
        : browse.total === null ? "…" : browse.total.toLocaleString();
    document.getElementById("rows-pager").innerHTML = rows.length || page > 1 ? `
        <span class="muted">Rows ${(first + (rows.length ? 1 : 0)).toLocaleString()}–${
            (first + rows.length).toLocaleString()}${total ? ` of ${total}` : ""}</span>
        <button class="ghost small" data-page="-1" ${page > 1 ? "" : "disabled"}>Previous</button>
        <button class="ghost small" data-page="1" ${more ? "" : "disabled"}>Next</button>
    ` : browse.filters.length
        ? `<span class="muted">No rows of ${total || "the table"} match</span>` : "";
}

/**
 * A value in the grid: NULL dimmed, a binary column's size, long text cut
 * with an ellipsis, and a button to see a long or JSON value whole. A
 * timestamp column shown as dates gives each as one, the number on hover.
 * @param {string} value
 * @param {{ binary: boolean, dataType: string }} column
 * @param {number} cut
 * @param {number} at
 * @param {boolean=} asDate
 * @returns {string}
 */
function cellOf(value, column, cut, at, asDate = false) {
    if (value === null) {
        return `<td data-at="${at}"><span class="null">NULL</span></td>`;
    }
    if (column.binary) {
        return `<td data-at="${at}"><span class="null">${esc(value)}</span></td>`;
    }
    const kind = /int|decimal|float|double|bit/.test(column.dataType) ? "num" : "";
    if (asDate && /^\d{9,13}$/.test(value)) {
        return `<td data-at="${at}" class="date" title="${esc(value)}">${esc(dateOf(value))}</td>`;
    }
    const text = value.length > cut ? `${value.slice(0, cut)}…` : value;
    const long = isBig(value);
    const open = long ? `<button class="cell-open" data-cell-open="${at}" title="See it whole"
        aria-label="See it whole"><svg viewBox="0 0 24 24"><path
        d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></button>` : "";
    return `<td data-at="${at}"
        class="${kind} ${long ? "long" : ""}">${esc(text.replace(/\s+/g, " "))}${open}</td>`;
}

/**
 * A cell with the arrow that follows its foreign key, when it has one and a value.
 * @param {string} cell
 * @param {boolean} linked
 * @param {number} at
 * @returns {string}
 */
function withLink(cell, linked, at) {
    if (!linked) {
        return cell;
    }
    const arrow = `<button class="fk-follow" data-fk-follow="${at}"
        title="Open the row it refers to" aria-label="Open the row it refers to"><svg
        viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
    return cell.replace(/^<td ([^>]*?)class="([^"]*)"/, "<td $1class=\"$2 linked\"")
        .replace(/^<td (?![^>]*class=)/, "<td class=\"linked\" ")
        .replace(/<\/td>$/, `${arrow}</td>`);
}

/**
 * A value too big for its cell: long, on several lines, or JSON. It shows cut, and changes in a
 * dialog.
 * @param {string} value
 * @returns {boolean}
 */
function isBig(value) {
    return value !== null && (value.length > 40 || /\n/.test(value) || /^\s*[[{]/.test(value));
}

/**
 * Whether a column's values on this page look like Unix timestamps: whole
 * numbers of seconds, or milliseconds, from 2001 to 2100.
 * @param {string[][]} rows
 * @param {number} at
 * @returns {boolean}
 */
function isTimestamps(rows, at) {
    const values = rows.map((row) => row[at])
        .filter((value) => value !== null && value !== "" && value !== "0");
    return values.length > 0 && values.every((value) => /^\d{10}(\d{3})?$/.test(value)
        && Number(value.slice(0, 10)) > 978307200
        && Number(value.slice(0, 10)) < 4102444800);
}

/**
 * A timestamp as a date and time here, with its seconds.
 * @param {string} value
 * @returns {string}
 */
function dateOf(value) {
    const date = new Date(value.length > 10 ? Number(value) : Number(value) * 1000);
    const pad  = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${
        pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Shows a timestamp column as dates, or as its numbers again, kept for the table.
 * @param {string} name
 * @returns {void}
 */
function toggleDates(name) {
    const key   = tableKey();
    const dates = browse.dates[key] || [];
    browse.dates[key] = dates.includes(name)
        ? dates.filter((one) => one !== name)
        : [ ...dates, name ];
    renderRows();
}

/**
 * Sorts by a column, the other way when it already is.
 * @param {string} name
 * @returns {void}
 */
function sortRows(name) {
    browse.dir  = browse.sort === name && browse.dir === "asc" ? "desc" : "asc";
    browse.sort = name;
    browse.page = 1;
    loadRows();
}

/**
 * Goes to the page of rows before or after, never before the first.
 * @param {number} step
 * @returns {void}
 */
function turnPage(step) {
    browse.page = Math.max(1, browse.page + step);
    loadRows();
}

// ----------------------------------------------------------------- filters ---

/**
 * The operators of a filter rule, as Sequel Ace offers them, and the ones
 * that need no value, or two.
 */
const FILTER_OPS = [
    [ "contains", "contains" ], [ "not contains", "doesn't contain" ], [ "=", "=" ],
    [ "!=", "≠" ], [ ">", ">" ], [ "<", "<" ], [ ">=", "≥" ], [ "<=", "≤" ],
    [ "begins", "begins with" ], [ "ends", "ends with" ], [ "like", "LIKE" ],
    [ "not like", "NOT LIKE" ], [ "regexp", "matches regex" ], [ "in", "IN" ],
    [ "not in", "NOT IN" ], [ "between", "BETWEEN" ], [ "null", "IS NULL" ],
    [ "not null", "IS NOT NULL" ],
];
const NO_VALUE = [ "null", "not null" ];

/**
 * The filter bar, as Sequel Ace's: a rule per line -- a box that turns it
 * on or off, a column or any, an operator and its value, and + and − to
 * add and take away rules -- then the WHERE they make, as typed, with
 * whether all or any must hold, Filter, which Enter does too, and Clear.
 * It is drawn again for another table, and as rules come and go, never as
 * rows load, so typing stays.
 * @param {boolean=} force
 * @returns {void}
 */
function renderFilterBar(force = false) {
    const bar = document.getElementById("rows-filters");
    if (!force && bar.dataset.table === tableKey()) {
        bar.classList.toggle("applied", browse.filters.length > 0);
        return;
    }
    bar.dataset.table = tableKey();
    const columns = browse.rows.structure.columns;
    const rules   = browse.draft.length ? browse.draft : [ blankRule() ];
    bar.classList.toggle("applied", browse.filters.length > 0);
    bar.innerHTML = `
        <div class="filter-rules">
            ${rules.map((rule, index) => `
                <div class="filter-rule ${rule.on ? "" : "off"}" data-rule="${index}">
                    <input type="checkbox" class="box" data-f="on" ${rule.on ? "checked" : ""}
                        title="Use this rule" aria-label="Use this rule">
                    <span class="field select"><select data-f="column" aria-label="Column">
                        <option value="*">Any column</option>
                        ${columns.map((column) => `<option value="${esc(column.name)}"
                            ${rule.column === column.name ? "selected" : ""}>${
                                esc(column.name)}</option>`).join("")}
                    </select></span>
                    <span class="field select op"><select data-f="op" aria-label="Operator">
                        ${FILTER_OPS.map(([ value, label ]) => `<option value="${esc(value)}"
                            ${rule.op === value ? "selected" : ""}>${esc(label)}</option>`)
                            .join("")}
                    </select></span>
                    <input data-f="value" value="${esc(rule.value)}"
                        placeholder="${rule.op.includes("in") && !rule.op.includes("contain")
                            ? "a, b, c" : "Value"}"
                        spellcheck="false" ${NO_VALUE.includes(rule.op) ? "hidden" : ""}>
                    <span class="filter-and" ${rule.op === "between" ? "" : "hidden"}>and</span>
                    <input data-f="value2" value="${esc(rule.value2)}" placeholder="Value"
                        spellcheck="false" ${rule.op === "between" ? "" : "hidden"}>
                    <button type="button" class="icon-btn" data-filter-remove="${index}"
                        title="Take this rule away" aria-label="Take this rule away"><svg
                        viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>
                    <button type="button" class="icon-btn" data-filter-add title="Add a rule"
                        aria-label="Add a rule"><svg viewBox="0 0 24 24"><path
                        d="M12 6v12M6 12h12"/></svg></button>
                </div>
            `).join("")}
        </div>
        <div class="filter-foot">
            <div class="filter-query"><code id="filter-sql" class="filter-sql"></code></div>
            ${rules.length > 1 ? `<span class="field select"><select data-f="match"
                aria-label="Match"><option value="all">All rules</option><option value="any"
                ${browse.match === "any" ? "selected" : ""}>Any rule</option></select></span>`
                : ""}
            <button class="small">Filter</button>
            <button type="button" class="ghost small" data-filter-clear ${browse.filters.length
                || rules.some((rule) => rule.value) ? "" : "disabled"}>Clear</button>
        </div>
    `;
    showFilterSql();
}

/**
 * A rule of the filter bar: whether it is on, its column or any, its operator and its values.
 * @typedef {{ on: boolean, column: string, op: string, value: string, value2: string }}
 *     DbFilterRule
 */

/**
 * A new rule, on, on any column, with no value.
 * @returns {DbFilterRule}
 */
function blankRule() {
    return { on : true, column : "*", op : "contains", value : "", value2 : "" };
}

/**
 * The rules as the bar holds them now.
 * @returns {DbFilterRule[]}
 */
function readFilterBar() {
    const bar = document.getElementById("rows-filters");
    browse.match = /** @type {HTMLSelectElement} */ (bar.querySelector("[data-f=match]"))?.value
        || "all";
    browse.draft = [ ...bar.querySelectorAll(".filter-rule") ].map((line) => {
        const get = (name) => /** @type {HTMLInputElement} */ (
            line.querySelector(`[data-f="${name}"]`)
        );
        return {
            on     : get("on").checked,
            column : get("column").value,
            op     : get("op").value,
            value  : get("value").value,
            value2 : get("value2").value,
        };
    });
    return browse.draft;
}

/**
 * The rules that filter: turned on, and with a value, or needing none.
 * @param {DbFilterRule[]} rules
 * @returns {DbFilterRule[]}
 */
function usedRules(rules) {
    return rules.filter((rule) => rule.on
        && (NO_VALUE.includes(rule.op) || rule.value.trim() !== ""));
}

/**
 * Filters by the rules in use, from the first page.
 * @returns {void}
 */
function applyFilters() {
    browse.filters = usedRules(readFilterBar());
    browse.page    = 1;
    loadRows();
}

/**
 * The WHERE the rules make, as the server writes it, shown under them as
 * they are typed. A rule on any column names a few of the columns it
 * tries; the server tries them all.
 * @returns {void}
 */
function showFilterSql() {
    const box   = document.getElementById("filter-sql");
    const rules = usedRules(readFilterBar());
    if (!rules.length) {
        box.innerHTML = `<span class="muted">No filter: every row</span>`;
        box.title     = "";
        return;
    }
    const quote = (value) => `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    const like  = (value) => String(value).replace(/[\\%_]/g, "\\$&");
    const list  = (value) => value.split(",").map((one) => one.trim()).filter(Boolean)
        .map(quote).join(", ");
    const ops   = {
        "contains"     : (name, value) => `${name} LIKE ${quote(`%${like(value)}%`)}`,
        "not contains" : (name, value) => `${name} NOT LIKE ${quote(`%${like(value)}%`)}`,
        "begins"       : (name, value) => `${name} LIKE ${quote(`${like(value)}%`)}`,
        "ends"         : (name, value) => `${name} LIKE ${quote(`%${like(value)}`)}`,
        "like"         : (name, value) => `${name} LIKE ${quote(value)}`,
        "not like"     : (name, value) => `${name} NOT LIKE ${quote(value)}`,
        "regexp"       : (name, value) => `${name} REGEXP ${quote(value)}`,
        "in"           : (name, value) => `${name} IN (${list(value)})`,
        "not in"       : (name, value) => `${name} NOT IN (${list(value)})`,
        "between"      : (name, value, second) =>
            `${name} BETWEEN ${quote(value)} AND ${quote(second)}`,
        "null"         : (name) => `${name} IS NULL`,
        "not null"     : (name) => `${name} IS NOT NULL`,
    };
    const one = (op, name, value, second) => (ops[op] ? ops[op](name, value, second)
        : `${name} ${op === "!=" ? "<>" : op} ${quote(value)}`);
    const columns = browse.rows.structure.columns.filter((column) => !column.binary)
        .map((column) => `\`${column.name}\``);
    const parts   = rules.map((rule) => {
        if (rule.column !== "*") {
            return one(rule.op, `\`${rule.column}\``, rule.value, rule.value2);
        }
        const negative = {
            "not contains" : "contains",
            "!="           : "=",
            "not like"     : "like",
            "not in"       : "in",
            "not null"     : "null",
        }[rule.op];
        const each     = columns.slice(0, 2)
            .map((name) => one(negative || rule.op, name, rule.value, rule.value2));
        const rest     = columns.length > 2 ? ` OR … ${columns.length - 2} more` : "";
        return `${negative ? "NOT " : ""}(${each.join(" OR ")}${rest})`;
    });
    const where = `WHERE ${parts.join(browse.match === "any" ? " OR " : " AND ")}`;
    box.innerHTML = paintSql(where);
    box.title     = where;
}

/**
 * Adds an empty rule under the others, and puts the cursor in its value.
 * @returns {void}
 */
function addFilter() {
    browse.draft = [ ...readFilterBar(), blankRule() ];
    renderFilterBar(true);
    /** @type {HTMLElement} */ ([ ...document.querySelectorAll("#rows-filters [data-f=value]") ]
        .pop())?.focus();
}

/**
 * Takes a rule away; with its last rule gone, the bar has an empty one, and nothing filters.
 * @param {number} index
 * @returns {void}
 */
function removeFilter(index) {
    const rules = readFilterBar();
    rules.splice(index, 1);
    browse.draft = rules;
    renderFilterBar(true);
    applyFilters();
}

/**
 * Takes every rule away, and shows the rows unfiltered from the first page.
 * @returns {void}
 */
function clearFilters() {
    browse.draft   = [];
    browse.filters = [];
    renderFilterBar(true);
    browse.page = 1;
    loadRows();
}

/**
 * An operator chosen: its value fields show as it needs them, and one that needs none filters at
 * once.
 * @param {{ value: string, closest: (selectors: string) => HTMLElement }} select
 * @returns {void}
 */
function changeFilterOp(select) {
    readFilterBar();
    renderFilterBar(true);
    if (NO_VALUE.includes(select.value)) {
        applyFilters();
    } else {
        /** @type {HTMLElement} */ (document.querySelector(
            `#rows-filters [data-rule="${select.closest("[data-rule]")
                .dataset.rule}"] [data-f=value]`,
        ))?.focus();
    }
}

// ---------------------------------------------------- column widths, values ---

/**
 * Gives a grid's columns the widths dragged for its table, kept while Studio
 * is open; without them, each column is as wide as it needs, up to a point.
 * @param {HTMLElement} grid
 * @param {Object<string, number>} widths
 * @returns {void}
 */
function applyWidths(grid, widths) {
    grid.classList.remove("fixed");
    grid.style.width = "";
    grid.querySelectorAll("th").forEach((th) => {
        /** @type {HTMLElement} */ (th).style.width = "";
    });
    if (widths) {
        freezeWidths(grid, widths);
    }
}

/**
 * Fixes every column at its width now, or the one given, so one can be dragged without the rest
 * moving.
 * @param {HTMLElement} grid
 * @param {Object<string, number>=} widths
 * @returns {void}
 */
function freezeWidths(grid, widths = {}) {
    const heads  = /** @type {HTMLElement[]} */ ([ ...grid.querySelectorAll("thead th") ]);
    const sizes  = heads.map((th) => widths[th.dataset.col] || th.offsetWidth);
    heads.forEach((th, index) => { th.style.width = `${sizes[index]}px`; });
    grid.style.width = `${sizes.reduce((sum, size) => sum + size, 0)}px`;
    grid.classList.add("fixed");
}

/**
 * Drags a column's edge; a double click puts the grid's columns back to the widths they need.
 * @param {PointerEvent} event
 * @returns {void}
 */
function startResize(event) {
    const handle = /** @type {HTMLElement} */ (event.target);
    const th     = /** @type {HTMLElement} */ (handle.closest("th"));
    const grid   = /** @type {HTMLElement} */ (handle.closest("table"));
    event.preventDefault();
    if (!grid.classList.contains("fixed")) {
        freezeWidths(grid);
    }
    const startX     = event.clientX;
    const startWidth = th.offsetWidth;
    const startTable = grid.offsetWidth;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
    const move = (moved) => {
        const width = Math.max(48, startWidth + moved.clientX - startX);
        th.style.width   = `${width}px`;
        grid.style.width = `${startTable + width - startWidth}px`;
    };
    const stop = () => {
        handle.removeEventListener("pointermove", move);
        document.body.classList.remove("resizing");
        if (grid.id === "rows-grid") {
            browse.widths[tableKey()] = Object.fromEntries(
                [ ...grid.querySelectorAll("thead th[data-col]") ].map((one) => [
                    /** @type {HTMLElement} */ (one).dataset.col,
                    /** @type {HTMLElement} */ (one).offsetWidth,
                ]),
            );
        }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop, { once : true });
}

/**
 * Puts a grid's columns back to the widths they need, forgetting the ones dragged.
 * @param {HTMLElement} grid
 * @returns {void}
 */
function resetWidths(grid) {
    if (grid.id === "rows-grid") {
        delete browse.widths[tableKey()];
    }
    applyWidths(grid, null);
}

/**
 * Shows a value whole, in a dialog: JSON laid out and painted as JSON, any
 * other text as it is, with Copy. A value the grid cut is read whole first,
 * by its row's key.
 * @param {HTMLElement} button
 * @returns {Promise<void>}
 */
async function openCell(button) {
    const td  = /** @type {HTMLElement} */ (button.closest("td"));
    const tr  = /** @type {HTMLElement} */ (td.closest("tr"));
    const at  = Number(button.dataset.cellOpen);
    let value;
    let name;
    if (tr.dataset.row !== undefined && rowsKeyed()) {
        editValue(Number(tr.dataset.row), at);
        return;
    }
    if (tr.dataset.row !== undefined) {
        const { structure, rows, cut } = browse.rows;
        name  = structure.columns[at].name;
        value = rows[Number(tr.dataset.row)][at];
        if (value.length > cut && structure.primary.length) {
            try {
                value = (await api("/api/action", {
                    action : "db-row",
                    db     : browse.db,
                    table  : browse.table,
                    key    : rowKey(Number(tr.dataset.row)),
                })).row[at];
            } catch (error) {
                toast(error.message, true);
                return;
            }
        }
    } else {
        const result = browse.results[Number(tr.dataset.result)];
        name  = result.columns[at];
        value = result.rows[Number(tr.dataset.r)][at];
    }
    showValue(name, value);
}

/**
 * A value in a dialog, JSON laid out and painted, to read and copy.
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function showValue(name, value) {

    let shown = value;
    let json  = false;
    if (/^\s*[[{]/.test(value)) {
        try {
            shown = JSON.stringify(JSON.parse(value), null, 2);
            json  = true;
        } catch {
            // Not JSON after all: shown as text.
        }
    }
    const done = ask({
        title  : name,
        text   : `${json ? "JSON · " : ""}${countOf(value.length, "character")}`,
        body   : `<pre class="value-view">${json ? paintJson(shown) : escapeCode(shown)}</pre>`,
        ok     : "Copy",
        closeX : true,
    });
    /** @type {HTMLElement} */ (document.getElementById("ask")).dataset.mode = "view";
    done.then((copy) => {
        if (copy) {
            navigator.clipboard.writeText(shown).then(() => toast("Copied"));
        }
    });
}
