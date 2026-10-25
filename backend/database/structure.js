"use strict";

// A table's structure changed: its indexes, its foreign keys and its columns.

const { readCharsets, quote, forgetDatabases } = require("./databases");
const { query, ident } = require("./client");
const { readTables, readStructure } = require("./schema");


// ------------------------------------------------------------------ indexes ---

/**
 * A column as the column dialog gives it: its name and type, its collation, whether it takes
 * NULL, what it starts with or is made from and the value or expression for it,
 * auto_increment, ON UPDATE, and its comment.
 * @typedef {{ name?: string, type?: string, nullable?: boolean,
 *     value?: "none" | "null" | "value" | "expression" | "virtual" | "stored",
 *     preset?: string, collation?: string, increment?: boolean, update?: boolean,
 *     comment?: string }} ColumnDefinition
 */

/** The kinds of index the page makes, as ALTER TABLE writes each. */
const INDEX_KINDS = {
    index    : "INDEX",
    unique   : "UNIQUE INDEX",
    fulltext : "FULLTEXT INDEX",
    primary  : "PRIMARY KEY",
};

/**
 * Adds an index on the columns given, in their order. MariaDB builds it
 * at once, which in a large table takes a while, so it is given minutes.
 * @param {{ db: string, table: string, name?: string,
 *     kind: "index" | "unique" | "fulltext" | "primary", columns: string[] }} index
 * @returns {Promise<{ message: string }>}
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
    await query(
        `ALTER TABLE ${ident(structure.db)}.${ident(structure.table)}
        ADD ${INDEX_KINDS[kind]}${label ? ` ${ident(label)}` : ""}
        (${list.map(ident).join(", ")});`,
        "",
        10 * 60_000,
    );
    forgetDatabases();
    return { message : `Added ${kind === "primary" ? "the primary key"
        : `the index ${label || list[0]}`} to ${structure.table}` };
}

/**
 * Drops an index of a table, by its name, or the primary key, as PRIMARY.
 * @param {{ db: string, table: string, name: string }} index
 * @returns {Promise<{ message: string }>}
 */
async function dropIndex({ db, table, name }) {
    const structure = await readStructure(db, table);
    if (!structure.indexes.some((index) => index.name === name)) {
        throw new Error(`${structure.table} has no index ${name}`);
    }
    const drop = name === "PRIMARY" ? "DROP PRIMARY KEY" : `DROP INDEX ${ident(name)}`;
    await query(
        `ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} ${drop};`,
        "",
        10 * 60_000,
    );
    forgetDatabases();
    return { message : `Dropped ${name === "PRIMARY" ? "the primary key"
        : `the index ${name}`} of ${structure.table}` };
}


// ------------------------------------------------------------- foreign keys ---

const FK_RULES = [ "RESTRICT", "CASCADE", "SET NULL", "NO ACTION" ];

/**
 * A column's type as a foreign key compares it: ints without their display width, the rest as
 * they are.
 * @param {import("./schema").TableColumn} column
 * @returns {string}
 */
function keyType(column) {
    return column.type
        .replace(/^((?:tiny|small|medium|big)?int)\(\d+\)/i, "$1")
        .replace(/\s+zerofill/i, "")
        .toLowerCase();
}

/**
 * Adds a foreign key, or changes one, by dropping it and adding it again in
 * the same ALTER: the columns, the table and columns they refer to, of this
 * database, and what a delete or an update there does here. What MariaDB
 * says vaguely -- errno 150, a row with no match -- is checked first, or
 * said plainly.
 * @param {{ db: string, table: string, name?: string, columns?: string[],
 *     refTable: string, refColumns?: string[], onDelete?: string, onUpdate?: string,
 *     replace?: string }} key
 * @returns {Promise<{ message: string }>}
 */
async function saveForeignKey({
    db, table, name = "", columns = [], refTable, refColumns = [],
    onDelete = "RESTRICT", onUpdate = "RESTRICT", replace = ""
}) {
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
            throw new Error(
                `${here.name} is ${here.type} and ${target.table}.${there.name} is ${there.type}: `
                + "a foreign key's columns are of the same type, unsigned or not alike",
            );
        }
        if ((onDelete === "SET NULL" || onUpdate === "SET NULL") && !here.nullable) {
            throw new Error(`SET NULL needs ${here.name} to take NULL`);
        }
        return [ here, there ];
    });
    // The columns referred to lead an index there, as MariaDB looks them up by it.
    if (!target.indexes.some((index) => refs.every((column, at) => index.columns[at] === column))) {
        throw new Error(
            `${target.table} has no index starting with ${refs.join(", ")}: add one there first, `
            + "or refer to its primary key",
        );
    }
    const specs = [];
    if (replace) {
        specs.push(`DROP FOREIGN KEY ${ident(replace)}`);
    }
    specs.push(`ADD${label ? ` CONSTRAINT ${ident(label)}` : ""}
        FOREIGN KEY (${pairs.map(([ here ]) => ident(here.name)).join(", ")})
        REFERENCES ${ident(target.table)}
        (${pairs.map(([ , there ]) => ident(there.name)).join(", ")})
        ON DELETE ${onDelete} ON UPDATE ${onUpdate}`);
    try {
        await query(
            `ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} ${specs.join(", ")};`,
            "",
            10 * 60_000,
        );
    } catch (error) {
        if (/a foreign key constraint fails/i.test(error.message)) {
            throw new Error(
                `Some rows of ${structure.table} have ${list.join(", ")} values with no match in `
                + `${target.table}: fix or clear them first`,
            );
        }
        if (/errno: 121|Duplicate key on write|duplicate.*constraint/i.test(error.message)) {
            throw new Error(
                `There is a foreign key named ${label} in this database already: pick another name`,
            );
        }
        throw error;
    }
    forgetDatabases();
    return { message : `${replace ? "Changed" : "Added"} the foreign key ${label
        || `on ${list.join(", ")}`}` };
}

