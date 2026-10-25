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
 * @type {{ db : string, tables : any[], table : string, tab : string, page : number, sort : string, dir : string, rows : any, total : any,
 *          filters : any[], draft : any[], match : string, widths : Record<string, any>, dates : Record<string, string[]>, structure : any,
 *          results : any[], sql : Record<string, string> }}
 */
let browse = { db : "", tables : [], table : "", tab : "tables", page : 1, sort : "", dir : "asc", rows : null, total : undefined,
    filters : [], draft : [], match : "all", widths : {}, dates : {}, structure : null, results : [], sql : {} };

function browsePath(tab, table = browse.table) {
    if (tab === "tables") {
        return `/database/${encodeURIComponent(browse.db)}`;
    }
    const parts = [ "database", browse.db, tab, ...(tab === "sql" || !table ? [] : [ table ]) ];
    return `/${parts.map(encodeURIComponent).join("/")}`;
}

/** Shows the page for the path, reading the database's tables when it is another one. */
async function showBrowse() {
    // A table the keys were going to doesn't open over a page gone to since.
    clearTimeout(tableStep);
    focusKeys(keysTo);
    // The database alone lists its tables, as phpMyAdmin starts.
    const [ , , db = "", tab = "tables", table = "" ] = location.pathname.split("/").map(decodeURIComponent);
    const tabName = [ "tables", "structure", "rows", "info", "sql" ].includes(tab) ? tab : "tables";
    if (db !== browse.db) {
        browse = { ...browse, db, tables : [], table : "", rows : null };
        document.getElementById("browse-tables").innerHTML = `<div class="pkg-none">Reading the tables…</div>`;
        await loadTables();
    }
    const picked = table || browse.table || browse.tables.find((one) => !one.view)?.name || browse.tables[0]?.name || "";
    if (picked !== browse.table) {
        browse = { ...browse, table : picked, page : 1, sort : "", dir : "asc", rows : null, filters : [], draft : [], match : "all" };
        /** @type {HTMLInputElement} */ (document.getElementById("column-filter")).value = "";
    }
    // A foreign key followed: its table opens filtered to the row it refers to.
    if (pendingFilters?.table === picked) {
        browse = { ...browse, page : 1, rows : null, filters : pendingFilters.filters, draft : pendingFilters.filters.map((rule) => ({ ...rule })), match : "all" };
    }
    pendingFilters = null;
    browse.tab = tabName;
    for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("#browse-tabs button"))) {
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

async function loadTables() {
    // The counts already exact stay while the list is read again, until counted anew, so the Rows column keeps its width.
    const db    = browse.db;
    const known = new Map(browse.tables.filter((one) => one.exact).map((one) => [ one.name, one.rows ]));
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

/** The rows of the tables again, wherever they show, once counted. */
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

/** phpMyAdmin's page of the database, from the page's state. */
function renderBrowseHead() {
    const db = state?.databases.list.find((one) => one.name === browse.db);
    /** @type {HTMLAnchorElement} */ (document.getElementById("browse-pma")).href = db?.url || state?.phpmyadmin.url || "#";
}

/** The tables by name, filtered as typed, to go to; what each holds is in the Tables tab. */
function renderTableList() {
    const search = /** @type {HTMLInputElement} */ (document.getElementById("table-filter")).value.trim().toLowerCase();
    const shown  = browse.tables.filter((one) => one.name.toLowerCase().includes(search));
    const tab    = browse.tab === "structure" || browse.tab === "info" ? browse.tab : "rows";
    const marked = [ "structure", "rows", "info" ].includes(browse.tab);
    document.getElementById("browse-tables").innerHTML = shown.map((one) => `
        <a href="${esc(browsePath(tab, one.name))}" data-table="${esc(one.name)}" class="table-link ${one.name === browse.table && marked ? "active" : ""}">
            <span class="table-name">${esc(one.name)}</span>${one.view ? `<span class="tag">view</span>` : ""}
        </a>
    `).join("") || `<div class="pkg-none">${browse.tables.length ? "No table matches." : "No tables yet."}</div>`;
    watchFades(document.getElementById("browse-tables"));
    renderTableInfo(marked ? browse.table : "");
}

/**
 * The marked table's engine, encoding, rows, sizes, next id and dates,
 * under the list, as Sequel Ace's Table Information shows them. It
 * follows the mark as the keys move it, before the table opens.
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
            ? date.toLocaleString([], { month : "short", day : "numeric", hour : "2-digit", minute : "2-digit" })
            : date.toLocaleDateString([], { dateStyle : "medium" });
    };
    // The same lines for every table, empty ones as a dash, so the panel never changes height.
    const charset = table.collation.split("_")[0];
    const lines   = [
        [ "Type", table.view ? "View" : table.engine + (table.format ? ` · ${table.format}` : "") ],
        [ "Encoding", table.collation ? `${charset} · ${table.collation.slice(charset.length + 1)}` : "" ],
        [ "Rows", table.view ? "" : rowsCell(table) ],
        [ "Data · Indexes", table.view ? "" : `${bytes(table.data)} · ${bytes(table.index)}` ],
        [ "Next id", table.next === null ? "" : table.next.toLocaleString() ],
        [ "Created", when(table.created) ],
        [ "Updated", when(table.updated) ],
    ];
    box.innerHTML = `
        <dl>${lines.map(([ label, value ]) => `<div><dt>${label}</dt>${!value ? `<dd class="none">—</dd>` : value.startsWith("<") ? `<dd>${value}</dd>` : `<dd title="${esc(value)}">${esc(value)}</dd>`}</div>`).join("")}</dl>
    `;
}

/**
 * A table's rows: the count when it is exact, or the estimate as a button
 * that counts them, as phpMyAdmin does for a large InnoDB table.
 */
function rowsCell(table) {
    if (table.exact) {
        return table.rows.toLocaleString();
    }
    // A table being counted says so through any redraw, until its count comes.
    return counting.has(`${browse.db}.${table.name}`) ? `<button class="estimate" disabled>Counting…</button>`
        : `<button class="estimate" data-count-table="${esc(table.name)}" title="An estimate: click to count them">~${table.rows.toLocaleString()}</button>`;
}

/** The tables being counted, by database and name. */
const counting = new Set();

/** Counts a table's rows when only their estimate was known, and shows the count everywhere. */
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
function stepTable(by) {
    const links = /** @type {HTMLAnchorElement[]} */ ([ ...document.querySelectorAll("#browse-tables .table-link") ]);
    if (!links.length) {
        return;
    }
    const at   = links.findIndex((one) => one.classList.contains("active"));
    const next = links[at < 0 ? (by > 0 ? 0 : links.length - 1) : Math.min(links.length - 1, Math.max(0, at + by))];
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
function focusKeys(to) {
    keysTo = to;
    const front = document.hasFocus();
    document.querySelector(".browse-aside").classList.toggle("focused", to === "list" && front);
    for (const grid of document.querySelectorAll(".browse-main .data-grid[id]")) {
        grid.classList.toggle("focused", grid.id === to && front);
    }
}

/** The row marked in each grid, by its key, and what it was a row of, so another table's or page's isn't. */
const marked = {};
function gridContext(id) {
    return id === "rows-grid" ? JSON.stringify(rowsQuestion()) : id === "structure-grid" ? tableKey() : browse.db;
}

/**
 * Marks a row: it alone, or, in the rows grid, as Sequel Ace's, added or
 * taken out with ⌘, or all from the one marked first to it with ⇧.
 * @param {HTMLElement} tr @param {"" | "toggle" | "range"} how
 */
function pickRow(tr, how = "") {
    const grid = tr.closest("table");
    const old  = marked[grid.id];
    const key  = tr.dataset.key;
    const more = (grid.id === "rows-grid" || grid.id === "overview-grid") && how && old && old.context === gridContext(grid.id);
    let keys   = [ key ];
    let anchor = key;
    if (more && how === "toggle") {
        keys = old.keys.includes(key) ? old.keys.filter((one) => one !== key) : [ ...old.keys, key ];
    } else if (more) {
        const all   = [ ...grid.querySelectorAll("tbody tr[data-key]") ].map((one) => /** @type {HTMLElement} */ (one).dataset.key);
        const [ from, to ] = [ all.indexOf(old.anchor), all.indexOf(key) ].sort((a, b) => a - b);
        anchor = old.anchor;
        keys   = from < 0 ? [ key ] : all.slice(from, to + 1);
    }
    marked[grid.id] = { key, anchor, keys, context : gridContext(grid.id) };
    markRow(grid);
}

/** Every row of the rows grid on the page marked. */
function pickAllRows() {
    const grid = document.getElementById("rows-grid");
    const keys = [ ...grid.querySelectorAll("tbody tr[data-key]") ].map((one) => /** @type {HTMLElement} */ (one).dataset.key);
    if (keys.length) {
        marked["rows-grid"] = { key : keys[0], anchor : keys[0], keys, context : gridContext("rows-grid") };
        markRow(grid);
    }
}

/** The rows marked in the rows grid, by their place on the page, in order. */
function pickedRows() {
    const one = marked["rows-grid"];
    if (!one || one.context !== gridContext("rows-grid") || !browse.rows) {
        return [];
    }
    return one.keys.map(Number).filter((index) => index < browse.rows.rows.length).sort((a, b) => a - b);
}

/** The tables marked in the Tables tab, by name, in the order they show. */
function pickedTables() {
    const one = marked["overview-grid"];
    if (!one || one.context !== gridContext("overview-grid")) {
        return [];
    }
    const names = new Set(one.keys || [ one.key ]);
    return [ ...document.querySelectorAll("#overview-grid tbody tr[data-key]") ].map((tr) => /** @type {HTMLElement} */ (tr).dataset.key).filter((name) => names.has(name));
}

/** Marks a grid's rows again, once it is drawn again, and whether the grid has the keys. */
function markRow(grid) {
    const one = marked[grid.id];
    for (const row of grid.querySelectorAll("tbody tr.selected")) {
        row.classList.remove("selected");
    }
    if (one && one.context === gridContext(grid.id)) {
        for (const key of one.keys || [ one.key ]) {
            grid.querySelector(`tbody tr[data-key="${CSS.escape(key)}"]`)?.classList.add("selected");
        }
    }
    grid.classList.toggle("focused", keysTo === grid.id && document.hasFocus());
}

/** ↑ and ↓ in a grid: the row above or below is marked, and scrolled to. */
/** With ⇧, in the rows grid, the rows marked reach to it. */
function stepRow(grid, by, extend = false) {
    const rows = /** @type {HTMLElement[]} */ ([ ...grid.querySelectorAll("tbody tr[data-key]") ]);
    if (!rows.length) {
        return;
    }
    // From the row marked last, of the ones marked.
    const lead = marked[grid.id]?.key;
    const at   = rows.findIndex((one) => one.classList.contains("selected") && one.dataset.key === lead) >= 0
        ? rows.findIndex((one) => one.dataset.key === lead)
        : rows.findIndex((one) => one.classList.contains("selected"));
    const next = rows[at < 0 ? (by > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + by))];
    pickRow(next, extend ? "range" : "");
    revealRow(grid, next);
}

/** Scrolls a grid's row clear of the header, the totals and the fades. */
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

/** Enter on a grid's row opens it: a table's rows, or a row to change. */
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

function tableKeys(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const typing = target.matches("input, textarea, select, [contenteditable]") && target.id !== "table-filter";
    const step   = event.key === "ArrowUp" || event.key === "ArrowDown";
    const extend = event.shiftKey && step && keysTo === "rows-grid";
    if (!step && event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey && !extend || typing) {
        return;
    }
    if (currentView() !== "database" || document.querySelector("dialog[open]")) {
        return;
    }
    const by = event.key === "ArrowDown" ? 1 : -1;
    if (step && (keysTo === "list" || target.id === "table-filter") && browse.tab !== "tables" && browse.tab !== "sql") {
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
function renderOverview() {
    const search = /** @type {HTMLInputElement} */ (document.getElementById("overview-filter")).value.trim().toLowerCase();
    const shown  = browse.tables.filter((one) => one.name.toLowerCase().includes(search) || one.comment.toLowerCase().includes(search))
        .sort((a, b) => {
            const [ x, y ] = [ a[overviewSort.key], b[overviewSort.key] ];
            return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * overviewSort.dir;
        });
    const sum    = (key) => shown.reduce((total, one) => total + (one.view ? 0 : one[key]), 0);
    const head   = [ [ "name", "Table" ], [ "rows", "Rows" ], [ "data", "Data" ], [ "index", "Indexes" ], [ "size", "Total" ], [ "free", "Overhead" ], [ "engine", "Engine" ], [ "collation", "Collation" ], [ "comment", "Comment" ] ];
    const right  = [ "rows", "data", "index", "size", "free" ];
    document.getElementById("overview-count").textContent = browse.tables.length ? String(browse.tables.length) : "";
    document.getElementById("overview-grid").innerHTML = `
        <thead><tr>${head.map(([ key, label ]) => `
            <th><button class="sort ${right.includes(key) ? "right" : ""} ${overviewSort.key === key ? "active" : ""}" data-overview-sort="${key}">${label}${overviewSort.key === key ? `<span class="sort-dir">${overviewSort.dir > 0 ? "↑" : "↓"}</span>` : ""}</button></th>
        `).join("")}</tr></thead>
        <tbody>
            ${shown.map((one) => `
                <tr data-key="${esc(one.name)}">
                    <td><a class="grid-link" href="${esc(browsePath("rows", one.name))}">${esc(one.name)}</a>${one.view ? ` <span class="tag">view</span>` : ""}</td>
                    <td class="num">${one.view ? "" : rowsCell(one)}</td>
                    <td class="num">${one.view ? "" : bytes(one.data)}</td>
                    <td class="num">${one.view ? "" : bytes(one.index)}</td>
                    <td class="num">${one.view ? "" : bytes(one.size)}</td>
                    <td class="num">${one.free ? bytes(one.free) : ""}</td>
                    <td>${esc(one.engine)}</td>
                    <td>${esc(one.collation)}</td>
                    <td class="comment" title="${esc(one.comment)}">${esc(one.comment)}</td>
                </tr>
            `).join("") || `<tr><td class="empty" colspan="9">${browse.tables.length ? "No table matches." : "No tables yet. Make one with SQL, or import a dump."}</td></tr>`}
        </tbody>
        ${shown.length > 1 ? `<tfoot><tr>
            <td>${countOf(shown.length, "table")}</td>
            <td class="num">${shown.every((one) => one.view || one.exact) ? "" : "~"}${sum("rows").toLocaleString()}</td>
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

/** Sorts the tables by a column, the other way when it already is; sizes start with the largest. */
function sortOverview(key) {
    overviewSort = overviewSort.key === key
        ? { key, dir : -overviewSort.dir }
        : { key, dir : [ "name", "engine", "collation", "comment" ].includes(key) ? 1 : -1 };
    renderOverview();
}

// ---------------------------------------------------------------- table menu ---

/**
 * A table's menu, on a right click in the Tables tab or the side's list,
 * as Sequel Ace's: to open it, add a table, rename or duplicate this one,
 * copy its name or CREATE, and empty or drop it.
 */
let tableMenu = "";
let tableMenuNames = [];
/** @param {string[]} [names] The tables marked with it, for what is done to several. */
function openTableMenu(name, x, y, names = [ name ]) {
    const table = browse.tables.find((one) => one.name === name);
    const here  = name === browse.table ? browse.tab : "";
    tableMenu      = name;
    tableMenuNames = names.length ? names : [ name ];
    const menu  = document.getElementById("row-menu");
    const views = tableMenuNames.every((one) => browse.tables.find((item) => item.name === one)?.view);
    const upkeep = `
        <hr>
        <button role="menuitem" data-table-act="optimize" ${views ? "disabled" : ""}>Optimize</button>
        <button role="menuitem" data-table-act="analyze" ${views ? "disabled" : ""}>Analyze</button>
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
        ${here === "structure" ? "" : `<button role="menuitem" data-table-act="structure">Open Structure</button>`}
        <hr>
        <button role="menuitem" data-table-act="add">Add Table…</button>
        <button role="menuitem" data-table-act="rename">Rename…</button>
        <button role="menuitem" data-table-act="duplicate">Duplicate…</button>
        <hr>
        <button role="menuitem" data-table-act="export">Export…</button>
        <button role="menuitem" data-table-act="import" ${table?.view ? "disabled" : ""}>Import CSV…</button>
        <hr>
        <button role="menuitem" data-table-act="copy">Copy Name</button>
        <button role="menuitem" data-table-act="create">Copy Create Syntax</button>
        ${upkeep}
        <hr>
        <button role="menuitem" data-table-act="empty" class="danger-item" ${table?.view ? "disabled" : ""}>Empty…</button>
        <button role="menuitem" data-table-act="drop" class="danger-item">Drop…</button>
    `;
    showMenuAt(menu, x, y);
}

/** The button in a table's tabs that opens its menu, under it. */
function tableMenuButton() {
    return `<button class="ghost" data-table-menu aria-haspopup="menu">Table<svg class="chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>`;
}

function toggleTableMenu(button) {
    const menu = document.getElementById("row-menu");
    if (!menu.hidden && menu.dataset.from === "button") {
        closeMenus();
        return;
    }
    const box = button.getBoundingClientRect();
    openTableMenu(browse.table, box.left, box.bottom + 6);
    // Kept inside the window: under the button, to its right edge when it would run out.
    menu.style.left = `${Math.max(8, Math.min(box.left, box.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.dataset.from = "button";
}

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
        return name === browse.table && browse.tab === "rows" && names.length === 1 ? openExportDialog({ rows : browse.filters.length ? "filtered" : "all" }) : openExportDialog({ tables : names });
    }
    if (act === "drop") {
        return dropTable(name);
    }
    let text = names.join("\n");
    if (act === "create") {
        try {
            text = (await api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${encodeURIComponent(name)}`)).create;
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
 * @param {"optimize" | "analyze" | "check" | "repair"} op @param {string[]} names
 */
async function maintainTables(op, names) {
    const doing = { optimize : "Optimizing", analyze : "Analyzing", check : "Checking", repair : "Repairing" }[op];
    const what  = names.length === 1 ? names[0] : `${names.length} tables`;
    const shown = ask({ title : `${doing} ${what}…`, body : `<p class="muted">MariaDB is working on it. A large table takes a while.</p>`, ok : "Done", closeX : true });
    const okBtn = /** @type {HTMLButtonElement} */ (document.getElementById("ask-ok"));
    okBtn.disabled = true;
    let answer;
    try {
        answer = await api("/api/action", { action : "db-table-upkeep", db : browse.db, op, tables : names });
    } catch (error) {
        document.getElementById("ask-title").textContent = `${doing} ${what} failed`;
        document.getElementById("ask-body").innerHTML    = `<p class="editor-status bad">${esc(error.message)}</p>`;
        okBtn.disabled = false;
        return;
    }
    const time  = answer.time < 1000 ? `${answer.time} ms` : `${(answer.time / 1000).toFixed(1)} s`;
    const worst = (said) => (said.some((one) => one.type === "error") ? "bad" : said.some((one) => one.type === "warning") ? "warn" : "ok");
    const fine  = answer.results.filter((one) => worst(one.said) === "ok").length;
    document.getElementById("ask-title").textContent = `${doing.replace(/ing$/, "ed")} ${what}`;
    document.getElementById("ask-text").textContent  = `${fine} of ${countOf(answer.results.length, "table")} OK · ${time}`;
    document.getElementById("ask-body").innerHTML    = `
        <div class="upkeep-list">${answer.results.map((one) => `
            <div class="upkeep-row ${worst(one.said)}">
                <span class="upkeep-table">${esc(one.table)}</span>
                <span class="upkeep-said">${one.said.map((line) => `<span class="${line.type}">${esc(line.type === "status" ? line.text : `${line.type}: ${line.text}`)}</span>`).join("")}</span>
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
            <label class="form-row"><span>Name</span><input name="name" maxlength="64" placeholder="orders" spellcheck="false" required></label>
            <div class="column-type">
                <label class="form-row"><span>First column</span><input name="column" value="id" maxlength="64" spellcheck="false" required></label>
                <label class="form-row"><span>Type</span><span class="field select"><select name="type">${typeOptions("int")}</select></span></label>
                <label class="form-row"><span>Length / values</span><input name="length" spellcheck="false"></label>
            </div>
            <div class="column-checks">
                <label class="check"><input type="checkbox" class="box" name="primary" checked><span>Primary key</span></label>
                <label class="check" data-table-number><input type="checkbox" class="box" name="unsigned" checked><span>Unsigned</span></label>
                <label class="check" data-table-number><input type="checkbox" class="box" name="increment" checked><span>Auto increment</span></label>
            </div>
            <div class="form-pair">
                <label class="form-row"><span>Engine</span><span class="field select"><select name="engine">
                    ${engines.map((one) => `<option value="${esc(one.name)}" title="${esc(one.comment)}" ${one.preset ? "selected" : ""}>${esc(one.name)}</option>`).join("")}
                </select></span></label>
                <label class="form-row"><span>Collation</span><span class="field select"><select name="collation">
                    <option value="">The database's${collation ? `, ${esc(collation)}` : ""}</option>
                    ${charsets.map((set) => `<optgroup label="${esc(set.description)} (${esc(set.name)})">${set.collations.map((one) => `<option>${esc(one)}</option>`).join("")}</optgroup>`).join("")}
                </select></span></label>
            </div>
            <label class="form-row"><span>Comment</span><input name="comment" maxlength="2048" placeholder="What the table holds" spellcheck="false"></label>
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
                for (const box of /** @type {NodeListOf<HTMLElement>} */ (fields.querySelectorAll("[data-table-number]"))) {
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
                    type      : `${type}${sized && TYPE_LENGTHS[type] ? `(${sized})` : ""}${number && data.get("unsigned") === "on" ? " unsigned" : ""}`,
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

/** A table's new name, or its copy's, with its rows or not; a view copies as its query. */
function openTableNameDialog(name, copy) {
    const view = browse.tables.find((one) => one.name === name)?.view;
    formDialog({
        title  : copy ? `Duplicate ${name}` : `Rename ${name}`,
        text   : copy && !view ? "Its columns, indexes and options are copied; its foreign keys and triggers are not." : "",
        body   : `
            <label class="form-row"><span>${copy ? "Name of the copy" : "New name"}</span><input name="name" value="${esc(copy ? `${name}_copy` : name)}" maxlength="64" spellcheck="false" required></label>
            ${copy && !view ? `<label class="check"><input type="checkbox" class="box" name="data" checked><span>With its rows</span></label>` : ""}
        `,
        ok     : copy ? "Duplicate" : "Rename",
        ready  : (fields) => /** @type {HTMLInputElement} */ (fields.querySelector("input[name=name]")).select(),
        submit : async (form) => {
            const data   = new FormData(form);
            const result = await api("/api/action", {
                action : copy ? "db-table-copy" : "db-table-rename",
                db     : browse.db,
                table  : name,
                name   : String(data.get("name")),
                data   : data.get("data") === "on",
            });
            marked["overview-grid"] = { key : result.table, context : gridContext("overview-grid") };
            await tableGone(copy ? null : name, result.table);
            return result;
        },
    });
}

async function emptyTable(name) {
    const table = browse.tables.find((one) => one.name === name);
    const sure  = await ask({
        title  : `Empty ${name}?`,
        text   : `Its ${table?.exact ? "" : "~"}${(table?.rows || 0).toLocaleString()} rows are gone for good, and its auto_increment starts again at 1.`,
        ok     : "Empty",
        danger : true,
    });
    if (!sure) {
        return;
    }
    try {
        toast((await api("/api/action", { action : "db-table-empty", db : browse.db, table : name })).message);
    } catch (error) {
        toast(error.message, true);
        return;
    }
    await loadTables();
    if (browse.table === name && browse.tab === "rows") {
        loadRows();
    }
}

async function dropTable(name) {
    const view = browse.tables.find((one) => one.name === name)?.view;
    const sure = await ask({
        title  : `Drop the ${view ? "view" : "table"} ${name}?`,
        text   : view ? "Only the view goes: the tables it reads keep their rows." : "The table and all its rows are gone for good.",
        ok     : "Drop",
        danger : true,
    });
    if (!sure) {
        return;
    }
    try {
        toast((await api("/api/action", { action : "db-table-drop", db : browse.db, table : name })).message);
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

function switchList() {
    const search = /** @type {HTMLInputElement} */ (document.getElementById("db-switch-filter")).value.trim().toLowerCase();
    return (state?.databases.list || []).filter((one) => one.name.toLowerCase().includes(search));
}

/** @param {number | null} [at] The one marked, by its place, or the database open. */
function renderDbSwitch(at = null) {
    const list = switchList();
    switchAt   = at ?? Math.max(0, list.findIndex((one) => one.name === browse.db));
    switchAt   = Math.min(switchAt, list.length - 1);
    const box  = document.getElementById("db-switch-list");
    box.innerHTML = list.map((one, place) => `
        <button type="button" role="option" data-db-go="${esc(one.name)}" class="${place === switchAt ? "active" : ""} ${one.name === browse.db ? "current" : ""}">
            <span class="db-switch-name">${esc(one.name)}</span>
            <small>${countOf(one.tables, "table")} · ${bytes(one.size)}</small>
        </button>
    `).join("") || `<div class="menu-none">No database matches.</div>`;
    box.querySelector(".active")?.scrollIntoView({ block : "nearest" });
}

/** Opens another database: in the SQL tab when there, else its tables, as the table open is this one's. */
function switchDatabase(name) {
    closeMenus();
    if (name && name !== browse.db) {
        navigate(browse.tab === "sql" ? `/${[ "database", name, "sql" ].map(encodeURIComponent).join("/")}` : `/database/${encodeURIComponent(name)}`);
    }
}

function dbSwitchKeys(event) {
    const list = switchList();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        renderDbSwitch(Math.max(0, Math.min(list.length - 1, switchAt + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter") {
        event.preventDefault();
        switchDatabase(list[switchAt]?.name);
    } else if (event.key === "Escape") {
        closeMenus();
    }
}

// -------------------------------------------------------------------- rows ---

/**
 * Reads the page of rows asked for, and replaces the rows in place, with
 * no fade, so nothing blinks. The total comes after: without filters, the estimate MariaDB
 * keeps; with them, counted apart, as that takes as long as filtering.
 */
async function loadRows() {
    if (!browse.table) {
        document.getElementById("rows-title").textContent = "";
        document.getElementById("rows-filters").innerHTML = "";
        document.getElementById("rows-grid").innerHTML    = `<tbody><tr><td class="empty">This database has no tables yet. Make one with SQL, or import a dump.</td></tr></tbody>`;
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
 */
function renderRows() {
    const { structure, rows, cut } = browse.rows;
    const table  = browse.tables.find((one) => one.name === structure.table);
    const keyed  = structure.primary.length > 0 && !table?.view;
    const clock  = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`;
    const arrow  = (name) => (browse.sort === name ? `<span class="sort-dir">${browse.dir === "desc" ? "↓" : "↑"}</span>` : "");
    const dates  = browse.dates[tableKey()] || [];
    // The columns the filter at the bottom leaves, by their place in the row.
    const search = /** @type {HTMLInputElement} */ (document.getElementById("column-filter")).value.trim().toLowerCase();
    const shown  = structure.columns.map((column, at) => at).filter((at) => structure.columns[at].name.toLowerCase().includes(search));
    renderRowsTitle();
    /** @type {HTMLElement} */ (document.querySelector("[data-row-new]")).hidden = !keyed;
    const note = document.getElementById("rows-note");
    note.hidden      = keyed;
    note.textContent = table?.view ? "A view, so its rows are only read here." : "It has no primary key, so its rows are only read here.";

    // The columns that alone are a foreign key, whose values open the row they refer to.
    const linked = new Set(structure.foreign.filter((key) => key.columns.length === 1).map((key) => structure.columns.findIndex((column) => column.name === key.columns[0])));
    const grid = document.getElementById("rows-grid");
    grid.innerHTML = `
        <thead><tr>
            ${shown.map((at) => structure.columns[at]).map((column, place) => [ column, shown[place] ]).map(([ column, at ]) => `
                <th data-col="${esc(column.name)}">
                    <button class="sort ${browse.sort === column.name ? "active" : ""}" data-sort="${esc(column.name)}" title="${esc(column.type)}${column.comment ? ` · ${esc(column.comment)}` : ""}">
                        ${structure.primary.includes(column.name) ? `<span class="key" title="Primary key"><svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg></span>` : ""}${esc(column.name)}${arrow(column.name)}
                    </button>
                    ${isTimestamps(rows, at) ? `<button class="icon-btn as-date ${dates.includes(column.name) ? "on" : ""}" data-as-date="${esc(column.name)}" title="${dates.includes(column.name) ? "Show the numbers" : "Show these timestamps as dates"}" aria-label="Show as dates">${clock}</button>` : ""}
                    <span class="col-resize" data-resize title="Drag to resize, double-click to fit"></span>
                </th>
            `).join("")}
        </tr></thead>
        <tbody>
            ${rows.map((row, index) => `
                <tr data-row="${index}" data-key="${index}">
                    ${shown.map((at) => withLink(cellOf(row[at], structure.columns[at], cut, at, dates.includes(structure.columns[at].name)), linked.has(at) && row[at] !== null, at)).join("")}
                </tr>
            `).join("") || `<tr><td class="empty" colspan="${shown.length}">${browse.filters.length ? "No row matches the filters." : "No rows yet."}</td></tr>`}
        </tbody>
    `;
    applyWidths(grid, browse.widths[tableKey()]);
    markRow(grid);
    renderPager();
    watchFades(/** @type {HTMLElement} */ (grid.parentElement));
}

function tableKey() {
    return `${browse.db}.${browse.table}`;
}

/** The table's name and its rows, exact or estimated, over its rows. */
function renderRowsTitle() {
    const name  = browse.rows.structure.table;
    const table = browse.tables.find((one) => one.name === name);
    document.getElementById("rows-title").innerHTML = `${esc(name)} <span class="muted">${table && !table.view ? `· ${table.exact ? "" : "~"}${countOf(table.rows, "row")}` : ""}</span>`;
}

/** Which rows these are, of how many, and the buttons to the pages either side. */
function renderPager() {
    const { rows, page, size, more } = browse.rows;
    const table = browse.tables.find((one) => one.name === browse.table);
    const first = (page - 1) * size;
    const total = browse.total === undefined ? (table && !table.view ? `${table.exact ? "" : "~"}${table.rows.toLocaleString()}` : "")
        : browse.total === null ? "…" : browse.total.toLocaleString();
    document.getElementById("rows-pager").innerHTML = rows.length || page > 1 ? `
        <span class="muted">Rows ${(first + (rows.length ? 1 : 0)).toLocaleString()}–${(first + rows.length).toLocaleString()}${total ? ` of ${total}` : ""}</span>
        <button class="ghost small" data-page="-1" ${page > 1 ? "" : "disabled"}>Previous</button>
        <button class="ghost small" data-page="1" ${more ? "" : "disabled"}>Next</button>
    ` : browse.filters.length ? `<span class="muted">No rows of ${total || "the table"} match</span>` : "";
}

/**
 * A value in the grid: NULL dimmed, a binary column's size, long text cut
 * with an ellipsis, and a button to see a long or JSON value whole. A
 * timestamp column shown as dates gives each as one, the number on hover.
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
    const open = long ? `<button class="cell-open" data-cell-open="${at}" title="See it whole" aria-label="See it whole"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></button>` : "";
    return `<td data-at="${at}" class="${kind} ${long ? "long" : ""}">${esc(text.replace(/\s+/g, " "))}${open}</td>`;
}

/** A cell with the arrow that follows its foreign key, when it has one and a value. */
function withLink(cell, linked, at) {
    if (!linked) {
        return cell;
    }
    const arrow = `<button class="fk-follow" data-fk-follow="${at}" title="Open the row it refers to" aria-label="Open the row it refers to"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
    return cell.replace(/^<td ([^>]*?)class="([^"]*)"/, "<td $1class=\"$2 linked\"").replace(/^<td (?![^>]*class=)/, "<td class=\"linked\" ").replace(/<\/td>$/, `${arrow}</td>`);
}

/** A value too big for its cell: long, on several lines, or JSON. It shows cut, and changes in a dialog. */
function isBig(value) {
    return value !== null && (value.length > 40 || /\n/.test(value) || /^\s*[[{]/.test(value));
}

/**
 * Whether a column's values on this page look like Unix timestamps: whole
 * numbers of seconds, or milliseconds, from 2001 to 2100.
 */
function isTimestamps(rows, at) {
    const values = rows.map((row) => row[at]).filter((value) => value !== null && value !== "" && value !== "0");
    return values.length > 0 && values.every((value) => /^\d{10}(\d{3})?$/.test(value) && Number(value.slice(0, 10)) > 978307200 && Number(value.slice(0, 10)) < 4102444800);
}

/** A timestamp as a date and time here, with its seconds. */
function dateOf(value) {
    const date = new Date(value.length > 10 ? Number(value) : Number(value) * 1000);
    const pad  = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Shows a timestamp column as dates, or as its numbers again, kept for the table. */
function toggleDates(name) {
    const key   = tableKey();
    const dates = browse.dates[key] || [];
    browse.dates[key] = dates.includes(name) ? dates.filter((one) => one !== name) : [ ...dates, name ];
    renderRows();
}

/** Sorts by a column, the other way when it already is. */
function sortRows(name) {
    browse.dir  = browse.sort === name && browse.dir === "asc" ? "desc" : "asc";
    browse.sort = name;
    browse.page = 1;
    loadRows();
}

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
    [ "contains", "contains" ], [ "not contains", "doesn't contain" ], [ "=", "=" ], [ "!=", "≠" ],
    [ ">", ">" ], [ "<", "<" ], [ ">=", "≥" ], [ "<=", "≤" ], [ "begins", "begins with" ], [ "ends", "ends with" ],
    [ "like", "LIKE" ], [ "not like", "NOT LIKE" ], [ "regexp", "matches regex" ], [ "in", "IN" ], [ "not in", "NOT IN" ],
    [ "between", "BETWEEN" ], [ "null", "IS NULL" ], [ "not null", "IS NOT NULL" ],
];
const NO_VALUE = [ "null", "not null" ];

/**
 * The filter bar, as Sequel Ace's: a rule per line -- a box that turns it
 * on or off, a column or any, an operator and its value, and + and − to
 * add and take away rules -- then the WHERE they make, as typed, with
 * whether all or any must hold, Filter, which Enter does too, and Clear.
 * It is drawn again for another table, and as rules come and go, never as
 * rows load, so typing stays.
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
                    <input type="checkbox" class="box" data-f="on" ${rule.on ? "checked" : ""} title="Use this rule" aria-label="Use this rule">
                    <span class="field select"><select data-f="column" aria-label="Column">
                        <option value="*">Any column</option>
                        ${columns.map((column) => `<option value="${esc(column.name)}" ${rule.column === column.name ? "selected" : ""}>${esc(column.name)}</option>`).join("")}
                    </select></span>
                    <span class="field select op"><select data-f="op" aria-label="Operator">
                        ${FILTER_OPS.map(([ value, label ]) => `<option value="${esc(value)}" ${rule.op === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
                    </select></span>
                    <input data-f="value" value="${esc(rule.value)}" placeholder="${rule.op.includes("in") && !rule.op.includes("contain") ? "a, b, c" : "Value"}" spellcheck="false" ${NO_VALUE.includes(rule.op) ? "hidden" : ""}>
                    <span class="filter-and" ${rule.op === "between" ? "" : "hidden"}>and</span>
                    <input data-f="value2" value="${esc(rule.value2)}" placeholder="Value" spellcheck="false" ${rule.op === "between" ? "" : "hidden"}>
                    <button type="button" class="icon-btn" data-filter-remove="${index}" title="Take this rule away" aria-label="Take this rule away"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>
                    <button type="button" class="icon-btn" data-filter-add title="Add a rule" aria-label="Add a rule"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></button>
                </div>
            `).join("")}
        </div>
        <div class="filter-foot">
            <div class="filter-query"><code id="filter-sql" class="filter-sql"></code></div>
            ${rules.length > 1 ? `<span class="field select"><select data-f="match" aria-label="Match"><option value="all">All rules</option><option value="any" ${browse.match === "any" ? "selected" : ""}>Any rule</option></select></span>` : ""}
            <button class="small">Filter</button>
            <button type="button" class="ghost small" data-filter-clear ${browse.filters.length || rules.some((rule) => rule.value) ? "" : "disabled"}>Clear</button>
        </div>
    `;
    showFilterSql();
}

function blankRule() {
    return { on : true, column : "*", op : "contains", value : "", value2 : "" };
}

/** The rules as the bar holds them now. */
function readFilterBar() {
    const bar = document.getElementById("rows-filters");
    browse.match = /** @type {HTMLSelectElement} */ (bar.querySelector("[data-f=match]"))?.value || "all";
    browse.draft = [ ...bar.querySelectorAll(".filter-rule") ].map((line) => {
        const get = (name) => /** @type {HTMLInputElement} */ (line.querySelector(`[data-f="${name}"]`));
        return { on : get("on").checked, column : get("column").value, op : get("op").value, value : get("value").value, value2 : get("value2").value };
    });
    return browse.draft;
}

/** The rules that filter: turned on, and with a value, or needing none. */
function usedRules(rules) {
    return rules.filter((rule) => rule.on && (NO_VALUE.includes(rule.op) || rule.value.trim() !== ""));
}

/** Filters by the rules in use, from the first page. */
function applyFilters() {
    browse.filters = usedRules(readFilterBar());
    browse.page    = 1;
    loadRows();
}

/**
 * The WHERE the rules make, as the server writes it, shown under them as
 * they are typed. A rule on any column names a few of the columns it
 * tries; the server tries them all.
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
    const list  = (value) => value.split(",").map((one) => one.trim()).filter(Boolean).map(quote).join(", ");
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
        "between"      : (name, value, second) => `${name} BETWEEN ${quote(value)} AND ${quote(second)}`,
        "null"         : (name) => `${name} IS NULL`,
        "not null"     : (name) => `${name} IS NOT NULL`,
    };
    const one = (op, name, value, second) => (ops[op] ? ops[op](name, value, second) : `${name} ${op === "!=" ? "<>" : op} ${quote(value)}`);
    const columns = browse.rows.structure.columns.filter((column) => !column.binary).map((column) => `\`${column.name}\``);
    const parts   = rules.map((rule) => {
        if (rule.column !== "*") {
            return one(rule.op, `\`${rule.column}\``, rule.value, rule.value2);
        }
        const negative = { "not contains" : "contains", "!=" : "=", "not like" : "like", "not in" : "in", "not null" : "null" }[rule.op];
        const each     = columns.slice(0, 2).map((name) => one(negative || rule.op, name, rule.value, rule.value2));
        const rest     = columns.length > 2 ? ` OR … ${columns.length - 2} more` : "";
        return `${negative ? "NOT " : ""}(${each.join(" OR ")}${rest})`;
    });
    const where = `WHERE ${parts.join(browse.match === "any" ? " OR " : " AND ")}`;
    box.innerHTML = paintSql(where);
    box.title     = where;
}

function addFilter() {
    browse.draft = [ ...readFilterBar(), blankRule() ];
    renderFilterBar(true);
    /** @type {HTMLElement} */ ([ ...document.querySelectorAll("#rows-filters [data-f=value]") ].pop())?.focus();
}

/** Takes a rule away; with its last rule gone, the bar has an empty one, and nothing filters. */
function removeFilter(index) {
    const rules = readFilterBar();
    rules.splice(index, 1);
    browse.draft = rules;
    renderFilterBar(true);
    applyFilters();
}

function clearFilters() {
    browse.draft   = [];
    browse.filters = [];
    renderFilterBar(true);
    browse.page = 1;
    loadRows();
}

/** An operator chosen: its value fields show as it needs them, and one that needs none filters at once. */
function changeFilterOp(select) {
    readFilterBar();
    renderFilterBar(true);
    if (NO_VALUE.includes(select.value)) {
        applyFilters();
    } else {
        /** @type {HTMLElement} */ (document.querySelector(`#rows-filters [data-rule="${select.closest("[data-rule]").dataset.rule}"] [data-f=value]`))?.focus();
    }
}

// ---------------------------------------------------- column widths, values ---

/**
 * Gives a grid's columns the widths dragged for its table, kept while Studio
 * is open; without them, each column is as wide as it needs, up to a point.
 */
function applyWidths(grid, widths) {
    grid.classList.remove("fixed");
    grid.style.width = "";
    grid.querySelectorAll("th").forEach((th) => { /** @type {HTMLElement} */ (th).style.width = ""; });
    if (widths) {
        freezeWidths(grid, widths);
    }
}

/** Fixes every column at its width now, or the one given, so one can be dragged without the rest moving. */
function freezeWidths(grid, widths = {}) {
    const heads  = /** @type {HTMLElement[]} */ ([ ...grid.querySelectorAll("thead th") ]);
    const sizes  = heads.map((th) => widths[th.dataset.col] || th.offsetWidth);
    heads.forEach((th, index) => { th.style.width = `${sizes[index]}px`; });
    grid.style.width = `${sizes.reduce((sum, size) => sum + size, 0)}px`;
    grid.classList.add("fixed");
}

/** Drags a column's edge; a double click puts the grid's columns back to the widths they need. */
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
            browse.widths[tableKey()] = Object.fromEntries([ ...grid.querySelectorAll("thead th[data-col]") ].map((one) => [ /** @type {HTMLElement} */ (one).dataset.col, /** @type {HTMLElement} */ (one).offsetWidth ]));
        }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop, { once : true });
}

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
                value = (await api("/api/action", { action : "db-row", db : browse.db, table : browse.table, key : rowKey(Number(tr.dataset.row)) })).row[at];
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

// ------------------------------------------------------------------- fades ---

/**
 * Fades a scrolling box's edges where more of it is hidden: the bottom and
 * the sides, and the top too, unless its header stays there. On the right,
 * the fade comes before a grid's edit buttons, which stay at that edge.
 */
const fadeSizes = new ResizeObserver((entries) => entries.forEach((entry) => fadeEdges(/** @type {HTMLElement} */ (entry.target))));
function watchFades(box) {
    if (!box.dataset.fades) {
        box.dataset.fades = "1";
        box.addEventListener("scroll", () => fadeEdges(box), { passive : true });
        fadeSizes.observe(box);
    }
    fadeEdges(box);
}

function fadeEdges(box) {
    const edge = (more) => (more ? "28px" : "0px");
    const head = box.querySelector("thead");
    box.style.setProperty("--fade-top", edge(!head && box.scrollTop > 1));
    const below = box.scrollTop + box.clientHeight < box.scrollHeight - 1;
    box.style.setProperty("--fade-bottom", edge(below));
    // The bottom fade ends above the totals, which stay whole at that edge.
    box.style.setProperty("--fade-foot", `${below ? box.querySelector("tfoot")?.offsetHeight || 0 : 0}px`);
    box.style.setProperty("--fade-floor", below ? "transparent" : "#000");
    box.style.setProperty("--fade-left", edge(box.scrollLeft > 1));
    const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
    box.style.setProperty("--fade-right", edge(right));
    box.style.setProperty("--fade-edge", right ? "transparent" : "#000");
}

/** A row's primary key, by column, which the server finds it by. */
function rowKey(index) {
    const { structure, rows } = browse.rows;
    return Object.fromEntries(structure.primary.map((name) => [ name, rows[index][structure.columns.findIndex((column) => column.name === name)] ]));
}

/**
 * The dialog that changes a row, read whole first, as the grid cuts long
 * values, or adds one, empty or a copy of another. Each column has a field
 * fitting its type, a NULL box when it takes NULL, and binary columns are
 * kept as they are. A new row's empty fields get their column's default,
 * as an auto_increment id, which a copy leaves empty, as its binary values.
 */
/** @param {number | null} index @param {number | null} copy */
async function openRowDialog(index = null, copy = null) {
    const { structure } = browse.rows;
    const key = index === null ? null : rowKey(index);
    let values;
    try {
        values = key ? (await api("/api/action", { action : "db-row", db : browse.db, table : browse.table, key })).row : structure.columns.map(() => "");
        if (copy !== null) {
            const row = (await api("/api/action", { action : "db-row", db : browse.db, table : browse.table, key : rowKey(copy) })).row;
            values    = structure.columns.map((column, at) => (column.binary || column.extra.includes("auto_increment") ? "" : row[at]));
        }
    } catch (error) {
        toast(error.message, true);
        return;
    }
    const from = copy === null ? "" : Object.entries(rowKey(copy)).map(([ name, value ]) => `${name} ${value}`).join(" · ");
    formDialog({
        title  : key ? `Change the row of ${structure.table}` : copy !== null ? `Duplicate the row of ${structure.table}` : `New row in ${structure.table}`,
        text   : key ? Object.entries(key).map(([ name, value ]) => `${name} ${value}`).join(" · ")
            : copy !== null ? `A copy of ${from}. Empty fields get their column's default${structure.columns.some((column) => column.binary) ? "; binary values aren't copied" : ""}.`
                : "Empty fields get their column's default.",
        body   : structure.columns.map((column, at) => rowField(column, values[at], !key)).join(""),
        ok     : key ? "Save" : "Add",
        remove : key ? { label : "Delete row", run : () => deleteRows([ index ]) } : null,
        ready  : (fields) => fields.addEventListener("change", (event) => {
            const box = /** @type {HTMLInputElement} */ (event.target);
            if (box.dataset.nullFor !== undefined) {
                /** @type {HTMLInputElement} */ (box.closest(".form-row").querySelector("[data-column]")).disabled = box.checked;
            }
        }),
        submit : async (form) => {
            const changed = {};
            structure.columns.forEach((column, at) => {
                const field = /** @type {HTMLInputElement} */ (form.querySelector(`[data-column="${CSS.escape(column.name)}"]`));
                const none  = /** @type {HTMLInputElement} */ (form.querySelector(`[data-null-for="${CSS.escape(column.name)}"]`));
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
            const result = await api("/api/action", { action : "db-row-save", db : browse.db, table : browse.table, key, values : changed });
            loadRows();
            // The table's count, in the title and the list, with the row added.
            if (!key) {
                loadTables();
            }
            return result;
        },
    });
}

/** A column's field: its choices for an enum, a box for long text, a line otherwise. */
function rowField(column, value, adding) {
    const name   = esc(column.name);
    const isNull = value === null;
    const hint   = adding && column.binary ? "left empty: binary values are set with SQL"
        : adding && column.extra.includes("auto_increment") ? "auto"
        : adding && column.default !== null ? `default: ${column.default}` : "";
    const attrs  = `data-column="${name}" ${isNull || column.binary ? "disabled" : ""} spellcheck="false" placeholder="${esc(hint)}"`;
    const text   = value ?? "";
    let   field;
    const choices = column.type.match(/^enum\((.*)\)$/)?.[1].match(/'((?:[^']|'')*)'/g)?.map((one) => one.slice(1, -1).replace(/''/g, "'"));
    if (column.binary) {
        field = `<input ${attrs} value="${esc(value ? `${value}, kept as it is` : "")}">`;
    } else if (choices) {
        field = `<span class="field select"><select ${attrs}>${adding ? `<option value="">${esc(hint || "—")}</option>` : ""}${choices.map((one) => `<option ${one === text ? "selected" : ""}>${esc(one)}</option>`).join("")}</select></span>`;
    } else if (/text|json|blob/.test(column.dataType) || text.length > 60 || text.includes("\n")) {
        field = `<textarea ${attrs} rows="${Math.min(8, Math.max(3, text.split("\n").length))}">${esc(text)}</textarea>`;
    } else {
        field = `<input ${attrs} value="${esc(text)}">`;
    }
    return `
        <div class="form-row row-field">
            <span>${name} <small class="col-type">${esc(column.type)}${column.key === "PRI" ? " · key" : ""}</small></span>
            <div class="row-value">
                ${field}
                ${column.nullable && !column.binary ? `<label class="check"><input type="checkbox" class="box" data-null-for="${name}" ${isNull ? "checked" : ""}><span>NULL</span></label>` : ""}
            </div>
        </div>
    `;
}

/** Deletes a row once it is confirmed, from its dialog; gives whether it did. */
/** Deletes rows, by their place on the page, once asked: one by its key, or how many. */
async function deleteRows(indexes) {
    const keys = indexes.map(rowKey);
    const sure = await ask({
        title  : keys.length === 1 ? `Delete the row of ${browse.table}?` : `Delete ${keys.length} rows of ${browse.table}?`,
        text   : `${keys.length === 1 ? Object.entries(keys[0]).map(([ name, value ]) => `${name} ${value}`).join(" · ") : "They are"}${keys.length === 1 ? ". It is" : ""} gone for good.`,
        ok     : "Delete",
        danger : true,
    });
    if (!sure) {
        return false;
    }
    try {
        const body = keys.length === 1 ? { key : keys[0] } : { keys };
        toast((await api("/api/action", { action : "db-row-delete", db : browse.db, table : browse.table, ...body })).message);
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

/**
 * The rows' menu, on a right click, as Sequel Ace's: the rows marked copied
 * as text, with their column names, or as an INSERT, with or without their
 * auto_increment ids; the values of the column clicked, as they are or as
 * SQL; then to change or duplicate a row, or delete them, when the table
 * has a key.
 */
let rowMenu = { indexes : [ 0 ], at : -1 };
function openRowMenu(indexes, at, x, y) {
    const { structure } = browse.rows;
    const keyed  = rowsKeyed() ? "" : "disabled";
    const one    = indexes.length === 1 ? keyed : "disabled";
    const column = structure.columns[at];
    const many   = indexes.length > 1 ? "s" : "";
    const menu   = document.getElementById("row-menu");
    rowMenu = { indexes, at };
    menu.innerHTML = `
        <button role="menuitem" data-row-act="copy">Copy${many ? ` ${indexes.length} Rows` : ""}</button>
        <button role="menuitem" data-row-act="names">Copy with Column Names</button>
        <button role="menuitem" data-row-act="insert">Copy as SQL INSERT</button>
        ${structure.columns.some((one) => one.extra.includes("auto_increment")) ? `<button role="menuitem" data-row-act="insert-new">Copy as SQL INSERT (no auto_increment)</button>` : ""}
        ${column ? `
            ${column.nullable && rowsKeyed() && !column.binary && ![ "virtual", "stored" ].includes(column.value.kind) ? `<button role="menuitem" data-row-act="null">Set '${esc(column.name)}' to NULL${many ? ` in ${indexes.length} Rows` : ""}</button>` : ""}
            <button role="menuitem" data-row-act="value">Copy '${esc(column.name)}' Value${many}</button>
            <button role="menuitem" data-row-act="value-sql">Copy '${esc(column.name)}' Value${many} as SQL</button>
        ` : ""}
        <button role="menuitem" data-row-act="export">Export${many ? ` ${indexes.length} Rows` : " Row"}…</button>
        <hr>
        <button role="menuitem" data-row-act="edit" ${one}>Edit…</button>
        <button role="menuitem" data-row-act="duplicate" ${one}>Duplicate…</button>
        <button role="menuitem" data-row-act="delete" class="danger-item" ${keyed}>Delete${many ? ` ${indexes.length} Rows` : ""}…</button>
    `;
    showMenuAt(menu, x, y);
}

/** Opens a right click's menu at the pointer, kept inside the window. */
function showMenuAt(menu, x, y) {
    closeMenus(menu);
    menu.dataset.from = "";
    menu.hidden     = false;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top  = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
}

/** Does what was picked in a row's menu. */
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
            toast((await api("/api/action", { action : "db-rows-set", db : browse.db, table : browse.table, keys : indexes.map(rowKey), column : column.name, value : null })).message);
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
            rows = (await api("/api/action", { action : "db-row", db : browse.db, table : browse.table, keys : indexes.map(rowKey), hex : true })).rows;
        } catch (error) {
            toast(error.message, true);
            return;
        }
    }
    const columns = structure.columns.map((column, place) => ({ column, place }));
    const plain   = (column, value) => (value === null ? "NULL" : column.binary && rowsKeyed() ? `0x${value}` : value);
    const sql     = (column, value) => (value === null ? "NULL"
        : column.binary && rowsKeyed() ? (value ? `0x${value}` : "''")
            : /int|decimal|float|double/.test(column.dataType) && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value) ? value
                : `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}'`);
    const ident   = (name) => `\`${name.replace(/`/g, "``")}\``;
    const line    = (row) => columns.map(({ column, place }) => plain(column, row[place])).join("\t");
    // One INSERT for all, a row of values on each line, as Sequel Ace's.
    const insert  = (list) => `INSERT INTO ${ident(structure.table)} (${list.map(({ column }) => ident(column.name)).join(", ")}) VALUES${rows.length > 1 ? "\n\t" : " "}${rows.map((row) => `(${list.map(({ column, place }) => sql(column, row[place])).join(", ")})`).join(",\n\t")};`;
    const text = {
        "copy"       : () => rows.map(line).join("\n"),
        "names"      : () => [ columns.map(({ column }) => column.name).join("\t"), ...rows.map(line) ].join("\n"),
        "insert"     : () => insert(columns),
        "insert-new" : () => insert(columns.filter(({ column }) => !column.extra.includes("auto_increment"))),
        "value"      : () => rows.map((row) => plain(structure.columns[at], row[at])).join("\n"),
        "value-sql"  : () => rows.map((row) => sql(structure.columns[at], row[at])).join(", "),
    }[act]();
    await navigator.clipboard.writeText(text);
    toast(rows.length > 1 ? `Copied ${rows.length} rows` : "Copied");
}

// -------------------------------------------------------- changing in place ---

/** Whether the rows shown can be changed: a table's, with a primary key to find each by. */
function rowsKeyed() {
    const { structure } = browse.rows;
    return structure.primary.length > 0 && !browse.tables.find((one) => one.name === structure.table)?.view;
}

/**
 * A cell changed where it is, as in Sequel Ace, by a double click, in a
 * field as wide as its column: Enter or a click away saves it, Escape
 * leaves it, Tab saves it and goes to the next cell, Shift-Tab to the one
 * before, and ↑ and ↓ to the same column of the row above or below. A big
 * value changes in a dialog instead, and a binary one only in the row's.
 */
let editing = null;
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
        } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            saveCell(edit, () => cellBelow(index, at, event.key === "ArrowUp" ? -1 : 1));
        }
    });
    input.addEventListener("blur", () => saveCell(edit));
}

