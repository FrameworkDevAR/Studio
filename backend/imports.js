"use strict";

const { spawn } = require("child_process");

// A CSV file into a table, as Sequel Ace's import: each of its columns to a
// column of the table, or left out; its rows read as they arrive and sent to
// MariaDB in batches, in one transaction, so a failure leaves an InnoDB
// table as it was. A row whose key is there already stops it, is skipped,
// or updates that row.

const tables = require("./tables");
const { quote, forgetDatabases } = require("./databases");
const { ident, runEnv } = tables;

const BATCH = 500;

/**
 * Reads a CSV a piece at a time: fields split at the separator outside
 * quotes, "" a quote in them, a line ending a row. A field empty and
 * unquoted is null, so NULL and '' come apart; one in quotes is text. A
 * quote or a \r at the end of a piece waits for the next, which tells
 * whether it is doubled, or a \r\n.
 */
function csvReader(separator, onRow) {
    let row = [], field = "", quoted = false, inQuotes = false, carry = "", first = true;
    const endField = () => {
        row.push(!quoted && field === "" ? null : field);
        field  = "";
        quoted = false;
    };
    const endRow = async () => {
        endField();
        // A blank line is no row.
        if (!(row.length === 1 && row[0] === null)) {
            await onRow(row);
        }
        row = [];
    };
    const read = async (text, last) => {
        for (let at = 0; at < text.length; at++) {
            const char = text[at];
            if (!last && at === text.length - 1 && (char === "\"" || char === "\r")) {
                carry = char;
                return;
            }
            if (inQuotes) {
                if (char !== "\"") {
                    field += char;
                } else if (text[at + 1] === "\"") {
                    field += "\"";
                    at++;
                } else {
                    inQuotes = false;
                }
            } else if (char === "\"" && field === "" && !quoted) {
                inQuotes = true;
                quoted   = true;
            } else if (char === separator) {
                endField();
            } else if (char === "\n" || char === "\r") {
                if (char === "\r" && text[at + 1] === "\n") {
                    at++;
                }
                await endRow();
            } else {
                field += char;
            }
        }
    };
    return {
        async write(text) {
            // The byte-order mark some programs start a CSV with, in the first piece with anything in it.
            if (first && text) {
                text  = text.replace(/^\uFEFF/, "");
                first = false;
            }
            const whole = carry + text;
            carry = "";
            await read(whole, false);
        },
        async end() {
            await read(carry, true);
            carry = "";
            if (field !== "" || row.length || quoted) {
                await endRow();
            }
        },
    };
}

/**
 * Imports the CSV in the request into a table: the table's column for each
 * of the file's, null to leave one out; its first line skipped when it
 * holds names; and what a row whose key is there does: error, skip or update.
 */
