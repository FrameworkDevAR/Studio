"use strict";

// What is done to a table as a whole: its options, and adding, renaming, copying,
// emptying, dropping and maintaining tables.

const { readCharsets, quote, forgetDatabases } = require("./databases");
const { query, existingDatabase, existingTable, ident } = require("./client");
const { readTables, readStructure, readEngines } = require("./schema");
const { columnSql } = require("./structure");


/**
 * Changes a table's options, as Sequel Ace's Table Information does: its
 * engine, its encoding -- the default for new columns, or converting the
 * columns too -- its comment and the next auto_increment id. Only what is
 * given changes; a new engine or a conversion rewrites the table, so it is
 * given minutes.
 * @param {{ db: string, table: string, engine?: string, charset?: string,
 *     collation?: string, convert?: boolean, comment?: string,
 *     next?: number | string }} change
 * @returns {Promise<{ message: string }>}
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
            throw new Error(`MariaDB has no encoding ${charset}${
                collation ? ` with ${collation}` : ""
            }`);
        }
        specs.push(`${convert ? "CONVERT TO" : "DEFAULT"} CHARACTER SET ${charset}${
            collation ? ` COLLATE ${collation}` : ""
        }`);
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
    await query(
        `ALTER TABLE ${ident(structure.db)}.${ident(structure.table)} ${specs.join(", ")};`,
        "",
        10 * 60_000,
    );
    forgetDatabases();
    return { message : `Changed ${structure.table}` };
}


// ------------------------------------------------------------------ tables ---

/**
 * A table's name, new or given anew: 1 to 64 characters, not ending in a space.
 * @param {string} name
 * @returns {string}
 */
function tableName(name) {
    name = String(name || "");
    if (!name.trim() || name.length > 64 || /\s$/.test(name)) {
        throw new Error("A table's name is 1 to 64 characters, not ending in a space");
    }
    return name;
}

/**
 * Whether a table there is a view, which is renamed, copied and dropped as one.
 * @param {string} db
 * @param {string} table
 * @returns {Promise<{ db: string, table: string, view: boolean, target: string }>}
 */
async function kindOf(db, table) {
    ({ db, table } = await existingTable(db, table));
    const [ set ] = await query(`SELECT TABLE_TYPE FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ${quote(db)} AND TABLE_NAME = ${quote(table)};`);
    return {
        db,
        table,
        view   : set.rows[0]?.[0] === "VIEW",
        target : `${ident(db)}.${ident(table)}`,
    };
}

/**
 * Refuses to empty or drop a table another refers to with a foreign key,
 * naming those, as MariaDB's own error doesn't.
 * @param {{ db: string, table: string }} old
 * @param {string} doing
 * @returns {Promise<void>}
 */
async function unreferenced(old, doing) {
    const [ set ] = await query(`
        SELECT DISTINCT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE REFERENCED_TABLE_SCHEMA = ${quote(old.db)}
            AND REFERENCED_TABLE_NAME = ${quote(old.table)}
            AND NOT (TABLE_SCHEMA = ${quote(old.db)} AND TABLE_NAME = ${quote(old.table)})
        ORDER BY TABLE_NAME;
    `);
    const names = set.rows.map(([ name ]) => name);
    if (names.length) {
        throw new Error(`${names.join(", ")} ${names.length === 1 ? "refers" : "refer"} to ${
            old.table
        } with a foreign key, so it can't be ${doing}: drop that key first`);
    }
}

/**
 * A new table, as Sequel Ace makes one: its name, a first column, as the
 * column dialog gives it, the primary key on it or not, and its engine,
 * collation and comment, or the database's and MariaDB's when not given.
 * @param {{ db: string, name: string, column: import("./structure").ColumnDefinition,
 *     primary?: boolean, engine?: string, collation?: string, comment?: string }} table
 * @returns {Promise<{ message: string, table: string }>}
 */
async function createTable({
    db, name, column, primary = true, engine = "", collation = "", comment = ""
}) {
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
    await query(`CREATE TABLE ${ident(db)}.${ident(name)} (\n  ${
        specs.join(",\n  ")
    }\n) ${options.join(" ")};`);
    forgetDatabases();
    return { message : `Created the table ${name}`, table : name };
}

/**
 * Renames a table or a view, in its database.
 * @param {{ db: string, table: string, name: string }} rename
 * @returns {Promise<{ message: string, table: string }>}
 */
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
 * @param {{ db: string, table: string, name: string, data?: boolean }} copy
 * @returns {Promise<{ message: string, table: string }>}
 */
