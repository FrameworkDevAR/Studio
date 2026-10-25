"use strict";

// A database's own page, as a small phpMyAdmin: its tables on the side; a
// table's structure; its rows, to sort, filter, change, add and delete;
// its information, as Sequel Ace's, to change its options; SQL to run;
// and the database exported or imported as a whole.

/**
 * What the page shows: the database and its tables, the table picked, the
 * tab, and the page of rows with its sort. The path holds the
 * database, the tab and the table, as /database/shop/rows/orders.
 */
/**
 * Also the filters, applied and as typed, the widths dragged and the
 * timestamp columns shown as dates, by table, and the SQL's last results.
 * @type {{ db: string, tables: any[], table: string, tab: string, page: number, sort: string,
 *          dir: string, rows: any, total: any, filters: any[], draft: any[], match: string,
 *          widths: Record<string, any>, dates: Record<string, string[]>, structure: any,
 *          results: any[], sql: Record<string, string> }}
 */
let browse = { db : "", tables : [], table : "", tab : "tables", page : 1, sort : "", dir : "asc",
    rows : null, total : undefined, filters : [], draft : [], match : "all", widths : {},
    dates : {}, structure : null, results : [], sql : {} };

/**
 * The path of a tab of the database, with its table but for the Tables and SQL tabs.
 * @param {string} tab
 * @param {string=} table
 * @returns {string}
 */
function browsePath(tab, table = browse.table) {
    if (tab === "tables") {
        return `/database/${encodeURIComponent(browse.db)}`;
    }
    const parts = [ "database", browse.db, tab, ...(tab === "sql" || !table ? [] : [ table ]) ];
    return `/${parts.map(encodeURIComponent).join("/")}`;
}

/**
 * Shows the page for the path, reading the database's tables when it is another one.
 * @returns {Promise<void>}
 */
async function showBrowse() {
    // A table the keys were going to doesn't open over a page gone to since.
    clearTimeout(tableStep);
    focusKeys(keysTo);
    // The database alone lists its tables, as phpMyAdmin starts.
    const [ , , db = "", tab = "tables", table = "" ] = location.pathname.split("/")
        .map(decodeURIComponent);
    const tabName = [ "tables", "structure", "rows", "info", "sql" ].includes(tab) ? tab : "tables";
    if (db !== browse.db) {
        browse = { ...browse, db, tables : [], table : "", rows : null };
        document.getElementById("browse-tables").innerHTML = `<div class="pkg-none">Reading the
            tables…</div>`;
        await loadTables();
    }
    const picked = table
        || browse.table
        || browse.tables.find((one) => !one.view)?.name
        || browse.tables[0]?.name
        || "";
    if (picked !== browse.table) {
        browse = {
            ...browse,
            table   : picked,
            page    : 1,
            sort    : "",
            dir     : "asc",
            rows    : null,
            filters : [],
            draft   : [],
            match   : "all",
        };
        /** @type {HTMLInputElement} */ (document.getElementById("column-filter")).value = "";
    }
    // A foreign key followed: its table opens filtered to the row it refers to.
    if (pendingFilters?.table === picked) {
        browse = {
            ...browse,
            page    : 1,
            rows    : null,
            filters : pendingFilters.filters,
            draft   : pendingFilters.filters.map((rule) => ({ ...rule })),
            match   : "all",
        };
    }
    pendingFilters = null;
    browse.tab = tabName;
    for (const button of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll("#browse-tabs button")
    )) {
        button.classList.toggle("active", button.dataset.browseTab === tabName);
    }
    // The Tables tab is the list itself, so the side's list would only repeat it.
    document.querySelector(".browse").classList.toggle("whole", tabName === "tables");
    document.getElementById("browse-overview").hidden  = tabName !== "tables";
    document.getElementById("browse-rows").hidden      = tabName !== "rows";
    document.getElementById("browse-structure").hidden = tabName !== "structure";
    document.getElementById("browse-info").hidden      = tabName !== "info";
    document.getElementById("browse-sql").hidden       = tabName !== "sql";
    document.getElementById("browse-db").textContent   = db;
    document.title = `${db} · Studio`;
    renderBrowseHead();
    renderTableList();
    if (tabName === "tables") {
        renderOverview();
    } else if (tabName === "rows") {
        loadRows();
    } else if (tabName === "structure") {
        loadStructure();
    } else if (tabName === "info") {
        loadInfo();
    } else {
        openSql();
    }
}

