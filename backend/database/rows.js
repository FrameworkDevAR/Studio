"use strict";

// A table's rows: a page of them, sorted and filtered, counted, one read whole, and
// rows changed, added and deleted by their primary key.

const { quote, forgetDatabases } = require("./databases");
const { query, existingDatabase, ident } = require("./client");
const { readStructure } = require("./schema");

// The rows a page of a table holds.
const PAGE    = 100;
// Long text is cut to this many characters in the grid, and read whole to edit.
const PREVIEW = 200;
const LONG    = /^(tinytext|text|mediumtext|longtext|json|varchar|char)$/;

/**
 * Up to this many rows, an InnoDB table's rows are counted when the tables
 * are read, as phpMyAdmin's MaxExactCount does; over it, the estimate shows
 * until it is asked to count them.
 */
const EXACT = 50_000;


/**
 * A page of a table's rows, sorted by a column or else by its primary key,
 * and filtered by rules, as Sequel Ace's, all or any of them. Long text is cut and
 * binary columns are given as their size, so a page stays light; one more
 * row than the page is asked for, to know whether there is a next one.
 */
async function readRows({
    db, table, page = 1, sort = "", dir = "asc", filters = "[]", match = "all"
}) {
    const structure = await readStructure(db, table);
    const columns   = structure.columns;
    const select    = columns.map((column) => {
        const name = ident(column.name);
        if (column.binary) {
            return `IF(${name} IS NULL, NULL, CONCAT(LENGTH(${name}), ' bytes')) AS ${name}`;
        }
        return LONG.test(column.dataType) ? `LEFT(${name}, ${PREVIEW + 1}) AS ${name}` : name;
    });
    const where = whereOf(columns, filters, match);
    const order = columns.some((column) => column.name === sort)
        ? `ORDER BY ${ident(sort)} ${dir === "desc" ? "DESC" : "ASC"}`
        : structure.primary.length ? `ORDER BY ${structure.primary.map(ident).join(", ")}` : "";
    const at      = Math.max(0, (Math.floor(Number(page)) || 1) - 1) * PAGE;
    // A filter reads every row, which takes a while in a table of millions.
    const [ set ] = await query(
        `SELECT ${select.join(", ")} FROM ${ident(structure.db)}.${ident(structure.table)}
        ${where} ${order} LIMIT ${PAGE + 1} OFFSET ${at};`,
        "",
        90_000,
    );
    return {
        structure,
        page : at / PAGE + 1,
        size : PAGE,
        more : set.rows.length > PAGE,
        rows : set.rows.slice(0, PAGE),
        cut  : PREVIEW,
    };
}

/** How many rows the filters leave, asked apart, as it takes as long as the filtering. */
async function countRows({ db, table, filters = "[]", match = "all" }) {
    const structure = await readStructure(db, table);
    const [ set ]   = await query(
        `SELECT COUNT(*) FROM ${ident(structure.db)}.${ident(structure.table)}
        ${whereOf(structure.columns, filters, match)};`,
        "",
        90_000,
    );
    return { count : Number(set.rows[0][0]) };
}

/**
 * The exact rows of the database's InnoDB tables small enough to count at
 * once, by name, asked for after the tables show, so they show at once.
 */
async function countSmallTables(db) {
    db = await existingDatabase(db);
    const [ set ] = await query(`
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ${quote(db)} AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB'
            AND TABLE_ROWS < ${EXACT}
    `);
    if (!set.rows.length) {
        return {};
    }
    const [ counts ] = await query(
        set.rows
            .map(([ name ]) => `SELECT ${quote(name)}, COUNT(*) FROM ${ident(db)}.${ident(name)}`)
            .join(" UNION ALL "),
        "",
        30_000,
    );
    return Object.fromEntries(counts.rows.map(([ name, count ]) => [ name, Number(count) ]));
}

/**
 * What a filter rule does, by its operator: the condition on one column,
 * from the value typed, and a second one for BETWEEN.
 */
