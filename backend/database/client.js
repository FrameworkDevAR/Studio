"use strict";

// The mariadb client, which every query goes through, and the names a query is
// given: a database or a table that is there, and any name in backticks.

const { PATH, run } = require("../core/system");
const { readDatabases, forgetDatabases, quote } = require("./databases");


// ----------------------------------------------------------------- helpers ---

/**
 * A result set of the client: its statement, its column names, and its rows, null for NULL.
 * @typedef {{ statement: string, columns: string[], rows: string[][] }} ResultSet
 */

/**
 * Runs SQL in the mariadb client, given on stdin, and reads every result
 * from its XML, which keeps a NULL apart from the text NULL, and tabs and
 * newlines in the values as they are. A failure is thrown with MariaDB's
 * own words, and the line, for SQL of several.
 * @param {string} sql
 * @param {string=} db
 * @param {number=} timeout
 * @returns {Promise<ResultSet[]>}
 */
async function query(sql, db = "", timeout = 30_000) {
    const result = await run("mariadb", [ "--xml", ...(db ? [ "-D", db ] : []) ], timeout, sql);
    if (!result.ok) {
        const said = result.stderr.match(/^ERROR \d+ \([\w]+\)( at line \d+)?: (.*)$/m);
        throw new Error(said
            ? `${said[2]}${said[1] && sql.includes("\n") ? ` (${said[1].trim()})` : ""}`
            : result.stderr.trim() || "MariaDB did not answer");
    }

    return parseResults(result.stdout);
}

/**
 * Each result set of the client's XML: its statement, its columns and its rows, null for NULL.
 * @param {string} xml
 * @returns {ResultSet[]}
 */
function parseResults(xml) {
    const sets = [];

    for (const set of xml.matchAll(
        /<resultset statement="([^"]*)"[^>]*>([\s\S]*?)<\/resultset>/g,
    )) {
        let columns = [];
        const rows  = [];

        for (const row of set[2].matchAll(/<row>([\s\S]*?)<\/row>/g)) {
            const names  = [];
            const values = [];

            for (const field of row[1].matchAll(
                /<field name="([^"]*)"(?:\s+xsi:nil="true"\s*\/>|>([\s\S]*?)<\/field>)/g,
            )) {
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

/**
 * Turns the XML's entities back into the characters they stand for.
 * @param {string} text
 * @returns {string}
 */
function decode(text) {
    return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (_, name) => {
        if (name[0] === "#") {
            return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16)
                : Number(name.slice(1)));
        }
        return { lt : "<", gt : ">", amp : "&", quot : "\"", apos : "'" }[name];
    });
}

/**
 * The PATH the other commands run with, for the ones spawned to stream.
 * @returns {NodeJS.ProcessEnv}
 */
function runEnv() {
    return { ...process.env, PATH };
}

/**
 * A database there now; one made since the list was kept, in another client say, is found too.
 * @param {string} name
 * @returns {Promise<string>}
 */
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

/**
 * A table there now, in a database there now, with its name as MariaDB has it.
 * @param {string} db
 * @param {string} table
 * @returns {Promise<{ db: string, table: string }>}
 */
async function existingTable(db, table) {
    db = await existingDatabase(db);

    const [ set ] = await query(`SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ${quote(db)} AND TABLE_NAME = ${quote(String(table || ""))};`);
    if (!set.rows.length) {
        throw new Error(`There is no table ${table} in ${db}`);
    }

    return { db, table : set.rows[0][0] };
}

/**
 * A name in backticks, with any backtick in it doubled.
 * @param {string} name
 * @returns {string}
 */
function ident(name) {
    return `\`${String(name).replace(/`/g, "``")}\``;
}



// The public API
module.exports = {
    query,
    decode,
    runEnv,
    existingDatabase,
    existingTable,
    ident,
};
