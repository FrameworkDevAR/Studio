"use strict";

// The mariadb client, which every query goes through, and the names a query is
// given: a database or a table that is there, and any name in backticks.

const { PATH, run } = require("../core/system");
const { readDatabases, forgetDatabases, quote } = require("./databases");


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
        throw new Error(said
            ? `${said[2]}${said[1] && sql.includes("\n") ? ` (${said[1].trim()})` : ""}`
            : result.stderr.trim() || "MariaDB did not answer");
    }
    return parseResults(result.stdout);
}

/** Each result set of the client's XML: its statement, its columns and its rows, null for NULL. */
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

function decode(text) {
    return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (_, name) => {
        if (name[0] === "#") {
            return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16)
                : Number(name.slice(1)));
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
    const [ set ] = await query(`SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ${quote(db)} AND TABLE_NAME = ${quote(String(table || ""))};`);
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
    query,
    decode,
    runEnv,
    existingDatabase,
    existingTable,
    ident,
};