async function duplicateTable({ db, table, name, data = true }) {
    const old = await kindOf(db, table);
    name = tableName(name);
    const target = `${ident(old.db)}.${ident(name)}`;
    if (old.view) {
        const [ set ] = await query(`SELECT VIEW_DEFINITION FROM information_schema.VIEWS
            WHERE TABLE_SCHEMA = ${quote(old.db)} AND TABLE_NAME = ${quote(old.table)};`);
        await query(`CREATE VIEW ${target} AS ${set.rows[0][0]};`);
        forgetDatabases();
        return { message : `Copied the view ${old.table} to ${name}`, table : name };
    }
    const structure = await readStructure(old.db, old.table);
    await query(`CREATE TABLE ${target} LIKE ${old.target};`);
    if (data) {
        const columns = structure.columns
            .filter((one) => one.value.kind !== "virtual" && one.value.kind !== "stored")
            .map((one) => ident(one.name))
            .join(", ");
        try {
            await query(
                `INSERT INTO ${target} (${columns}) SELECT ${columns} FROM ${old.target};`,
                "",
                30 * 60_000,
            );
        } catch (error) {
            // No half copy is left behind.
            await query(`DROP TABLE IF EXISTS ${target};`).catch(() => {});
            throw error;
        }
    }
    forgetDatabases();
    const left = structure.foreign.length ? ", without its foreign keys" : "";
    return {
        message : `Copied ${old.table} to ${name}${data ? "" : ", without its rows"}${left}`,
        table   : name,
    };
}

/**
 * Empties a table, as TRUNCATE does: its rows gone, and its auto_increment back to 1.
 * @param {{ db: string, table: string }} empty
 * @returns {Promise<{ message: string }>}
 */
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

/**
 * Drops a table, unless another refers to it with a foreign key, or a view.
 * @param {{ db: string, table: string }} drop
 * @returns {Promise<{ message: string }>}
 */
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
 * @param {{ db: string, tables?: string[],
 *     op: "optimize" | "analyze" | "check" | "repair" }} upkeep
 * @returns {Promise<{ time: number, results: { table: string,
 *     said: { type: string, text: string }[] }[] }>}
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
    const picked = all.filter((one) => list.includes(one.name) && (op === "check" || !one.view))
        .map((one) => one.name);
    if (!picked.length) {
        throw new Error(list.length ? "Views can only be checked" : "Pick a table");
    }
    const start = Date.now();
    const [ set ] = await query(
        `${verb} TABLE ${picked.map((name) => `${ident(db)}.${ident(name)}`).join(", ")};`,
        "",
        60 * 60_000,
    );
    forgetDatabases();
    const byTable = new Map(picked.map((name) => [ name, [] ]));
    for (const [ table, , type, text ] of set.rows) {
        // MariaDB names each db.table.
        const name = String(table).slice(db.length + 1);
        // InnoDB's way of saying it optimized, which reads as if it didn't.
        const said = /does not support optimize, doing recreate \+ analyze instead/i.test(text)
            ? "InnoDB optimizes by rebuilding the table and analyzing it, which it did"
            : text;
        (byTable.get(name) || byTable.set(name, []).get(name)).push({
            type : String(type).toLowerCase(),
            text : said,
        });
    }
    return {
        time    : Date.now() - start,
        results : [ ...byTable ].map(([ table, said ]) => ({ table, said })),
    };
}

/**
 * The id after the highest of the table's auto_increment column: where a reset of its next id
 * puts it.
 * @param {{ db: string, table: string }} pick
 * @returns {Promise<{ next: string }>}
 */
async function nextId({ db, table }) {
    const structure = await readStructure(db, table);
    const column    = structure.columns.find((one) => /auto_increment/i.test(one.extra));
    if (!column) {
        throw new Error(`${structure.table} has no auto_increment column`);
    }
    const [ set ] = await query(`SELECT COALESCE(MAX(${ident(column.name)}), 0) + 1
        FROM ${ident(structure.db)}.${ident(structure.table)};`);
    return { next : set.rows[0][0] };
}



// The public API
module.exports = {
    changeTable,
    createTable,
    renameTable,
    duplicateTable,
    emptyTable,
    dropTable,
    maintainTables,
    nextId,
};
