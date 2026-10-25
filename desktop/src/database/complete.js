// The SQL box's autocomplete: the tables, their columns, the words and the functions.

import { api } from "../core/api.js";
import { esc } from "../core/helpers.js";
import { browse } from "./page.js";
import { SQL_WORDS, paintSqlBox, statementsOf } from "./sql.js";



/** @import { DbStructureColumn } from "./structure.js" */



// ------------------------------------------------------------ autocomplete ---

/** Words to offer that the paint doesn't need, and the functions most used. */
const SQL_MORE = `ANALYZE AFTER ALGORITHM AVG_ROW_LENGTH BINARY CASCADE CHARSET COLUMNS COMMENT
    DATA DUPLICATE ENUM EVENT EXPLAIN FIRST
    FLUSH FULLTEXT GLOBAL GRANTS HANDLER INDEXES LOCAL MATCH AGAINST NATURAL OPTIMIZE PARTITION
    PRIVILEGES PROCESSLIST REPAIR
    RESTRICT ROLLUP SCHEMA SESSION STATUS STRAIGHT_JOIN TEMPORARY VARIABLES WARNINGS`.split(/\s+/);

const SQL_FUNCTIONS = `ABS AVG CAST CEIL COALESCE CONCAT CONCAT_WS CONVERT COUNT CURDATE
    CURRENT_TIMESTAMP DATE DATE_ADD DATE_FORMAT
    DATE_SUB DATEDIFF DAY FIND_IN_SET FLOOR FROM_UNIXTIME GREATEST GROUP_CONCAT HOUR IF IFNULL INSTR
    JSON_ARRAY JSON_CONTAINS
    JSON_EXTRACT JSON_OBJECT JSON_UNQUOTE JSON_VALUE LAST_INSERT_ID LEAST LEFT LENGTH CHAR_LENGTH
    LOCATE LOWER LPAD LTRIM MAX
    MD5 MIN MINUTE MONTH NOW NULLIF RAND REGEXP_REPLACE REPLACE RIGHT ROUND ROW_NUMBER RPAD RTRIM
    SECOND SHA2 SUBSTRING
    SUBSTRING_INDEX SUM TIMESTAMPDIFF TRIM TRUNCATE UNIX_TIMESTAMP UPPER UUID YEAR`.split(/\s+/);

// After these, a table is what comes.
const TABLE_AFTER =
    /\b(FROM|JOIN|INTO|UPDATE|TABLE|DESCRIBE|DESC|TRUNCATE)\s+(?:`?[\w$]+`?\s*,\s*)*$/i;

/** The columns of the tables asked for, read once each, by database and table. */
const columnCache = new Map();



/**
 * A table's columns, once they are read; none until then, and the list is shown again when they
 * come.
 * @param {string} table
 * @returns {DbStructureColumn[]}
 */
