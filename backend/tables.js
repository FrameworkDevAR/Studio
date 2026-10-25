"use strict";

const zlib = require("zlib");
const { spawn } = require("child_process");

// A database's tables, as a small phpMyAdmin: their rows to browse and
// change, their structure, SQL to run, and the database exported and
// imported with mariadb-dump and the mariadb client.

const { PATH, run }                              = require("./system");
const { readDatabases, forgetDatabases, readCharsets, quote } = require("./databases");



// The rows a page of a table holds, and the most a query in the console shows.
const PAGE    = 100;
const RESULTS = 1000;
// Long text is cut to this many characters in the grid, and read whole to edit.
const PREVIEW = 200;
// Columns whose bytes are not text, shown by their size and never edited here.
const BINARY  = /^(binary|varbinary|tinyblob|blob|mediumblob|longblob|geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)$/;
const LONG    = /^(tinytext|text|mediumtext|longtext|json|varchar|char)$/;


// ------------------------------------------------------------------ reading ---

/**
 * Up to this many rows, an InnoDB table's rows are counted when the tables
 * are read, as phpMyAdmin's MaxExactCount does; over it, the estimate shows
 * until it is asked to count them.
 */
const EXACT = 50_000;

/**
 * The tables and views of a database, as phpMyAdmin lists them first: rows,
 * exact for MyISAM and Aria, which keep them, and estimated for InnoDB,
 * engine, collation, the data's and the indexes' sizes, the space a table
 * could give back, and its comment.
 */
async function readTables(db) {
    db = await existingDatabase(db);
    const [ set ] = await query(`
        SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, DATA_FREE, TABLE_COLLATION, TABLE_COMMENT,
            ROW_FORMAT, AUTO_INCREMENT, CREATE_TIME, UPDATE_TIME, AVG_ROW_LENGTH, MAX_DATA_LENGTH
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quote(db)} ORDER BY TABLE_NAME
    `);
    return set.rows.map(([ name, type, engine, rows, data, index, free, collation, comment, format, next, created, updated, average, most ]) => ({
        name,
        view      : type === "VIEW",
        engine    : engine || "",
        rows      : Number(rows || 0),
        exact     : engine === "MyISAM" || engine === "Aria",
        data      : Number(data || 0),
        index     : Number(index || 0),
        size      : Number(data || 0) + Number(index || 0),
        free      : Number(free || 0),
        collation : collation || "",
        comment   : type === "VIEW" ? "" : comment || "",
        format    : format || "",
        next      : next === null ? null : Number(next),
        average   : Number(average || 0),
        most      : Number(most || 0),
        created   : created || "",
        updated   : updated || "",
    }));
}

/**
 * A table's structure: its columns, its indexes and foreign keys, the
 * columns of its primary key, which the rows are changed by, and its
 * CREATE TABLE.
 */
async function readStructure(db, table) {
    ({ db, table } = await existingTable(db, table));
    const where = `TABLE_SCHEMA = ${quote(db)} AND TABLE_NAME = ${quote(table)}`;
    const [ columns, indexes, foreign, create ] = await query(`
        SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, COLUMN_COMMENT, COLLATION_NAME, GENERATION_EXPRESSION
        FROM information_schema.COLUMNS WHERE ${where} ORDER BY ORDINAL_POSITION;
        SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, INDEX_TYPE
        FROM information_schema.STATISTICS WHERE ${where} ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX;
        SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, r.DELETE_RULE, r.UPDATE_RULE
        FROM information_schema.KEY_COLUMN_USAGE k
        LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.${where.replace(" AND TABLE_NAME", " AND k.TABLE_NAME")} AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION;
        SHOW CREATE TABLE ${ident(db)}.${ident(table)};
    `);
    const byIndex = new Map();
    for (const [ name, nonUnique, column, type ] of indexes.rows) {
        const index = byIndex.get(name) || { name, unique : nonUnique === "0", type, columns : [] };
        index.columns.push(column);
        byIndex.set(name, index);
    }
    const byKey = new Map();
    for (const [ name, column, refTable, refColumn, refDb, onDelete, onUpdate ] of foreign.rows) {
        const key = byKey.get(name) || { name, columns : [], db : refDb, table : refTable, references : [], onDelete : onDelete || "RESTRICT", onUpdate : onUpdate || "RESTRICT" };
        key.columns.push(column);
        key.references.push(refColumn);
        byKey.set(name, key);
    }
    return {
        db,
        table,
        columns : columns.rows.map(([ name, type, dataType, nullable, preset, key, extra, comment, collation, generated ]) => ({
            name,
            type,
            dataType,
            nullable  : nullable === "YES",
            default   : preset,
            value     : valueOf(preset, generated, extra),
            key,
            extra,
            comment,
            collation : collation || "",
            binary    : BINARY.test(dataType),
        })),
        indexes : [ ...byIndex.values() ],
        foreign : [ ...byKey.values() ],
        primary : byIndex.get("PRIMARY")?.columns || [],
        create  : create.rows[0]?.[1] || "",
    };
}

/**
 * What a column starts with, from MariaDB's own words for it: nothing, NULL,
 * a value -- a number, or a text in quotes, read back from them -- or an
 * expression, as current_timestamp(); or what it is made from, when it is
 * generated, kept on disk or not.
 */