/**
 * Reads the database's tables again, and shows them wherever they show.
 * @returns {Promise<void>}
 */
async function loadTables() {
    // The counts already exact stay while the list is read again, until counted anew, so the Rows
    // column keeps its width.
    const db    = browse.db;
    const known = new Map(browse.tables
        .filter((one) => one.exact)
        .map((one) => [ one.name, one.rows ]));
    try {
        const list = await api(`/api/db-tables?db=${encodeURIComponent(db)}`);
        for (const table of db === browse.db ? list : []) {
            if (!table.exact && known.has(table.name)) {
                table.estimate = table.rows;
                table.rows     = known.get(table.name);
                table.exact    = true;
                table.held     = true;
            }
        }
        browse.tables = list;
    } catch (error) {
        browse.tables = [];
        toast(error.message, true);
    }
    renderTableList();
    renderBrowseHead();
    if (browse.tab === "tables") {
        renderOverview();
    }
    countSmallTables();
}

/**
 * The exact rows of the small InnoDB tables, asked for once the list
 * shows, so it shows at once: until then, they are estimates.
 * @returns {Promise<void>}
 */
async function countSmallTables() {
    const db = browse.db;
    let counts;
    try {
        counts = await api(`/api/db-counts?db=${encodeURIComponent(db)}`);
    } catch {
        return;
    }
    if (db !== browse.db) {
        return;
    }
    for (const table of browse.tables) {
        if (table.name in counts) {
            table.rows  = counts[table.name];
            table.exact = true;
        } else if (table.held) {
            // A count held from before that isn't counted again goes back to MariaDB's estimate.
            table.rows  = table.estimate;
            table.exact = false;
        }
        delete table.held;
    }
    showCounts();
}

/**
 * The rows of the tables again, wherever they show, once counted.
 * @returns {void}
 */
function showCounts() {
    if (browse.tab === "tables") {
        renderOverview();
    }
    renderTableList();
    if (browse.tab === "rows" && browse.rows) {
        renderRowsTitle();
        renderPager();
    }
    const rows  = document.getElementById("info-rows");
    const table = browse.tables.find((one) => one.name === browse.table);
    if (rows && table) {
        rows.innerHTML = rowsCell(table);
    }
}

/**
 * phpMyAdmin's page of the database, from the page's state.
 * @returns {void}
 */
function renderBrowseHead() {
    const db = state?.databases.list.find((one) => one.name === browse.db);
    /** @type {HTMLAnchorElement} */ (document.getElementById("browse-pma")).href = db?.url
        || state?.phpmyadmin.url
        || "#";
}

/**
 * The tables by name, filtered as typed, to go to; what each holds is in the Tables tab.
 * @returns {void}
 */
function renderTableList() {
    const search = /** @type {HTMLInputElement} */ (document.getElementById("table-filter")).value
        .trim()
        .toLowerCase();
    const shown  = browse.tables.filter((one) => one.name.toLowerCase().includes(search));
    const tab    = browse.tab === "structure" || browse.tab === "info" ? browse.tab : "rows";
    const marked = [ "structure", "rows", "info" ].includes(browse.tab);
    document.getElementById("browse-tables").innerHTML = shown.map((one) => `
        <a href="${esc(browsePath(tab, one.name))}"
            data-table="${esc(one.name)}"
            class="table-link ${one.name === browse.table && marked ? "active" : ""}">
            <span class="table-name">${esc(one.name)}</span>${one.view
                ? `<span class="tag">view</span>`
                : ""}
        </a>
    `).join("") || `<div class="pkg-none">${browse.tables.length
        ? "No table matches."
        : "No tables yet."}</div>`;
    watchFades(document.getElementById("browse-tables"));
    renderTableInfo(marked ? browse.table : "");
}

/**
 * The marked table's engine, encoding, rows, sizes, next id and dates,
 * under the list, as Sequel Ace's Table Information shows them. It
 * follows the mark as the keys move it, before the table opens.
 * @param {string} name
 * @returns {void}
 */