function columnsOf(table) {
    const key = `${browse.db}.${table}`;
    if (!columnCache.has(key)) {
        columnCache.set(key, null);
        api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${
            encodeURIComponent(table)}`)
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

/**
 * Whether the cursor is in a text in quotes or a comment, where nothing is offered.
 * @param {string} text
 * @param {number} caret
 * @returns {boolean}
 */
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

/**
 * The tables a statement names, by themselves and by their aliases: FROM t, JOIN t AS x,
 * UPDATE t x.
 * @param {string} statement
 * @returns {Map<string, string>}
 */
function tablesIn(statement) {
    const names = new Map();
    const known = new Set(browse.tables.map((one) => one.name));

    for (const found of statement.matchAll(
        new RegExp(
            "\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(?:`((?:[^`]|``)+)`|([\\w$]+))" +
            "(?:\\s+(?:AS\\s+)?`?([\\w$]+)`?)?",
            "gi",
        ),
    )) {
        const table = found[1] ? found[1].replace(/``/g, "`") : found[2];
        const alias = found[3];
        if (!known.has(table)) {
            continue;
        }

        names.set(table, table);
        if (alias && !SQL_WORDS.has(alias.toUpperCase())
            && !SQL_MORE.includes(alias.toUpperCase())) {
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
 * @param {boolean=} asked With ⌃Space, offered even before anything is typed.
 * @returns {void}
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

    const statement = statementsOf(text.value)
        .find((one) => caret >= one.start && caret <= one.end + 1);
    const tables    = tablesIn(statement
        ? text.value.slice(statement.start, statement.end)
        : text.value);
    const typed     = word.toLowerCase();
    const lower     = word && word === word.toLowerCase();

    let items = [];
    if (owner) {
        const table = tables.get(owner)
            || browse.tables.find((one) => one.name === owner)?.name;
        items = table
            ? columnsOf(table).map((column) => ({
                text : column.name,
                kind : column.type,
                name : true,
            }))
            : [];
    } else {
        const tableItems = browse.tables.map((one) => ({
            text : one.name,
            kind : one.view ? "view" : "table",
            name : true,
        }));

        // A backtick opening the name doesn't hide the FROM before it.
        if (TABLE_AFTER.test(before.slice(0, before.length - word.length).replace(/`$/, ""))) {
            items = tableItems;
        } else {
            const columns = [ ...new Set(tables.values()) ].flatMap((table) => columnsOf(table)
                .map((column) => ({
                    text : column.name,
                    kind : `${column.type} · ${table}`,
                    name : true,
                })));
            const words   = [ ...new Set([ ...SQL_WORDS, ...SQL_MORE ]) ].map((one) => ({
                text : lower ? one.toLowerCase() : one,
                kind : "keyword",
            }));
            const calls   = SQL_FUNCTIONS.map((one) => ({
                text : `${lower ? one.toLowerCase() : one}()`,
                kind : "function",
                call : true,
            }));

            items = [ ...columns, ...tableItems, ...words, ...calls ];
        }
    }

    // Starting with what is typed first, then holding it; what is typed whole already, left out.
    const starts = items.filter((one) => one.text.toLowerCase().startsWith(typed));
    const holds  = typed.length > 1
        ? items.filter((one) => !one.text.toLowerCase().startsWith(typed)
            && one.text.toLowerCase().includes(typed))
        : [];

    const seen   = new Set();
    const shown  = [ ...starts, ...holds ].filter((one) => {
        const key = `${one.text}|${one.kind}`;
        const same = one.text.toLowerCase() === typed
            || "call" in one && one.call && one.text.toLowerCase() === `${typed}()`;
        return !seen.has(key) && seen.add(key) && !same;
    }).slice(0, 60);
    if (!shown.length) {
        return hideCompletion();
    }

    const box = document.getElementById("sql-complete");
    completion = {
        items : shown,
        at    : 0,
        from  : caret - word.length - (/`$/.test(before.slice(0, caret - word.length)) ? 1 : 0),
        to    : caret,
    };

    box.innerHTML = shown.map((one, at) => `
        <button type="button" role="option" data-complete="${at}" class="${at ? "" : "active"}"
            tabindex="-1">
            <span class="complete-text">${esc(one.text)}</span><span
                class="complete-kind">${esc(one.kind)}</span>
        </button>
    `).join("");

    box.hidden = false;
    placeCompletion(text, completion.from);
}

/**
 * Puts the list under the word, from where the text box draws it, kept in the window.
 * @param {HTMLTextAreaElement} text
 * @param {number} at
 * @returns {void}
 */
function placeCompletion(text, at) {
    const box    = document.getElementById("sql-complete");
    const mirror = document.createElement("div");
    const style  = getComputedStyle(text);

    for (const name of [
        "font",
        "letterSpacing",
        "padding",
        "border",
        "boxSizing",
        "whiteSpace",
        "overflowWrap",
        "wordBreak",
        "tabSize",
        "lineHeight",
    ]) {
        mirror.style[name] = style[name];
    }

    Object.assign(mirror.style, {
        position   : "absolute",
        visibility : "hidden",
        top        : "0",
        left       : "-9999px",
        width      : `${text.clientWidth}px`,
    });

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
    box.style.top  = `${y + 4 + box.offsetHeight > innerHeight - 8
        ? y - parseFloat(style.lineHeight) - box.offsetHeight - 4
        : y + 4}px`;
}

/**
 * Closes the list.
 * @returns {void}
 */
function hideCompletion() {
    completion = null;
    document.getElementById("sql-complete").hidden = true;
}

/**
 * Marks the item a step down the list, or up, round from one end to the other.
 * @param {number} by
 * @returns {void}
 */
function stepCompletion(by) {
    const box = document.getElementById("sql-complete");
    completion.at = (completion.at + by + completion.items.length) % completion.items.length;
    box.querySelector(".active")?.classList.remove("active");

    const button = box.querySelector(`[data-complete="${completion.at}"]`);
    button.classList.add("active");
    button.scrollIntoView({ block : "nearest" });
}

/**
 * Puts the item picked in place of the word typed: a name in backticks when it needs them, a
 * function's cursor in its brackets.
 * @param {number=} at
 * @returns {void}
 */
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
 * @param {KeyboardEvent} event
 * @returns {boolean}
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
    } else if ((event.key === "Enter" || event.key === "Tab")
        && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
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



// The public API
export {
    completion,
    showCompletion,
    hideCompletion,
    acceptCompletion,
    completionKeys,
};