function valueOf(preset, generated, extra) {
    if (generated) {
        return { kind : /STORED|PERSISTENT/i.test(extra) ? "stored" : "virtual", value : generated };
    }
    if (preset === null) {
        return { kind : "none", value : "" };
    }
    if (preset === "NULL") {
        return { kind : "null", value : "" };
    }
    const quoted = preset.match(/^'([\s\S]*)'$/);
    if (quoted) {
        const escapes = { n : "\n", t : "\t", r : "\r", 0 : "\0", Z : "\x1a", b : "\b" };
        return { kind : "value", value : quoted[1].replace(/''|\\([\s\S])/g, (all, char) => (all === "''" ? "'" : escapes[char] ?? char)) };
    }
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(preset)) {
        return { kind : "value", value : preset };
    }
    return { kind : "expression", value : preset };
}

/**
 * A page of a table's rows, sorted by a column or else by its primary key,
 * and filtered by rules, as Sequel Ace's, all or any of them. Long text is cut and
 * binary columns are given as their size, so a page stays light; one more
 * row than the page is asked for, to know whether there is a next one.
 */
async function readRows({ db, table, page = 1, sort = "", dir = "asc", filters = "[]", match = "all" }) {
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
    const [ set ] = await query(`SELECT ${select.join(", ")} FROM ${ident(structure.db)}.${ident(structure.table)} ${where} ${order} LIMIT ${PAGE + 1} OFFSET ${at};`, "", 90_000);
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
    const [ set ]   = await query(`SELECT COUNT(*) FROM ${ident(structure.db)}.${ident(structure.table)} ${whereOf(structure.columns, filters, match)};`, "", 90_000);
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
        WHERE TABLE_SCHEMA = ${quote(db)} AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB' AND TABLE_ROWS < ${EXACT}
    `);
    if (!set.rows.length) {
        return {};
    }
    const [ counts ] = await query(set.rows.map(([ name ]) => `SELECT ${quote(name)}, COUNT(*) FROM ${ident(db)}.${ident(name)}`).join(" UNION ALL "), "", 30_000);
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
    "between"      : (name, value, second) => `${name} BETWEEN ${quote(value)} AND ${quote(second)}`,
    "null"         : (name) => `${name} IS NULL`,
    "not null"     : (name) => `${name} IS NOT NULL`,
};
// The operators that say what a column is not: on any column, none of them may.
const NEGATIVE = { "not contains" : "contains", "!=" : "=", "not like" : "like", "not in" : "in", "not null" : "null" };

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
    const conditions = [].concat(rules || []).filter((rule) => rule && FILTERS[rule.op]).map((rule) => {
        const value  = String(rule.value ?? "");
        const second = String(rule.value2 ?? "");
        if (rule.column !== "*") {
            if (!columns.some((column) => column.name === rule.column)) {
                throw new Error(`There is no column ${rule.column}`);
            }
            return `(${FILTERS[rule.op](ident(rule.column), value, second)})`;
        }
        const positive = NEGATIVE[rule.op] || rule.op;
        const each     = columns.filter((column) => !column.binary).map((column) => FILTERS[positive](ident(column.name), value, second));
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
            : `IF(${ident(column.name)} IS NULL, NULL, CONCAT(LENGTH(${ident(column.name)}), ' bytes')) AS ${ident(column.name)}`));
    const from      = `SELECT ${select.join(", ")} FROM ${ident(structure.db)}.${ident(structure.table)}`;
    if (keys) {
        const [ set ] = await query(`${from} WHERE ${keysWhere(structure, keys)} LIMIT ${keys.length};`, "", 90_000);
        const places  = structure.primary.map((name) => structure.columns.findIndex((column) => column.name === name));
        const byKey   = new Map(set.rows.map((row) => [ JSON.stringify(places.map((at) => row[at])), row ]));
        const rows    = keys.map((one) => byKey.get(JSON.stringify(structure.primary.map((name) => one[name] ?? null)))).filter(Boolean);
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
    const columns   = structure.columns.filter((column) => !column.binary && values && Object.hasOwn(values, column.name));
    const literal   = (value) => (value === null ? "NULL" : quote(String(value)));
    if (key) {
        if (!columns.length) {
            return { message : "Nothing to save" };
        }
        const set = columns.map((column) => `${ident(column.name)} = ${literal(values[column.name])}`).join(", ");
        await change(`UPDATE ${target} SET ${set} WHERE ${keyWhere(structure, key)} LIMIT 1`);
        return { message : `Saved the row of ${structure.table}` };
    }
    const names = columns.map((column) => ident(column.name)).join(", ");
    const added = await change(`INSERT INTO ${target} (${names}) VALUES (${columns.map((column) => literal(values[column.name])).join(", ")})`, false);
    return { message : `Added a row to ${structure.table}${added.id && added.id !== "0" ? `, id ${added.id}` : ""}` };
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
    const { count } = await change(`UPDATE ${ident(structure.db)}.${ident(structure.table)} SET ${ident(column)} = ${value === null ? "NULL" : quote(String(value))} WHERE ${keysWhere(structure, keys)} LIMIT ${keys.length}`, false);
    return { message : `Set ${column} to ${value === null ? "NULL" : "the value"} in ${count === 1 ? "1 row" : `${count} rows`}`, count };
}

/** Deletes a row by its key, or several by theirs, in one statement, so all go or none. */
async function deleteRow({ db, table, key, keys = null }) {
    const structure = await readStructure(db, table);
    const target    = `${ident(structure.db)}.${ident(structure.table)}`;
    if (keys) {
        const { count } = await change(`DELETE FROM ${target} WHERE ${keysWhere(structure, keys)} LIMIT ${keys.length}`, false);
        const gone      = keys.length - count;
        return { message : `Deleted ${count === 1 ? "1 row" : `${count} rows`} of ${structure.table}${gone ? `; ${gone} ${gone === 1 ? "was" : "were"} gone already` : ""}`, count };
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
        throw new Error(`${structure.table} has no primary key, so its rows cannot be told apart here`);
    }
    if (!key || typeof key !== "object") {
        throw new Error("Which row?");
    }
    return structure.primary.map((column) => {
        if (!Object.hasOwn(key, column)) {
            throw new Error(`The row's ${column} is missing`);
        }
        return key[column] === null ? `${ident(column)} IS NULL` : `${ident(column)} = ${quote(String(key[column]))}`;
    }).join(" AND ");
}