function renderTableInfo(name) {
    const box   = document.getElementById("table-info");
    const table = browse.tables.find((one) => one.name === name);
    box.hidden  = !table;
    if (!table) {
        return;
    }
    // A date of this year with its time, one of before with its year, to fit the panel.
    const when  = (text) => {
        if (!text) {
            return "";
        }
        const date = new Date(text.replace(" ", "T"));
        return date.getFullYear() === new Date().getFullYear()
            ? date.toLocaleString([], {
                month  : "short",
                day    : "numeric",
                hour   : "2-digit",
                minute : "2-digit",
            })
            : date.toLocaleDateString([], { dateStyle : "medium" });
    };
    // The same lines for every table, empty ones as a dash, so the panel never changes height.
    const charset = table.collation.split("_")[0];
    const lines   = [
        [
            "Type",
            table.view ? "View" : table.engine + (table.format ? ` · ${table.format}` : ""),
        ],
        [
            "Encoding",
            table.collation ? `${charset} · ${table.collation.slice(charset.length + 1)}` : "",
        ],
        [ "Rows", table.view ? "" : rowsCell(table) ],
        [ "Data · Indexes", table.view ? "" : `${bytes(table.data)} · ${bytes(table.index)}` ],
        [ "Next id", table.next === null ? "" : table.next.toLocaleString() ],
        [ "Created", when(table.created) ],
        [ "Updated", when(table.updated) ],
    ];
    box.innerHTML = `
        <dl>${lines.map(([ label, value ]) => `<div><dt>${label}</dt>${!value
            ? `<dd class="none">—</dd>`
            : value.startsWith("<") ? `<dd>${value}</dd>`
                : `<dd title="${esc(value)}">${esc(value)}</dd>`}</div>`).join("")}</dl>
    `;
}

/**
 * A table of the database as the server lists it: its rows, exact or an estimate, its engine,
 * collation, sizes, next id, dates and comment. A count held from before keeps the estimate.
 * @typedef {{ name: string, view: boolean, engine: string, rows: number, exact: boolean,
 *             data: number, index: number, size: number, free: number, collation: string,
 *             comment: string, format: string, next: number, average: number, most: number,
 *             created: string, updated: string, estimate?: number, held?: boolean
 *           }} BrowseTable
 */

/**
 * A table's rows: the count when it is exact, or the estimate as a button
 * that counts them, as phpMyAdmin does for a large InnoDB table.
 * @param {BrowseTable} table
 * @returns {string}
 */
function rowsCell(table) {
    if (table.exact) {
        return table.rows.toLocaleString();
    }
    // A table being counted says so through any redraw, until its count comes.
    return counting.has(`${browse.db}.${table.name}`)
        ? `<button class="estimate" disabled>Counting…</button>`
        : `<button class="estimate"
            data-count-table="${esc(table.name)}"
            title="An estimate: click to count them">~${table.rows.toLocaleString()}</button>`;
}

/** The tables being counted, by database and name. */
const counting = new Set();

/**
 * Counts a table's rows when only their estimate was known, and shows the count everywhere.
 * @param {HTMLElement} button
 * @returns {Promise<void>}
 */
async function countTable(button) {
    const db   = browse.db;
    const name = button.dataset.countTable;
    counting.add(`${db}.${name}`);
    showCounts();
    try {
        const { count } = await api(`/api/db-count?${new URLSearchParams({ db, table : name })}`);
        const table     = db === browse.db && browse.tables.find((one) => one.name === name);
        if (table) {
            table.rows  = count;
            table.exact = true;
        }
    } catch (error) {
        toast(error.message, true);
    }
    counting.delete(`${db}.${name}`);
    showCounts();
}

/**
 * ↑ and ↓ go to the table above or below in the side's list, as in
 * Sequel Ace. The mark moves at once and the table opens when the keys
 * rest, so holding one runs through the list without loading each table
 * on the way, or leaving each in the history.
 */
let tableStep;
/**
 * Marks the table above or below the one marked, and opens it once the keys rest.
 * @param {number} by
 * @returns {void}
 */
function stepTable(by) {
    const links = /** @type {HTMLAnchorElement[]} */ ([
        ...document.querySelectorAll("#browse-tables .table-link"),
    ]);
    if (!links.length) {
        return;
    }
    const at   = links.findIndex((one) => one.classList.contains("active"));
    const next = links[at < 0 ? (by > 0 ? 0 : links.length - 1)
        : Math.min(links.length - 1, Math.max(0, at + by))];
    for (const link of links) {
        link.classList.toggle("active", link === next);
    }
    next.scrollIntoView({ block : "nearest" });
    renderTableInfo(next.querySelector(".table-name").textContent);
    clearTimeout(tableStep);
    tableStep = setTimeout(() => navigate(new URL(next.href).pathname), 180);
}