async function importCsv(request, { db, table, spec = "{}" }) {
    let options;
    try {
        options = JSON.parse(spec);
    } catch {
        throw new Error("The import's options could not be read");
    }
    const structure = await tables.readStructure(db, table);
    const engine    = (await tables.readTables(structure.db)).find((one) => one.name === structure.table)?.engine || "";
    const target    = `${ident(structure.db)}.${ident(structure.table)}`;
    const separator = [ ",", ";", "\t", "|" ].includes(options.separator) ? options.separator : ",";
    const duplicate = [ "error", "skip", "update" ].includes(options.duplicate) ? options.duplicate : "error";
    const mapping   = [].concat(options.mapping || []).map((name) => (name === null || name === "" ? null : String(name)));
    const used      = mapping.filter((name) => name !== null);
    if (!used.length) {
        throw new Error("Pick at least one column to import into");
    }
    if (new Set(used).size !== used.length) {
        throw new Error("Each column of the table takes one column of the file at most");
    }
    const columns = used.map((name) => {
        const column = structure.columns.find((one) => one.name === name);
        if (!column) {
            throw new Error(`${structure.table} has no column ${name}`);
        }
        if ([ "virtual", "stored" ].includes(column.value.kind)) {
            throw new Error(`${name} is generated: it makes its own values`);
        }
        return column;
    });
    const places = mapping.map((name, at) => (name === null ? -1 : at)).filter((at) => at >= 0);
    const verb   = duplicate === "skip" ? "INSERT IGNORE" : "INSERT";
    const tail   = duplicate === "update" ? ` ON DUPLICATE KEY UPDATE ${columns.map((column) => `${ident(column.name)} = VALUES(${ident(column.name)})`).join(", ")}` : "";
    // A value as SQL: NULL, a binary one's 0x hex as it is, as Studio exports it, or a text in quotes.
    const literal = (value, column) => (value === null ? "NULL"
        : column.binary && /^0x[\da-f]*$/i.test(value) ? (value.length > 2 ? value : "''")
            : quote(value));

    // The client stops at the first statement that fails, and the transaction with it.
    const client = spawn("mariadb", [ "--batch", "--skip-column-names", "-D", structure.db ], { env : runEnv() });
    let said = "", out = "", stopped = false;
    client.stderr.on("data", (chunk) => { said += chunk; });
    client.stdout.on("data", (chunk) => { out += chunk; });
    client.stdin.on("error", () => {});
    const done = new Promise((resolve) => client.on("close", (code) => {
        stopped = true;
        resolve(code);
    }));
    // Waits when the client is behind, and not at all once it has stopped.
    const send = (text) => (stopped || client.stdin.write(text) ? null : Promise.race([ new Promise((resolve) => client.stdin.once("drain", resolve)), done ]));

    let line = 0, read = 0, batch = [];
    const flush = async () => {
        if (batch.length) {
            await send(`${verb} INTO ${target} (${columns.map((column) => ident(column.name)).join(", ")}) VALUES\n${batch.join(",\n")}${tail};\nSET @studio_rows = @studio_rows + ROW_COUNT();\n`);
            batch = [];
        }
    };
    // Strict, so a value a column can't take stops the import, rather than going in as 0 or cut.
    await send("SET @studio_rows = 0;\nSET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_ALL_TABLES');\nSTART TRANSACTION;\n");
    const reader = csvReader(separator, async (row) => {
        line++;
        if (line === 1 && options.header) {
            return;
        }
        read++;
        batch.push(`(${places.map((at, place) => literal(row[at] ?? null, columns[place])).join(", ")})`);
        if (batch.length >= BATCH) {
            await flush();
        }
    });
    const decoder = new TextDecoder("utf-8");
    // The file is read to its end even once the client has stopped, so the answer still goes back.
    for await (const chunk of request) {
        if (!stopped) {
            await reader.write(decoder.decode(chunk, { stream : true }));
        }
    }
    if (!stopped) {
        await reader.write(decoder.decode());
        await reader.end();
        await flush();
        await send("COMMIT;\nSELECT @studio_rows;\n");
    }
    client.stdin.end();
    const code = await done;
    forgetDatabases();
    if (code !== 0) {
        const error = said.match(/^ERROR \d+ \([\w]+\)(?: at line \d+)?: (.*)$/m);
        const kept  = engine === "InnoDB" ? "Nothing was imported." : `${engine || "This"} table has no transactions: the rows before it may be in.`;
        throw new Error(`${error ? error[1] : said.trim() || "MariaDB stopped"}. ${kept}`);
    }
    const changed = Number(out.trim().split("\n").pop()) || 0;
    const rows    = (count) => `${count.toLocaleString()} ${count === 1 ? "row" : "rows"}`;
    const message = duplicate === "update" ? `Imported ${rows(read)} into ${structure.table}, adding or updating each`
        : duplicate === "skip" && changed < read ? `Added ${rows(changed)} to ${structure.table}; ${rows(read - changed)} already there ${read - changed === 1 ? "was" : "were"} skipped`
            : `Added ${rows(changed)} to ${structure.table}`;
    return { message, read, changed };
}

module.exports = { importCsv, csvReader };