/** The WHERE that finds rows by their keys, up to a thousand at once. */
function keysWhere(structure, keys) {
    if (!Array.isArray(keys) || !keys.length || keys.length > 1000) {
        throw new Error("Pick 1 to 1000 rows");
    }
    return keys.map((key) => `(${keyWhere(structure, key)})`).join(" OR ");
}


// ------------------------------------------------------------------ indexes ---

/** The kinds of index the page makes, as ALTER TABLE writes each. */
const INDEX_KINDS = { index : "INDEX", unique : "UNIQUE INDEX", fulltext : "FULLTEXT INDEX", primary : "PRIMARY KEY" };

/**
 * Adds an index on the columns given, in their order. MariaDB builds it
 * at once, which in a large table takes a while, so it is given minutes.
 */
async function addIndex({ db, table, name, kind, columns }) {
    const structure = await readStructure(db, table);
    const list      = [].concat(columns || []).map(String);
    if (!INDEX_KINDS[kind]) {
        throw new Error("Pick a kind of index");
    }
    if (!list.length) {
        throw new Error("Pick the columns it is on");
    }
    for (const column of list) {
        if (!structure.columns.some((one) => one.name === column)) {
            throw new Error(`There is no column ${column}`);
        }
    }
    const label = kind === "primary" ? "" : String(name || "").trim();
    if (label && !/^[\w$]{1,64}$/.test(label)) {
        throw new Error("An index name is up to 64 letters, digits, _ or $");
    }
    await query(`ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} ADD ${INDEX_KINDS[kind]}${label ? ` ${ident(label)}` : ""} (${list.map(ident).join(", ")});`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Added ${kind === "primary" ? "the primary key" : `the index ${label || list[0]}`} to ${structure.table}` };
}

async function dropIndex({ db, table, name }) {
    const structure = await readStructure(db, table);
    if (!structure.indexes.some((index) => index.name === name)) {
        throw new Error(`${structure.table} has no index ${name}`);
    }
    const drop = name === "PRIMARY" ? "DROP PRIMARY KEY" : `DROP INDEX ${ident(name)}`;
    await query(`ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} ${drop};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Dropped ${name === "PRIMARY" ? "the primary key" : `the index ${name}`} of ${structure.table}` };
}


// ------------------------------------------------------------- foreign keys ---

const FK_RULES = [ "RESTRICT", "CASCADE", "SET NULL", "NO ACTION" ];

/** A column's type as a foreign key compares it: ints without their display width, the rest as they are. */
function keyType(column) {
    return column.type.replace(/^((?:tiny|small|medium|big)?int)\(\d+\)/i, "$1").replace(/\s+zerofill/i, "").toLowerCase();
}

/**
 * Adds a foreign key, or changes one, by dropping it and adding it again in
 * the same ALTER: the columns, the table and columns they refer to, of this
 * database, and what a delete or an update there does here. What MariaDB
 * says vaguely -- errno 150, a row with no match -- is checked first, or
 * said plainly.
 */
async function saveForeignKey({ db, table, name = "", columns = [], refTable, refColumns = [], onDelete = "RESTRICT", onUpdate = "RESTRICT", replace = "" }) {
    const structure = await readStructure(db, table);
    const list      = [].concat(columns).map(String);
    const refs      = [].concat(refColumns).map(String);
    const label     = String(name || "").trim();
    if (!list.length || list.length !== refs.length) {
        throw new Error("Pair each column with the column it refers to");
    }
    if (label && !/^[\w$]{1,64}$/.test(label)) {
        throw new Error("A foreign key's name is up to 64 letters, digits, _ or $");
    }
    if (!FK_RULES.includes(onDelete) || !FK_RULES.includes(onUpdate)) {
        throw new Error("On delete and on update are RESTRICT, CASCADE, SET NULL or NO ACTION");
    }
    if (replace && !structure.foreign.some((key) => key.name === replace)) {
        throw new Error(`${structure.table} has no foreign key ${replace}`);
    }
    const target = await readStructure(structure.db, refTable);
    const all    = await readTables(structure.db);
    for (const one of [ structure.table, target.table ]) {
        const engine = all.find((item) => item.name === one)?.engine;
        if (engine !== "InnoDB") {
            throw new Error(`${one} is ${engine || "a view"}: foreign keys need InnoDB tables`);
        }
    }
    const pairs = list.map((name, at) => {
        const here  = structure.columns.find((column) => column.name === name);
        const there = target.columns.find((column) => column.name === refs[at]);
        if (!here || !there) {
            throw new Error(`There is no column ${here ? `${refs[at]} in ${target.table}` : name}`);
        }
        if (keyType(here) !== keyType(there)) {
            throw new Error(`${here.name} is ${here.type} and ${target.table}.${there.name} is ${there.type}: a foreign key's columns are of the same type, unsigned or not alike`);
        }
        if ((onDelete === "SET NULL" || onUpdate === "SET NULL") && !here.nullable) {
            throw new Error(`SET NULL needs ${here.name} to take NULL`);
        }
        return [ here, there ];
    });
    // The columns referred to lead an index there, as MariaDB looks them up by it.
    if (!target.indexes.some((index) => refs.every((column, at) => index.columns[at] === column))) {
        throw new Error(`${target.table} has no index starting with ${refs.join(", ")}: add one there first, or refer to its primary key`);
    }
    const specs = [];
    if (replace) {
        specs.push(`DROP FOREIGN KEY ${ident(replace)}`);
    }
    specs.push(`ADD${label ? ` CONSTRAINT ${ident(label)}` : ""} FOREIGN KEY (${pairs.map(([ here ]) => ident(here.name)).join(", ")}) REFERENCES ${ident(target.table)} (${pairs.map(([ , there ]) => ident(there.name)).join(", ")}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`);
    try {
        await query(`ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} ${specs.join(", ")};`, "", 10 * 60_000);
    } catch (error) {
        if (/a foreign key constraint fails/i.test(error.message)) {
            throw new Error(`Some rows of ${structure.table} have ${list.join(", ")} values with no match in ${target.table}: fix or clear them first`);
        }
        if (/errno: 121|Duplicate key on write|duplicate.*constraint/i.test(error.message)) {
            throw new Error(`There is a foreign key named ${label} in this database already: pick another name`);
        }
        throw error;
    }
    forgetDatabases();
    return { message : `${replace ? "Changed" : "Added"} the foreign key ${label || `on ${list.join(", ")}`}` };
}