/**
 * The keys go to the list after a click in it, or while its filter is
 * typed in, or to a grid after a click on one of its rows, which it
 * marks; after a click anywhere else, to nothing, so the page scrolls
 * with them. What has them shows its mark as in macOS: the accent while
 * it has them, grey when something else has them or the window is in the
 * back.
 */
let keysTo = "list";
/**
 * Gives the keys to the list, to a grid by its id, or to nothing, and shows the marks for it.
 * @param {string} to
 * @returns {void}
 */
function focusKeys(to) {
    keysTo = to;
    const front = document.hasFocus();
    document.querySelector(".browse-aside").classList.toggle("focused", to === "list" && front);
    for (const grid of document.querySelectorAll(".browse-main .data-grid[id]")) {
        grid.classList.toggle("focused", grid.id === to && front);
    }
}

/**
 * The row marked in each grid, by its key, and what it was a row of, so another table's or page's
 * isn't.
 */
const marked = {};
/**
 * What a grid's rows are rows of: the rows asked for, the table, or the database.
 * @param {string} id
 * @returns {string}
 */
function gridContext(id) {
    return id === "rows-grid" ? JSON.stringify(rowsQuestion())
        : id === "structure-grid" ? tableKey()
            : browse.db;
}

/**
 * Marks a row: it alone, or, in the rows grid, as Sequel Ace's, added or
 * taken out with ⌘, or all from the one marked first to it with ⇧.
 * @param {HTMLElement} tr
 * @param {("" | "toggle" | "range")=} how
 * @returns {void}
 */
function pickRow(tr, how = "") {
    const grid = tr.closest("table");
    const old  = marked[grid.id];
    const key  = tr.dataset.key;
    const more = (grid.id === "rows-grid" || grid.id === "overview-grid")
        && how
        && old
        && old.context === gridContext(grid.id);
    let keys   = [ key ];
    let anchor = key;
    if (more && how === "toggle") {
        keys = old.keys.includes(key) ? old.keys.filter((one) => one !== key)
            : [ ...old.keys, key ];
    } else if (more) {
        const all   = [ ...grid.querySelectorAll("tbody tr[data-key]") ]
            .map((one) => /** @type {HTMLElement} */ (one).dataset.key);
        const [ from, to ] = [ all.indexOf(old.anchor), all.indexOf(key) ].sort((a, b) => a - b);
        anchor = old.anchor;
        keys   = from < 0 ? [ key ] : all.slice(from, to + 1);
    }
    marked[grid.id] = { key, anchor, keys, context : gridContext(grid.id) };
    markRow(grid);
}

/**
 * Every row of the rows grid on the page marked.
 * @returns {void}
 */
function pickAllRows() {
    const grid = document.getElementById("rows-grid");
    const keys = [ ...grid.querySelectorAll("tbody tr[data-key]") ]
        .map((one) => /** @type {HTMLElement} */ (one).dataset.key);
    if (keys.length) {
        marked["rows-grid"] = {
            key     : keys[0],
            anchor  : keys[0],
            keys,
            context : gridContext("rows-grid"),
        };
        markRow(grid);
    }
}

/**
 * The rows marked in the rows grid, by their place on the page, in order.
 * @returns {number[]}
 */
function pickedRows() {
    const one = marked["rows-grid"];
    if (!one || one.context !== gridContext("rows-grid") || !browse.rows) {
        return [];
    }
    return one.keys
        .map(Number)
        .filter((index) => index < browse.rows.rows.length)
        .sort((a, b) => a - b);
}

/**
 * The tables marked in the Tables tab, by name, in the order they show.
 * @returns {string[]}
 */
function pickedTables() {
    const one = marked["overview-grid"];
    if (!one || one.context !== gridContext("overview-grid")) {
        return [];
    }
    const names = new Set(one.keys || [ one.key ]);
    return [ ...document.querySelectorAll("#overview-grid tbody tr[data-key]") ]
        .map((tr) => /** @type {HTMLElement} */ (tr).dataset.key)
        .filter((name) => names.has(name));
}

/**
 * Marks a grid's rows again, once it is drawn again, and whether the grid has the keys.
 * @param {HTMLElement} grid
 * @returns {void}
 */