const FILTERS = {
    "contains"     : (name, value) => `${name} LIKE ${quote(`%${likeText(value)}%`)}`,
    "not contains" : (name, value) => `NOT ${name} LIKE ${quote(`%${likeText(value)}%`)}`,
    "="            : (name, value) => `${name} = ${quote(value)}`,
    "!="           : (name, value) => `${name} <> ${quote(value)}`,
    ">"            : (name, value) => `${name} > ${quote(value)}`,
    "<"            : (name, value) => `${name} < ${quote(value)}`,
    ">="           : (name, value) => `${name} >= ${quote(value)}`,
    "<="           : (name, value) => `${name} <= ${quote(value)}`,
    "begins"       : (name, value) => `${name} LIKE ${quote(`${likeText(value)}%`)}`,
    "ends"         : (name, value) => `${name} LIKE ${quote(`%${likeText(value)}`)}`,
    "like"         : (name, value) => `${name} LIKE ${quote(value)}`,
    "not like"     : (name, value) => `NOT ${name} LIKE ${quote(value)}`,
    "regexp"       : (name, value) => `${name} REGEXP ${quote(value)}`,
    "in"           : (name, value) => `${name} IN (${listOf(value)})`,
    "not in"       : (name, value) => `${name} NOT IN (${listOf(value)})`,
    "between"      : (name, value, second) =>
        `${name} BETWEEN ${quote(value)} AND ${quote(second)}`,
    "null"         : (name) => `${name} IS NULL`,
    "not null"     : (name) => `${name} IS NOT NULL`,
};
// The operators that say what a column is not: on any column, none of them may.
const NEGATIVE = {
    "not contains" : "contains",
    "!="           : "=",
    "not like"     : "like",
    "not in"       : "in",
    "not null"     : "null",
};

/**
 * The WHERE of the filter rules, joined by AND, or by OR for any. A rule on
 * any column holds when one column does, or, said in the negative, when
 * none does; binary columns are left out of those.
 */
function whereOf(columns, filters, match) {
    let rules;
    try {
        rules = typeof filters === "string" ? JSON.parse(filters) : filters;
    } catch {
        throw new Error("The filters could not be read");
    }
    const conditions = [].concat(rules || [])
        .filter((rule) => rule && FILTERS[rule.op])
        .map((rule) => {
            const value  = String(rule.value ?? "");
            const second = String(rule.value2 ?? "");
            if (rule.column !== "*") {
                if (!columns.some((column) => column.name === rule.column)) {
                    throw new Error(`There is no column ${rule.column}`);
                }
                return `(${FILTERS[rule.op](ident(rule.column), value, second)})`;
            }
            const positive = NEGATIVE[rule.op] || rule.op;
            const each     = columns.filter((column) => !column.binary)
                .map((column) => FILTERS[positive](ident(column.name), value, second));
            return `${NEGATIVE[rule.op] ? "NOT " : ""}(${each.join(" OR ")})`;
        });
    return conditions.length ? `WHERE ${conditions.join(match === "any" ? " OR " : " AND ")}` : "";
}

/** A text for LIKE, with its own % and _ kept as they are. */
function likeText(value) {
    return value.replace(/[\\%_]/g, "\\$&");
}

/** The values of IN, typed with commas between them. */
function listOf(value) {
    const values = value.split(",").map((one) => one.trim()).filter((one) => one !== "");
    if (!values.length) {
        throw new Error("IN needs values, with commas between them");
    }
    return values.map(quote).join(", ");
}

/** One row whole, found by its primary key, to edit; or to copy, with binary columns in hex. */
/**
 * A row whole, by its key, or several, by theirs, in the order given: the
 * ones gone since are left out.
 */
async function readRow({ db, table, key, keys = null, hex = false }) {
    const structure = await readStructure(db, table);
    const select    = structure.columns.map((column) => (!column.binary ? ident(column.name)
        : hex ? `HEX(${ident(column.name)}) AS ${ident(column.name)}`
            : `IF(${ident(column.name)} IS NULL, NULL,
                CONCAT(LENGTH(${ident(column.name)}), ' bytes')) AS ${ident(column.name)}`));
    const from      = `SELECT ${select.join(", ")}
        FROM ${ident(structure.db)}.${ident(structure.table)}`;
    if (keys) {
        const [ set ] = await query(
            `${from} WHERE ${keysWhere(structure, keys)} LIMIT ${keys.length};`,
            "",
            90_000,
        );
        const places  = structure.primary
            .map((name) => structure.columns.findIndex((column) => column.name === name));
        const byKey   = new Map(set.rows.map((row) => [
            JSON.stringify(places.map((at) => row[at])),
            row,
        ]));
        const rows    = keys
            .map((one) => byKey.get(JSON.stringify(
                structure.primary.map((name) => one[name] ?? null),
            )))
            .filter(Boolean);
        return { structure, rows };
    }
    const [ set ] = await query(`${from} WHERE ${keyWhere(structure, key)} LIMIT 1;`);
    if (!set.rows.length) {
        throw new Error("The row is gone");
    }
    return { structure, row : set.rows[0] };
}


// ----------------------------------------------------------------- changing ---

/**
 * Saves a row: changes the one its primary key names, or adds one without
 * a key. A value is a text, as MariaDB converts it to the column's type, or
 * null; a binary column is never written. A new row leaves out the columns
 * not given, for their defaults, as an auto_increment id.
 */