async function dropForeignKey({ db, table, name }) {
    const structure = await readStructure(db, table);
    if (!structure.foreign.some((key) => key.name === name)) {
        throw new Error(`${structure.table} has no foreign key ${name}`);
    }
    await query(`ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} DROP FOREIGN KEY ${ident(name)};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Dropped the foreign key ${name}` };
}

/** The engines a table can be given: those MariaDB has on, its default first. */
async function readEngines() {
    const [ set ] = await query("SELECT ENGINE, SUPPORT, COMMENT FROM information_schema.ENGINES WHERE SUPPORT IN ('YES', 'DEFAULT') ORDER BY SUPPORT = 'DEFAULT' DESC, ENGINE");
    return set.rows.filter(([ name ]) => !/^(PERFORMANCE_SCHEMA|MRG_MyISAM|SEQUENCE)$/i.test(name))
        .map(([ name, support, comment ]) => ({ name, comment, preset : support === "DEFAULT" }));
}

/**
 * Changes a table's options, as Sequel Ace's Table Information does: its
 * engine, its encoding -- the default for new columns, or converting the
 * columns too -- its comment and the next auto_increment id. Only what is
 * given changes; a new engine or a conversion rewrites the table, so it is
 * given minutes.
 */
async function changeTable({ db, table, engine, charset, collation, convert, comment, next }) {
    const structure = await readStructure(db, table);
    const specs     = [];
    if (engine) {
        if (!(await readEngines()).some((one) => one.name === engine)) {
            throw new Error(`MariaDB has no engine ${engine}`);
        }
        specs.push(`ENGINE = ${engine}`);
    }
    if (charset) {
        const set = (await readCharsets()).find((one) => one.name === charset);
        if (!set || (collation && !set.collations.includes(collation))) {
            throw new Error(`MariaDB has no encoding ${charset}${collation ? ` with ${collation}` : ""}`);
        }
        specs.push(`${convert ? "CONVERT TO" : "DEFAULT"} CHARACTER SET ${charset}${collation ? ` COLLATE ${collation}` : ""}`);
    }
    if (typeof comment === "string") {
        if (comment.length > 2048) {
            throw new Error("A table's comment is up to 2048 characters");
        }
        specs.push(`COMMENT = ${quote(comment)}`);
    }
    if (next !== undefined && next !== null && next !== "") {
        if (!/^\d{1,19}$/.test(String(next)) || Number(next) < 1) {
            throw new Error("The next id is a whole number from 1");
        }
        specs.push(`AUTO_INCREMENT = ${next}`);
    }
    if (!specs.length) {
        throw new Error("Nothing changed");
    }
    await query(`ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} ${specs.join(", ")};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Changed ${structure.table}` };
}


// ------------------------------------------------------------------ columns ---

/*
 * A type as MariaDB writes one: its name, its size or its choices in
 * brackets, and unsigned or zerofill after. An enum's choices are texts in
 * quotes; nothing else in the brackets may end the statement.
 */
const COLUMN_TYPE = /^[a-z][a-z0-9 ]*?(\s*\((?:'(?:[^'\\]|\\.|'')*'|[^()';])*\))?(\s+(unsigned|signed|zerofill))*$/i;
const TEXT_TYPE   = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i;

/**
 * A column's definition, from what the column dialog gives: its name and
 * type, its collation when it holds text, whether it takes NULL, what it
 * starts with or is made from, auto_increment, ON UPDATE, and its comment.
 */
