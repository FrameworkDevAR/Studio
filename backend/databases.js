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
    const [ result, users, grants ] = await Promise.all([
        run("mariadb", [ "-N", "-B", "-e", query ]),
        run("mariadb", [ "-N", "-B", "-e", "SELECT DISTINCT User FROM mysql.user WHERE User NOT IN ('', 'root', 'PUBLIC', 'mariadb.sys')" ]),
        run("mariadb", [ "-N", "-B", "-e", "SELECT User, Db FROM mysql.db WHERE User NOT IN ('', 'root', 'PUBLIC', 'mariadb.sys')" ]),
    ]);
    if (!result.ok) {
        return { available : false, list : [] };
    }

    const rows  = result.stdout.trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
    const owner = usersOf(rows.map(([ name ]) => name), linesOf(users), linesOf(grants).map((line) => line.split("\t")));
    const list  = rows.map(([ name, size, tables ]) => {
        return {
            name,
            size   : Number(size),
            tables : Number(tables),
            users  : owner(name),
            url    : `${PHPMYADMIN}/index.php?route=/database/structure&db=${encodeURIComponent(name)}`,
        };
    });
    databaseCache = { at : Date.now(), data : { available : true, list } };
    return databaseCache.data;
}

function linesOf(result) {
    return result.ok ? result.stdout.trim().split("\n").filter(Boolean) : [];
}

/**
 * The users of each database: the ones granted it, or else the one named like
 * it, as shop_us or shop_user for shop_db. A user named exactly as a
 * database belongs to that one only.
 */
function usersOf(databases, users, grants) {
    const stem    = (name) => name.replace(/_[^_]+$/, "");
    const matches = (pattern, name) => likeRegex(pattern).test(name);
    return (database) => {
        const granted = grants.filter(([ , pattern ]) => matches(pattern, database)).map(([ user ]) => user);
        if (granted.length) {
            return [ ...new Set(granted) ];
        }
        if (users.includes(database)) {
            return [ database ];
        }
        return users.filter((user) => !databases.includes(user) && stem(user) === stem(database));
    };
}

/** A grant's database, where _ and % are wildcards unless escaped, as a RegExp. */
function likeRegex(pattern) {
    let source = "";
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === "\\" && i + 1 < pattern.length) {
            source += escapeRegex(pattern[++i]);
        } else {
            source += char === "%" ? ".*" : char === "_" ? "." : escapeRegex(char);
        }
    }
    return new RegExp(`^${source}$`);
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drops the kept answer, after a service starts or stops. */
function forgetDatabases() {
    databaseCache.at = 0;
}

module.exports = {
    readDatabases,
    forgetDatabases,
};