async function saveRow({ db, table, key, values }) {
    const structure = await readStructure(db, table);
    const target    = `${ident(structure.db)}.${ident(structure.table)}`;
    const columns   = structure.columns
        .filter((column) => !column.binary && values && Object.hasOwn(values, column.name));
    const literal   = (value) => (value === null ? "NULL" : quote(String(value)));
    if (key) {
        if (!columns.length) {
            return { message : "Nothing to save" };
        }
        const set = columns
            .map((column) => `${ident(column.name)} = ${literal(values[column.name])}`)
            .join(", ");
        await change(`UPDATE ${target} SET ${set} WHERE ${keyWhere(structure, key)} LIMIT 1`);
        return { message : `Saved the row of ${structure.table}` };
    }
    const names = columns.map((column) => ident(column.name)).join(", ");
    const added = await change(
        `INSERT INTO ${target} (${names})
        VALUES (${columns.map((column) => literal(values[column.name])).join(", ")})`,
        false,
    );
    return { message : `Added a row to ${structure.table}${added.id && added.id !== "0"
        ? `, id ${added.id}` : ""}` };
}

/**
 * Sets a column of rows, by their keys, to one value, or NULL, in one
 * statement: what a row's menu does to the rows picked.
 */
async function setColumn({ db, table, keys, column, value = null }) {
    const structure = await readStructure(db, table);
    const found     = structure.columns.find((one) => one.name === column);
    if (!found) {
        throw new Error(`${structure.table} has no column ${column}`);
    }
    if (value === null && !found.nullable) {
        throw new Error(`${column} doesn't take NULL`);
    }
    const { count } = await change(
        `UPDATE ${ident(structure.db)}.${ident(structure.table)}
        SET ${ident(column)} = ${value === null ? "NULL" : quote(String(value))}
        WHERE ${keysWhere(structure, keys)} LIMIT ${keys.length}`,
        false,
    );
    return { message : `Set ${column} to ${value === null ? "NULL" : "the value"} in ${count === 1
        ? "1 row" : `${count} rows`}`, count };
}

/** Deletes a row by its key, or several by theirs, in one statement, so all go or none. */
async function deleteRow({ db, table, key, keys = null }) {
    const structure = await readStructure(db, table);
    const target    = `${ident(structure.db)}.${ident(structure.table)}`;
    if (keys) {
        const { count } = await change(
            `DELETE FROM ${target} WHERE ${keysWhere(structure, keys)} LIMIT ${keys.length}`,
            false,
        );
        const gone      = keys.length - count;
        return { message : `Deleted ${count === 1
            ? "1 row" : `${count} rows`} of ${structure.table}${gone
            ? `; ${gone} ${gone === 1 ? "was" : "were"} gone already` : ""}`, count };
    }
    await change(`DELETE FROM ${target} WHERE ${keyWhere(structure, key)} LIMIT 1`);
    return { message : `Deleted the row of ${structure.table}` };
}

/**
 * Runs a change, then asks how many rows it touched and the id it made, in
 * the same session. Changing a row that is no longer there is an error, as
 * when another tab deleted it.
 */
async function change(statement, one = true) {
    const [ set ] = await query(`${statement}; SELECT ROW_COUNT(), LAST_INSERT_ID();`);
    const [ count, id ] = set.rows[0];
    if (one && count === "0") {
        throw new Error("No row changed: it is gone, or already had these values");
    }
    forgetDatabases();
    return { count : Number(count), id };
}

/** The WHERE that finds a row by its primary key, given as its values by column. */
function keyWhere(structure, key) {
    if (!structure.primary.length) {
        throw new Error(
            `${structure.table} has no primary key, so its rows cannot be told apart here`,
        );
    }
    if (!key || typeof key !== "object") {
        throw new Error("Which row?");
    }
    return structure.primary.map((column) => {
        if (!Object.hasOwn(key, column)) {
            throw new Error(`The row's ${column} is missing`);
        }
        return key[column] === null ? `${ident(column)} IS NULL`
            : `${ident(column)} = ${quote(String(key[column]))}`;
    }).join(" AND ");
}


/** The WHERE that finds rows by their keys, up to a thousand at once. */
function keysWhere(structure, keys) {
    if (!Array.isArray(keys) || !keys.length || keys.length > 1000) {
        throw new Error("Pick 1 to 1000 rows");
    }
    return keys.map((key) => `(${keyWhere(structure, key)})`).join(" OR ");
}


module.exports = {
    readRows,
    countRows,
    countSmallTables,
    readRow,
    saveRow,
    setColumn,
    deleteRow,
    whereOf,
    keysWhere,
};