/** Saves a cell changed in place, if it is, then goes on to the cell asked for, if any. */
/** @param {(() => void) | null} [then] */
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

/** The cell after or before one, as shown, on to the next row or the one before at either end, to change; binary ones are passed. */
function nextCell(index, at, by) {
    const columns = browse.rows.structure.columns;
    const cells   = /** @type {HTMLElement[]} */ ([ ...document.querySelectorAll("#rows-grid tbody td[data-at]") ])
        .filter((td) => !columns[Number(td.dataset.at)].binary || Number(td.dataset.at) === at);
    const here  = cells.findIndex((td) => Number(td.closest("tr").dataset.row) === index && Number(td.dataset.at) === at);
    const next  = cells[here + by];
    if (next) {
        changeAt(next);
    }
}

/** The cell of the same column in the row above or below, to change. */
function cellBelow(index, at, by) {
    const rows = /** @type {HTMLElement[]} */ ([ ...document.querySelectorAll("#rows-grid tbody tr[data-row]") ]);
    const tr   = rows[rows.findIndex((one) => Number(one.dataset.row) === index) + by];
    const td   = /** @type {HTMLElement} */ (tr?.querySelector(`td[data-at="${at}"]`));
    if (td) {
        changeAt(td);
    }
}

/** Marks a cell's row, scrolls to it, and changes the cell. */
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
 */
