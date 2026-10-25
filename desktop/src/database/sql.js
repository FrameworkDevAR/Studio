"use strict";

// SQL to run: its statements, its results, changed in place when they can be, and the
// queries run before and kept.

// --------------------------------------------------------------------- sql ---

/**
 * A result of the SQL run: its statement, its columns and its rows, null for NULL, whether there
 * were more than these, and, when its rows change in place, its table, its primary key and each
 * column as the table's.
 * @typedef {{ statement: string, columns: string[], rows: string[][], more: boolean,
 *     edit: { db: string, table: string, primary: string[], columns: { name: string,
 *     binary: boolean, dataType: string, generated: boolean }[] } }} SqlResultSet
 */

/**
 * The console: the SQL typed for this database, or a SELECT of the table to start from.
 * @returns {void}
 */
function openSql() {
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    text.value = browse.sql[browse.db]
        ?? (browse.table ? `SELECT * FROM \`${browse.table}\` LIMIT 50;` : "");
    paintSqlBox();
    text.focus();
}

/** The words SQL is written with, painted as such. */
const SQL_WORDS = new Set(`
    ADD ALL ALTER AND ANY AS ASC AUTO_INCREMENT BEGIN BETWEEN BY CASE CHANGE CHARACTER CHECK COLLATE
    COLUMN COMMIT CONSTRAINT CREATE CROSS DATABASE DATABASES DEFAULT DELETE DESC DESCRIBE DISTINCT
    DO DROP ELSE END ENGINE EXISTS EXPLAIN FALSE FOREIGN FROM FULL FUNCTION GRANT GROUP HAVING IF
    IGNORE IN INDEX INNER INSERT INTERVAL INTO IS JOIN KEY KEYS LEFT LIKE LIMIT LOCK MODIFY NOT NULL
    OFFSET ON OR ORDER OUTER PRIMARY PROCEDURE REFERENCES REGEXP RENAME REPLACE RIGHT ROLLBACK
    SELECT SET SHOW START TABLE TABLES THEN TO TRANSACTION TRIGGER TRUE TRUNCATE UNION UNIQUE UNLOCK
    UNSIGNED UPDATE USE USING VALUES VIEW WHEN WHERE WITH
`.trim().split(/\s+/));

/**
 * SQL painted: comments, texts in quotes, names in backticks, numbers and
 * the words it is written with, the rest as typed.
 * @param {string} text
 * @returns {string}
 */