function markRow(grid) {
    const one = marked[grid.id];
    for (const row of grid.querySelectorAll("tbody tr.selected")) {
        row.classList.remove("selected");
    }
    if (one && one.context === gridContext(grid.id)) {
        for (const key of one.keys || [ one.key ]) {
            grid.querySelector(`tbody tr[data-key="${CSS.escape(key)}"]`)
                ?.classList.add("selected");
        }
    }
    grid.classList.toggle("focused", keysTo === grid.id && document.hasFocus());
}

/**
 * ↑ and ↓ in a grid: the row above or below is marked, and scrolled to.
 * With ⇧, in the rows grid, the rows marked reach to it.
 * @param {HTMLElement} grid
 * @param {number} by
 * @param {boolean=} extend
 * @returns {void}
 */
function stepRow(grid, by, extend = false) {
    const rows = /** @type {HTMLElement[]} */ ([ ...grid.querySelectorAll("tbody tr[data-key]") ]);
    if (!rows.length) {
        return;
    }
    // From the row marked last, of the ones marked.
    const lead = marked[grid.id]?.key;
    const at   = rows.findIndex((one) => one.classList.contains("selected")
        && one.dataset.key === lead) >= 0
        ? rows.findIndex((one) => one.dataset.key === lead)
        : rows.findIndex((one) => one.classList.contains("selected"));
    const next = rows[at < 0 ? (by > 0 ? 0 : rows.length - 1)
        : Math.min(rows.length - 1, Math.max(0, at + by))];
    pickRow(next, extend ? "range" : "");
    revealRow(grid, next);
}

/**
 * Scrolls a grid's row clear of the header, the totals and the fades.
 * @param {HTMLElement & { tHead?: HTMLElement, tFoot?: HTMLElement }} grid
 * @param {HTMLElement} tr
 * @returns {void}
 */
function revealRow(grid, tr) {
    const box   = /** @type {HTMLElement} */ (grid.closest(".grid-scroll"));
    const row   = tr.getBoundingClientRect();
    const edges = box.getBoundingClientRect();
    const top   = edges.top + (grid.tHead?.offsetHeight || 0);
    const floor = edges.bottom - (grid.tFoot?.offsetHeight || 0) - 28;
    if (row.top < top) {
        box.scrollTop -= top - row.top;
    } else if (row.bottom > floor) {
        box.scrollTop += row.bottom - floor;
    }
}

/**
 * Enter on a grid's row opens it: a table's rows, or a row to change.
 * @param {HTMLElement} grid
 * @returns {void}
 */
function openRow(grid) {
    const row = /** @type {HTMLElement} */ (grid.querySelector("tbody tr.selected"));
    if (!row) {
        return;
    }
    if (grid.id === "overview-grid") {
        navigate(browsePath("rows", row.dataset.key));
    } else if (grid.id === "rows-grid" && rowsKeyed()) {
        openRowDialog(Number(row.dataset.key));
    } else if (grid.id === "structure-grid" && !structureIsView()) {
        openColumnDialog(row.dataset.key);
    }
}

/**
 * The keys of the database page: ↑ and ↓ through the tables or a grid's rows, and Enter to
 * open the row marked.
 * @param {KeyboardEvent} event
 * @returns {void}
 */
function tableKeys(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const typing = target.matches("input, textarea, select, [contenteditable]")
        && target.id !== "table-filter";
    const step   = event.key === "ArrowUp" || event.key === "ArrowDown";
    const extend = event.shiftKey && step && keysTo === "rows-grid";
    if (!step && event.key !== "Enter"
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || event.shiftKey && !extend
        || typing) {
        return;
    }
    if (currentView() !== "database" || document.querySelector("dialog[open]")) {
        return;
    }
    const by = event.key === "ArrowDown" ? 1 : -1;
    if (step
        && (keysTo === "list" || target.id === "table-filter")
        && browse.tab !== "tables"
        && browse.tab !== "sql") {
        event.preventDefault();
        stepTable(by);
        return;
    }
    const grid = keysTo && keysTo !== "list" ? document.getElementById(keysTo) : null;
    // A grid on a tab gone from keeps its mark, but not the keys.
    if (grid && grid.offsetParent && target.id !== "table-filter") {
        event.preventDefault();
        if (step) {
            stepRow(grid, by, extend);
        } else {
            openRow(grid);
        }
    }
}