async function saveValue(index, at, value) {
    const { structure, rows } = browse.rows;
    await api("/api/action", { action : "db-row-save", db : browse.db, table : browse.table, key : rowKey(index), values : { [structure.columns[at].name] : value } });
    rows[index][at] = value;
    const asked = JSON.stringify(rowsQuestion());
    api("/api/action", { action : "db-row", db : browse.db, table : browse.table, key : rowKey(index) }).then(({ row }) => {
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
 */
async function editValue(index, at) {
    const { structure, rows, cut } = browse.rows;
    const column = structure.columns[at];
    let value = rows[index][at];
    if (value !== null && value.length > cut) {
        try {
            value = (await api("/api/action", { action : "db-row", db : browse.db, table : browse.table, key : rowKey(index) })).row[at];
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
    formDialog({
        title  : column.name,
        text   : `${column.type}${json ? " · JSON" : ""} · ${countOf((value ?? "").length, "character")}`,
        body   : `
            <div class="editor-body value-code">
                <pre class="editor-lines" aria-hidden="true"></pre>
                <div class="editor-code">
                    <pre class="editor-paint" aria-hidden="true"></pre>
                    <textarea name="value" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off">${esc(shown)}</textarea>
                </div>
            </div>
            ${column.nullable ? `<label class="check"><input type="checkbox" class="box" name="null" ${value === null ? "checked" : ""}><span>NULL</span></label>` : ""}
        `,
        ok     : "Save",
        ready  : (fields) => {
            const dialog = fields.closest("dialog");
            dialog.classList.add("wide");
            dialog.addEventListener("close", () => dialog.classList.remove("wide"), { once : true });
            const box = /** @type {HTMLElement} */ (fields.querySelector(".value-code"));
            codeArea(box, json ? paintJson : markup ? paintMarkup : escapeCode, json ? "  " : "    ");
            // ⌘S or ⌘↩ saves, as in the editor.
            box.querySelector("textarea").addEventListener("keydown", (event) => {
                if ((event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "Enter")) {
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
    const area = /** @type {HTMLTextAreaElement} */ (document.querySelector("#form .value-code textarea"));
    area.focus();
    area.setSelectionRange(0, 0);
}

// --------------------------------------------------------------- structure ---

/**
 * The table's columns, filtered as typed, and its indexes, to add and
 * drop, each scrolling its own; its CREATE TABLE is in Information.
 */
async function loadStructure() {
    const box = document.getElementById("browse-structure");
    if (!browse.table) {
        box.innerHTML = `<div class="panel"><div class="pkg-none">This database has no tables yet.</div></div>`;
        return;
    }
    let structure;
    try {
        structure = await api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${encodeURIComponent(browse.table)}`);
    } catch (error) {
        box.innerHTML = `<div class="panel"><div class="pkg-none">${esc(error.message)}</div></div>`;
        return;
    }
    // Only the last table asked for shows, when several were gone through quickly.
    if (structure.table !== browse.table) {
        return;
    }
    // The filter stays as typed when the same table is drawn again, as after a change.
    const typed = browse.structure?.table === structure.table ? /** @type {HTMLInputElement} */ (document.getElementById("structure-filter"))?.value || "" : "";
    browse.structure = structure;
    const view = browse.tables.find((one) => one.name === structure.table)?.view;
    box.innerHTML = `
        <div class="panel structure-columns">
            <div class="panel-head">
                <h2>${esc(structure.table)} <span class="muted">· ${countOf(structure.columns.length, "column")}${size(structure.table)}</span></h2>
                <div class="head-tools">
                    <input id="structure-filter" type="search" placeholder="Filter columns…" spellcheck="false" autocomplete="off">
                    ${view ? "" : `<button class="ghost" data-column-add>Add column</button>`}
                    ${tableMenuButton()}
                </div>
            </div>
            <div class="grid-wrap"><div class="grid-scroll"><table id="structure-grid" class="data-grid structure fill">
                <thead><tr>${[ "Column", "Type", "Null", "Default", "Extra", "Comment" ].map((name) => `<th><span class="th">${name}</span></th>`).join("")}</tr></thead>
                <tbody id="structure-columns"></tbody>
            </table></div></div>
        </div>
        <div class="structure-keys ${structure.foreign.length ? "" : "alone"}">
        <div class="panel structure-indexes">
            <div class="panel-head">
                <h2>Indexes <span class="muted">${structure.indexes.length}</span></h2>
                ${view ? "" : `<div class="head-tools">
                    ${structure.foreign.length || browse.tables.find((one) => one.name === structure.table)?.engine !== "InnoDB" ? "" : `<button class="ghost small" data-fk-add>Add foreign key</button>`}
                    <button class="ghost small" data-index-add>Add index</button>
                </div>`}
            </div>
            <div class="index-list">${structure.indexes.map((index) => `
                <div class="structure-line">
                    <code>${esc(index.name)}</code>
                    <span>${index.columns.map(esc).join(", ")}</span>
                    <span class="tag">${index.name === "PRIMARY" ? "primary" : index.unique ? "unique" : index.type.toLowerCase()}</span>
                    <button class="icon-btn remove" data-index-drop="${esc(index.name)}" title="Drop it" aria-label="Drop the index ${esc(index.name)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
                </div>
            `).join("") || `<div class="pkg-none">No indexes.</div>`}</div>
        </div>
        ${structure.foreign.length ? `<div class="panel structure-indexes">
            <div class="panel-head">
                <h2>Foreign keys <span class="muted">${structure.foreign.length}</span></h2>
                ${view ? "" : `<button class="ghost small" data-fk-add>Add foreign key</button>`}
            </div>
            <div class="index-list">${structure.foreign.map((key) => `
                <div class="structure-line fk-line" data-fk-edit="${esc(key.name)}" title="Click to change it">
                    <div class="fk-text">
                        <span class="fk-map">${key.columns.map(esc).join(", ")} → <a href="${esc(browsePath("structure", key.table))}" class="fk-target">${esc(key.table)}</a>.${key.references.map(esc).join(", ")}</span>
                        <small title="${esc(key.name)} · on delete ${esc(fkRule(key.onDelete))} · on update ${esc(fkRule(key.onUpdate))}">${esc(key.name)} · on delete ${esc(fkRule(key.onDelete))} · on update ${esc(fkRule(key.onUpdate))}</small>
                    </div>
                    <button class="icon-btn remove" data-fk-drop="${esc(key.name)}" title="Drop it" aria-label="Drop the foreign key ${esc(key.name)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
                </div>
            `).join("")}</div>
        </div>` : ""}
        </div>
    `;
    /** @type {HTMLInputElement} */ (document.getElementById("structure-filter")).value = typed;
    document.getElementById("structure-filter").addEventListener("input", renderStructureColumns);
    renderStructureColumns();
    box.querySelectorAll(".grid-scroll, .index-list").forEach((one) => watchFades(/** @type {HTMLElement} */ (one)));
}

/**
 * The dialog that adds an index: its kind, the columns it is on, in the
 * order they are ticked, which is the order that counts for an index, and
 * its name, made from them until it is typed over.
 */
function openIndexDialog() {
    const structure = browse.structure;
    const kinds     = [ [ "index", "Index" ], [ "unique", "Unique" ], [ "fulltext", "Full text" ], ...(structure.primary.length ? [] : [ [ "primary", "Primary key" ] ]) ];
    formDialog({
        title : `New index on ${structure.table}`,
        text  : "MariaDB builds it at once, which takes a while in a large table.",
        body  : `
            <div class="form-row">
                <span>Kind</span>
                <div class="segmented">${kinds.map(([ value, label ], index) => `<button type="button" data-index-kind="${value}" class="${index ? "" : "active"}">${label}</button>`).join("")}</div>
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
            <label class="form-row" data-index-name><span>Name</span><input name="name" maxlength="64" pattern="[\\w$]+" placeholder="Made from the columns" spellcheck="false" data-auto></label>
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
                    /** @type {HTMLElement} */ (one.closest(".check").querySelector(".order")).textContent = at === -1 ? "" : String(at + 1);
                });
                if (name.dataset.auto !== undefined) {
                    name.value = order.join("_").slice(0, 64);
                }
                fields.dataset.order = JSON.stringify(order);
            });
            name.addEventListener("input", () => delete name.dataset.auto);
        },
        submit : async (form) => {
            const kind   = /** @type {HTMLElement} */ (form.querySelector("[data-index-kind].active")).dataset.indexKind;
            const result = await api("/api/action", {
                action  : "db-index-add",
                db      : browse.db,
                table   : browse.table,
                kind,
                name    : /** @type {HTMLInputElement} */ (form.querySelector("[name=name]")).value,
                columns : JSON.parse(/** @type {HTMLElement} */ (form.querySelector("#form-body")).dataset.order || "[]"),
            });
            loadStructure();
            loadTables();
            return result;
        },
    });
}

/** A kind picked; a primary key has no name of its own. */
function pickIndexKind(button) {
    setActive(button);
    /** @type {HTMLElement} */ (button.closest("form").querySelector("[data-index-name]")).hidden = button.dataset.indexKind === "primary";
}

async function dropIndex(name) {
    const sure = await ask({
        title  : name === "PRIMARY" ? `Drop the primary key of ${browse.table}?` : `Drop the index ${name}?`,
        text   : name === "PRIMARY" ? "Its rows can no longer be changed here, as they cannot be told apart." : "Queries that use it get slower. Its data stays.",
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

/** A rule, short, as the list shows it. */
function fkRule(rule) {
    return { "RESTRICT" : "restrict", "NO ACTION" : "no action", "CASCADE" : "cascade", "SET NULL" : "set null" }[rule] || rule.toLowerCase();
}

/**
 * A foreign key added, or one changed: its columns here, each paired with
 * the one it refers to in the table picked -- its primary key at first --
 * what a delete and an update there do here, and its name, made from the
 * table and columns until it is typed over.
 * @param {string | null} name The key to change, or none for a new one.
 */
async function openForeignKeyDialog(name = null) {
    const structure = browse.structure;
    const old       = structure.foreign.find((key) => key.name === name);
    const targets   = browse.tables.filter((one) => !one.view && one.engine === "InnoDB");
    const rules     = [ [ "RESTRICT", "Restrict", "Refused while rows here refer to it" ], [ "CASCADE", "Cascade", "Done to the rows here too" ], [ "SET NULL", "Set NULL", "The column here is cleared" ], [ "NO ACTION", "No action", "As restrict, in MariaDB" ] ];
    const guess     = targets.find((one) => structure.columns.some((column) => column.name === `${one.name.replace(/s$/, "")}_id`)) || targets.find((one) => one.name !== structure.table) || targets[0];
    const start     = old || { columns : [ "" ], table : guess?.name || "", references : [ "" ], onDelete : "RESTRICT", onUpdate : "RESTRICT" };
    const ruleSelect = (field, value) => `<span class="field select"><select name="${field}">${rules.map(([ rule, label, hint ]) => `<option value="${rule}" title="${hint}" ${rule === value ? "selected" : ""}>${label}</option>`).join("")}</select></span>`;
    let refColumns = [];
    const loadRef  = async (table) => {
        try {
            const ref  = await api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${encodeURIComponent(table)}`);
            refColumns = ref.columns.map((column) => ({ name : column.name, type : column.type, primary : ref.primary.includes(column.name) }));
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
        title  : old ? `Change the foreign key ${old.name}` : `New foreign key on ${structure.table}`,
        text   : "Each column here refers to one in the other table, of the same type, which has an index on it.",
        body   : `
            <label class="form-row"><span>Refers to the table</span><span class="field select"><select name="refTable">
                ${targets.map((one) => `<option value="${esc(one.name)}" ${one.name === start.table ? "selected" : ""}>${esc(one.name)}</option>`).join("")}
            </select></span></label>
            <div class="form-row"><span>Columns</span><div class="fk-pairs" data-fk-pairs></div></div>
            <button type="button" class="ghost small fk-more" data-fk-more>Add a column pair</button>
            <div class="form-pair">
                <label class="form-row"><span>On delete there</span>${ruleSelect("onDelete", start.onDelete)}</label>
                <label class="form-row"><span>On update there</span>${ruleSelect("onUpdate", start.onUpdate)}</label>
            </div>
            <label class="form-row"><span>Name</span><input name="name" value="${esc(old?.name || "")}" maxlength="64" pattern="[\\w$]+" placeholder="Made from the table and columns" spellcheck="false" ${old ? "" : "data-auto"}></label>
        `,
        ok     : old ? "Save" : "Add",
        ready  : (fields) => {
            const form  = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const pairs = /** @type {HTMLElement} */ (fields.querySelector("[data-fk-pairs]"));
            const label = /** @type {HTMLInputElement} */ (form.elements.namedItem("name"));
            // A pair: a column here, an arrow, the column there; the first there is the primary key, as it most often is.
            const pair  = (here, there) => {
                const primary = refColumns.find((column) => column.primary)?.name || refColumns[0]?.name || "";
                return `
                    <div class="fk-pair">
                        <span class="field select"><select data-fk-here>${structure.columns.map((column) => `<option value="${esc(column.name)}" ${column.name === here ? "selected" : ""}>${esc(column.name)} · ${esc(column.type)}</option>`).join("")}</select></span>
                        <span class="fk-arrow">→</span>
                        <span class="field select"><select data-fk-there>${refColumns.map((column) => `<option value="${esc(column.name)}" ${column.name === (there || primary) ? "selected" : ""}>${esc(column.name)} · ${esc(column.type)}</option>`).join("")}</select></span>
                        <button type="button" class="icon-btn" data-fk-less title="Take this pair out" aria-label="Take this pair out"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
                    </div>
                `;
            };
            const table = () => /** @type {HTMLSelectElement} */ (form.elements.namedItem("refTable")).value;
            // A new key's column here starts as the one named for the table, as customer_id for customers.
            const named = () => structure.columns.find((column) => column.name === `${table().replace(/s$/, "")}_id`)?.name || "";
            const draw  = (list) => {
                pairs.innerHTML = list.map(([ here, there ]) => pair(here, there)).join("");
                pairs.querySelectorAll("[data-fk-less]").forEach((one) => (/** @type {HTMLElement} */ (one).hidden = list.length < 2));
                rename();
            };
            const current = () => [ ...pairs.querySelectorAll(".fk-pair") ].map((one) => [
                /** @type {HTMLSelectElement} */ (one.querySelector("[data-fk-here]")).value,
                /** @type {HTMLSelectElement} */ (one.querySelector("[data-fk-there]")).value,
            ]);
            const rename = () => {
                if (label.dataset.auto !== undefined) {
                    label.value = `fk_${structure.table}_${current().map(([ here ]) => here).join("_")}`.replace(/[^\w$]/g, "_").slice(0, 64);
                }
            };
            draw(old ? old.columns.map((column, at) => [ column, old.references[at] ]) : [ [ named() || structure.columns[0]?.name, "" ] ]);
            /** @type {HTMLSelectElement} */ (form.elements.namedItem("refTable")).addEventListener("change", async () => {
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
                columns    : pairs.map((one) => /** @type {HTMLSelectElement} */ (one.querySelector("[data-fk-here]")).value),
                refColumns : pairs.map((one) => /** @type {HTMLSelectElement} */ (one.querySelector("[data-fk-there]")).value),
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

async function dropForeignKey(name) {
    const key  = browse.structure.foreign.find((one) => one.name === name);
    const sure = await ask({
        title  : `Drop the foreign key ${name}?`,
        text   : `${browse.table} no longer has to match ${key?.table || "the other table"}. Its rows and the index on its columns stay.`,
        ok     : "Drop",
        danger : true,
    });
    if (!sure) {
        return false;
    }
    try {
        toast((await api("/api/action", { action : "db-fk-drop", db : browse.db, table : browse.table, name })).message);
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
function followForeignKey(at, index) {
    const { structure, rows } = browse.rows;
    const column = structure.columns[at];
    const key    = structure.foreign.find((one) => one.columns.length === 1 && one.columns[0] === column.name);
    const value  = rows[index][at];
    if (!key || value === null) {
        return;
    }
    pendingFilters = { table : key.table, filters : [ { on : true, column : key.references[0], op : "=", value : String(value), value2 : "" } ] };
    navigate(browsePath("rows", key.table));
}

/** A table's size on disk, data and indexes, for a title; nothing for a view. */
function size(name) {
    const table = browse.tables.find((one) => one.name === name);
    return table && !table.view ? ` · ${bytes(table.size)}` : "";
}

/** The columns whose name, type or comment has the text typed. */
function renderStructureColumns() {
    const structure = browse.structure;
    const search    = /** @type {HTMLInputElement} */ (document.getElementById("structure-filter")).value.trim().toLowerCase();
    const shown     = structure.columns.filter((column) => [ column.name, column.type, column.comment ].some((text) => text.toLowerCase().includes(search)));
    const key       = `<span class="key" title="Primary key"><svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg></span>`;
    // A row drags to another place, while every column shows, so where it lands is plain.
    const drag = !search && !structureIsView();
    document.getElementById("structure-columns").innerHTML = shown.map((column) => `
        <tr data-key="${esc(column.name)}" ${drag ? `draggable="true"` : ""}>
            <td data-field="name"><strong>${esc(column.name)}</strong>${structure.primary.includes(column.name) ? key : ""}</td>
            <td data-field="type">${esc(column.type)}</td>
            <td data-field="null">${column.nullable ? "yes" : `<span class="null">no</span>`}</td>
            <td data-field="default">${defaultCell(column)}</td>
            <td>${esc(column.extra)}</td>
            <td data-field="comment" class="comment" title="${esc(column.comment)}">${esc(column.comment)}</td>
        </tr>
    `).join("") || `<tr><td class="empty" colspan="6">No column has “${esc(search)}”.</td></tr>`;
    markRow(document.getElementById("structure-grid"));
}

/** What a column starts with, as the grid shows it: nothing and NULL muted, an empty text named, a generated column's expression after "as". */
function defaultCell(column) {
    const { kind, value } = column.value;
    return kind === "none" ? `<span class="null">none</span>`
        : kind === "null" ? `<span class="null">NULL</span>`
            : kind === "virtual" || kind === "stored" ? `<span class="null">as</span> ${esc(value)}`
                : value === "" ? `<span class="null">empty</span>` : esc(value);
}

// ---------------------------------------------------------- changing columns ---

/** Whether the table shown is a view, whose columns are only read. */
function structureIsView() {
    return Boolean(browse.tables.find((one) => one.name === browse.structure?.table)?.view);
}

/** The types to pick, in phpMyAdmin's groups, the most used first; "-" parts a group. */
/** @type {[string, string[]][]} */
const COLUMN_TYPES = [
    [ "Common", [ "int", "varchar", "text", "date" ] ],
    [ "Numeric", [ "tinyint", "smallint", "mediumint", "int", "bigint", "-", "decimal", "float", "double", "-", "bit" ] ],
    [ "Date and time", [ "date", "datetime", "timestamp", "time", "year" ] ],
    [ "String", [ "char", "varchar", "-", "tinytext", "text", "mediumtext", "longtext", "-", "binary", "varbinary", "-", "tinyblob", "blob", "mediumblob", "longblob", "-", "enum", "set", "-", "uuid", "inet4", "inet6" ] ],
    [ "Spatial", [ "geometry", "point", "linestring", "polygon", "multipoint", "multilinestring", "multipolygon", "geometrycollection" ] ],
    [ "JSON", [ "json" ] ],
];
const TEXT_TYPE = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i;
const NUMBER_TYPE = /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double)$/;
// What the length or values of a type are, as a hint, and what one picked anew starts with; a type without is given none.
const TYPE_LENGTHS = {
    tinyint : [ "4" ], smallint : [ "6" ], mediumint : [ "9" ], int : [ "11" ], bigint : [ "20" ], decimal : [ "10,2", "10,2" ], float : [ "10,2" ], double : [ "10,2" ], bit : [ "1", "1" ],
    char : [ "36" ], varchar : [ "255", "255" ], binary : [ "16", "16" ], varbinary : [ "255", "255" ], text : [ "65535" ], blob : [ "65535" ],
    enum : [ "'one','two'", "'one','two'" ], set : [ "'one','two'", "'one','two'" ], datetime : [ "0 to 6 decimals" ], timestamp : [ "0 to 6 decimals" ], time : [ "0 to 6 decimals" ],
};

/**
 * The dialog that adds a column or changes one, as Sequel Ace's columns
 * do: its name and type, whether it takes NULL, what it starts with -- a
 * value, NULL, an expression as current_timestamp() -- or what it is
 * generated from, auto_increment, ON UPDATE, its collation when it holds
 * text, its comment, and its place among the others. A copy starts as the
 * column it copies, after it.
 */
/** The types to pick from, grouped as phpMyAdmin's, the one given picked, under its own group when it is none of them. */
function typeOptions(base) {
    const known  = COLUMN_TYPES.some(([ , types ]) => types.includes(base.toLowerCase()));
    let   chosen = false;
    return `${known ? "" : `<optgroup label="This column's"><option value="${esc(base)}" selected>${esc(base.toUpperCase())}</option></optgroup>`}${COLUMN_TYPES.map(([ group, types ]) => `<optgroup label="${group}">${types.map((type) => {
        if (type === "-") {
            return `<option disabled>──────</option>`;
        }
        // Only the first of a type's places, as Common has them again, is picked.
        const on = !chosen && type === base.toLowerCase();
        chosen ||= on;
        return `<option value="${type}" ${on ? "selected" : ""}>${type.toUpperCase()}</option>`;
    }).join("")}</optgroup>`).join("")}`;
}

/** @param {string | null} [name] @param {{ copy?: boolean, after?: string | null }} [options] */
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
    const tableCollation = browse.tables.find((one) => one.name === structure.table)?.collation || "";
    const column = old ? { ...old, name : copy ? `${old.name}_copy` : old.name } : {
        name : "", type : "varchar(255)", nullable : true, value : { kind : "null", value : "" }, extra : "", comment : "", collation : "",
    };
    const others = structure.columns.filter((one) => one.name !== name || copy);
    const place  = copy ? name : after ?? (adding ? structure.columns.at(-1)?.name : "");
    const kinds  = [ [ "none", "No default" ], [ "null", "NULL" ], [ "value", "A value" ], [ "expression", "An expression" ], [ "virtual", "Generated, virtual" ], [ "stored", "Generated, stored" ] ];
    const picked = column.collation && column.collation !== tableCollation ? column.collation : "";
    // The type apart: its name, its length or values in brackets, and unsigned or zerofill after.
    const [ , base = column.type, length = "", flags = "" ] = column.type.match(/^([a-z][a-z0-9 ]*?)\s*(?:\((.*)\))?((?:\s+(?:unsigned|signed|zerofill))*)$/i) || [];
    formDialog({
        title  : adding ? `New column in ${structure.table}` : `Change the column ${old.name}`,
        text   : "MariaDB rewrites the table to change its columns, which takes a while in a large one.",
        body   : `
            <div class="column-type">
                <label class="form-row"><span>Name</span><input name="name" value="${esc(column.name)}" maxlength="64" spellcheck="false" required></label>
                <label class="form-row"><span>Type</span><span class="field select"><select name="type">${typeOptions(base)}</select></span></label>
                <label class="form-row"><span>Length / values</span><input name="length" value="${esc(length)}" spellcheck="false"></label>
            </div>
            <div class="form-pair">
                <label class="form-row"><span>Starts with</span><span class="field select"><select name="value">${kinds.map(([ value, label ]) => `<option value="${value}" ${value === column.value.kind ? "selected" : ""}>${label}</option>`).join("")}</select></span></label>
                <label class="form-row" data-column-preset><span></span><input name="preset" value="${esc(column.value.value)}" spellcheck="false"></label>
            </div>
            <div class="column-checks" data-column-checks>
                <label class="check"><input type="checkbox" class="box" name="nullable" ${column.nullable ? "checked" : ""}><span>Allows NULL</span></label>
                <label class="check" data-column-unsigned><input type="checkbox" class="box" name="unsigned" ${/unsigned/i.test(flags) ? "checked" : ""}><span>Unsigned</span></label>
                <label class="check"><input type="checkbox" class="box" name="increment" ${/auto_increment/i.test(column.extra) && !copy ? "checked" : ""}><span>Auto increment</span></label>
                <label class="check" data-column-update><input type="checkbox" class="box" name="update" ${/on update/i.test(column.extra) ? "checked" : ""}><span>On update, the time</span></label>
            </div>
            <div class="form-pair">
                <label class="form-row"><span>Place</span><span class="field select"><select name="after">
                    ${adding ? "" : `<option value="">Where it is</option>`}
                    <option value="first">First</option>
                    ${others.map((one) => `<option value="${esc(one.name)}" ${one.name === place ? "selected" : ""}>After ${esc(one.name)}</option>`).join("")}
                </select></span></label>
                <label class="form-row" data-column-collation><span>Collation</span><span class="field select"><select name="collation">
                    <option value="">The table's${tableCollation ? `, ${esc(tableCollation)}` : ""}</option>
                    ${charsets.map((set) => `<optgroup label="${esc(set.description)} (${esc(set.name)})">${set.collations.map((one) => `<option ${one === picked ? "selected" : ""}>${esc(one)}</option>`).join("")}</optgroup>`).join("")}
                </select></span></label>
            </div>
            <label class="form-row"><span>Comment</span><input name="comment" value="${esc(column.comment)}" maxlength="1024" placeholder="What it holds" spellcheck="false"></label>
        `,
        ok     : adding ? "Add" : "Save",
        ready  : (fields) => {
            // Only the fields that count for the type and the start show.
            const form   = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const size   = /** @type {HTMLInputElement} */ (form.elements.namedItem("length"));
            const update = () => {
                const kind = /** @type {HTMLSelectElement} */ (form.elements.namedItem("value")).value;
                const type = /** @type {HTMLSelectElement} */ (form.elements.namedItem("type")).value;
                const hint = TYPE_LENGTHS[type];
                size.disabled    = !hint;
                size.placeholder = hint ? hint[0] : "None for this type";
                /** @type {HTMLElement} */ (fields.querySelector("[data-column-unsigned]")).hidden = !NUMBER_TYPE.test(type);
                const made = kind === "virtual" || kind === "stored";
                const box  = /** @type {HTMLElement} */ (fields.querySelector("[data-column-preset]"));
                box.style.visibility = kind === "none" || kind === "null" ? "hidden" : "";
                box.querySelector("span").textContent = made ? "Made from" : kind === "expression" ? "Expression" : "Value";
                /** @type {HTMLInputElement} */ (box.querySelector("input")).placeholder = made ? "`price` * `count`" : kind === "expression" ? "current_timestamp()" : "";
                /** @type {HTMLElement} */ (fields.querySelector("[data-column-checks]")).hidden = made;
                /** @type {HTMLElement} */ (fields.querySelector("[data-column-update]")).hidden = !/^(timestamp|datetime)$/.test(type);
                /** @type {HTMLElement} */ (fields.querySelector("[data-column-collation]")).style.visibility = TEXT_TYPE.test(type) ? "" : "hidden";
            };
            form.addEventListener("input", update);
            // A type picked anew starts with its usual length, or none when it takes none.
            /** @type {HTMLSelectElement} */ (form.elements.namedItem("type")).addEventListener("change", (event) => {
                size.value = TYPE_LENGTHS[/** @type {HTMLSelectElement} */ (event.target).value]?.[1] || "";
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
            const marks = NUMBER_TYPE.test(name) ? `${data.get("unsigned") === "on" ? " unsigned" : ""}${/zerofill/i.test(flags) ? " zerofill" : ""}` : "";
            const definition = {
                name      : String(data.get("name")),
                type      : `${name}${sized && TYPE_LENGTHS[name] ? `(${sized})` : ""}${marks}`,
                nullable  : data.get("nullable") === "on",
                value     : String(data.get("value")),
                preset    : String(data.get("preset")),
                increment : data.get("increment") === "on",
                update    : data.get("update") === "on" && /^(timestamp|datetime)$/.test(name),
                // Named even when it is the table's, as a column changed without one would get the table's anyway.
                collation : text ? String(data.get("collation")) || tableCollation : "",
                comment   : String(data.get("comment")),
            };
            const result = await api("/api/action", { action : "db-column-save", db : browse.db, table : browse.table, column : adding ? null : old.name, definition, after : String(data.get("after")) });
            marked["structure-grid"] = { key : definition.name, context : gridContext("structure-grid") };
            loadStructure();
            loadTables();
            return result;
        },
    });
}

/**
 * A column's definition as it is, with some of it changed: what a change
 * in place or a move sends, so the rest of the column stays as it was.
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

/** A column's start as it is typed in its cell: nothing, NULL, or the value or expression itself. */
function defaultText(column) {
    return column.value.kind === "none" ? "" : column.value.kind === "null" ? "NULL" : column.value.value;
}

/** What is typed in a default's cell: empty for none, NULL, a call as current_timestamp() for an expression, else a value. */
function defaultOf(text, column) {
    if (text === defaultText(column)) {
        return { value : column.value.kind, preset : column.value.value };
    }
    return text === "" ? { value : "none", preset : "" }
        : /^null$/i.test(text) ? { value : "null", preset : "" }
            : /^[a-z_][a-z0-9_]*\(.*\)$/i.test(text.trim()) ? { value : "expression", preset : text.trim() }
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
function editColumnCell(td) {
    if (columnEdit || structureIsView()) {
        return;
    }
    const tr     = /** @type {HTMLElement} */ (td.closest("tr"));
    const name   = tr.dataset.key;
    const field  = td.dataset.field;
    const column = browse.structure.columns.find((one) => one.name === name);
    if (!field || field === "default" && (column.value.kind === "virtual" || column.value.kind === "stored")) {
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
        input.value       = { name : column.name, type : column.type, comment : column.comment, default : defaultText(column) }[field];
        input.placeholder = field === "default" ? "none" : "";
        input.spellcheck  = false;
    }
    input.className   = "cell-input";
    // The cell's width less its padding while changed, so the column keeps its.
    input.style.width = `${td.clientWidth - 4}px`;
    const cells = () => [ ...document.querySelectorAll("#structure-grid tbody td[data-field]") ];
    const edit  = { name, field, old : input.value, input, done : false, at : cells().indexOf(td), row : [ ...tr.parentElement.children ].indexOf(tr) };
    columnEdit   = edit;
    tr.draggable = false;
    td.classList.add("editing");
    td.replaceChildren(input);
    input.focus();
    if (input instanceof HTMLInputElement) {
        input.select();
    }
    // Where to go after: a cell along, or the same one a row up or down, found again once the grid is drawn again.
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
        } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && field !== "null" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            saveColumnCell(edit, down(event.key === "ArrowUp" ? -1 : 1));
        }
    });
    if (input instanceof HTMLSelectElement) {
        input.addEventListener("change", () => saveColumnCell(edit));
    }
    input.addEventListener("blur", () => saveColumnCell(edit));
}

/** Marks a column's row, scrolls to it, and changes its cell. */
function changeColumnAt(td) {
    const tr = /** @type {HTMLElement} */ (td.closest("tr"));
    pickRow(tr);
    revealRow(/** @type {HTMLTableElement} */ (tr.closest("table")), tr);
    editColumnCell(td);
}

/** Saves a column's cell changed in place, if it is, with the rest of the column as it was, then goes on, if asked. */
/** @param {(() => void) | null} [then] */
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
            await api("/api/action", { action : "db-column-save", db : browse.db, table : browse.table, column : edit.name, definition : columnDefinition(column, changes) });
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
function dropColumnAt(tr, below) {
    const columns = browse.structure.columns.map((one) => one.name);
    const target  = tr.dataset.key;
    const at      = columns.indexOf(target);
    const after   = below ? target : at > 0 ? columns[at - 1] : "first";
    const name    = columnDrag;
    // Dropped where it is already: before or after itself.
    if (!name || name === target || after === columns[columns.indexOf(name) - 1] || after === "first" && columns[0] === name) {
        return;
    }
    api("/api/action", { action : "db-column-move", db : browse.db, table : browse.table, column : name, after })
        .then((result) => {
            toast(result.message);
            marked["structure-grid"] = { key : name, context : gridContext("structure-grid") };
            loadStructure();
        })
        .catch((error) => toast(error.message, true));
}

/** The menu of a column, on a right click: to change, copy or add one after it, to move it, or to drop it. */
let columnMenu = "";
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
        <button role="menuitem" data-column-act="down" ${at === columns.length - 1 ? "disabled" : ""}>Move Down</button>
        <hr>
        <button role="menuitem" data-column-act="copy">Copy Name</button>
        <hr>
        <button role="menuitem" data-column-act="drop" class="danger-item" ${columns.length === 1 ? "disabled" : ""}>Drop…</button>
    `;
    showMenuAt(menu, x, y);
}

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
        toast((await api("/api/action", { action : "db-column-move", db : browse.db, table : browse.table, column : name, after })).message);
    } catch (error) {
        toast(error.message, true);
        return;
    }
    loadStructure();
}

async function dropColumn(name) {
    const sure = await ask({
        title  : `Drop the column ${name}?`,
        text   : `Its values in every row of ${browse.table} are gone for good, and the indexes on it change.`,
        ok     : "Drop",
        danger : true,
    });
    if (!sure) {
        return;
    }
    try {
        toast((await api("/api/action", { action : "db-column-drop", db : browse.db, table : browse.table, column : name })).message);
    } catch (error) {
        toast(error.message, true);
        return;
    }
    loadStructure();
    loadTables();
}

// -------------------------------------------------------------- information ---

/** The engines MariaDB has on, asked once, when the Information tab first needs them. */
let engineList = null;
async function loadEngines() {
    engineList = engineList || await api("/api/engines");
    return engineList;
}

/**
 * The table's information, as Sequel Ace's Table Information has it: its
 * engine and encoding, which change here, its dates, its rows and sizes,
 * its next id and comment, which change here too, and its CREATE
 * statement. A view's is only read.
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
            api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${encodeURIComponent(browse.table)}`),
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
    const when    = (text) => text ? new Date(text.replace(" ", "T")).toLocaleString([], { dateStyle : "medium", timeStyle : "medium" }) : "";
    const pair    = (label, value, id = "") => `<dt>${label}</dt><dd ${id ? `id="${id}"` : ""} class="${value ? "" : "none"}">${value || "—"}</dd>`;
    const names   = engines.some((one) => one.name === table.engine) ? engines : [ { name : table.engine, comment : "" }, ...engines ];
    const view    = table.view;
    box.innerHTML = `
        <div class="panel-head">
            <h2>${esc(table.name)} <span class="muted">· ${view ? "view" : "table"}</span></h2>
            <div class="actions">${view ? "" : `<span id="info-status" class="editor-status"></span><button data-info-save disabled>Save</button>`}${tableMenuButton()}</div>
        </div>
        <form id="info-form" class="info-form" autocomplete="off">
            <dl class="info-grid">
                ${view ? pair("Type", "View") : `
                    <dt>Type</dt>
                    <dd><span class="field select"><select name="engine">${names.map((one) => `<option value="${esc(one.name)}" title="${esc(one.comment)}" ${one.name === table.engine ? "selected" : ""}>${esc(one.name)}</option>`).join("")}</select></span></dd>
                `}
                ${pair("Created at", esc(when(table.created)))}
                ${view ? pair("Encoding", "") : `
                    <dt>Encoding</dt>
                    <dd><span class="field select"><select name="charset">${charsets.map((one) => `<option value="${esc(one.name)}" ${one.name === charset ? "selected" : ""}>${esc(one.description)} (${esc(one.name)})</option>`).join("")}</select></span></dd>
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
                        <span>Convert its columns too<small>Otherwise only new columns get it</small></span>
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
                        <input name="next" type="number" min="1" step="1" value="${table.next}" class="info-next" title="The id the next row gets">
                        <button type="button" class="ghost" data-reset-next title="The id after the highest there, to save">Reset</button>
                    </dd>
                `}
                ${pair("Free data size", view ? "" : bytes(table.free))}
            </dl>
            ${view ? "" : `
                <dl class="info-wide">
                    <dt>Comment</dt>
                    <dd><span class="field"><textarea name="comment" rows="2" maxlength="2048" placeholder="What the table holds" spellcheck="false">${esc(table.comment)}</textarea></span></dd>
                </dl>
            `}
            <dl class="info-wide info-create">
                <dt>Create syntax<button type="button" class="ghost small" data-copy-create>Copy</button></dt>
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
 */
function setUpInfoForm(table, charset) {
    const form = /** @type {HTMLFormElement} */ (document.getElementById("info-form"));
    const set  = /** @type {HTMLSelectElement} */ (form.elements.namedItem("charset"));
    const sort = /** @type {HTMLSelectElement} */ (form.elements.namedItem("collation"));
    const fill = (wanted) => {
        const one  = charsetList.find((item) => item.name === set.value);
        const kind = wanted.replace(/^[^_]+_/, "");
        const pick = one.collations.includes(wanted) ? wanted : one.collations.find((name) => name === `${one.name}_${kind}`) || one.collation;
        sort.innerHTML = one.collations.map((name) => `<option ${name === pick ? "selected" : ""}>${esc(name)}</option>`).join("");
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

function infoValues() {
    const data = new FormData(/** @type {HTMLFormElement} */ (document.getElementById("info-form")));
    return Object.fromEntries([ "engine", "charset", "collation", "comment", "next" ].map((name) => [ name, data.has(name) ? String(data.get(name)) : null ]));
}

/** What the form changes, by option; the encoding as a pair, as it is set together. */
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

function infoChanged() {
    const changes = infoChanges();
    /** @type {HTMLButtonElement} */ (document.querySelector("[data-info-save]")).disabled = !Object.keys(changes).length;
    /** @type {HTMLElement} */ (document.getElementById("info-convert")).hidden = !changes.charset;
}

/**
 * Saves what changed. A new engine, or columns converted, rewrite the
 * table, which takes a while in a large one, so the status says so.
 */
async function saveInfo() {
    const changes = infoChanges();
    const button  = /** @type {HTMLButtonElement} */ (document.querySelector("[data-info-save]"));
    const status  = document.getElementById("info-status");
    const convert = Boolean(changes.charset) && /** @type {HTMLInputElement} */ (document.querySelector("#info-form [name=convert]")).checked;
    button.disabled    = true;
    status.className   = "editor-status";
    status.textContent = changes.engine || convert ? "Rewriting the table…" : "Saving…";
    try {
        const result = await api("/api/action", { action : "db-table-change", db : browse.db, table : browse.table, ...changes, convert });
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
 */
async function resetNext(button) {
    button.disabled = true;
    try {
        const { next } = await api("/api/action", { action : "db-next-id", db : browse.db, table : browse.table });
        const field    = /** @type {HTMLInputElement} */ (document.querySelector("#info-form [name=next]"));
        field.value    = String(next);
        field.dispatchEvent(new Event("input", { bubbles : true }));
    } catch (error) {
        toast(error.message, true);
    }
    button.disabled = false;
}

function copyCreate() {
    navigator.clipboard.writeText(browse.structure.create).then(() => toast("Copied"));
}

// --------------------------------------------------------------------- sql ---

/** The console: the SQL typed for this database, or a SELECT of the table to start from. */
function openSql() {
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    text.value = browse.sql[browse.db] ?? (browse.table ? `SELECT * FROM \`${browse.table}\` LIMIT 50;` : "");
    paintSqlBox();
    text.focus();
}

/** The words SQL is written with, painted as such. */
const SQL_WORDS = new Set(`
    ADD ALL ALTER AND ANY AS ASC AUTO_INCREMENT BEGIN BETWEEN BY CASE CHANGE CHARACTER CHECK COLLATE COLUMN COMMIT
    CONSTRAINT CREATE CROSS DATABASE DATABASES DEFAULT DELETE DESC DESCRIBE DISTINCT DO DROP ELSE END ENGINE EXISTS
    EXPLAIN FALSE FOREIGN FROM FULL FUNCTION GRANT GROUP HAVING IF IGNORE IN INDEX INNER INSERT INTERVAL INTO IS JOIN
    KEY KEYS LEFT LIKE LIMIT LOCK MODIFY NOT NULL OFFSET ON OR ORDER OUTER PRIMARY PROCEDURE REFERENCES REGEXP RENAME
    REPLACE RIGHT ROLLBACK SELECT SET SHOW START TABLE TABLES THEN TO TRANSACTION TRIGGER TRUE TRUNCATE UNION UNIQUE
    UNLOCK UNSIGNED UPDATE USE USING VALUES VIEW WHEN WHERE WITH
`.trim().split(/\s+/));

/**
 * SQL painted: comments, texts in quotes, names in backticks, numbers and
 * the words it is written with, the rest as typed.
 */
function paintSql(text) {
    const parts = /(--[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:\\.|''|[^'\\])*'?|"(?:\\.|""|[^"\\])*"?)|(`[^`]*`?)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]+)\b/g;
    let result = "";
    let last   = 0;
    for (const found of text.matchAll(parts)) {
        const [ part, comment, quoted, name, number, word ] = found;
        const kind = comment ? "code-mark" : quoted ? "code-string" : name ? "code-key" : number ? "code-number"
            : word && SQL_WORDS.has(word.toUpperCase()) ? "code-word" : "";
        result += escapeCode(text.slice(last, found.index));
        result += kind ? `<span class="${kind}">${escapeCode(part)}</span>` : escapeCode(part);
        last = found.index + part.length;
    }
    return result + escapeCode(text.slice(last));
}

/**
 * The paint under the box, which follows it as it scrolls, and Run's label
 * for a selection. The paint is a block per line, wrapped as the box wraps
 * the text, numbered in the gutter by its own CSS counter; a comment or a
 * string going on past a line has its color closed there and opened again.
 */
function paintSqlBox() {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const paint = document.getElementById("sql-paint");
    let   open  = "";
    paint.innerHTML = paintSql(text.value).split("\n").map((line) => {
        const html = `${open}${line}`;
        const last = html.lastIndexOf("<span");
        open = last > html.lastIndexOf("</span>") ? html.slice(last, html.indexOf(">", last) + 1) : "";
        return `<div class="sql-line">${html || "\u200b"}${open ? "</span>" : ""}</div>`;
    }).join("");
    // As wide as the text inside the box, less a scrollbar, so lines wrap at the same place.
    paint.style.width     = `${text.clientWidth}px`;
    paint.style.transform = `translateY(${-text.scrollTop}px)`;
    document.getElementById("sql-run-label").textContent = text.selectionStart !== text.selectionEnd ? "Run selection" : "Run all";
}

/**
 * The statements in the SQL, by where each starts and ends: split at each
 * ; outside quotes, backticks and comments, the empty ones left out.
 */
function statementsOf(text) {
    const list = [];
    let start  = 0;
    for (let at = 0; at < text.length; at++) {
        const char = text[at];
        if (char === "'" || char === "\"" || char === "`") {
            // To the quote that closes it; a doubled one closes and opens again.
            for (at++; at < text.length && text[at] !== char; at++) {
                if (text[at] === "\\" && char !== "`") {
                    at++;
                }
            }
        } else if (char === "#" || char === "-" && text[at + 1] === "-") {
            const end = text.indexOf("\n", at);
            at = end < 0 ? text.length : end;
        } else if (char === "/" && text[at + 1] === "*") {
            const end = text.indexOf("*/", at + 2);
            at = end < 0 ? text.length : end + 1;
        } else if (char === ";") {
            list.push({ start, end : at });
            start = at + 1;
        }
    }
    list.push({ start, end : text.length });
    return list.filter((one) => text.slice(one.start, one.end).trim());
}

/** The statement the cursor is in, or, after the last one, that one. */
function currentStatement() {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const caret = text.selectionStart;
    const list  = statementsOf(text.value);
    const one   = list.find((statement) => caret >= statement.start && caret <= statement.end + 1) || list.filter((statement) => statement.start <= caret).at(-1) || list[0];
    return one ? text.value.slice(one.start, one.end).trim() : "";
}

/**
 * Runs the SQL: all of it, or only the part selected; the statement the
 * cursor is in; or that one's EXPLAIN. Each result shows as a grid, and
 * the last statement's changed rows and the time in the status. The SQL run
 * goes in the history; the tables are read again after, as it may have
 * made or dropped one.
 * @param {"all" | "current" | "explain"} how
 */
async function runSql(how = "all") {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const status = document.getElementById("sql-status");
    const button = /** @type {HTMLButtonElement} */ (document.querySelector("[data-sql-run]"));
    const picked = text.selectionStart !== text.selectionEnd ? text.value.slice(text.selectionStart, text.selectionEnd) : "";
    let   sql    = how === "all" ? picked || text.value : picked.trim() || currentStatement();
    if (how === "explain") {
        sql = /^\s*EXPLAIN\b/i.test(sql) ? sql : `EXPLAIN ${sql.replace(/;\s*$/, "")}`;
    }
    if (!sql.trim() || button.disabled) {
        return;
    }
    browse.sql[browse.db] = text.value;
    rememberSql(sql);
    for (const one of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("[data-sql-run], [data-sql-current], [data-sql-explain]"))) {
        one.disabled = true;
    }
    status.className   = "editor-status";
    status.textContent = "Running…";
    try {
        const answer = await api("/api/action", { action : "db-sql", db : browse.db, sql });
        const time   = answer.time < 1000 ? `${answer.time} ms` : `${(answer.time / 1000).toFixed(1)} s`;
        status.className   = "editor-status ok";
        status.textContent = `${answer.changed >= 0 ? `${countOf(answer.changed, "row")} changed · ` : ""}${time}`;
        browse.results = answer.results;
        renderResults();
        loadTables();
    } catch (error) {
        status.className   = "editor-status bad";
        status.textContent = error.message;
    } finally {
        for (const one of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("[data-sql-run], [data-sql-current], [data-sql-explain]"))) {
            one.disabled = false;
        }
    }
}

/** The results, a grid each; the rows of a plain SELECT of one table change in place, as in Sequel Ace. */
function renderResults() {
    document.getElementById("sql-results").innerHTML = browse.results.map((result, index) => `
        <div class="sql-result">
            <div class="sql-result-head">
                <code>${esc(result.statement.length > 120 ? `${result.statement.slice(0, 120)}…` : result.statement)}</code>
                ${result.edit ? `<span class="tag" title="Double-click a value to change it in ${esc(result.edit.table)}">editable</span>` : ""}
                <span class="muted">${result.more ? "the first 1000 rows" : countOf(result.rows.length, "row")}</span>
                ${result.columns.length && READS.test(result.statement) ? `<button class="ghost small" data-result-export="${index}" title="All its rows, run again, as CSV or JSON">Export…</button>` : ""}
            </div>
            ${result.rows.length ? `
                <div class="grid-wrap"><div class="grid-scroll"><table class="data-grid ${result.edit ? "editable" : ""}">
                    <thead><tr>${result.columns.map((name) => `<th><span class="th">${esc(name)}</span><span class="col-resize" data-resize></span></th>`).join("")}</tr></thead>
                    <tbody>${result.rows.map((row, at) => `<tr data-result="${index}" data-r="${at}">${row.map((value, column) => resultCell(result, value, column)).join("")}</tr>`).join("")}</tbody>
                </table></div></div>
            ` : ""}
        </div>
    `).join("");
    document.querySelectorAll("#sql-results .grid-scroll").forEach((one) => watchFades(/** @type {HTMLElement} */ (one)));
    watchFades(/** @type {HTMLElement} */ (document.querySelector(".browse-main")));
}

// A query that only reads, whose results can be run again to export.
const READS = /^\s*(?:(?:--[^\n]*|#[^\n]*)\n\s*|\/\*[\s\S]*?\*\/\s*)*(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC|VALUES|TABLE)\b/i;

/** A result's rows, all of them, as the query gives them again, as CSV or JSON. */
function openResultExport(index) {
    const result = browse.results[index];
    formDialog({
        title  : "Export the results",
        text   : `The query runs again, in a transaction that can't change anything, for all its rows${result.more ? ", not only the 1000 shown" : ""}.`,
        body   : `
            <div class="export-form">
                <div class="form-row"><span>Format</span><div class="segmented"><button type="button" data-export-format="csv" class="active">CSV</button><button type="button" data-export-format="json">JSON</button></div></div>
                <div class="form-pair" data-export-for="csv">
                    <label class="form-row"><span>Separator</span><span class="field select"><select name="separator">
                        <option value=",">Comma ,</option><option value=";">Semicolon ;</option><option value="&#9;">Tab</option>
                    </select></span></label>
                    <label class="check export-header"><input type="checkbox" class="box" name="header" checked><span>Column names first</span></label>
                </div>
                <label class="check"><input type="checkbox" class="box" name="gzip"><span>Compressed, as .gz</span></label>
            </div>
        `,
        ok     : "Export",
        ready  : (fields) => fields.addEventListener("click", (event) => {
            const button = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest("[data-export-format]"));
            if (button) {
                fields.querySelector("[data-export-format].active").classList.remove("active");
                button.classList.add("active");
                /** @type {HTMLElement} */ (fields.querySelector("[data-export-for]")).hidden = button.dataset.exportFormat !== "csv";
            }
        }),
        submit : async (form) => {
            const data   = new FormData(form);
            const format = /** @type {HTMLElement} */ (form.querySelector("[data-export-format].active")).dataset.exportFormat;
            const { id } = await api("/api/action", {
                action    : "db-export",
                db        : browse.db,
                format,
                sql       : result.statement,
                columns   : result.columns,
                separator : String(data.get("separator") || ","),
                header    : data.get("header") === "on",
                gzip      : data.get("gzip") === "on",
            });
            window.location.assign(`/api/db-export?id=${encodeURIComponent(id)}`);
            return { message : "Exporting: the file downloads as it is written" };
        },
    });
}

/** A result's value, as its table's column shows it when the result is of one. */
function resultCell(result, value, at) {
    const column = result.edit?.columns[at];
    return cellOf(value, column ? { ...column, binary : false } : { binary : false, dataType : "" }, 300, at);
}

// --------------------------------------------------------- changing results ---

let resultEdit = null;

/** A result's row, by its primary key, as the server finds it. */
function resultKey(result, r) {
    return Object.fromEntries(result.edit.primary.map((name) => [ name, result.rows[r][result.columns.indexOf(name)] ]));
}

/**
 * Changes a value of an editable result where it is: Enter or leaving it
 * saves, Escape doesn't, Tab goes on to the next. A long value changes in
 * a dialog; binary and generated ones only with SQL.
 */
function editResultCell(td) {
    const tr     = /** @type {HTMLElement} */ (td.closest("tr[data-result]"));
    const result = tr && browse.results[Number(tr.dataset.result)];
    if (!result?.edit || resultEdit) {
        return;
    }
    const r      = Number(tr.dataset.r);
    const at     = Number(td.dataset.at);
    const column = result.edit.columns[at];
    const value  = result.rows[r][at];
    if (column.binary || column.generated) {
        toast(`${column.name} is ${column.binary ? "binary" : "generated"}: change it with SQL`, true);
        return;
    }
    if (isBig(value)) {
        editResultValue(result, r, at);
        return;
    }
    const input = document.createElement("input");
    input.className   = "cell-input";
    input.value       = value ?? "";
    input.placeholder = value === null ? "NULL" : "";
    input.spellcheck  = false;
    input.style.width = `${td.clientWidth - 4}px`;
    const edit = { result, r, at, td, input, done : false };
    resultEdit = edit;
    td.classList.add("editing");
    td.replaceChildren(input);
    input.focus();
    input.select();
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            saveResultCell(edit);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            edit.done  = true;
            resultEdit = null;
            td.outerHTML = resultCell(result, value, at);
        } else if (event.key === "Tab") {
            event.preventDefault();
            // The body found first, as the cell is drawn anew once saved.
            const body  = td.closest("tbody");
            const place = [ ...body.querySelectorAll("td[data-at]") ].indexOf(td) + (event.shiftKey ? -1 : 1);
            saveResultCell(edit, () => {
                const next = /** @type {HTMLElement} */ (body.querySelectorAll("td[data-at]")[place]);
                if (next) {
                    editResultCell(next);
                }
            });
        }
    });
    input.addEventListener("blur", () => saveResultCell(edit));
}

/** @param {(() => void) | null} [then] */
async function saveResultCell(edit, then = null) {
    if (edit.done) {
        return;
    }
    edit.done = true;
    const { result, r, at, td, input } = edit;
    const old  = result.rows[r][at];
    const text = input.value;
    if (old === null ? text !== "" : text !== old) {
        input.disabled = true;
        try {
            await saveResultValue(result, r, at, text);
        } catch (error) {
            toast(error.message, true);
            edit.done      = false;
            input.disabled = false;
            input.focus();
            return;
        }
    }
    resultEdit = null;
    // The cell again, found anew, as the grid may have been drawn again since.
    const cell = document.querySelector(`#sql-results tr[data-result="${browse.results.indexOf(result)}"][data-r="${r}"] td[data-at="${at}"]`) || td;
    cell.outerHTML = resultCell(result, result.rows[r][at], at);
    then?.();
}

/** Saves a value of a result's row, then reads the row back, for what MariaDB made of it. */
async function saveResultValue(result, r, at, value) {
    const { db, table } = result.edit;
    await api("/api/action", { action : "db-row-save", db, table, key : resultKey(result, r), values : { [result.columns[at]] : value } });
    result.rows[r][at] = value;
    try {
        const { structure, row } = await api("/api/action", { action : "db-row", db, table, key : resultKey(result, r) });
        result.rows[r] = result.columns.map((name) => row[structure.columns.findIndex((column) => column.name === name)]);
    } catch {
        // The value as typed stays.
    }
}

/** A long value of a result, changed in a dialog, in full. */
function editResultValue(result, r, at) {
    formDialog({
        title  : `Change ${result.columns[at]}`,
        text   : `In ${result.edit.table}, the row ${Object.entries(resultKey(result, r)).map(([ name, value ]) => `${name} ${value}`).join(" · ")}.`,
        body   : `<textarea name="value" class="result-value" spellcheck="false">${esc(result.rows[r][at])}</textarea>`,
        ok     : "Save",
        submit : async (form) => {
            await saveResultValue(result, r, at, String(new FormData(form).get("value")));
            renderResults();
            return { message : `Saved ${result.columns[at]}` };
        },
    });
}

// ------------------------------------------------- history and favorites ---

// Kept in the browser, by database for the history, never with Studio's files.
const SQL_HISTORY   = "studio.sql.history";
const SQL_FAVORITES = "studio.sql.favorites";

function readStored(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
        return [];
    }
}

/** The SQL run goes first in the history, once, and the oldest go past 200. */
function rememberSql(sql) {
    const text = sql.trim();
    const list = readStored(SQL_HISTORY).filter((one) => !(one.db === browse.db && one.sql === text));
    list.unshift({ db : browse.db, sql : text, at : Date.now() });
    localStorage.setItem(SQL_HISTORY, JSON.stringify(list.slice(0, 200)));
}

/** A query's first line, as a menu shows it, its whole in the title. */
function sqlItem(sql, data, meta) {
    const line = sql.replace(/\s+/g, " ").trim();
    return `<button role="menuitem" ${data} title="${esc(sql)}"><span class="sql-menu-text">${esc(line)}</span><small>${esc(meta)}</small></button>`;
}

/** How long ago, in a word or two. */
function agoOf(time) {
    const minutes = Math.round((Date.now() - time) / 60_000);
    return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : new Date(time).toLocaleDateString();
}

/** The two menus, drawn as they open: this database's history, and the favorites. */
function renderSqlMenus() {
    const history = readStored(SQL_HISTORY).filter((one) => one.db === browse.db).slice(0, 50);
    document.getElementById("sql-history").innerHTML = history.length
        ? `${history.map((one) => sqlItem(one.sql, `data-sql-use="history:${esc(String(one.at))}"`, agoOf(one.at))).join("")}<hr><button role="menuitem" data-sql-clear>Clear ${esc(browse.db)}'s History</button>`
        : `<div class="menu-none">Nothing run in ${esc(browse.db)} yet.</div>`;
    const favorites = readStored(SQL_FAVORITES);
    document.getElementById("sql-favorites").innerHTML = `
        <button role="menuitem" data-sql-keep>Save Query…</button>
        ${favorites.length ? "<hr>" : ""}
        ${favorites.map((one, at) => `
            <div class="menu-row">
                <button role="menuitem" data-sql-use="favorite:${at}" title="${esc(one.sql)}"><span class="sql-menu-name">${esc(one.name)}</span><small class="sql-menu-text">${esc(one.sql.replace(/\s+/g, " ").trim())}</small></button>
                <button class="icon-btn" data-sql-forget="${at}" title="Remove from the favorites" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>
        `).join("")}
    `;
}

/** Puts a query from the history or the favorites in the box, in place of what is there. */
function useSql(from) {
    const [ kind, which ] = from.split(":");
    const one  = kind === "history" ? readStored(SQL_HISTORY).find((item) => String(item.at) === which && item.db === browse.db) : readStored(SQL_FAVORITES)[Number(which)];
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    if (!one) {
        return;
    }
    text.value = one.sql;
    browse.sql[browse.db] = one.sql;
    paintSqlBox();
    text.focus();
}

/** Keeps the query in the box, or the part selected, as a favorite, by a name. */
function keepSql() {
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const sql  = (text.selectionStart !== text.selectionEnd ? text.value.slice(text.selectionStart, text.selectionEnd) : text.value).trim();
    if (!sql) {
        toast("Write the query to keep first", true);
        return;
    }
    formDialog({
        title  : "Save the query",
        text   : "Kept in this browser, for any database, under Favorites.",
        body   : `<label class="form-row"><span>Name</span><input name="name" value="${esc(sql.replace(/\s+/g, " ").slice(0, 60))}" maxlength="120" spellcheck="false" required></label>`,
        ok     : "Save",
        ready  : (fields) => /** @type {HTMLInputElement} */ (fields.querySelector("input")).select(),
        submit : async (form) => {
            const name = String(new FormData(form).get("name")).trim();
            const list = readStored(SQL_FAVORITES).filter((one) => one.name !== name);
            list.unshift({ name, sql });
            localStorage.setItem(SQL_FAVORITES, JSON.stringify(list));
            return { message : `Saved ${name}` };
        },
    });
}

function forgetSql(at) {
    const list = readStored(SQL_FAVORITES);
    list.splice(Number(at), 1);
    localStorage.setItem(SQL_FAVORITES, JSON.stringify(list));
    renderSqlMenus();
}

async function clearSqlHistory() {
    if (await ask({ title : `Clear ${browse.db}'s history?`, text : "The queries run in it are forgotten. The favorites stay.", ok : "Clear", danger : true })) {
        localStorage.setItem(SQL_HISTORY, JSON.stringify(readStored(SQL_HISTORY).filter((one) => one.db !== browse.db)));
    }
}

// ------------------------------------------------------------ autocomplete ---

/** Words to offer that the paint doesn't need, and the functions most used. */
const SQL_MORE = `ANALYZE AFTER ALGORITHM AVG_ROW_LENGTH BINARY CASCADE CHARSET COLUMNS COMMENT DATA DUPLICATE ENUM EVENT EXPLAIN FIRST
    FLUSH FULLTEXT GLOBAL GRANTS HANDLER INDEXES LOCAL MATCH AGAINST NATURAL OPTIMIZE PARTITION PRIVILEGES PROCESSLIST REPAIR
    RESTRICT ROLLUP SCHEMA SESSION STATUS STRAIGHT_JOIN TEMPORARY VARIABLES WARNINGS`.split(/\s+/);
const SQL_FUNCTIONS = `ABS AVG CAST CEIL COALESCE CONCAT CONCAT_WS CONVERT COUNT CURDATE CURRENT_TIMESTAMP DATE DATE_ADD DATE_FORMAT
    DATE_SUB DATEDIFF DAY FIND_IN_SET FLOOR FROM_UNIXTIME GREATEST GROUP_CONCAT HOUR IF IFNULL INSTR JSON_ARRAY JSON_CONTAINS
    JSON_EXTRACT JSON_OBJECT JSON_UNQUOTE JSON_VALUE LAST_INSERT_ID LEAST LEFT LENGTH CHAR_LENGTH LOCATE LOWER LPAD LTRIM MAX
    MD5 MIN MINUTE MONTH NOW NULLIF RAND REGEXP_REPLACE REPLACE RIGHT ROUND ROW_NUMBER RPAD RTRIM SECOND SHA2 SUBSTRING
    SUBSTRING_INDEX SUM TIMESTAMPDIFF TRIM TRUNCATE UNIX_TIMESTAMP UPPER UUID YEAR`.split(/\s+/);
// After these, a table is what comes.
const TABLE_AFTER = /\b(FROM|JOIN|INTO|UPDATE|TABLE|DESCRIBE|DESC|TRUNCATE)\s+(?:`?[\w$]+`?\s*,\s*)*$/i;

/** The columns of the tables asked for, read once each, by database and table. */
const columnCache = new Map();
function columnsOf(table) {
    const key = `${browse.db}.${table}`;
    if (!columnCache.has(key)) {
        columnCache.set(key, null);
        api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${encodeURIComponent(table)}`)
            .then((structure) => {
                columnCache.set(key, structure.columns);
                // The list shows them once they come, if the box is still being typed in.
                if (document.activeElement?.id === "sql-text") {
                    showCompletion();
                }
            })
            .catch(() => columnCache.set(key, []));
    }
    return columnCache.get(key) || [];
}

/** Whether the cursor is in a text in quotes or a comment, where nothing is offered. */
function inQuoteOrComment(text, caret) {
    for (let at = 0; at < caret; at++) {
        const char = text[at];
        if (char === "'" || char === "\"") {
            for (at++; at < caret && text[at] !== char; at++) {
                if (text[at] === "\\") {
                    at++;
                }
            }
            if (at >= caret) {
                return true;
            }
        } else if (char === "#" || char === "-" && text[at + 1] === "-") {
            const end = text.indexOf("\n", at);
            if (end < 0 || end >= caret) {
                return true;
            }
            at = end;
        } else if (char === "/" && text[at + 1] === "*") {
            const end = text.indexOf("*/", at + 2);
            if (end < 0 || end + 2 > caret) {
                return true;
            }
            at = end + 1;
        }
    }
    return false;
}

/** The tables a statement names, by themselves and by their aliases: FROM t, JOIN t AS x, UPDATE t x. */
function tablesIn(statement) {
    const names = new Map();
    const known = new Set(browse.tables.map((one) => one.name));
    for (const found of statement.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:`((?:[^`]|``)+)`|([\w$]+))(?:\s+(?:AS\s+)?`?([\w$]+)`?)?/gi)) {
        const table = found[1] ? found[1].replace(/``/g, "`") : found[2];
        const alias = found[3];
        if (!known.has(table)) {
            continue;
        }
        names.set(table, table);
        if (alias && !SQL_WORDS.has(alias.toUpperCase()) && !SQL_MORE.includes(alias.toUpperCase())) {
            names.set(alias, table);
        }
    }
    return names;
}

let completion = null;

/**
 * What to offer where the cursor is, as it types: after "x.", the columns
 * of x, by its name or alias; after FROM and the like, the tables; else the
 * columns of the statement's tables, then the tables, the words and the
 * functions, the ones starting with what is typed first.
 * @param {boolean} [asked] With ⌃Space, offered even before anything is typed.
 */
function showCompletion(asked = false) {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const caret = text.selectionStart;
    if (text.selectionStart !== text.selectionEnd || inQuoteOrComment(text.value, caret)) {
        return hideCompletion();
    }
    const before = text.value.slice(0, caret);
    const [ , owner = "", word ] = before.match(/(?:`?([\w$]+)`?\.)?`?([\w$]*)$/);
    if (!word && !owner && !asked) {
        return hideCompletion();
    }
    const statement = statementsOf(text.value).find((one) => caret >= one.start && caret <= one.end + 1);
    const tables    = tablesIn(statement ? text.value.slice(statement.start, statement.end) : text.value);
    const typed     = word.toLowerCase();
    const lower     = word && word === word.toLowerCase();
    let items = [];
    if (owner) {
        const table = tables.get(owner) || browse.tables.find((one) => one.name === owner)?.name;
        items = table ? columnsOf(table).map((column) => ({ text : column.name, kind : column.type, name : true })) : [];
    } else {
        const tableItems = browse.tables.map((one) => ({ text : one.name, kind : one.view ? "view" : "table", name : true }));
        // A backtick opening the name doesn't hide the FROM before it.
        if (TABLE_AFTER.test(before.slice(0, before.length - word.length).replace(/`$/, ""))) {
            items = tableItems;
        } else {
            const columns = [ ...new Set(tables.values()) ].flatMap((table) => columnsOf(table).map((column) => ({ text : column.name, kind : `${column.type} · ${table}`, name : true })));
            const words   = [ ...new Set([ ...SQL_WORDS, ...SQL_MORE ]) ].map((one) => ({ text : lower ? one.toLowerCase() : one, kind : "keyword" }));
            const calls   = SQL_FUNCTIONS.map((one) => ({ text : `${lower ? one.toLowerCase() : one}()`, kind : "function", call : true }));
            items = [ ...columns, ...tableItems, ...words, ...calls ];
        }
    }
    // Starting with what is typed first, then holding it; what is typed whole already, left out.
    const starts = items.filter((one) => one.text.toLowerCase().startsWith(typed));
    const holds  = typed.length > 1 ? items.filter((one) => !one.text.toLowerCase().startsWith(typed) && one.text.toLowerCase().includes(typed)) : [];
    const seen   = new Set();
    const shown  = [ ...starts, ...holds ].filter((one) => {
        const key = `${one.text}|${one.kind}`;
        const same = one.text.toLowerCase() === typed || one.call && one.text.toLowerCase() === `${typed}()`;
        return !seen.has(key) && seen.add(key) && !same;
    }).slice(0, 60);
    if (!shown.length) {
        return hideCompletion();
    }
    const box = document.getElementById("sql-complete");
    completion = { items : shown, at : 0, from : caret - word.length - (/`$/.test(before.slice(0, caret - word.length)) ? 1 : 0), to : caret };
    box.innerHTML = shown.map((one, at) => `
        <button type="button" role="option" data-complete="${at}" class="${at ? "" : "active"}" tabindex="-1">
            <span class="complete-text">${esc(one.text)}</span><span class="complete-kind">${esc(one.kind)}</span>
        </button>
    `).join("");
    box.hidden = false;
    placeCompletion(text, completion.from);
}

/** Puts the list under the word, from where the text box draws it, kept in the window. */
function placeCompletion(text, at) {
    const box    = document.getElementById("sql-complete");
    const mirror = document.createElement("div");
    const style  = getComputedStyle(text);
    for (const name of [ "font", "letterSpacing", "padding", "border", "boxSizing", "whiteSpace", "overflowWrap", "wordBreak", "tabSize", "lineHeight" ]) {
        mirror.style[name] = style[name];
    }
    Object.assign(mirror.style, { position : "absolute", visibility : "hidden", top : "0", left : "-9999px", width : `${text.clientWidth}px` });
    mirror.textContent = text.value.slice(0, at);
    const mark = document.createElement("span");
    mark.textContent = "​";
    mirror.append(mark);
    document.body.append(mirror);
    const area = text.getBoundingClientRect();
    const x    = area.left + mark.offsetLeft - text.scrollLeft;
    const y    = area.top + mark.offsetTop - text.scrollTop + parseFloat(style.lineHeight);
    mirror.remove();
    box.style.left = `${Math.max(8, Math.min(x - 10, innerWidth - box.offsetWidth - 8))}px`;
    // Above the line when there is no room under it.
    box.style.top  = `${y + 4 + box.offsetHeight > innerHeight - 8 ? y - parseFloat(style.lineHeight) - box.offsetHeight - 4 : y + 4}px`;
}

function hideCompletion() {
    completion = null;
    document.getElementById("sql-complete").hidden = true;
}

function stepCompletion(by) {
    const box = document.getElementById("sql-complete");
    completion.at = (completion.at + by + completion.items.length) % completion.items.length;
    box.querySelector(".active")?.classList.remove("active");
    const button = box.querySelector(`[data-complete="${completion.at}"]`);
    button.classList.add("active");
    button.scrollIntoView({ block : "nearest" });
}

/** Puts the item picked in place of the word typed: a name in backticks when it needs them, a function's cursor in its brackets. */
function acceptCompletion(at = completion.at) {
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const item = completion.items[at];
    const bare = /^[A-Za-z_][\w$]*$/.test(item.text) && !SQL_WORDS.has(item.text.toUpperCase());
    const put  = item.name && !bare ? `\`${item.text.replace(/`/g, "``")}\`` : item.text;
    // A backtick typed before the word is the name's own, replaced with it.
    text.setRangeText(put, completion.from, completion.to, "end");
    if (item.call) {
        text.selectionStart = text.selectionEnd = text.selectionEnd - 1;
    }
    hideCompletion();
    text.focus();
    browse.sql[browse.db] = text.value;
    paintSqlBox();
}

/**
 * The keys while the list shows: ↑ and ↓ move in it, Enter and Tab take the
 * one marked, Escape closes it; ⌃Space opens it. True when the key was its.
 */
function completionKeys(event) {
    if (event.ctrlKey && event.code === "Space") {
        event.preventDefault();
        showCompletion(true);
        return true;
    }
    if (!completion) {
        return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        stepCompletion(event.key === "ArrowDown" ? 1 : -1);
    } else if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        acceptCompletion();
    } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        hideCompletion();
    } else {
        return false;
    }
    return true;
}

// ------------------------------------------------------- export and import ---

/**
 * The export, as Sequel Ace's: from the database, the tables picked; from
 * the rows, all of the table's, the ones its filters show, or the ones
 * picked. As SQL, with the structure, the data or both; as CSV, with its
 * separator and a line of column names; or as JSON. What to export is sent
 * first, and the file then comes as a download, so the page stays.
 * @param {{ tables? : string[], rows? : "all" | "filtered" | "picked" }} start
 */
function openExportDialog({ tables = null, rows = null } = {}) {
    const fromRows = rows !== null && browse.rows;
    const picked   = fromRows ? pickedRows() : [];
    const filtered = fromRows && browse.filters.length > 0;
    const chosen   = tables || browse.tables.map((one) => one.name);
    const choice   = (value, label, on) => `<label class="check"><input type="radio" class="box" name="rows" value="${value}" ${on ? "checked" : ""}><span>${label}</span></label>`;
    const formats  = [ [ "sql", "SQL" ], [ "csv", "CSV" ], [ "json", "JSON" ] ];
    formDialog({
        title  : fromRows ? `Export rows of ${browse.table}` : `Export ${browse.db}`,
        body   : `
            <div class="export-form">
                ${fromRows ? `
                    <div class="form-row"><span>Rows</span><div class="export-choices">
                        ${choice("all", `All the table's rows`, rows === "all" || rows === "filtered" && !filtered || rows === "picked" && !picked.length)}
                        ${filtered ? choice("filtered", "The rows the filters show, in their order", rows === "filtered") : ""}
                        ${picked.length && rowsKeyed() ? choice("picked", `The ${countOf(picked.length, "row")} picked`, rows === "picked") : ""}
                    </div></div>
                ` : `
                    <div class="form-row">
                        <span>Tables <span class="muted" data-export-count></span><span class="export-all"><button type="button" class="link" data-export-all="1">All</button> · <button type="button" class="link" data-export-all="0">None</button></span></span>
                        <input type="search" class="export-filter" data-export-filter placeholder="Filter tables…" spellcheck="false" autocomplete="off">
                        <div class="export-tables-box"><div class="check-list export-tables">${browse.tables.map((one) => `
                            <label class="check"><input type="checkbox" class="box" name="tables" value="${esc(one.name)}" ${chosen.includes(one.name) ? "checked" : ""}><span>${esc(one.name)}${one.view ? ` <span class="tag">view</span>` : ""}</span></label>
                        `).join("")}</div></div>
                    </div>
                `}
                <div class="form-row"><span>Format</span><div class="segmented">${formats.map(([ value, label ], at) => `<button type="button" data-export-format="${value}" class="${at ? "" : "active"}">${label}</button>`).join("")}</div></div>
                <div class="column-checks" data-export-for="sql">
                    <label class="check"><input type="checkbox" class="box" name="structure" ${fromRows ? "" : "checked"}><span>Structure<small>CREATE TABLE${fromRows ? "" : ", views, triggers"}</small></span></label>
                    <label class="check"><input type="checkbox" class="box" name="data" checked ${fromRows ? "disabled" : ""}><span>Data<small>INSERT of the rows</small></span></label>
                </div>
                <div class="form-pair" data-export-for="csv" hidden>
                    <label class="form-row"><span>Separator</span><span class="field select"><select name="separator">
                        <option value=",">Comma ,</option><option value=";">Semicolon ;</option><option value="&#9;">Tab</option>
                    </select></span></label>
                    <label class="check export-header"><input type="checkbox" class="box" name="header" checked><span>Column names first</span></label>
                </div>
                <label class="check" data-export-gzip><input type="checkbox" class="box" name="gzip"><span>Compressed, as .gz<small data-export-gzip-note></small></span></label>
                <p class="editor-status" data-export-note></p>
            </div>
        `,
        ok     : "Export",
        ready  : (fields) => {
            const form   = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const format = () => /** @type {HTMLElement} */ (fields.querySelector("[data-export-format].active")).dataset.exportFormat;
            // Only what counts for the format shows; several tables as CSV come as a .zip, a file each.
            const update = () => {
                const kind  = format();
                const boxes = /** @type {HTMLInputElement[]} */ ([ ...fields.querySelectorAll("input[name=tables]") ]);
                const some  = boxes.filter((box) => box.checked);
                const views = some.filter((box) => browse.tables.find((one) => one.name === box.value)?.view).length;
                for (const pane of /** @type {NodeListOf<HTMLElement>} */ (fields.querySelectorAll("[data-export-for]"))) {
                    pane.hidden = pane.dataset.exportFor !== kind;
                }
                const zip = kind === "csv" && some.length - views > 1;
                /** @type {HTMLElement} */ (fields.querySelector("[data-export-gzip]")).hidden = zip;
                fields.querySelector("[data-export-gzip-note]").textContent = kind === "sql" ? "Much smaller; a .sql.gz imports here the same way" : "Much smaller";
                const count = fields.querySelector("[data-export-count]");
                if (count) {
                    count.textContent = `${some.length} of ${boxes.length}`;
                }
                fields.querySelector("[data-export-note]").textContent = [
                    zip ? "Several tables as CSV come as a .zip, a file for each." : "",
                    kind !== "sql" && views ? "Views are left out: they hold no rows of their own." : "",
                ].filter(Boolean).join(" ");
            };
            fields.addEventListener("click", (event) => {
                const button = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest("button"));
                if (button?.dataset.exportFormat) {
                    fields.querySelector("[data-export-format].active").classList.remove("active");
                    button.classList.add("active");
                } else if (button?.dataset.exportAll) {
                    // All and None go by the tables the filter shows.
                    for (const box of /** @type {NodeListOf<HTMLInputElement>} */ (fields.querySelectorAll("input[name=tables]"))) {
                        if (!box.closest("label").hidden) {
                            box.checked = button.dataset.exportAll === "1";
                        }
                    }
                }
                update();
            });
            form.addEventListener("change", update);
            // The list fades at the edges it scrolls past, once the dialog shows and has its size.
            const list = /** @type {HTMLElement} */ (fields.querySelector(".export-tables"));
            if (list) {
                requestAnimationFrame(() => watchFades(list));
            }
            fields.querySelector("[data-export-filter]")?.addEventListener("input", (event) => {
                const search = /** @type {HTMLInputElement} */ (event.target).value.trim().toLowerCase();
                for (const box of /** @type {NodeListOf<HTMLInputElement>} */ (fields.querySelectorAll("input[name=tables]"))) {
                    box.closest("label").hidden = !box.value.toLowerCase().includes(search);
                }
                fadeEdges(fields.querySelector(".export-tables"));
            });
            // Enter in the filter filters, and doesn't export.
            fields.querySelector("[data-export-filter]")?.addEventListener("keydown", (event) => {
                if (/** @type {KeyboardEvent} */ (event).key === "Enter") {
                    event.preventDefault();
                }
            });
            update();
        },
        submit : async (form) => {
            const data = new FormData(form);
            const kind = /** @type {HTMLElement} */ (form.querySelector("[data-export-format].active")).dataset.exportFormat;
            const spec = {
                action    : "db-export",
                db        : browse.db,
                format    : kind,
                structure : data.get("structure") === "on",
                data      : fromRows || data.get("data") === "on",
                separator : String(data.get("separator") || ","),
                header    : data.get("header") === "on",
                gzip      : data.get("gzip") === "on",
            };
            if (fromRows) {
                const part = String(data.get("rows"));
                Object.assign(spec, { table : browse.table, sort : browse.sort, dir : browse.dir },
                    part === "filtered" ? { filters : JSON.stringify(browse.filters), match : browse.match }
                        : part === "picked" ? { keys : picked.map(rowKey) } : { filters : "[]" });
            } else {
                spec.tables = data.getAll("tables").map(String);
            }
            const { id } = await api("/api/action", spec);
            window.location.assign(`/api/db-export?id=${encodeURIComponent(id)}`);
            return { message : "Exporting: the file downloads as it is written" };
        },
    });
}

/**
 * Imports a .sql or .sql.gz file into the database: it is sent as it is
 * read, with its progress, and MariaDB runs it as it arrives, stopping at
 * the first statement that fails.
 */
function importDatabase() {
    formDialog({
        title  : `Import into ${browse.db}`,
        text   : "Runs a .sql file, or a .sql.gz, in this database. A dump's tables replace the ones of the same name.",
        body   : `
            <label class="file-drop" data-file-drop>
                <input type="file" name="file" accept=".sql,.gz">
                <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/></svg>
                <span class="file-drop-text"><strong>Choose a .sql or .sql.gz file</strong><small>or drop it here</small></span>
            </label>
        `,
        ok     : "Import",
        danger : true,
        ready  : (fields) => setUpFileDrop(/** @type {HTMLElement} */ (fields.querySelector("[data-file-drop]"))),
        submit : async (form) => {
            const file   = /** @type {HTMLInputElement} */ (form.querySelector("[name=file]")).files[0];
            if (!file) {
                throw new Error("Choose the file to import first");
            }
            const status = document.getElementById("form-status");
            const result = await upload(`/api/db-import?${new URLSearchParams({ db : browse.db, name : file.name })}`, file, (done) => {
                status.textContent = done < 1 ? `Sending ${Math.round(done * 100)}% of ${bytes(file.size)}…` : "MariaDB is running it…";
            });
            await loadTables();
            if (browse.tab === "rows") {
                loadRows();
            }
            return result;
        },
    });
}

/** A CSV's text read into rows, as the server reads it: up to as many as asked, quotes and all. */
function parseCsv(text, separator, most = Infinity) {
    const rows = [];
    let row = [], field = "", quoted = false, inQuotes = false;
    const endField = () => {
        row.push(!quoted && field === "" ? null : field);
        field  = "";
        quoted = false;
    };
    for (let at = 0; at < text.length && rows.length < most; at++) {
        const char = text[at];
        if (inQuotes) {
            if (char !== "\"") {
                field += char;
            } else if (text[at + 1] === "\"") {
                field += "\"";
                at++;
            } else {
                inQuotes = false;
            }
        } else if (char === "\"" && field === "" && !quoted) {
            inQuotes = quoted = true;
        } else if (char === separator) {
            endField();
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[at + 1] === "\n") {
                at++;
            }
            endField();
            if (!(row.length === 1 && row[0] === null)) {
                rows.push(row);
            }
            row = [];
        } else {
            field += char;
        }
    }
    if (rows.length < most && (field !== "" || row.length)) {
        endField();
        rows.push(row);
    }
    return rows;
}

/** The separator a CSV's first line has most of, outside quotes. */
function guessSeparator(text) {
    const line   = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0].replace(/"(?:[^"]|"")*"/g, "");
    const counts = [ ",", ";", "\t", "|" ].map((one) => [ one, line.split(one).length - 1 ]);
    return counts.sort((a, b) => b[1] - a[1])[0][1] ? counts[0][0] : ",";
}

