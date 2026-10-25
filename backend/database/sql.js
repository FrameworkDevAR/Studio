"use strict";

// SQL run in a database, with the results a plain SELECT of one table gives changed in
// place, and a dump imported.

const zlib = require("zlib");
const { spawn } = require("child_process");

const { forgetDatabases } = require("./databases");
const { query, existingDatabase, runEnv } = require("./client");
const { readTables, readStructure } = require("./schema");

// The most rows a query in the console shows.
const RESULTS = 1000;

/**
 * How a result's rows can be changed in place: the table, its key, and each column of the
 * result as the table's.
 * @typedef {{ db: string, table: string, primary: string[], columns: { name: string,
 *     binary: boolean, dataType: string, generated: boolean }[] }} SqlEditable
 */


// ---------------------------------------------------------------------- sql ---

/**
 * Runs the SQL typed in the console, in its database. Each result shows,
 * up to 1000 rows -- a SELECT without a LIMIT stops there -- and for the
 * last statement, the rows it changed.
 * @param {{ db: string, sql: string }} run
 * @returns {Promise<{ time: number, changed: number, results: { statement: string,
 *     columns: string[], rows: string[][], more: boolean, edit: SqlEditable }[] }>}
 */
async function runSql({ db, sql }) {
    db = await existingDatabase(db);
    const text = String(sql || "").trim();
    if (!text) {
        throw new Error("No SQL to run");
    }

    const start = Date.now();
    // The limit goes on a line before the SQL, so a line MariaDB names is one less.
    const sets  = await query(`SET SESSION sql_select_limit = ${RESULTS + 1};\n${
        text.replace(/;?\s*$/, ";")
    }\nSELECT ROW_COUNT() AS \`studio:changed\`;`, db, 120_000)
        .catch((error) => {
            throw new Error(error.message.replace(
                /\(at line (\d+)\)$/,
                (_, line) => (text.includes("\n") ? `(at line ${line - 1})` : "").trim(),
            ).trim());
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

// A plain SELECT of one table: its columns by name, or *, then its WHERE, ORDER BY and LIMIT,
// nothing else.
const NAME_SQL   = "(?:`(?:[^`]|``)+`|[\\w$]+)";
const PLAIN_FROM = new RegExp(`^\\s*SELECT\\s+([\\s\\S]+?)\\s+FROM\\s+(${
    NAME_SQL
}(?:\\s*\\.\\s*${NAME_SQL})?)\\s*((?:WHERE|ORDER\\s+BY|LIMIT)\\b[\\s\\S]*)?;?\\s*$`, "i");
const PLAIN_ITEM = new RegExp(`^(?:${NAME_SQL}\\s*\\.\\s*)?(?:${NAME_SQL}|\\*)$`);
/**
 * A name as it is, out of its backticks, with any doubled backtick in it single.
 * @param {string} name
 * @returns {string}
 */
const unquoted   = (name) => (name.startsWith("`") ? name.slice(1, -1).replace(/``/g, "`") : name);

/**
 * Whether a result's rows can be changed in place, as Sequel Ace allows: a
 * plain SELECT of one table, not a view, with its columns as they are named
 * -- no expressions, no aliases -- and its primary key among them. Then
 * the table, its key, and each column of the result as the table's.
 * @param {string} db
 * @param {import("./client").ResultSet} set
 * @returns {Promise<SqlEditable>}
 */
async function editableOf(db, set) {
    const found = String(set.statement).match(PLAIN_FROM);
    if (!found || /\b(JOIN|UNION|GROUP|HAVING|DISTINCT|INTO|FOR\s+UPDATE|SELECT)\b/i.test(
        `${found[1]} ${found[3] || ""}`,
    )) {
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
        if ((await readTables(base))
            .find((one) => one.name.toLowerCase() === table.toLowerCase())?.view !== false) {
            return null;
        }
        structure = await readStructure(base, table);
    } catch {
        return null;
    }

    const columns = set.columns
        .map((name) => structure.columns.find((column) => column.name === name) || null);
    const unique  = new Set(set.columns).size === set.columns.length;
    if (!structure.primary.length || !unique || columns.includes(null)
        || !structure.primary.every((name) => set.columns.includes(name))) {
        return null;
    }

    return {
        db      : structure.db,
        table   : structure.table,
        primary : structure.primary,
        columns : columns.map((column) => ({
            name      : column.name,
            binary    : column.binary,
            dataType  : column.dataType,
            generated : [ "virtual", "stored" ].includes(column.value.kind),
        })),
    };
}


// -------------------------------------------------------- export and import ---

/**
 * Runs an uploaded .sql file, or a .sql.gz, into a database, streamed from
 * the request into the mariadb client, so a dump of any size goes through.
 * The client stops at the first statement that fails, and says which.
 * @param {import("http").IncomingMessage} request
 * @param {{ db?: string, name?: string }} file
 * @returns {Promise<{ message: string }>}
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
        throw new Error(error ? `Stopped at line ${error[1]} of the file: ${error[2]}`
            : said.trim() || "The import failed");
    }

    return { message : `Imported ${name || "the file"} into ${db}` };
}



// The public API
module.exports = {
    runSql,
    importDatabase,
};
