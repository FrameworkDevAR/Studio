"use strict";

// The databases MariaDB holds.

const { PHPMYADMIN, run } = require("./system");



/**
 * Each database with its size and table count. Asking information_schema
 * takes a moment with this many tables, so the answer is kept for 30s.
 */
let databaseCache = { at : 0, data : null };
async function readDatabases() {
    if (Date.now() - databaseCache.at < 30_000 && databaseCache.data) {
        return databaseCache.data;
    }

    const query = `
        SELECT s.schema_name, COALESCE(SUM(t.data_length + t.index_length), 0), COUNT(t.table_name)
        FROM information_schema.schemata s
        LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
        WHERE s.schema_name NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
        GROUP BY s.schema_name ORDER BY s.schema_name
    `;
    // As the user running Studio, which Homebrew's MariaDB lets in through its
    // socket; a ~/.my.cnf can name another.
    const result = await run("mariadb", [ "-N", "-B", "-e", query ]);
    if (!result.ok) {
        return { available : false, list : [] };
    }

    const list = result.stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [ name, size, tables ] = line.split("\t");
        return {
            name,
            size   : Number(size),
            tables : Number(tables),
            url    : `${PHPMYADMIN}/index.php?route=/database/structure&db=${encodeURIComponent(name)}`,
        };
    });
    databaseCache = { at : Date.now(), data : { available : true, list } };
    return databaseCache.data;
}

/** Drops the kept answer, after a service starts or stops. */
function forgetDatabases() {
    databaseCache.at = 0;
}

module.exports = {
    readDatabases,
    forgetDatabases,
};
