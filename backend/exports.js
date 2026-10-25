"use strict";

const crypto = require("crypto");
const zlib   = require("zlib");
const { spawn } = require("child_process");

// Exports, as Sequel Ace's: tables picked from a database, or a table's rows
// -- all, the ones its filters show, or the ones picked -- as SQL, CSV or
// JSON. SQL is mariadb-dump's, with the structure, the data or both; CSV and
// JSON are written here, row by row, as MariaDB sends them, so a table of
// any size goes through. Several tables in CSV come as a .zip, a file each.

const tables = require("./tables");
const { ident, runEnv } = tables;

// What to export is sent first, in an action, as a list of tables or of rows
// is too long for an address; the download then asks for it by its id, once.
const prepared = new Map();
const KEEP     = 5 * 60_000;

/**
 * Checks what is asked for and keeps it, for the download to take: the
 * database, the format, gzip, and either the tables, with the structure, the
 * data or both, for SQL, or a table's rows, by its filters or by keys.
 */
async function prepareExport(spec) {
    const format = [ "sql", "csv", "json" ].includes(spec.format) ? spec.format : null;
    if (!format) {
        throw new Error("Export as SQL, CSV or JSON");
    }
    const db   = await tables.existingDatabase(spec.db);
    const job  = { db, format, gzip : Boolean(spec.gzip), structure : spec.structure !== false, data : spec.data !== false,
        separator : [ ",", ";", "\t" ].includes(spec.separator) ? spec.separator : ",", header : spec.header !== false };
    if (format === "sql" && !job.structure && !job.data) {
        throw new Error("Export the structure, the data, or both");
    }
    if (spec.sql) {
        // A query's results, run again whole, read only, as CSV or JSON; its column names as the result had them.
        const sql = String(spec.sql).trim().replace(/;\s*$/, "");
        const bare = sql.replace(/^(\s*(--[^\n]*\n|#[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, "");
        if (format === "sql") {
            throw new Error("A query's results export as CSV or JSON");
        }
        if (!/^(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC|VALUES|TABLE)\b/i.test(bare)) {
            throw new Error("Only a query that reads, as SELECT or SHOW, exports its results");
        }
        if (statementCount(sql) > 1) {
            throw new Error("Export one query's results at a time");
        }
        job.sql     = sql;
        job.columns = [].concat(spec.columns || []).map(String);
        job.part    = "query";
    } else if (spec.table) {
        // A table's rows: the ones its filters show, in its order, or the ones picked.
        const structure = await tables.readStructure(db, spec.table);
        job.table = structure.table;
        job.where = spec.keys ? `WHERE ${tables.keysWhere(structure, spec.keys)}` : tables.whereOf(structure.columns, spec.filters || "[]", spec.match);
        job.sort  = structure.columns.some((column) => column.name === spec.sort) ? { name : spec.sort, dir : spec.dir === "desc" ? "DESC" : "ASC" } : null;
        job.part  = spec.keys ? "rows" : job.where ? "filtered" : "";
    } else {
        const all  = await tables.readTables(db);
        const list = [].concat(spec.tables || []).map(String);
        if (!list.length) {
            throw new Error("Pick at least one table");
        }
        const missing = list.find((name) => !all.some((one) => one.name === name));
        if (missing) {
            throw new Error(`There is no table ${missing} in ${db}`);
        }
        job.tables = all.filter((one) => list.includes(one.name)).map((one) => one.name);
        job.whole  = job.tables.length === all.length;
        // Views have no rows of their own to write as CSV or JSON.
        if (format !== "sql") {
            job.tables = all.filter((one) => job.tables.includes(one.name) && !one.view).map((one) => one.name);
            if (!job.tables.length) {
                throw new Error("Views hold no rows of their own: pick a table");
            }
        }
    }
    const id = crypto.randomUUID();
    prepared.set(id, job);
    setTimeout(() => prepared.delete(id), KEEP).unref();
    return { id };
}

/** How many statements SQL holds: split at each ; outside quotes, backticks and comments. */
function statementCount(sql) {
    let count = 0, some = false;
    for (let at = 0; at < sql.length; at++) {
        const char = sql[at];
        if (char === "'" || char === "\"" || char === "`") {
            for (at++; at < sql.length && sql[at] !== char; at++) {
                if (sql[at] === "\\" && char !== "`") {
                    at++;
                }
            }
            some = true;
        } else if (char === "#" || char === "-" && sql[at + 1] === "-") {
            const end = sql.indexOf("\n", at);
            at = end < 0 ? sql.length : end;
        } else if (char === "/" && sql[at + 1] === "*") {
            const end = sql.indexOf("*/", at + 2);
            at = end < 0 ? sql.length : end + 1;
        } else if (char === ";") {
            count += some ? 1 : 0;
            some   = false;
        } else if (!/\s/.test(char)) {
            some = true;
        }
    }
    return count + (some ? 1 : 0);
}

/** Streams the export kept by its id, once, as a file to download. */
async function runExport(response, id) {
    const job = prepared.get(String(id));
    prepared.delete(String(id));
    if (!job) {
        throw new Error("This export is gone: start it again");
    }
    const day   = new Date().toISOString().slice(0, 10);
    const base  = [ job.db, job.table || (job.tables?.length === 1 ? job.tables[0] : ""), job.part, day ].filter(Boolean).join("-").replace(/[^\w.\-]+/g, "_");
    const zip   = job.format === "csv" && !job.table && job.tables?.length > 1;
    const gzip  = job.gzip && !zip;
    const ext   = zip ? "zip" : job.format;
    const type  = { sql : "application/sql", csv : "text/csv", json : "application/json", zip : "application/zip" }[ext];
    response.writeHead(200, {
        "Content-Type"        : gzip ? "application/gzip" : `${type}; charset=utf-8`,
        "Content-Disposition" : `attachment; filename="${base}.${ext}${gzip ? ".gz" : ""}"`,
        "Cache-Control"       : "no-store",
    });
    const gzipper = gzip ? zlib.createGzip() : null;
    gzipper?.pipe(response);
    const out    = gzipper || response;
    const closed = { now : false };
    response.on("close", () => { closed.now = true; });
    try {
        if (job.format === "sql") {
            await dumpSql(job, out, closed);
        } else if (zip) {
            await writeZip(job, out, closed);
        } else if (job.format === "csv") {
            await writeCsv(job, job.sql ? null : job.table || job.tables[0], out, closed);
        } else {
            await writeJson(job, out, closed);
        }
    } catch (error) {
        // The file has started, so the failure is written in it.
        const note = job.format === "sql" ? `\n-- Studio: the export did not finish: ${error.message}\n` : `\nStudio: the export did not finish: ${error.message}\n`;
        if (!closed.now) {
            out.write(note);
        }
    }
    out.end();
}

// ---------------------------------------------------------------------- SQL ---

/**
 * mariadb-dump of the tables picked, or of a table's rows by a WHERE: their
 * CREATE, their INSERTs, or both. The routines and events come with the
 * structure of a whole database; the triggers, with any table's.
 */
function dumpSql(job, out, closed) {
    const args = [ "--single-transaction", "--hex-blob" ];
    if (!job.data) {
        args.push("--no-data");
    }
    if (!job.structure) {
        args.push("--no-create-info", "--skip-triggers");
    }
    if (job.structure && job.whole) {
        args.push("--routines", "--events");
    }
    if (job.table && job.where) {
        args.push(`--where=${job.where.replace(/^WHERE /, "")}`);
    }
    // Every table of the database is the database itself, which keeps the views in order after the tables.
    args.push(job.db, ...(job.table ? [ job.table ] : job.whole ? [] : job.tables));
    return new Promise((resolve, reject) => {
        const dump = spawn("mariadb-dump", args, { env : runEnv() });
        let said   = "";
        dump.stderr.on("data", (chunk) => { said += chunk; });
        dump.stdout.pipe(out, { end : false });
        dump.on("error", reject);
        dump.on("close", (code) => (code === 0 || closed.now ? resolve() : reject(new Error(said.trim().replace(/\n/g, " ") || "mariadb-dump stopped"))));
        out.on("close", () => dump.kill());
        if (closed.now) {
            dump.kill();
        }
    });
}

// ------------------------------------------------------------ CSV and JSON ---

/**
 * A table's rows, as MariaDB sends them, a row at a time, to the function
 * given, which waits when the download does. Binary values come as hex.
 */
async function eachRow(job, table, onColumns, onRow, closed) {
    let sql, columns;
    if (job.sql) {
        // A query, in a transaction that can't write, so running it again changes nothing.
        columns = job.columns.map((name) => ({ name, binary : false, dataType : "" }));
        sql     = `START TRANSACTION READ ONLY;\n${job.sql};\nCOMMIT;`;
    } else {
        const structure = await tables.readStructure(job.db, table);
        const select    = structure.columns.map((column) => (column.binary ? `HEX(${ident(column.name)}) AS ${ident(column.name)}` : ident(column.name)));
        const order     = job.table && job.sort ? `ORDER BY ${ident(job.sort.name)} ${job.sort.dir}`
            : structure.primary.length ? `ORDER BY ${structure.primary.map(ident).join(", ")}` : "";
        columns = structure.columns;
        sql     = `SELECT ${select.join(", ")} FROM ${ident(structure.table)} ${job.table ? job.where : ""} ${order};`;
    }
    await onColumns(columns);
    const client = spawn("mariadb", [ "--xml", "--quick", "-D", job.db ], { env : runEnv() });
    client.stdin.end(sql);
    client.stdout.setEncoding("utf8");
    let said = "";
    client.stderr.on("data", (chunk) => { said += chunk; });
    const done = new Promise((resolve) => client.on("close", resolve));
    let rest = "";
    try {
        for await (const chunk of client.stdout) {
            if (closed.now) {
                break;
            }
            rest += chunk;
            const end = rest.lastIndexOf("</row>");
            if (end < 0) {
                continue;
            }
            const whole = rest.slice(0, end + 6);
            rest = rest.slice(end + 6);
            for (const row of whole.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
                const values = [ ...row[1].matchAll(/<field name="[^"]*"(?:\s+xsi:nil="true"\s*\/>|>([\s\S]*?)<\/field>)/g)]
                    .map((field) => (field[1] === undefined ? null : tables.decode(field[1])));
                await onRow(values, columns);
            }
        }
    } finally {
        client.kill();
    }
    const code = await done;
    if (code !== 0 && !closed.now && said) {
        const line = said.match(/^ERROR \d+ \([\w]+\)(?: at line \d+)?: (.*)$/m);
        throw new Error(line ? line[1] : said.trim());
    }
}

/** Writes, and waits for the download to take it when it is behind. */
function put(out, text) {
    return out.write(text) ? null : new Promise((resolve) => out.once("drain", resolve));
}

/** A CSV field: quoted when it holds the separator, a quote or a line; NULL an empty field, unquoted. */
function csvField(value, column, separator) {
    if (value === null) {
        return "";
    }
    const text = column.binary ? `0x${value}` : value;
    return text === "" || text.includes(separator) || /["\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function writeCsv(job, table, out, closed) {
    const line = (fields) => `${fields.join(job.separator)}\r\n`;
    await eachRow(job, table,
        (columns) => (job.header ? put(out, line(columns.map((column) => csvField(column.name, {}, job.separator)))) : null),
        (values, columns) => put(out, line(values.map((value, at) => csvField(value, columns[at], job.separator)))),
        closed);
}

/** A JSON value: whole numbers and floats as numbers, when they fit; the rest as text, binary as 0x hex. */
function jsonValue(value, column) {
    if (value === null) {
        return null;
    }
    if (column.binary) {
        return `0x${value}`;
    }
    if (/int$/.test(column.dataType) && Number.isSafeInteger(Number(value)) || /^(float|double)$/.test(column.dataType) && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return value;
}

/** An array of rows, as objects by column; several tables, an object of arrays by table. */
async function writeJson(job, out, closed) {
    const list = job.sql ? [ null ] : job.table ? [ job.table ] : job.tables;
    const many = list.length > 1;
    await put(out, many ? "{" : "");
    for (const [ at, table ] of list.entries()) {
        let first = true;
        await put(out, `${many ? `${at ? "," : ""}\n  ${JSON.stringify(table)}: ` : ""}[`);
        await eachRow(job, table, () => null, (values, columns) => {
            const text = JSON.stringify(Object.fromEntries(columns.map((column, place) => [ column.name, jsonValue(values[place], column) ])));
            const lead = first ? "\n" : ",\n";
            first = false;
            return put(out, `${lead}${many ? "    " : "  "}${text}`);
        }, closed);
        await put(out, `${first ? "" : `\n${many ? "  " : ""}`}]`);
    }
    await put(out, many ? "\n}\n" : "\n");
}

// ---------------------------------------------------------------------- zip ---

/**
 * A .zip of a CSV per table, written as it goes: each file deflated, its
 * sizes and checksum after it, and the list of files at the end. Up to 4 GB
 * in all, as zip without its 64-bit extension allows.
 */
async function writeZip(job, out, closed) {
    const entries = [];
    let   offset  = 0;
    const write   = async (buffer) => {
        offset += buffer.length;
        await put(out, buffer);
    };
    const now  = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const table of job.tables) {
        if (closed.now) {
            return;
        }
        const name  = Buffer.from(`${table}.csv`);
        const start = offset;
        const head  = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0);
        head.writeUInt16LE(20, 4);
        head.writeUInt16LE(0x0808, 6);
        head.writeUInt16LE(8, 8);
        head.writeUInt16LE(time, 10);
        head.writeUInt16LE(date, 12);
        head.writeUInt16LE(name.length, 26);
        await write(Buffer.concat([ head, name ]));
        // The CSV, deflated as it is written, counted and checked on the way.
        const deflate = zlib.createDeflateRaw();
        let crc = 0, size = 0, packed = 0;
        const pending = [];
        deflate.on("data", (chunk) => {
            packed += chunk.length;
            pending.push(write(chunk));
        });
        const sink = {
            write : (text) => {
                const bytes = Buffer.from(text);
                crc   = zlib.crc32(bytes, crc);
                size += bytes.length;
                return deflate.write(bytes);
            },
            once  : (event, listener) => deflate.once(event, listener),
        };
        await writeCsv(job, table, sink, closed);
        // Its last bytes come out once it has ended, after its input has.
        await new Promise((resolve) => {
            deflate.on("end", resolve);
            deflate.end();
        });
        await Promise.all(pending);
        const tail = Buffer.alloc(16);
        tail.writeUInt32LE(0x08074b50, 0);
        tail.writeUInt32LE(crc >>> 0, 4);
        tail.writeUInt32LE(packed, 8);
        tail.writeUInt32LE(size, 12);
        await write(tail);
        entries.push({ name, crc, size, packed, start });
    }
    const listStart = offset;
    for (const entry of entries) {
        const head = Buffer.alloc(46);
        head.writeUInt32LE(0x02014b50, 0);
        head.writeUInt16LE(20, 4);
        head.writeUInt16LE(20, 6);
        head.writeUInt16LE(0x0808, 8);
        head.writeUInt16LE(8, 10);
        head.writeUInt16LE(time, 12);
        head.writeUInt16LE(date, 14);
        head.writeUInt32LE(entry.crc >>> 0, 16);
        head.writeUInt32LE(entry.packed, 20);
        head.writeUInt32LE(entry.size, 24);
        head.writeUInt16LE(entry.name.length, 28);
        head.writeUInt32LE(entry.start, 42);
        await write(Buffer.concat([ head, entry.name ]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - listStart, 12);
    end.writeUInt32LE(listStart, 16);
    await write(end);
}

module.exports = { prepareExport, runExport };
