// What a database holds: its tables, with their sizes, a table's columns, indexes and
// foreign keys, and the engines MariaDB has.

import { quote } from "./databases.js";
import { query, existingDatabase, existingTable, ident } from "./client.js";



// Columns whose bytes are not text, shown by their size and never edited here.
const BINARY  = new RegExp(
    "^(binary|varbinary|tinyblob|blob|mediumblob|longblob|geometry|point|linestring|polygon|" +
    "multipoint|multilinestring|multipolygon|geometrycollection)$",
);



/**
 * A table or view as the database's list shows it: its rows, exact or estimated, engine,
 * collation, sizes, the space it could give back, and what its info shows.
 * @typedef {{ name: string, view: boolean, engine: string, rows: number, exact: boolean,
 *     data: number, index: number, size: number, free: number, collation: string,
 *     comment: string, format: string, next: number, average: number, most: number,
 *     created: string, updated: string }} TableEntry
 */

/**
 * What a column starts with, or is made from: its kind, and the value or expression.
 * @typedef {{ kind: "none" | "null" | "value" | "expression" | "stored" | "virtual",
 *     value: string }} ColumnValue
 */

/**
 * A column of a table, as information_schema has it, with what it starts with and whether its
 * bytes are not text.
 * @typedef {{ name: string, type: string, dataType: string, nullable: boolean,
 *     default: string, value: ColumnValue, key: string, extra: string, comment: string,
 *     collation: string, binary: boolean }} TableColumn
 */

/**
 * An index of a table, with its columns in order.
 * @typedef {{ name: string, unique: boolean, type: string, columns: string[] }} TableIndex
 */

/**
 * A foreign key of a table: its columns, and the table and columns they reference.
 * @typedef {{ name: string, columns: string[], db: string, table: string,
 *     references: string[], onDelete: string, onUpdate: string }} TableForeignKey
 */

/**
 * A table's structure, as readStructure gives it.
 * @typedef {{ db: string, table: string, columns: TableColumn[], indexes: TableIndex[],
 *     foreign: TableForeignKey[], primary: string[], create: string }} TableStructure
 */



// ------------------------------------------------------------------ reading ---

/**
 * The tables and views of a database, as phpMyAdmin lists them first: rows,
 * exact for MyISAM and Aria, which keep them, and estimated for InnoDB,
 * engine, collation, the data's and the indexes' sizes, the space a table
 * could give back, and its comment.
 * @param {string} db
 * @returns {Promise<TableEntry[]>}
 */
async function readTables(db) {
    db = await existingDatabase(db);
    const [ set ] = await query(`
        SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, DATA_FREE,
            TABLE_COLLATION, TABLE_COMMENT,
            ROW_FORMAT, AUTO_INCREMENT, CREATE_TIME, UPDATE_TIME, AVG_ROW_LENGTH, MAX_DATA_LENGTH
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quote(db)} ORDER BY TABLE_NAME
    `);

    return set.rows.map(([
        name, type, engine, rows, data, index, free, collation, comment, format, next, created,
        updated, average, most
    ]) => ({
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
 * @param {string} db
 * @param {string} table
 * @returns {Promise<TableStructure>}
 */
async function readStructure(db, table) {
    const existing = await existingTable(db, table);
    ({ db, table } = existing);
    const where = `TABLE_SCHEMA = ${quote(db)} AND TABLE_NAME = ${quote(table)}`;
    const [ columns, indexes, foreign, create ] = await query(`
        SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA,
            COLUMN_COMMENT, COLLATION_NAME, GENERATION_EXPRESSION
        FROM information_schema.COLUMNS WHERE ${where} ORDER BY ORDINAL_POSITION;
        SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, INDEX_TYPE
        FROM information_schema.STATISTICS WHERE ${where}
            ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX;
        SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
            k.REFERENCED_TABLE_SCHEMA, r.DELETE_RULE, r.UPDATE_RULE
        FROM information_schema.KEY_COLUMN_USAGE k
        LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
            ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME
            AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.${where.replace(" AND TABLE_NAME", " AND k.TABLE_NAME")}
            AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION;
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
        const key = byKey.get(name) || {
            name,
            columns    : [],
            db         : refDb,
            table      : refTable,
            references : [],
            onDelete   : onDelete || "RESTRICT",
            onUpdate   : onUpdate || "RESTRICT",
        };

        key.columns.push(column);
        key.references.push(refColumn);
        byKey.set(name, key);
    }

    return {
        db,
        table,
        columns : columns.rows.map(([
            name, type, dataType, nullable, preset, key, extra, comment, collation, generated
        ]) => ({
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
 * @param {string} preset
 * @param {string} generated
 * @param {string} extra
 * @returns {ColumnValue}
 */
function valueOf(preset, generated, extra) {
    if (generated) {
        return {
            kind  : /STORED|PERSISTENT/i.test(extra) ? "stored" : "virtual",
            value : generated,
        };
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
        return {
            kind  : "value",
            value : quoted[1].replace(
                /''|\\([\s\S])/g,
                (all, char) => (all === "''" ? "'" : escapes[char] ?? char),
            ),
        };
    }

    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(preset)) {
        return { kind : "value", value : preset };
    }
    return { kind : "expression", value : preset };
}


/**
 * The engines a table can be given: those MariaDB has on, its default first.
 * @returns {Promise<{ name: string, comment: string, preset: boolean }[]>}
 */
async function readEngines() {
    const [ set ] = await query(
        "SELECT ENGINE, SUPPORT, COMMENT FROM information_schema.ENGINES " +
        "WHERE SUPPORT IN ('YES', 'DEFAULT') ORDER BY SUPPORT = 'DEFAULT' DESC, ENGINE",
    );

    return set.rows.filter(([ name ]) => !/^(PERFORMANCE_SCHEMA|MRG_MyISAM|SEQUENCE)$/i.test(name))
        .map(([ name, support, comment ]) => ({ name, comment, preset : support === "DEFAULT" }));
}



// The public API
export {
    readTables,
    readStructure,
    readEngines,
};