function paintSql(text) {
    const parts = new RegExp(
        /(--[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|/.source +
        /('(?:\\.|''|[^'\\])*'?|"(?:\\.|""|[^"\\])*"?)|/.source +
        /(`[^`]*`?)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]+)\b/.source,
        "g",
    );
    let result = "";
    let last   = 0;
    for (const found of text.matchAll(parts)) {
        const [ part, comment, quoted, name, number, word ] = found;
        const kind = comment ? "code-mark" : quoted ? "code-string" : name ? "code-key"
            : number ? "code-number"
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
 * @returns {void}
 */
function paintSqlBox() {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const paint = document.getElementById("sql-paint");
    let   open  = "";
    paint.innerHTML = paintSql(text.value).split("\n").map((line) => {
        const html = `${open}${line}`;
        const last = html.lastIndexOf("<span");
        open = last > html.lastIndexOf("</span>")
            ? html.slice(last, html.indexOf(">", last) + 1)
            : "";
        return `<div class="sql-line">${html || "\u200b"}${open ? "</span>" : ""}</div>`;
    }).join("");
    // As wide as the text inside the box, less a scrollbar, so lines wrap at the same place.
    paint.style.width     = `${text.clientWidth}px`;
    paint.style.transform = `translateY(${-text.scrollTop}px)`;
    document.getElementById("sql-run-label").textContent =
        text.selectionStart !== text.selectionEnd ? "Run selection" : "Run all";
}

/**
 * The statements in the SQL, by where each starts and ends: split at each
 * ; outside quotes, backticks and comments, the empty ones left out.
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
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

/**
 * The statement the cursor is in, or, after the last one, that one.
 * @returns {string}
 */
function currentStatement() {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const caret = text.selectionStart;
    const list  = statementsOf(text.value);
    const one   = list.find((statement) => caret >= statement.start && caret <= statement.end + 1)
        || list.filter((statement) => statement.start <= caret).at(-1)
        || list[0];
    return one ? text.value.slice(one.start, one.end).trim() : "";
}

/**
 * Runs the SQL: all of it, or only the part selected; the statement the
 * cursor is in; or that one's EXPLAIN. Each result shows as a grid, and
 * the last statement's changed rows and the time in the status. The SQL run
 * goes in the history; the tables are read again after, as it may have
 * made or dropped one.
 * @param {("all" | "current" | "explain")=} how
 * @returns {Promise<void>}
 */
async function runSql(how = "all") {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const status = document.getElementById("sql-status");
    const button = /** @type {HTMLButtonElement} */ (document.querySelector("[data-sql-run]"));
    const picked = text.selectionStart !== text.selectionEnd
        ? text.value.slice(text.selectionStart, text.selectionEnd)
        : "";
    let   sql    = how === "all" ? picked || text.value : picked.trim() || currentStatement();
    if (how === "explain") {
        sql = /^\s*EXPLAIN\b/i.test(sql) ? sql : `EXPLAIN ${sql.replace(/;\s*$/, "")}`;
    }
    if (!sql.trim() || button.disabled) {
        return;
    }
    browse.sql[browse.db] = text.value;
    rememberSql(sql);
    for (const one of /** @type {NodeListOf<HTMLButtonElement>} */ (
        document.querySelectorAll("[data-sql-run], [data-sql-current], [data-sql-explain]")
    )) {
        one.disabled = true;
    }
    status.className   = "editor-status";
    status.textContent = "Running…";
    try {
        const answer = await api("/api/action", { action : "db-sql", db : browse.db, sql });
        const time   = answer.time < 1000
            ? `${answer.time} ms`
            : `${(answer.time / 1000).toFixed(1)} s`;
        status.className   = "editor-status ok";
        status.textContent = `${answer.changed >= 0
            ? `${countOf(answer.changed, "row")} changed · `
            : ""}${time}`;
        browse.results = answer.results;
        renderResults();
        loadTables();
    } catch (error) {
        status.className   = "editor-status bad";
        status.textContent = error.message;
    } finally {
        for (const one of /** @type {NodeListOf<HTMLButtonElement>} */ (
            document.querySelectorAll("[data-sql-run], [data-sql-current], [data-sql-explain]")
        )) {
            one.disabled = false;
        }
    }
}

/**
 * The results, a grid each; the rows of a plain SELECT of one table change in place, as in
 * Sequel Ace.
 * @returns {void}
 */
function renderResults() {
    document.getElementById("sql-results").innerHTML = browse.results.map((result, index) => `
        <div class="sql-result">
            <div class="sql-result-head">
                <code>${esc(result.statement.length > 120
                    ? `${result.statement.slice(0, 120)}…`
                    : result.statement)}</code>
                ${result.edit ? `<span class="tag" title="Double-click a value to change it in ${
                    esc(result.edit.table)}">editable</span>` : ""}
                <span class="muted">${result.more
                    ? "the first 1000 rows"
                    : countOf(result.rows.length, "row")}</span>
                ${result.columns.length && READS.test(result.statement)
                    ? `<button class="ghost small" data-result-export="${index}"
                        title="All its rows, run again, as CSV or JSON">Export…</button>`
                    : ""}
            </div>
            ${result.rows.length ? `
                <div class="grid-wrap"><div class="grid-scroll"><table
                    class="data-grid ${result.edit ? "editable" : ""}">
                    <thead><tr>${result.columns
                        .map((name) => `<th><span class="th">${esc(name)}</span><span
                            class="col-resize" data-resize></span></th>`)
                        .join("")}</tr></thead>
                    <tbody>${result.rows
                        .map((row, at) => `<tr data-result="${index}" data-r="${at}">${row
                            .map((value, column) => resultCell(result, value, column))
                            .join("")}</tr>`)
                        .join("")}</tbody>
                </table></div></div>
            ` : ""}
        </div>
    `).join("");
    document.querySelectorAll("#sql-results .grid-scroll")
        .forEach((one) => watchFades(/** @type {HTMLElement} */ (one)));
    watchFades(/** @type {HTMLElement} */ (document.querySelector(".browse-main")));
}

// A query that only reads, whose results can be run again to export.
const READS = new RegExp(
    /^\s*(?:(?:--[^\n]*|#[^\n]*)\n\s*|\/\*[\s\S]*?\*\/\s*)*/.source +
    /(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC|VALUES|TABLE)\b/.source,
    "i",
);

/**
 * A result's rows, all of them, as the query gives them again, as CSV or JSON.
 * @param {number} index
 * @returns {void}
 */
function openResultExport(index) {
    const result = browse.results[index];
    formDialog({
        title  : "Export the results",
        text   : "The query runs again, in a transaction that can't change anything, for all its "
            + `rows${result.more ? ", not only the 1000 shown" : ""}.`,
        body   : `
            <div class="export-form">
                <div class="form-row"><span>Format</span><div class="segmented"><button
                    type="button" data-export-format="csv" class="active">CSV</button><button
                    type="button" data-export-format="json">JSON</button></div></div>
                <div class="form-pair" data-export-for="csv">
                    <label class="form-row"><span>Separator</span><span
                        class="field select"><select name="separator">
                        <option value=",">Comma ,</option><option
                            value=";">Semicolon ;</option><option value="&#9;">Tab</option>
                    </select></span></label>
                    <label class="check export-header"><input type="checkbox" class="box"
                        name="header" checked><span>Column names first</span></label>
                </div>
                <label class="check"><input type="checkbox" class="box"
                    name="gzip"><span>Compressed, as .gz</span></label>
            </div>
        `,
        ok     : "Export",
        ready  : (fields) => fields.addEventListener("click", (event) => {
            const button = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target)
                .closest("[data-export-format]"));
            if (button) {
                fields.querySelector("[data-export-format].active").classList.remove("active");
                button.classList.add("active");
                /** @type {HTMLElement} */ (fields.querySelector("[data-export-for]")).hidden =
                    button.dataset.exportFormat !== "csv";
            }
        }),
        submit : async (form) => {
            const data   = new FormData(form);
            const format = /** @type {HTMLElement} */ (
                form.querySelector("[data-export-format].active")
            ).dataset.exportFormat;
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

/**
 * A result's value, as its table's column shows it when the result is of one.
 * @param {SqlResultSet} result
 * @param {string} value
 * @param {number} at
 * @returns {string}
 */
function resultCell(result, value, at) {
    const column = result.edit?.columns[at];
    return cellOf(
        value,
        column ? { ...column, binary : false } : { binary : false, dataType : "" },
        300,
        at,
    );
}

// --------------------------------------------------------- changing results ---

let resultEdit = null;

/**
 * A result's row, by its primary key, as the server finds it.
 * @param {SqlResultSet} result
 * @param {number} r
 * @returns {Object<string, string>}
 */
function resultKey(result, r) {
    return Object.fromEntries(result.edit.primary
        .map((name) => [ name, result.rows[r][result.columns.indexOf(name)] ]));
}

/**
 * Changes a value of an editable result where it is: Enter or leaving it
 * saves, Escape doesn't, Tab goes on to the next. A long value changes in
 * a dialog; binary and generated ones only with SQL.
 * @param {HTMLElement} td
 * @returns {void}
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
        toast(
            `${column.name} is ${column.binary ? "binary" : "generated"}: change it with SQL`,
            true,
        );
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
            const place = [ ...body.querySelectorAll("td[data-at]") ].indexOf(td)
                + (event.shiftKey ? -1 : 1);
            saveResultCell(edit, () => {
                const next = /** @type {HTMLElement} */ (
                    body.querySelectorAll("td[data-at]")[place]
                );
                if (next) {
                    editResultCell(next);
                }
            });
        }
    });
    input.addEventListener("blur", () => saveResultCell(edit));
}

/**
 * Saves a result's value changed in place, if it is, and draws its cell again, then goes on, if
 * asked. One MariaDB refuses stays open, to fix.
 * @param {{ result: SqlResultSet, r: number, at: number, td: HTMLElement,
 *     input: HTMLInputElement, done: boolean }} edit
 * @param {(() => void)=} then
 * @returns {Promise<void>}
 */
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
    const cell = document.querySelector(
        `#sql-results tr[data-result="${browse.results.indexOf(result)}"][data-r="${r}"]
            td[data-at="${at}"]`,
    ) || td;
    cell.outerHTML = resultCell(result, result.rows[r][at], at);
    then?.();
}

/**
 * Saves a value of a result's row, then reads the row back, for what MariaDB made of it.
 * @param {SqlResultSet} result
 * @param {number} r
 * @param {number} at
 * @param {string} value
 * @returns {Promise<void>}
 */
async function saveResultValue(result, r, at, value) {
    const { db, table } = result.edit;
    await api("/api/action", {
        action : "db-row-save",
        db,
        table,
        key    : resultKey(result, r),
        values : { [result.columns[at]] : value },
    });
    result.rows[r][at] = value;
    try {
        const { structure, row } = await api("/api/action", {
            action : "db-row",
            db,
            table,
            key    : resultKey(result, r),
        });
        result.rows[r] = result.columns
            .map((name) => row[structure.columns.findIndex((column) => column.name === name)]);
    } catch {
        // The value as typed stays.
    }
}

/**
 * A long value of a result, changed in a dialog, in full.
 * @param {SqlResultSet} result
 * @param {number} r
 * @param {number} at
 * @returns {void}
 */
function editResultValue(result, r, at) {
    formDialog({
        title  : `Change ${result.columns[at]}`,
        text   : `In ${result.edit.table}, the row ${Object.entries(resultKey(result, r))
            .map(([ name, value ]) => `${name} ${value}`)
            .join(" · ")}.`,
        body   : `<textarea name="value" class="result-value"
            spellcheck="false">${esc(result.rows[r][at])}</textarea>`,
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

/**
 * The list kept in the browser under a key, or an empty one when there is none or it does not
 * read.
 * @param {string} key
 * @returns {Object<string, *>[]}
 */
function readStored(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
        return [];
    }
}

/**
 * The SQL run goes first in the history, once, and the oldest go past 200.
 * @param {string} sql
 * @returns {void}
 */
function rememberSql(sql) {
    const text = sql.trim();
    const list = readStored(SQL_HISTORY)
        .filter((one) => !(one.db === browse.db && one.sql === text));
    list.unshift({ db : browse.db, sql : text, at : Date.now() });
    localStorage.setItem(SQL_HISTORY, JSON.stringify(list.slice(0, 200)));
}

/**
 * A query's first line, as a menu shows it, its whole in the title.
 * @param {string} sql
 * @param {string} data The button's data attribute.
 * @param {string} meta
 * @returns {string}
 */
function sqlItem(sql, data, meta) {
    const line = sql.replace(/\s+/g, " ").trim();
    return `<button role="menuitem" ${data} title="${esc(sql)}"><span
        class="sql-menu-text">${esc(line)}</span><small>${esc(meta)}</small></button>`;
}

/**
 * How long ago, in a word or two.
 * @param {number} time
 * @returns {string}
 */
function agoOf(time) {
    const minutes = Math.round((Date.now() - time) / 60_000);
    return minutes < 1 ? "just now"
        : minutes < 60 ? `${minutes} min ago`
        : minutes < 1440 ? `${Math.round(minutes / 60)} h ago`
        : new Date(time).toLocaleDateString();
}

/**
 * The two menus, drawn as they open: this database's history, and the favorites.
 * @returns {void}
 */
function renderSqlMenus() {
    const history = readStored(SQL_HISTORY).filter((one) => one.db === browse.db).slice(0, 50);
    document.getElementById("sql-history").innerHTML = history.length
        ? `${history.map((one) => sqlItem(
            one.sql,
            `data-sql-use="history:${esc(String(one.at))}"`,
            agoOf(one.at),
        )).join("")}<hr><button role="menuitem"
            data-sql-clear>Clear ${esc(browse.db)}'s History</button>`
        : `<div class="menu-none">Nothing run in ${esc(browse.db)} yet.</div>`;
    const favorites = readStored(SQL_FAVORITES);
    document.getElementById("sql-favorites").innerHTML = `
        <button role="menuitem" data-sql-keep>Save Query…</button>
        ${favorites.length ? "<hr>" : ""}
        ${favorites.map((one, at) => `
            <div class="menu-row">
                <button role="menuitem" data-sql-use="favorite:${at}" title="${esc(one.sql)}"><span
                    class="sql-menu-name">${esc(one.name)}</span><small
                    class="sql-menu-text">${esc(one.sql.replace(/\s+/g, " ")
                        .trim())}</small></button>
                <button class="icon-btn" data-sql-forget="${at}" title="Remove from the favorites"
                    aria-label="Remove"><svg
                        viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>
        `).join("")}
    `;
}

/**
 * Puts a query from the history or the favorites in the box, in place of what is there.
 * @param {string} from
 * @returns {void}
 */
function useSql(from) {
    const [ kind, which ] = from.split(":");
    const one  = kind === "history"
        ? readStored(SQL_HISTORY).find((item) => String(item.at) === which && item.db === browse.db)
        : readStored(SQL_FAVORITES)[Number(which)];
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    if (!one) {
        return;
    }
    text.value = one.sql;
    browse.sql[browse.db] = one.sql;
    paintSqlBox();
    text.focus();
}

/**
 * Keeps the query in the box, or the part selected, as a favorite, by a name.
 * @returns {void}
 */
function keepSql() {
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("sql-text"));
    const sql  = (text.selectionStart !== text.selectionEnd
        ? text.value.slice(text.selectionStart, text.selectionEnd)
        : text.value).trim();
    if (!sql) {
        toast("Write the query to keep first", true);
        return;
    }
    formDialog({
        title  : "Save the query",
        text   : "Kept in this browser, for any database, under Favorites.",
        body   : `<label class="form-row"><span>Name</span><input name="name"
            value="${esc(sql.replace(/\s+/g, " ").slice(0, 60))}" maxlength="120" spellcheck="false"
            required></label>`,
        ok     : "Save",
        ready  : (fields) => /** @type {HTMLInputElement} */ (fields.querySelector("input"))
            .select(),
        submit : async (form) => {
            const name = String(new FormData(form).get("name")).trim();
            const list = readStored(SQL_FAVORITES).filter((one) => one.name !== name);
            list.unshift({ name, sql });
            localStorage.setItem(SQL_FAVORITES, JSON.stringify(list));
            return { message : `Saved ${name}` };
        },
    });
}

/**
 * Takes a favorite out, by its place, and draws the menus again.
 * @param {string} at
 * @returns {void}
 */
function forgetSql(at) {
    const list = readStored(SQL_FAVORITES);
    list.splice(Number(at), 1);
    localStorage.setItem(SQL_FAVORITES, JSON.stringify(list));
    renderSqlMenus();
}

/**
 * Forgets the queries run in this database, once the user is sure; the favorites stay.
 * @returns {Promise<void>}
 */
async function clearSqlHistory() {
    if (await ask({
        title  : `Clear ${browse.db}'s history?`,
        text   : "The queries run in it are forgotten. The favorites stay.",
        ok     : "Clear",
        danger : true,
    })) {
        localStorage.setItem(
            SQL_HISTORY,
            JSON.stringify(readStored(SQL_HISTORY).filter((one) => one.db !== browse.db)),
        );
    }
}