async function columnSql({ name, type, nullable, value = "none", preset = "", collation = "", increment, update, comment = "" }) {
    name = String(name || "");
    type = String(type || "").trim();
    if (!name.trim() || name.length > 64 || /\s$/.test(name)) {
        throw new Error("A column's name is 1 to 64 characters, not ending in a space");
    }
    if (!COLUMN_TYPE.test(type)) {
        throw new Error(`${type || "An empty type"} is not a type MariaDB knows, as int, varchar(255) or enum('a','b')`);
    }
    const parts = [ ident(name), type ];
    if (collation) {
        if (!TEXT_TYPE.test(type)) {
            throw new Error("Only a column of text has a collation");
        }
        if (!(await readCharsets()).some((set) => set.collations.includes(collation))) {
            throw new Error(`MariaDB has no collation ${collation}`);
        }
        parts.push(`COLLATE ${collation}`);
    }
    const expression = (text) => {
        if (!String(text).trim() || /;/.test(text)) {
            throw new Error("An expression is one, as current_timestamp() or `price` * 2, without ;");
        }
        return String(text).trim();
    };
    if (value === "virtual" || value === "stored") {
        parts.push(`AS (${expression(preset)}) ${value === "stored" ? "STORED" : "VIRTUAL"}`);
    } else {
        parts.push(nullable ? "NULL" : "NOT NULL");
        if (value === "null") {
            if (!nullable) {
                throw new Error("A column that doesn't take NULL can't start with it");
            }
            parts.push("DEFAULT NULL");
        } else if (value === "value") {
            parts.push(`DEFAULT ${quote(String(preset))}`);
        } else if (value === "expression") {
            parts.push(`DEFAULT (${expression(preset)})`);
        } else if (value !== "none") {
            throw new Error("Pick what the column starts with");
        }
        if (update) {
            parts.push("ON UPDATE current_timestamp()");
        }
        if (increment) {
            parts.push("AUTO_INCREMENT");
        }
    }
    if (String(comment).length > 1024) {
        throw new Error("A column's comment is up to 1024 characters");
    }
    if (comment) {
        parts.push(`COMMENT ${quote(String(comment))}`);
    }
    return parts.join(" ");
}

/** Where a column goes: first, after another, or, given nothing, where it is, or at the end for a new one. */
function placeOf(structure, after) {
    if (after === undefined || after === null || after === "") {
        return "";
    }
    if (after === true || after === "first") {
        return " FIRST";
    }
    if (!structure.columns.some((one) => one.name === after)) {
        throw new Error(`There is no column ${after}`);
    }
    return ` AFTER ${ident(after)}`;
}

/** Adds a column, or changes one, by its name as it was: its definition, name included, and its place. */
async function saveColumn({ db, table, column, definition, after }) {
    const structure = await readStructure(db, table);
    const target    = `${ident(structure.db)}.${ident(structure.table)}`;
    const sql       = await columnSql(definition || {});
    if (column && !structure.columns.some((one) => one.name === column)) {
        throw new Error(`${structure.table} has no column ${column}`);
    }
    await query(`ALTER TABLE ${target} ${column ? `CHANGE COLUMN ${ident(column)}` : "ADD COLUMN"} ${sql}${placeOf(structure, after)};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : column ? `Changed the column ${definition.name}` : `Added the column ${definition.name} to ${structure.table}` };
}

/**
 * Moves a column, first or after another, with its definition as SHOW
 * CREATE TABLE gives it, so nothing of it is lost on the way.
 */
async function moveColumn({ db, table, column, after }) {
    const structure = await readStructure(db, table);
    const start     = `${ident(column)} `;
    const line      = structure.create.split("\n").map((one) => one.trim()).find((one) => one.startsWith(start));
    if (!line || !structure.columns.some((one) => one.name === column)) {
        throw new Error(`${structure.table} has no column ${column}`);
    }
    await query(`ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} MODIFY COLUMN ${line.replace(/,$/, "")}${placeOf(structure, after) || " FIRST"};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Moved the column ${column}` };
}

async function dropColumn({ db, table, column }) {
    const structure = await readStructure(db, table);
    if (!structure.columns.some((one) => one.name === column)) {
        throw new Error(`${structure.table} has no column ${column}`);
    }
    if (structure.columns.length === 1) {
        throw new Error("A table keeps at least one column: drop the table instead");
    }
    await query(`ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} DROP COLUMN ${ident(column)};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Dropped the column ${column}` };
}

// ------------------------------------------------------------------ tables ---

/** A table's name, new or given anew: 1 to 64 characters, not ending in a space. */
function tableName(name) {
    name = String(name || "");
    if (!name.trim() || name.length > 64 || /\s$/.test(name)) {
        throw new Error("A table's name is 1 to 64 characters, not ending in a space");
    }
    return name;
}

/** Whether a table there is a view, which is renamed, copied and dropped as one. */
async function kindOf(db, table) {
    ({ db, table } = await existingTable(db, table));
    const [ set ] = await query(`SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quote(db)} AND TABLE_NAME = ${quote(table)};`);
    return { db, table, view : set.rows[0]?.[0] === "VIEW", target : `${ident(db)}.${ident(table)}` };
}

/**
 * Refuses to empty or drop a table another refers to with a foreign key,
 * naming those, as MariaDB's own error doesn't.
 */
async function unreferenced(old, doing) {
    const [ set ] = await query(`
        SELECT DISTINCT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE REFERENCED_TABLE_SCHEMA = ${quote(old.db)} AND REFERENCED_TABLE_NAME = ${quote(old.table)} AND NOT (TABLE_SCHEMA = ${quote(old.db)} AND TABLE_NAME = ${quote(old.table)})
        ORDER BY TABLE_NAME;
    `);
    const names = set.rows.map(([ name ]) => name);
    if (names.length) {
        throw new Error(`${names.join(", ")} ${names.length === 1 ? "refers" : "refer"} to ${old.table} with a foreign key, so it can't be ${doing}: drop that key first`);
    }
}