/**
 * Drops a foreign key of a table, by its name.
 * @param {{ db: string, table: string, name: string }} key
 * @returns {Promise<{ message: string }>}
 */
async function dropForeignKey({ db, table, name }) {
    const structure = await readStructure(db, table);
    if (!structure.foreign.some((key) => key.name === name)) {
        throw new Error(`${structure.table} has no foreign key ${name}`);
    }
    await query(
        `ALTER TABLE ${ident(structure.db)}.${ident(structure.table)}
        DROP FOREIGN KEY ${ident(name)};`,
        "",
        10 * 60_000,
    );
    forgetDatabases();
    return { message : `Dropped the foreign key ${name}` };
}


// ------------------------------------------------------------------ columns ---

/*
 * A type as MariaDB writes one: its name, its size or its choices in
 * brackets, and unsigned or zerofill after. An enum's choices are texts in
 * quotes; nothing else in the brackets may end the statement.
 */
const COLUMN_TYPE = new RegExp(
    "^[a-z][a-z0-9 ]*?(\\s*\\((?:'(?:[^'\\\\]|\\\\.|'')*'|[^()';])*\\))?" +
    "(\\s+(unsigned|signed|zerofill))*$",
    "i",
);
const TEXT_TYPE   = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i;

/**
 * A column's definition, from what the column dialog gives: its name and
 * type, its collation when it holds text, whether it takes NULL, what it
 * starts with or is made from, auto_increment, ON UPDATE, and its comment.
 * @param {ColumnDefinition} definition
 * @returns {Promise<string>}
 */
async function columnSql({
    name, type, nullable, value = "none", preset = "", collation = "", increment, update,
    comment = ""
}) {
    name = String(name || "");
    type = String(type || "").trim();
    if (!name.trim() || name.length > 64 || /\s$/.test(name)) {
        throw new Error("A column's name is 1 to 64 characters, not ending in a space");
    }
    if (!COLUMN_TYPE.test(type)) {
        throw new Error(`${type
            || "An empty type"} is not a type MariaDB knows, as int, varchar(255) or enum('a','b')`,
        );
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
            throw new Error(
                "An expression is one, as current_timestamp() or `price` * 2, without ;",
            );
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

/**
 * Where a column goes: first, after another, or, given nothing, where it is, or at the end for a
 * new one.
 * @param {import("./schema").TableStructure} structure
 * @param {string | true} after
 * @returns {string}
 */
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

/**
 * Adds a column, or changes one, by its name as it was: its definition, name included, and its
 * place.
 * @param {{ db: string, table: string, column?: string, definition: ColumnDefinition,
 *     after?: string | true }} change
 * @returns {Promise<{ message: string }>}
 */
async function saveColumn({ db, table, column, definition, after }) {
    const structure = await readStructure(db, table);
    const target    = `${ident(structure.db)}.${ident(structure.table)}`;
    const sql       = await columnSql(definition || {});
    if (column && !structure.columns.some((one) => one.name === column)) {
        throw new Error(`${structure.table} has no column ${column}`);
    }
    await query(
        `ALTER TABLE ${target} ${column ? `CHANGE COLUMN ${ident(column)}` : "ADD COLUMN"}
        ${sql}${placeOf(structure, after)};`,
        "",
        10 * 60_000,
    );
    forgetDatabases();
    return { message : column ? `Changed the column ${definition.name}`
        : `Added the column ${definition.name} to ${structure.table}` };
}

/**
 * Moves a column, first or after another, with its definition as SHOW
 * CREATE TABLE gives it, so nothing of it is lost on the way.
 * @param {{ db: string, table: string, column: string, after?: string | true }} move
 * @returns {Promise<{ message: string }>}
 */
async function moveColumn({ db, table, column, after }) {
    const structure = await readStructure(db, table);
    const start     = `${ident(column)} `;
    const line      = structure.create.split("\n")
        .map((one) => one.trim())
        .find((one) => one.startsWith(start));
    if (!line || !structure.columns.some((one) => one.name === column)) {
        throw new Error(`${structure.table} has no column ${column}`);
    }
    await query(
        `ALTER TABLE ${ident(structure.db)}.${ident(structure.table)}
        MODIFY COLUMN ${line.replace(/,$/, "")}${placeOf(structure, after) || " FIRST"};`,
        "",
        10 * 60_000,
    );
    forgetDatabases();
    return { message : `Moved the column ${column}` };
}

/**
 * Drops a column of a table, which keeps at least one.
 * @param {{ db: string, table: string, column: string }} drop
 * @returns {Promise<{ message: string }>}
 */
async function dropColumn({ db, table, column }) {
    const structure = await readStructure(db, table);
    if (!structure.columns.some((one) => one.name === column)) {
        throw new Error(`${structure.table} has no column ${column}`);
    }
    if (structure.columns.length === 1) {
        throw new Error("A table keeps at least one column: drop the table instead");
    }
    await query(
        `ALTER TABLE ${ident(structure.db)}.${ident(structure.table)}
        DROP COLUMN ${ident(column)};`,
        "",
        10 * 60_000,
    );
    forgetDatabases();
    return { message : `Dropped the column ${column}` };
}



// The public API
module.exports = {
    addIndex,
    dropIndex,
    saveForeignKey,
    dropForeignKey,
    columnSql,
    saveColumn,
    moveColumn,
    dropColumn,
};