/**
 * A CSV into a table, as Sequel Ace's import: the file, its separator,
 * guessed, and whether its first line names the columns; then each of its
 * columns matched to one of the table's, by name when it names them, else
 * in order, or left out, with its first values to tell; and what a row
 * whose key is there does. It runs in one transaction.
 */
async function openCsvImport(table) {
    let structure;
    try {
        structure = await api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${encodeURIComponent(table)}`);
    } catch (error) {
        toast(error.message, true);
        return;
    }
    const targets = structure.columns.filter((column) => ![ "virtual", "stored" ].includes(column.value.kind));
    let   sample  = "";
    formDialog({
        title  : `Import a CSV into ${table}`,
        text   : "Its rows are added in one transaction: on an error, an InnoDB table stays as it was.",
        body   : `
            <label class="file-drop" data-file-drop>
                <input type="file" name="file" accept=".csv,.tsv,.txt,text/csv">
                <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/></svg>
                <span class="file-drop-text"><strong>Choose a .csv file</strong><small>or drop it here</small></span>
            </label>
            <div class="form-pair">
                <label class="form-row"><span>Separator</span><span class="field select"><select name="separator">
                    <option value=",">Comma ,</option><option value=";">Semicolon ;</option><option value="&#9;">Tab</option><option value="|">Bar |</option>
                </select></span></label>
                <label class="form-row"><span>If a row's key is there already</span><span class="field select"><select name="duplicate">
                    <option value="error">Stop, importing nothing</option><option value="skip">Skip that row</option><option value="update">Update that row</option>
                </select></span></label>
            </div>
            <label class="check"><input type="checkbox" class="box" name="header" checked><span>The first line names the columns</span></label>
            <div class="csv-map" data-csv-map></div>
        `,
        ok     : "Import",
        ready  : (fields) => {
            const form = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const map  = /** @type {HTMLElement} */ (fields.querySelector("[data-csv-map]"));
            // The file's columns, each with its first values and the table's column it goes to.
            const draw = (fresh) => {
                if (!sample) {
                    map.innerHTML = "";
                    return;
                }
                const separator = /** @type {HTMLSelectElement} */ (form.elements.namedItem("separator")).value;
                const header    = /** @type {HTMLInputElement} */ (form.elements.namedItem("header")).checked;
                const rows      = parseCsv(sample, separator, 6);
                const width     = Math.max(0, ...rows.map((row) => row.length));
                const names     = header ? rows[0] || [] : [];
                const values    = header ? rows.slice(1) : rows;
                const kept      = fresh ? [] : [ ...map.querySelectorAll("select") ].map((one) => /** @type {HTMLSelectElement} */ (one).value);
                const byName    = names.some((name) => targets.some((column) => column.name.toLowerCase() === String(name ?? "").trim().toLowerCase()));
                map.innerHTML = `
                    <div class="csv-map-head"><span>In the file</span><span>Into ${esc(table)}</span></div>
                    ${Array.from({ length : width }, (_, at) => {
                        const name   = String(names[at] ?? "").trim();
                        const guess  = byName ? targets.find((column) => column.name.toLowerCase() === name.toLowerCase())?.name || "" : targets[at]?.name || "";
                        const picked = fresh ? guess : kept[at] ?? guess;
                        const shown  = values.map((row) => row[at]).filter((value) => value !== undefined).slice(0, 3).map((value) => (value === null ? "NULL" : value.replace(/\s+/g, " "))).join(" · ");
                        return `
                            <div class="csv-map-row">
                                <div class="csv-map-file"><strong>${esc(name || `Column ${at + 1}`)}</strong><small>${esc(shown) || "empty"}</small></div>
                                <span class="field select"><select data-csv-column="${at}">
                                    <option value="">Leave out</option>
                                    ${targets.map((column) => `<option value="${esc(column.name)}" ${column.name === picked ? "selected" : ""}>${esc(column.name)} · ${esc(column.type)}</option>`).join("")}
                                </select></span>
                            </div>
                        `;
                    }).join("")}
                `;
            };
            setUpFileDrop(/** @type {HTMLElement} */ (fields.querySelector("[data-file-drop]")), async (file) => {
                // The start of the file is enough to see its columns.
                sample = await file.slice(0, 64 * 1024).text();
                /** @type {HTMLSelectElement} */ (form.elements.namedItem("separator")).value = guessSeparator(sample);
                draw(true);
            });
            form.elements.namedItem("separator").addEventListener("change", () => draw(true));
            form.elements.namedItem("header").addEventListener("change", () => draw(true));
        },
        submit : async (form) => {
            const file = /** @type {HTMLInputElement} */ (form.querySelector("[name=file]")).files[0];
            if (!file) {
                throw new Error("Choose the file to import first");
            }
            const data    = new FormData(form);
            const mapping = [ ...form.querySelectorAll("[data-csv-column]") ].map((one) => /** @type {HTMLSelectElement} */ (one).value || null);
            const spec    = { separator : String(data.get("separator")), header : data.get("header") === "on", duplicate : String(data.get("duplicate")), mapping };
            const status  = document.getElementById("form-status");
            const result  = await upload(`/api/db-import-csv?${new URLSearchParams({ db : browse.db, table, spec : JSON.stringify(spec) })}`, file, (done) => {
                status.textContent = done < 1 ? `Sending ${Math.round(done * 100)}% of ${bytes(file.size)}…` : "MariaDB is adding the rows…";
            });
            await loadTables();
            if (browse.tab === "rows" && browse.table === table) {
                loadRows();
            }
            return result;
        },
    });
}

/**
 * A file box: the file picked or dropped shows by its name and size, and
 * goes to the function given, if any.
 * @param {HTMLElement} box @param {((file : File) => void) | null} [picked]
 */
function setUpFileDrop(box, picked = null) {
    const input = /** @type {HTMLInputElement} */ (box.querySelector("input"));
    const empty = box.querySelector("strong").textContent;
    const show  = () => {
        const file = input.files[0];
        box.classList.toggle("chosen", Boolean(file));
        box.querySelector("strong").textContent = file ? file.name : empty;
        if (file) {
            picked?.(file);
        }
        box.querySelector("small").textContent  = file ? `${bytes(file.size)} · click to pick another` : "or drop it here";
    };
    input.addEventListener("change", show);
    box.addEventListener("dragover", (event) => {
        event.preventDefault();
        box.classList.add("over");
    });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (event) => {
        event.preventDefault();
        box.classList.remove("over");
        if (event.dataTransfer.files.length) {
            input.files = event.dataTransfer.files;
            show();
        }
    });
}

/** Sends a file as a request's body, saying how much has gone; fetch cannot tell. */
function upload(url, file, progress) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", url);
        request.setRequestHeader("X-Studio", "1");
        request.upload.onprogress = (event) => progress(event.loaded / event.total);
        request.upload.onload     = () => progress(1);
        request.onload  = () => {
            const data = JSON.parse(request.responseText || "{}");
            if (request.status === 200) {
                resolve(data);
            } else {
                reject(new Error(data.error || request.statusText));
            }
        };
        request.onerror = () => reject(new Error("The file could not be sent"));
        request.send(file);
    });
}