/**
 * A new table, as Sequel Ace makes one: its name, a first column, as the
 * column dialog gives it, the primary key on it or not, and its engine,
 * collation and comment, or the database's and MariaDB's when not given.
 */
async function createTable({ db, name, column, primary = true, engine = "", collation = "", comment = "" }) {
    db   = await existingDatabase(db);
    name = tableName(name);
    const specs = [ await columnSql(column || {}) ];
    if (primary) {
        specs.push(`PRIMARY KEY (${ident(column.name)})`);
    }
    const options = [];
    if (engine) {
        if (!(await readEngines()).some((one) => one.name === engine)) {
            throw new Error(`MariaDB has no engine ${engine}`);
        }
        options.push(`ENGINE = ${engine}`);
    }
    if (collation) {
        const set = (await readCharsets()).find((one) => one.collations.includes(collation));
        if (!set) {
            throw new Error(`MariaDB has no collation ${collation}`);
        }
        options.push(`DEFAULT CHARSET = ${set.name} COLLATE = ${collation}`);
    }
    if (String(comment).length > 2048) {
        throw new Error("A table's comment is up to 2048 characters");
    }
    if (comment) {
        options.push(`COMMENT = ${quote(String(comment))}`);
    }
    await query(`CREATE TABLE ${ident(db)}.${ident(name)} (\n  ${specs.join(",\n  ")}\n) ${options.join(" ")};`);
    forgetDatabases();
    return { message : `Created the table ${name}`, table : name };
}

async function renameTable({ db, table, name }) {
    const old = await kindOf(db, table);
    name = tableName(name);
    await query(`RENAME TABLE ${old.target} TO ${ident(old.db)}.${ident(name)};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Renamed ${old.table} to ${name}`, table : name };
}

/**
 * A copy of a table, with its rows or not: its columns, indexes and
 * options, as CREATE TABLE ... LIKE gives them, and its rows with their
 * values, the generated columns making theirs again. Foreign keys and
 * triggers stay with the table copied. A view is made again as its query.
 */
async function duplicateTable({ db, table, name, data = true }) {
    const old = await kindOf(db, table);
    name = tableName(name);
    const target = `${ident(old.db)}.${ident(name)}`;
    if (old.view) {
        const [ set ] = await query(`SELECT VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ${quote(old.db)} AND TABLE_NAME = ${quote(old.table)};`);
        await query(`CREATE VIEW ${target} AS ${set.rows[0][0]};`);
        forgetDatabases();
        return { message : `Copied the view ${old.table} to ${name}`, table : name };
    }
    const structure = await readStructure(old.db, old.table);
    await query(`CREATE TABLE ${target} LIKE ${old.target};`);
    if (data) {
        const columns = structure.columns.filter((one) => one.value.kind !== "virtual" && one.value.kind !== "stored").map((one) => ident(one.name)).join(", ");
        try {
            await query(`INSERT INTO ${target} (${columns}) SELECT ${columns} FROM ${old.target};`, "", 30 * 60_000);
        } catch (error) {
            // No half copy is left behind.
            await query(`DROP TABLE IF EXISTS ${target};`).catch(() => {});
            throw error;
        }
    }
    forgetDatabases();
    const left = structure.foreign.length ? ", without its foreign keys" : "";
    return { message : `Copied ${old.table} to ${name}${data ? "" : ", without its rows"}${left}`, table : name };
}

/** Empties a table, as TRUNCATE does: its rows gone, and its auto_increment back to 1. */
async function emptyTable({ db, table }) {
    const old = await kindOf(db, table);
    if (old.view) {
        throw new Error(`${old.table} is a view: it holds no rows of its own`);
    }
    await unreferenced(old, "emptied");
    await query(`TRUNCATE TABLE ${old.target};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Emptied ${old.table}` };
}

async function dropTable({ db, table }) {
    const old = await kindOf(db, table);
    if (!old.view) {
        await unreferenced(old, "dropped");
    }
    await query(`DROP ${old.view ? "VIEW" : "TABLE"} ${old.target};`, "", 10 * 60_000);
    forgetDatabases();
    return { message : `Dropped the ${old.view ? "view" : "table"} ${old.table}` };
}

// ------------------------------------------------------------- maintenance ---

const UPKEEP = {
    optimize : "OPTIMIZE",
    analyze  : "ANALYZE",
    check    : "CHECK",
    repair   : "REPAIR",
};

/**
 * Optimizes, analyzes, checks or repairs tables, as phpMyAdmin's table
 * operations do, all in one statement: what MariaDB says of each, by
 * table, as it says it -- a note, then its status. Views are only checked;
 * the rest leaves them out. Optimizing rewrites a table, so it is given time.
 */