/**
 * Every table with what it holds, as phpMyAdmin starts: rows, engine,
 * collation, the data's and indexes' sizes, the space it could give back
 * and its comment, with the totals under them. A header sorts by it; a
 * name opens its rows.
 */
let overviewSort = { key : "name", dir : 1 };
/**
 * Draws the Tables tab: the tables filtered as typed, in the order picked, with their totals.
 * @returns {void}
 */
function renderOverview() {
    const search = /** @type {HTMLInputElement} */ (
        document.getElementById("overview-filter")
    ).value.trim().toLowerCase();
    const shown  = browse.tables
        .filter((one) => one.name.toLowerCase().includes(search)
            || one.comment.toLowerCase().includes(search))
        .sort((a, b) => {
            const [ x, y ] = [ a[overviewSort.key], b[overviewSort.key] ];
            return (typeof x === "number" ? x - y : String(x).localeCompare(String(y)))
                * overviewSort.dir;
        });
    const sum    = (key) => shown.reduce((total, one) => total + (one.view ? 0 : one[key]), 0);
    const head   = [
        [ "name", "Table" ],
        [ "rows", "Rows" ],
        [ "data", "Data" ],
        [ "index", "Indexes" ],
        [ "size", "Total" ],
        [ "free", "Overhead" ],
        [ "engine", "Engine" ],
        [ "collation", "Collation" ],
        [ "comment", "Comment" ],
    ];
    const right  = [ "rows", "data", "index", "size", "free" ];
    document.getElementById("overview-count").textContent = browse.tables.length
        ? String(browse.tables.length)
        : "";
    document.getElementById("overview-grid").innerHTML = `
        <thead><tr>${head.map(([ key, label ]) => `
            <th><button class="sort ${right.includes(key) ? "right" : ""} ${overviewSort.key === key
                ? "active"
                : ""}"
                data-overview-sort="${key}">${label}${overviewSort.key === key
                ? `<span class="sort-dir">${overviewSort.dir > 0 ? "↑" : "↓"}</span>`
                : ""}</button></th>
        `).join("")}</tr></thead>
        <tbody>
            ${shown.map((one) => `
                <tr data-key="${esc(one.name)}">
                    <td><a class="grid-link"
                        href="${esc(browsePath("rows", one.name))}">${esc(one.name)}</a>${one.view
                        ? ` <span class="tag">view</span>`
                        : ""}</td>
                    <td class="num">${one.view ? "" : rowsCell(one)}</td>
                    <td class="num">${one.view ? "" : bytes(one.data)}</td>
                    <td class="num">${one.view ? "" : bytes(one.index)}</td>
                    <td class="num">${one.view ? "" : bytes(one.size)}</td>
                    <td class="num">${one.free ? bytes(one.free) : ""}</td>
                    <td>${esc(one.engine)}</td>
                    <td>${esc(one.collation)}</td>
                    <td class="comment" title="${esc(one.comment)}">${esc(one.comment)}</td>
                </tr>
            `).join("") || `<tr><td class="empty" colspan="9">${browse.tables.length
                ? "No table matches."
                : "No tables yet. Make one with SQL, or import a dump."}</td></tr>`}
        </tbody>
        ${shown.length > 1 ? `<tfoot><tr>
            <td>${countOf(shown.length, "table")}</td>
            <td class="num">${shown.every((one) => one.view || one.exact)
                ? ""
                : "~"}${sum("rows").toLocaleString()}</td>
            <td class="num">${bytes(sum("data"))}</td>
            <td class="num">${bytes(sum("index"))}</td>
            <td class="num">${bytes(sum("size"))}</td>
            <td class="num">${sum("free") ? bytes(sum("free")) : ""}</td>
            <td></td><td></td><td></td>
        </tr></tfoot>` : ""}
    `;
    markRow(document.getElementById("overview-grid"));
    watchFades(/** @type {HTMLElement} */ (document.getElementById("overview-grid").parentElement));
}

/**
 * Sorts the tables by a column, the other way when it already is; sizes start with the largest.
 * @param {string} key
 * @returns {void}
 */
function sortOverview(key) {

    overviewSort = overviewSort.key === key
        ? { key, dir : -overviewSort.dir }
        : { key, dir : [ "name", "engine", "collation", "comment" ].includes(key) ? 1 : -1 };
    renderOverview();
}
