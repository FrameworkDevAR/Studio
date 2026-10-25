"use strict";

// What runs once every script is in: the listeners, the first draw and the timers. Loaded last.

const IS_MAC = /Mac/.test(navigator.platform);
document.addEventListener("click", onClick);
window.addEventListener("popstate", route);
window.addEventListener("scroll", () => {
    document.body.classList.toggle("scrolled", window.scrollY > 4);
}, { passive : true });
document.getElementById("log").addEventListener("scroll", showLogBottom, { passive : true });
const columnWatch = new ResizeObserver((entries) => entries.forEach((entry) => markColumnEnds(entry.target)));
columnWatch.observe(document.getElementById("php-extensions"));
columnWatch.observe(document.getElementById("node-globals"));
columnWatch.observe(document.getElementById("apache-configs-pane"));
// A click outside the dialog, on its backdrop, is a Cancel.
document.getElementById("ask").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
        /** @type {HTMLDialogElement} */ (event.currentTarget).close("cancel");
    }
});
document.getElementById("node-filter").addEventListener("input", renderNode);
document.getElementById("php-ext-filter").addEventListener("input", renderExtensions);
document.getElementById("db-filter").addEventListener("input", renderDbList);
document.getElementById("user-filter").addEventListener("input", renderUsers);
document.getElementById("table-filter").addEventListener("input", renderTableList);
// The databases to switch to, from the title, filtered as typed, with ↑, ↓ and Enter.
document.getElementById("db-switch-filter").addEventListener("input", () => renderDbSwitch(0));
document.getElementById("db-switch-filter").addEventListener("keydown", dbSwitchKeys);
// A menu closes once an item is picked, or on a click outside it, or Escape.
document.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    // A button a menu drew anew on its click is gone from the page, and the menu stays.
    if (target.isConnected && (!target.closest(".menu-wrap, [data-table-menu]") || target.closest(".menu [role=menuitem]"))) {
        closeMenus();
    }
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeMenus();
    }
});
// ↑ and ↓ change the table, and Enter in the filter opens the one marked or the first it shows.
document.addEventListener("keydown", tableKeys);
// A click in the list gives it the keys; one on a grid's row marks it and gives the grid them; one elsewhere, nothing.
document.addEventListener("pointerdown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!target.closest(".browse")) {
        return;
    }
    const row  = /** @type {HTMLElement} */ (target.closest(".browse-main .data-grid[id] tbody tr[data-key]"));
    const grid = target.closest(".browse-main .grid-scroll")?.querySelector(".data-grid[id]");
    // A right click, or a Control click on a Mac, is the menu's: a row of the ones marked keeps them, for it to act on all.
    const menuClick = event.button !== 0 || IS_MAC && event.ctrlKey;
    if (row && !(menuClick && row.classList.contains("selected"))) {
        // ⌘ (Ctrl elsewhere) adds a row to the ones marked or takes it out, and ⇧ marks all up to it.
        pickRow(row, menuClick ? "" : (IS_MAC ? event.metaKey : event.ctrlKey) ? "toggle" : event.shiftKey ? "range" : "");
    }
    focusKeys(target.closest(".browse-aside") ? "list" : grid ? grid.id : "");
});
// Tabbing into the list's filter gives the list the keys, and into another field, takes them.
document.addEventListener("focusin", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest?.(".browse-aside")) {
        focusKeys("list");
    } else if (target.closest?.(".browse") && target.matches("input, textarea, select")) {
        focusKeys("");
    }
});
window.addEventListener("focus", () => focusKeys(keysTo));
window.addEventListener("blur", () => focusKeys(keysTo));
document.getElementById("table-filter").addEventListener("keydown", (event) => {
    const link = /** @type {HTMLAnchorElement} */ (document.querySelector("#browse-tables .table-link.active") || document.querySelector("#browse-tables .table-link"));
    if (event.key === "Enter" && link) {
        event.preventDefault();
        navigate(new URL(link.href).pathname);
    }
});
// The filters: Enter or Filter applies them, and an operator shows the fields it needs.
document.getElementById("rows-filters").addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters();
});
document.getElementById("rows-filters").addEventListener("change", (event) => {
    const field = /** @type {HTMLSelectElement} */ (event.target);
    if (field.dataset.f === "op") {
        changeFilterOp(field);
    } else if (field.dataset.f === "on") {
        // A rule turned on or off filters again at once.
        field.closest(".filter-rule").classList.toggle("off", !(/** @type {any} */ (field)).checked);
        applyFilters();
    } else {
        showFilterSql();
    }
});
document.getElementById("rows-filters").addEventListener("input", showFilterSql);
document.getElementById("column-filter").addEventListener("input", () => renderRows());
// A column's edge drags to resize it, and a double click fits the columns again.
document.addEventListener("pointerdown", (event) => {
    if (/** @type {HTMLElement} */ (event.target).matches("[data-resize]")) {
        startResize(event);
    }
});
document.addEventListener("dblclick", (event) => {
    const handle = /** @type {HTMLElement} */ (event.target);
    if (handle.matches("[data-resize]")) {
        resetWidths(handle.closest("table"));
    }
});
// A cell opens to change in place with a double click, and the row's tools to change it whole.
document.getElementById("rows-grid").addEventListener("dblclick", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const cell   = /** @type {HTMLElement} */ (target.closest("td[data-at]"));
    const row    = /** @type {HTMLElement} */ (target.closest("tr[data-row]"));
    if (target.closest("input, button")) {
        return;
    }
    if (cell && rowsKeyed()) {
        // A cell changes where it is, as in Sequel Ace; its text isn't left picked by the double click.
        getSelection().removeAllRanges();
        editCell(cell);
    } else if (row && rowsKeyed()) {
        openRowDialog(Number(row.dataset.row));
    }
});
// A right click on a row marks it and opens its menu, with the cell's column; one in a cell being changed is the field's own.
document.getElementById("rows-grid").addEventListener("contextmenu", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const cell   = /** @type {HTMLElement} */ (target.closest("td[data-at]"));
    const row    = /** @type {HTMLElement} */ (target.closest("tbody tr[data-row]"));
    if (!row || target.closest("input")) {
        return;
    }
    event.preventDefault();
    // A row of the ones marked keeps them, for the menu to act on all.
    if (!row.classList.contains("selected")) {
        pickRow(row);
    }
    focusKeys("rows-grid");
    const picked = pickedRows();
    openRowMenu(picked.length ? picked : [ Number(row.dataset.row) ], cell ? Number(cell.dataset.at) : -1, event.clientX, event.clientY);
});
// ⇧ and ⌘ clicks mark rows, not the text in them.
document.getElementById("overview-grid").addEventListener("mousedown", (event) => {
    if (event.button === 0 && (event.shiftKey || event.metaKey || event.ctrlKey) && /** @type {HTMLElement} */ (event.target).closest("tbody tr[data-key]")) {
        event.preventDefault();
    }
});
document.getElementById("rows-grid").addEventListener("mousedown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (event.button === 0 && (event.shiftKey || event.metaKey || event.ctrlKey) && target.closest("tbody tr[data-row]") && !target.closest("input, textarea, select")) {
        event.preventDefault();
    }
});
// In the rows grid, ⌘A marks the page's rows, ⌘C copies the ones marked, and ⌫ deletes them, once asked.
document.addEventListener("keydown", (event) => {
    const target  = /** @type {HTMLElement} */ (event.target);
    const command = event.metaKey || event.ctrlKey;
    if (keysTo !== "rows-grid" || currentView() !== "database" || browse.tab !== "rows" || !browse.rows || event.altKey
        || document.querySelector("dialog[open]") || target.matches("input, textarea, select, [contenteditable]")) {
        return;
    }
    if (command && event.key === "a") {
        event.preventDefault();
        pickAllRows();
    } else if (command && event.key === "c" && getSelection().isCollapsed && pickedRows().length) {
        event.preventDefault();
        rowMenu = { indexes : pickedRows(), at : -1 };
        rowAction("copy");
    } else if ((event.key === "Backspace" || event.key === "Delete") && !event.shiftKey && pickedRows().length && rowsKeyed()) {
        event.preventDefault();
        deleteRows(pickedRows());
    }
});
// A table has its menu on a right click, in the Tables tab and in the side's list.
document.getElementById("overview-grid").addEventListener("contextmenu", (event) => {
    const row = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest("tbody tr[data-key]"));
    if (!row) {
        return;
    }
    event.preventDefault();
    // A table of the ones marked keeps them, for the menu to act on all.
    if (!row.classList.contains("selected")) {
        pickRow(row);
    }
    focusKeys("overview-grid");
    const picked = pickedTables();
    openTableMenu(row.dataset.key, event.clientX, event.clientY, picked.length ? picked : [ row.dataset.key ]);
});
document.getElementById("browse-tables").addEventListener("contextmenu", (event) => {
    const link = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest(".table-link"));
    if (!link) {
        return;
    }
    event.preventDefault();
    openTableMenu(link.dataset.table, event.clientX, event.clientY);
});
// A column changes with a double click, and has its menu on a right click, unless the table is a view.
// A column's cell changes in place with a double click, and its extra opens its dialog.
document.getElementById("browse-structure").addEventListener("dblclick", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const row    = /** @type {HTMLElement} */ (target.closest("#structure-grid tbody tr[data-key]"));
    if (!row || structureIsView() || target.closest("input, select")) {
        return;
    }
    getSelection().removeAllRanges();
    editColumnCell(/** @type {HTMLElement} */ (target.closest("td")));
});
document.getElementById("browse-structure").addEventListener("contextmenu", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const row    = /** @type {HTMLElement} */ (target.closest("#structure-grid tbody tr[data-key]"));
    if (!row || structureIsView() || target.closest("input, select")) {
        return;
    }
    event.preventDefault();
    pickRow(row);
    focusKeys("structure-grid");
    openColumnMenu(row.dataset.key, event.clientX, event.clientY);
});
// A column drags by its row to another place; the line it would land on shows as it goes.
const structureBox = document.getElementById("browse-structure");
const clearDrop    = () => structureBox.querySelectorAll(".drop-above, .drop-below").forEach((one) => one.classList.remove("drop-above", "drop-below"));
structureBox.addEventListener("dragstart", (event) => {
    const row = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest?.("#structure-grid tbody tr[draggable=true]"));
    if (!row) {
        return;
    }
    columnDrag = row.dataset.key;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnDrag);
    row.classList.add("dragging");
});
structureBox.addEventListener("dragover", (event) => {
    const row = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest?.("#structure-grid tbody tr[data-key]"));
    if (!row || !columnDrag) {
        return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const box   = row.getBoundingClientRect();
    const below = event.clientY > box.top + box.height / 2;
    if (!row.classList.contains(below ? "drop-below" : "drop-above")) {
        clearDrop();
        row.classList.add(below ? "drop-below" : "drop-above");
    }
});
structureBox.addEventListener("drop", (event) => {
    const row = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest?.("#structure-grid tbody tr[data-key]"));
    if (!row || !columnDrag) {
        return;
    }
    event.preventDefault();
    dropColumnAt(row, row.classList.contains("drop-below"));
    clearDrop();
});
structureBox.addEventListener("dragend", () => {
    columnDrag = "";
    clearDrop();
    structureBox.querySelector(".dragging")?.classList.remove("dragging");
});
// The row's menu stays where it opened, so it closes when the page or the grid scrolls.
document.addEventListener("scroll", () => {
    document.getElementById("row-menu").hidden = true;
}, true);
// ⌘↩ runs the SQL, ⇧⌘↩ the statement the cursor is in, and Tab indents it rather than leaving the box.
document.getElementById("sql-text").addEventListener("keydown", (event) => {
    const text = /** @type {HTMLTextAreaElement} */ (event.target);
    // The autocomplete's keys first, while its list shows.
    if (completionKeys(event)) {
        return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        // With ⇧, only the statement the cursor is in.
        event.preventDefault();
        runSql(event.shiftKey ? "current" : "all");
    } else if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        text.setRangeText("    ", text.selectionStart, text.selectionEnd, "end");
        paintSqlBox();
    }
});
// The list of words to complete follows the typing, and goes on a click, a move or leaving the box.
document.getElementById("sql-text").addEventListener("input", (event) => {
    const typed = /** @type {InputEvent} */ (event).data;
    if (typed && /[\w$.`]/.test(typed.slice(-1)) || completion && /** @type {InputEvent} */ (event).inputType === "deleteContentBackward") {
        showCompletion();
    } else {
        hideCompletion();
    }
});
document.getElementById("sql-text").addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement?.id !== "sql-text") {
        hideCompletion();
    }
}, 100));
document.getElementById("sql-text").addEventListener("mousedown", hideCompletion);
document.getElementById("sql-text").addEventListener("scroll", hideCompletion);
// A click on the list takes the word, and the box keeps the focus.
document.getElementById("sql-complete").addEventListener("mousedown", (event) => {
    event.preventDefault();
    const button = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest("[data-complete]"));
    if (button && completion) {
        acceptCompletion(Number(button.dataset.complete));
    }
});
// The paint follows the text, and Run says when it runs a selection only.
for (const name of [ "input", "scroll", "select", "keyup", "mouseup" ]) {
    document.getElementById("sql-text").addEventListener(name, paintSqlBox);
}
// And it wraps again as the box changes width, or first shows.
new ResizeObserver(paintSqlBox).observe(document.getElementById("sql-text"));
// A foreign key opens to change on a click on its line, but on its table's link or its drop button.
document.getElementById("browse-structure").addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const line   = /** @type {HTMLElement} */ (target.closest("[data-fk-edit]"));
    if (line && !target.closest("a, button")) {
        openForeignKeyDialog(line.dataset.fkEdit);
    }
});
// A value of an editable result changes in place with a double click.
document.getElementById("sql-results").addEventListener("dblclick", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const cell   = /** @type {HTMLElement} */ (target.closest("td[data-at]"));
    if (cell && !target.closest("input, button") && cell.closest("table.editable")) {
        getSelection().removeAllRanges();
        editResultCell(cell);
    }
});
document.getElementById("overview-filter").addEventListener("input", renderOverview);
document.getElementById("npm-search").addEventListener("input", () => searchNpm());
// Enter searches at once, or installs a package named with its version.
document.getElementById("npm-search").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = /** @type {HTMLInputElement} */ (document.querySelector("#npm-search input")).value.trim();
    if (/.@/.test(text)) {
        installNpm(text);
    } else {
        searchNpm(true);
    }
});
document.getElementById("pecl-search").addEventListener("input", () => searchPecl());
document.getElementById("pecl-search").addEventListener("submit", (event) => {
    event.preventDefault();
    searchPecl(true);
});
document.getElementById("pick-filter").addEventListener("input", () => renderPickList());
// Enter in the filter picks the first setting it shows.
document.getElementById("pick-filter").addEventListener("keydown", (event) => {
    const first = /** @type {HTMLElement} */ (document.querySelector("#pick-list [data-pick-key]"));
    if (event.key === "Enter" && first) {
        event.preventDefault();
        choosePick(first.dataset.pickKey);
    }
});
document.getElementById("pick-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitPick();
});
document.getElementById("pick").addEventListener("close", () => finishPick(null));
document.getElementById("module-search").addEventListener("input", renderModules);
let searchTimer = null;
document.getElementById("log-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadLog(), 150);
});

setUpPillTabs();
// Links from before the paths, like /#/sites, still land on their view.
if (location.hash.startsWith("#/")) {
    history.replaceState(null, "", location.hash.slice(1));
}
route();
refresh();
loadRecentErrors();

setInterval(refresh, REFRESH_MS);
setInterval(() => {
    if (currentView() === "logs" && isPressed("log-follow")) {
        loadLog();
    }
}, REFRESH_MS);
setInterval(loadRecentErrors, REFRESH_MS * 3);