async function maintainTables({ db, tables = [], op }) {
    const verb = UPKEEP[op];
    if (!verb) {
        throw new Error("Optimize, analyze, check or repair");
    }
    db = await existingDatabase(db);
    const all  = await readTables(db);
    const list = [].concat(tables).map(String);
    const gone = list.find((name) => !all.some((one) => one.name === name));
    if (gone) {
        throw new Error(`There is no table ${gone} in ${db}`);
    }
    const picked = all.filter((one) => list.includes(one.name) && (op === "check" || !one.view)).map((one) => one.name);
    if (!picked.length) {
        throw new Error(list.length ? "Views can only be checked" : "Pick a table");
    }
    const start = Date.now();
    const [ set ] = await query(`${verb} TABLE ${picked.map((name) => `${ident(db)}.${ident(name)}`).join(", ")};`, "", 60 * 60_000);
    forgetDatabases();
    const byTable = new Map(picked.map((name) => [ name, [] ]));
    for (const [ table, , type, text ] of set.rows) {
        // MariaDB names each db.table.
        const name = String(table).slice(db.length + 1);
        // InnoDB's way of saying it optimized, which reads as if it didn't.
        const said = /does not support optimize, doing recreate \+ analyze instead/i.test(text) ? "InnoDB optimizes by rebuilding the table and analyzing it, which it did" : text;
        (byTable.get(name) || byTable.set(name, []).get(name)).push({ type : String(type).toLowerCase(), text : said });
    }
    return {
        time    : Date.now() - start,
        results : [ ...byTable ].map(([ table, said ]) => ({ table, said })),
    };
}

/** The id after the highest of the table's auto_increment column: where a reset of its next id puts it. */
async function nextId({ db, table }) {
    const structure = await readStructure(db, table);
    const column    = structure.columns.find((one) => /auto_increment/i.test(one.extra));
    if (!column) {
        throw new Error(`${structure.table} has no auto_increment column`);
    }
    const [ set ] = await query(`SELECT COALESCE(MAX(${ident(column.name)}), 0) + 1 FROM ${ident(structure.db)}.${ident(structure.table)};`);
    return { next : set.rows[0][0] };
}

// ---------------------------------------------------------------------- sql ---

/**
 * Runs the SQL typed in the console, in its database. Each result shows,
 * up to 1000 rows -- a SELECT without a LIMIT stops there -- and for the
 * last statement, the rows it changed.
 */
async function runSql({ db, sql }) {
    db = await existingDatabase(db);
    const text = String(sql || "").trim();
    if (!text) {
        throw new Error("No SQL to run");
    }
    const start = Date.now();
    // The limit goes on a line before the SQL, so a line MariaDB names is one less.
    const sets  = await query(`SET SESSION sql_select_limit = ${RESULTS + 1};\n${text.replace(/;?\s*$/, ";")}\nSELECT ROW_COUNT() AS \`studio:changed\`;`, db, 120_000)
        .catch((error) => {
            throw new Error(error.message.replace(/\(at line (\d+)\)$/, (_, line) => (text.includes("\n") ? `(at line ${line - 1})` : "").trim()).trim());
        });
    const last  = sets.pop();
    forgetDatabases();
    const results = [];
    for (const set of sets) {
        results.push({
            statement : set.statement,
            columns   : set.columns,
            rows      : set.rows.slice(0, RESULTS),
            more      : set.rows.length > RESULTS,
            edit      : await editableOf(db, set),
        });
    }
    return { time : Date.now() - start, changed : Number(last?.rows[0]?.[0] ?? -1), results };
}

// A plain SELECT of one table: its columns by name, or *, then its WHERE, ORDER BY and LIMIT, nothing else.
const NAME_SQL   = "(?:`(?:[^`]|``)+`|[\\w$]+)";
const PLAIN_FROM = new RegExp(`^\\s*SELECT\\s+([\\s\\S]+?)\\s+FROM\\s+(${NAME_SQL}(?:\\s*\\.\\s*${NAME_SQL})?)\\s*((?:WHERE|ORDER\\s+BY|LIMIT)\\b[\\s\\S]*)?;?\\s*$`, "i");
const PLAIN_ITEM = new RegExp(`^(?:${NAME_SQL}\\s*\\.\\s*)?(?:${NAME_SQL}|\\*)$`);
const unquoted   = (name) => (name.startsWith("`") ? name.slice(1, -1).replace(/``/g, "`") : name);

/**
 * Whether a result's rows can be changed in place, as Sequel Ace allows: a
 * plain SELECT of one table, not a view, with its columns as they are named
 * -- no expressions, no aliases -- and its primary key among them. Then
 * the table, its key, and each column of the result as the table's.
 */
async function editableOf(db, set) {
    const found = String(set.statement).match(PLAIN_FROM);
    if (!found || /\b(JOIN|UNION|GROUP|HAVING|DISTINCT|INTO|FOR\s+UPDATE|SELECT)\b/i.test(`${found[1]} ${found[3] || ""}`)) {
        return null;
    }
    const items = found[1].split(",").map((item) => item.trim());
    if (!items.every((item) => PLAIN_ITEM.test(item))) {
        return null;
    }
    const parts = found[2].split(/\s*\.\s*(?=`|[\w$])/).map(unquoted);
    const [ base, table ] = parts.length === 2 ? parts : [ db, parts[0] ];
    let structure;
    try {
        if ((await readTables(base)).find((one) => one.name.toLowerCase() === table.toLowerCase())?.view !== false) {
            return null;
        }
        structure = await readStructure(base, table);
    } catch {
        return null;
    }
    const columns = set.columns.map((name) => structure.columns.find((column) => column.name === name) || null);
    const unique  = new Set(set.columns).size === set.columns.length;
    if (!structure.primary.length || !unique || columns.includes(null) || !structure.primary.every((name) => set.columns.includes(name))) {
        return null;
    }
    return {
        db      : structure.db,
        table   : structure.table,
        primary : structure.primary,
        columns : columns.map((column) => ({ name : column.name, binary : column.binary, dataType : column.dataType, generated : [ "virtual", "stored" ].includes(column.value.kind) })),
    };
}


// -------------------------------------------------------- export and import ---

/**
 * Runs an uploaded .sql file, or a .sql.gz, into a database, streamed from
 * the request into the mariadb client, so a dump of any size goes through.
 * The client stops at the first statement that fails, and says which.
 */
async function importDatabase(request, { db, name = "" }) {
    db = await existingDatabase(db);
    const client = spawn("mariadb", [ "-D", db ], { env : runEnv() });
    let said = "";
    client.stderr.on("data", (chunk) => { said += chunk; });
    const done = new Promise((resolve) => client.on("close", resolve));
    const input = /\.gz$/i.test(name) ? request.pipe(zlib.createGunzip()) : request;
    input.on("error", () => client.stdin.destroy());
    client.stdin.on("error", () => {});
    input.pipe(client.stdin);
    const code = await done;
    forgetDatabases();
    if (code !== 0) {
        const error = said.match(/^ERROR \d+ \([\w]+\) at line (\d+): (.*)$/m);
        throw new Error(error ? `Stopped at line ${error[1]} of the file: ${error[2]}` : said.trim() || "The import failed");
    }
    return { message : `Imported ${name || "the file"} into ${db}` };
}


// ----------------------------------------------------------------- helpers ---

/**
 * Runs SQL in the mariadb client, given on stdin, and reads every result
 * from its XML, which keeps a NULL apart from the text NULL, and tabs and
 * newlines in the values as they are. A failure is thrown with MariaDB's
 * own words, and the line, for SQL of several.
 */
async function query(sql, db = "", timeout = 30_000) {
    const result = await run("mariadb", [ "--xml", ...(db ? [ "-D", db ] : []) ], timeout, sql);
    if (!result.ok) {
        const said = result.stderr.match(/^ERROR \d+ \([\w]+\)( at line \d+)?: (.*)$/m);
        throw new Error(said ? `${said[2]}${said[1] && sql.includes("\n") ? ` (${said[1].trim()})` : ""}` : result.stderr.trim() || "MariaDB did not answer");
    }
    return parseResults(result.stdout);
}

/** Each result set of the client's XML: its statement, its columns and its rows, null for NULL. */
function parseResults(xml) {
    const sets = [];
    for (const set of xml.matchAll(/<resultset statement="([^"]*)"[^>]*>([\s\S]*?)<\/resultset>/g)) {
        let columns = [];
        const rows  = [];
        for (const row of set[2].matchAll(/<row>([\s\S]*?)<\/row>/g)) {
            const names  = [];
            const values = [];
            for (const field of row[1].matchAll(/<field name="([^"]*)"(?:\s+xsi:nil="true"\s*\/>|>([\s\S]*?)<\/field>)/g)) {
                names.push(decode(field[1]));
                values.push(field[2] === undefined ? null : decode(field[2]));
            }
            columns = columns.length ? columns : names;
            rows.push(values);
        }
        sets.push({ statement : decode(set[1]), columns, rows });
    }
    return sets;
}

function decode(text) {
    return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (_, name) => {
        if (name[0] === "#") {
            return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
        }
        return { lt : "<", gt : ">", amp : "&", quot : "\"", apos : "'" }[name];
    });
}

/** The PATH the other commands run with, for the ones spawned to stream. */
function runEnv() {
    return { ...process.env, PATH };
}

/** A database there now; one made since the list was kept, in another client say, is found too. */
async function existingDatabase(name) {
    let { list } = await readDatabases();
    if (!list.some((db) => db.name === name)) {
        forgetDatabases();
        ({ list } = await readDatabases());
    }
    if (!list.some((db) => db.name === name)) {
        throw new Error(`There is no database ${name}`);
    }
    return name;
}

async function existingTable(db, table) {
    db = await existingDatabase(db);
    const [ set ] = await query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quote(db)} AND TABLE_NAME = ${quote(String(table || ""))};`);
    if (!set.rows.length) {
        throw new Error(`There is no table ${table} in ${db}`);
    }
    return { db, table : set.rows[0][0] };
}

/** A name in backticks, with any backtick in it doubled. */
function ident(name) {
    return `\`${String(name).replace(/`/g, "``")}\``;
}

module.exports = {
    readTables,
    readStructure,
    readRows,
    countRows,
    countSmallTables,
    readEngines,
    changeTable,
    saveForeignKey,
    dropForeignKey,
    maintainTables,
    createTable,
    renameTable,
    duplicateTable,
    emptyTable,
    dropTable,
    nextId,
    readRow,
    saveRow,
    deleteRow,
    setColumn,
    addIndex,
    dropIndex,
    saveColumn,
    moveColumn,
    dropColumn,
    runSql,
    importDatabase,
    existingDatabase,
    keysWhere,
    whereOf,
    decode,
    ident,
    runEnv,
};
