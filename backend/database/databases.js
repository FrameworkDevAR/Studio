"use strict";

// The databases MariaDB holds and its users: listing them, and creating,
// changing and dropping either.

const { PHPMYADMIN, run } = require("../core/system");



// The accounts MariaDB keeps for itself, never listed.
const SYSTEM_USERS = [ "", "PUBLIC", "mariadb.sys" ];
// The schemas MariaDB keeps for itself, never listed or touched.
const SYSTEM_SCHEMAS = [ "information_schema", "performance_schema", "mysql", "sys" ];

/**
 * The privileges the page offers, each with its column in mysql.user and
 * mysql.db, and its group in the dialog. The server's own apply to every
 * database at once, so only a user that reaches them all can have them;
 * SHOW CREATE ROUTINE is the other way round, kept for one database only.
 */
const PRIVILEGES = [
    [ "SELECT",                  "Select_priv",              "Data" ],
    [ "INSERT",                  "Insert_priv",              "Data" ],
    [ "UPDATE",                  "Update_priv",              "Data" ],
    [ "DELETE",                  "Delete_priv",              "Data" ],
    [ "DELETE HISTORY",          "Delete_history_priv",      "Data" ],
    [ "CREATE",                  "Create_priv",              "Structure" ],
    [ "ALTER",                   "Alter_priv",               "Structure" ],
    [ "DROP",                    "Drop_priv",                "Structure" ],
    [ "INDEX",                   "Index_priv",               "Structure" ],
    [ "REFERENCES",              "References_priv",          "Structure" ],
    [ "CREATE TEMPORARY TABLES", "Create_tmp_table_priv",    "Structure" ],
    [ "LOCK TABLES",             "Lock_tables_priv",         "Structure" ],
    [ "CREATE VIEW",             "Create_view_priv",         "Routines" ],
    [ "SHOW VIEW",               "Show_view_priv",           "Routines" ],
    [ "CREATE ROUTINE",          "Create_routine_priv",      "Routines" ],
    [ "ALTER ROUTINE",           "Alter_routine_priv",       "Routines" ],
    [ "SHOW CREATE ROUTINE",     "Show_create_routine_priv", "Routines", "database" ],
    [ "EXECUTE",                 "Execute_priv",             "Routines" ],
    [ "EVENT",                   "Event_priv",               "Routines" ],
    [ "TRIGGER",                 "Trigger_priv",             "Routines" ],
    [ "SHOW DATABASES",          "Show_db_priv",             "Server", "server" ],
    [ "PROCESS",                 "Process_priv",             "Server", "server" ],
    [ "RELOAD",                  "Reload_priv",              "Server", "server" ],
    [ "FILE",                    "File_priv",                "Server", "server" ],
    [ "SUPER",                   "Super_priv",               "Server", "server" ],
    [ "CREATE USER",             "Create_user_priv",         "Server", "server" ],
    [ "SHUTDOWN",                "Shutdown_priv",            "Server", "server" ],
    [ "GRANT OPTION",            "Grant_priv",               "Grant" ],
].map(([ name, column, group, only = "" ]) => ({ name, column, group, only }));

/** The privileges one database or every one can be given, by name. */
function privilegesFor(all) {
    return PRIVILEGES.filter((one) => one.only !== (all ? "database" : "server"))
        .map((one) => one.name);
}

/**
 * Each database with its size, table count, encoding and users, and the
 * users with what each may reach. Asking information_schema takes a moment
 * with this many tables, so the answer is kept for 30s.
 */
let databaseCache = { at : 0, data : null, version : 0 };
async function readDatabases() {
    if (Date.now() - databaseCache.at < 30_000 && databaseCache.data) {
        return databaseCache.data;
    }
    // A change made while this reads makes its answer old, so it is not kept.
    const version = databaseCache.version;

    const query = `
        SELECT s.schema_name, COALESCE(SUM(t.data_length + t.index_length), 0), COUNT(t.table_name),
               s.default_character_set_name, s.default_collation_name
        FROM information_schema.schemata s
        LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
        WHERE s.schema_name NOT IN (${SYSTEM_SCHEMAS.map(quote).join(", ")})
        GROUP BY s.schema_name ORDER BY s.schema_name
    `;
    // As the user running Studio, which Homebrew's MariaDB lets in through its
    // socket; a ~/.my.cnf can name another.
    const columns = (all) => PRIVILEGES
        .filter((one) => one.only !== (all ? "database" : "server"))
        .map((one) => one.column)
        .join(", ");
    const [ result, users, grants, server ] = await Promise.all([
        rows(query),
        rows(`SELECT User, Host, ${columns(true)} FROM mysql.user
            WHERE User NOT IN (${SYSTEM_USERS.map(quote).join(", ")}) ORDER BY User, Host`),
        rows(`SELECT User, Host, Db, ${columns(false)} FROM mysql.db
            WHERE User NOT IN (${SYSTEM_USERS.map(quote).join(", ")})`),
        rows("SELECT CURRENT_USER(), @@character_set_server, @@collation_server"),
    ]);
    if (!result) {
        return { available : false, list : [], users : [] };
    }

    const [ [ current, charset, collation ] ] = server || [ [ "", "", "" ] ];
    const names    = result.map(([ name ]) => name);
    // The privileges a row of mysql.user or mysql.db gives, by name.
    const held     = (all, flags) => privilegesFor(all)
        .filter((name, index) => flags[index] === "Y");
    const accounts = (users || []).map(([ name, host, ...flags ]) => {
        const global = held(true, flags);
        const own    = (grants || []).filter((grant) => grant[0] === name && grant[1] === host);
        const each   = own.map(([ , , , ...rest ]) => held(false, rest).join(","));
        // A user reaches every database once it may do anything to their data.
        const all    = global.some((one) => ![ "Server", "Grant" ]
            .includes(PRIVILEGES.find((item) => item.name === one).group));
        return {
            name,
            host,
            all,
            databases  : names.filter((db) => own.some((grant) => likeRegex(grant[2]).test(db))),
            privileges : all ? global : (each[0] || "").split(",").filter(Boolean),
            // The databases are given different privileges, so the dialog shows the first one's.
            mixed      : !all && new Set(each).size > 1,
            admin      : name === "root" || `${name}@${host}` === current,
        };
    });
    const owners = usersOf(names, accounts);
    const list   = result.map(([ name, size, tables, set, order ]) => {
        return {
            name,
            size      : Number(size),
            tables    : Number(tables),
            charset   : set,
            collation : order,
            users     : owners(name),
            url       : `${PHPMYADMIN}/index.php?route=/database/structure&db=${
                encodeURIComponent(name)
            }`,
        };
    });
    const privileges = PRIVILEGES.map(({ name, group, only }) => ({ name, group, only }));
    const data       = { available : true, list, users : accounts, charset, collation, privileges };
    if (version === databaseCache.version) {
        databaseCache = { at : Date.now(), data, version };
    }
    return data;
}

/**
 * The users of each database: the ones granted it, then the one named like
 * it, as shop_us or shop_user for shop_db, when that one may reach every
 * database, as the users XAMPP made could. A user named exactly as a
 * database belongs to that one only. Each is given as name@host.
 */
function usersOf(databases, accounts) {
    const stem = (name) => name.replace(/_[^_]+$/, "");
    return (database) => {
        const granted = accounts.filter((user) => user.databases.includes(database));
        const named   = accounts.filter((user) => user.all && !user.admin && !granted.includes(user)
            && (user.name === database
                || (!databases.includes(user.name) && stem(user.name) === stem(database))));
        return [ ...granted, ...named ].map((user) => `${user.name}@${user.host}`);
    };
}

/** Drops the kept answer, after a service starts or stops, or anything changes. */
function forgetDatabases() {
    databaseCache.at = 0;
    databaseCache.version++;
}

/**
 * The character sets MariaDB knows, each with its collations and the one it
 * uses unless told, for the dialogs that create and change a database.
 */
async function readCharsets() {
    const [ sets, collations ] = await Promise.all([
        rows(
            "SELECT CHARACTER_SET_NAME, DESCRIPTION FROM information_schema.CHARACTER_SETS " +
            "ORDER BY CHARACTER_SET_NAME",
        ),
        rows(
            "SELECT CHARACTER_SET_NAME, FULL_COLLATION_NAME, IS_DEFAULT " +
            "FROM information_schema.COLLATION_CHARACTER_SET_APPLICABILITY " +
            "ORDER BY FULL_COLLATION_NAME",
        ),
    ]);
    if (!sets || !collations) {
        throw new Error("MariaDB is not running");
    }
    return sets.map(([ name, description ]) => {
        const own = collations.filter(([ set ]) => set === name);
        return {
            name,
            description,
            collations : own.map(([ , collation ]) => collation),
            collation  : (own.find(([ , , preset ]) => preset === "Yes") || own[0] || [])[1] || "",
        };
    });
}


// --------------------------------------------------------------- databases ---

/**
 * Creates a database with its encoding, the server's unless given, and, when
 * asked, a user for it: a new one, or one there already, given everything
 * on it alone.
 */
async function createDatabase({ name, charset, collation, user }) {
    name = databaseName(name);
    const steps = [
        `CREATE DATABASE ${ident(name)}${charset ? encoding(charset, collation) : ""};`,
    ];
    let   given = "";
    if (user && user.mode === "new") {
        const account = accountOf(user.name, user.host);
        steps.push(`CREATE USER ${account.sql} IDENTIFIED BY ${quote(password(user.password))};`);
        steps.push(grantStep(account, `${ident(name)}.*`, null, false));
        given = `, and the user ${account.name}`;
    } else if (user && user.mode === "existing") {
        const account = await existingAccount(user.account);
        steps.push(grantStep(
            account,
            `${ident(name)}.*`,
            account.all ? null : account.privileges,
            false,
        ));
        given = `, for ${account.name}`;
    }
    await execute(steps);
    return { message : `Created ${name}${given}` };
}

/**
 * Changes a database's encoding, and its tables' too when asked, since
 * MariaDB gives the new one only to the tables made after; then who may use
 * it. MariaDB cannot rename a database, so its name stays.
 */
async function changeDatabase({ name, charset, collation, convert, users }) {
    name = await existingDatabase(name);
    const steps = [];
    let   tables = [];
    if (charset) {
        steps.push(`ALTER DATABASE ${ident(name)}${encoding(charset, collation)};`);
        if (convert) {
            tables = await rows(`SELECT table_name FROM information_schema.tables
                WHERE table_schema = ${quote(name)} AND table_type = 'BASE TABLE'`) || [];
            steps.push(...tables.map(([ table ]) => `ALTER TABLE ${ident(name)}.${ident(table)}
                CONVERT TO${encoding(charset, collation)};`));
        }
    }
    const { users : accounts } = await fresh();
    if (Array.isArray(users)) {
        const wanted = await Promise.all(users.map(existingAccount));
        for (const account of accounts.filter((one) => !one.admin)) {
            const key = `${account.name}@${account.host}`;
            const has = account.databases.includes(name);
            const now = wanted.some((one) => one.key === key);
            if (now && !has && !account.all) {
                steps.push(grantStep(
                    accountOf(account.name, account.host),
                    `${ident(name)}.*`,
                    account.privileges,
                    false,
                ));
            }
            if (!now && has) {
                steps.push(...await revokeSteps(account, name));
            }
        }
    }
    if (!steps.length) {
        return { message : `${name} has no changes` };
    }
    await execute(steps, 10 * 60_000);
    return { message : `Saved ${name}${tables.length
        ? `, and converted its ${tables.length === 1 ? "table" : `${tables.length} tables`}`
        : ""}` };
}

/**
 * Drops a database, and what was granted on it, which MariaDB would keep;
 * then the users asked to go with it.
 */
async function dropDatabase({ name, users }) {
    name = await existingDatabase(name);
    const { users : accounts } = await fresh();
    const steps = [ `DROP DATABASE ${ident(name)};` ];
    for (const account of accounts.filter((one) => one.databases.includes(name))) {
        steps.push(...await revokeSteps(account, name));
    }
    const going = await Promise.all((Array.isArray(users) ? users : []).map(existingAccount));
    for (const account of going) {
        if (account.admin) {
            throw new Error(`${account.name} looks after MariaDB, and is not dropped`);
        }
        steps.push(`DROP USER ${account.sql};`);
    }
    await execute(steps);
    return { message : `Dropped ${name}${going.length
        ? `, and ${going.map((one) => one.name).join(", ")}` : ""}` };
}

/**
 * Takes back what an account was given on a database: the grant naming it
 * exactly, as written, which a pattern like shop\_% is not.
 */
async function revokeSteps(account, name) {
    const found = await rows(`SELECT Db FROM mysql.db
        WHERE User = ${quote(account.name)} AND Host = ${quote(account.host)}`) || [];
    return found
        .map(([ pattern ]) => pattern)
        .filter((pattern) => pattern === name || pattern.replace(/\\(.)/g, "$1") === name)
        .map((pattern) => `REVOKE ALL PRIVILEGES ON ${ident(pattern)}.*
            FROM ${accountOf(account.name, account.host).sql};`);
}


// ------------------------------------------------------------------- users ---

/**
 * Creates a user with its password, given every database, or the ones
 * listed, each on its own, with the privileges picked: all of them unless
 * the dialog's advanced part says otherwise.
 */
async function createUser({ name, host, password : secret, all, databases, privileges }) {
    const account = accountOf(name, host);
    const steps   = [
        `CREATE USER ${account.sql} IDENTIFIED BY ${quote(password(secret))};`,
        ...await accessSteps(account, all, databases, privileges),
    ];
    await execute(steps);
    return { message : `Created ${account.name}` };
}

/**
 * Changes a user: its name and host, which MariaDB renames in place with
 * its grants, its password when a new one is given, and what it may reach
 * and do. Those are given again from nothing, only when they changed.
 */
async function changeUser({
    account : key, name, host, password : secret, all, databases, privileges
}) {
    const old = await existingAccount(key);
    if (old.admin) {
        throw new Error(`${old.name} looks after MariaDB, and is changed in phpMyAdmin`);
    }
    const account = accountOf(name, host);
    const steps   = [];
    if (account.key !== old.key) {
        steps.push(`RENAME USER ${old.sql} TO ${account.sql};`);
    }
    if (secret) {
        steps.push(`ALTER USER ${account.sql} IDENTIFIED BY ${quote(password(secret))};`);
    }
    const sorted = (list) => [ ...(list || []) ].sort().join(",");
    const before = `${old.all ? "*" : sorted(old.databases)}:${old.mixed ? "mixed"
        : sorted(old.privileges)}`;
    const after  = `${all ? "*" : sorted(databases)}:${sorted(privileges
        || privilegesFor(Boolean(all)))}`;
    if (before !== after) {
        steps.push(
            `REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${account.sql};`,
            ...await accessSteps(account, all, databases, privileges),
        );
    }
    if (!steps.length) {
        return { message : `${old.name} has no changes` };
    }
    await execute(steps);
    return { message : `Saved ${account.name}` };
}

async function dropUser({ account : key }) {
    const account = await existingAccount(key);
    if (account.admin) {
        throw new Error(`${account.name} looks after MariaDB, and is not dropped`);
    }
    await execute([ `DROP USER ${account.sql};` ]);
    return { message : `Dropped ${account.name}` };
}

/** What gives an account every database, or each of the ones listed, with the privileges picked. */
async function accessSteps(account, all, databases, privileges) {
    if (all) {
        return [ grantStep(account, "*.*", privileges, true) ];
    }
    const names = await Promise.all((Array.isArray(databases) ? databases : [])
        .map(existingDatabase));
    return names.map((db) => grantStep(account, `${ident(db)}.*`, privileges, false));
}

/**
 * A GRANT of the privileges picked, of the ones that scope takes; without a
 * pick, every one but GRANT OPTION. Every one is written ALL PRIVILEGES,
 * and GRANT OPTION as WITH GRANT OPTION, as MariaDB has them.
 */
function grantStep(account, scope, privileges, all) {
    const offered = privilegesFor(all).filter((one) => one !== "GRANT OPTION");
    const picked  = Array.isArray(privileges) ? privileges : offered;
    const chosen  = offered.filter((one) => picked.includes(one));
    if (!chosen.length) {
        throw new Error("Pick at least one privilege");
    }
    const list = chosen.length === offered.length ? "ALL PRIVILEGES" : chosen.join(", ");
    return `GRANT ${list} ON ${scope} TO ${account.sql}${picked.includes("GRANT OPTION")
        ? " WITH GRANT OPTION" : ""};`;
}


// ----------------------------------------------------------------- helpers ---

/** The rows of a query, each a list of its columns, or null when MariaDB does not answer. */
async function rows(query) {
    const result = await run("mariadb", [ "-N", "-B", "-e", query ]);
    return result.ok
        ? result.stdout.split("\n").filter(Boolean).map((line) => line.split("\t"))
        : null;
}

/**
 * Runs statements in one go, given on stdin, so a password never shows in
 * the process list. The client stops at the first that fails, and says why.
 */
async function execute(steps, timeout = 60_000) {
    const result = await run("mariadb", [ "-N", "-B" ], timeout, steps.join("\n"));
    forgetDatabases();
    if (!result.ok) {
        throw new Error(result.stderr.replace(/^ERROR \d+ \([\w]+\) at line \d+: /m, "").trim()
            || "MariaDB refused it");
    }
}

/** The databases and users as they are now, never the ones kept for 30s. */
function fresh() {
    forgetDatabases();
    return readDatabases();
}

async function existingDatabase(name) {
    const { list } = await readDatabases();
    if (!list.some((db) => db.name === name)) {
        throw new Error(`There is no database ${name}`);
    }
    return name;
}

/** An account there now, by its name@host, which the page names it by. */
async function existingAccount(key) {
    const { users } = await readDatabases();
    const found     = users.find((user) => `${user.name}@${user.host}` === key);
    if (!found) {
        throw new Error(`There is no user ${key}`);
    }
    return { ...accountOf(found.name, found.host), ...found };
}

/**
 * A database name, as one a site would use: letters, digits, _, - and $,
 * which every client and phpMyAdmin take without trouble.
 */
function databaseName(name) {
    name = String(name || "").trim();
    if (!/^[\w$-]{1,64}$/.test(name)) {
        throw new Error("A database name is up to 64 letters, digits, _, - or $");
    }
    if (SYSTEM_SCHEMAS.includes(name.toLowerCase())) {
        throw new Error(`${name} is MariaDB's own`);
    }
    return name;
}

/** A user and host, checked, with how a statement names them. */
function accountOf(name, host) {
    name = String(name || "").trim();
    host = String(host || "localhost").trim();
    if (!/^[\w.$-]{1,80}$/.test(name)) {
        throw new Error("A user name is up to 80 letters, digits, _, ., - or $");
    }
    if (SYSTEM_USERS.includes(name) || name === "root") {
        throw new Error(`${name} is MariaDB's own`);
    }
    if (!/^[\w.%:-]{1,255}$/.test(host)) {
        throw new Error("A host is a name or address, as localhost, 127.0.0.1 or %");
    }
    return { name, host, key : `${name}@${host}`, sql : `${quote(name)}@${quote(host)}` };
}

function password(secret) {
    secret = String(secret || "");
    if (!secret) {
        throw new Error("The user needs a password");
    }
    return secret;
}

/** The CHARACTER SET and COLLATE of a statement, each checked as a name. */
function encoding(charset, collation) {
    const word = (value) => {
        if (!/^\w{1,64}$/.test(String(value))) {
            throw new Error("Pick an encoding from the list");
        }
        return value;
    };
    return ` CHARACTER SET ${word(charset)}${collation ? ` COLLATE ${word(collation)}` : ""}`;
}

/** A name in backticks, with any backtick in it doubled. */
function ident(name) {
    return `\`${String(name).replace(/`/g, "``")}\``;
}

/** A string in quotes, with its backslashes and quotes escaped. */
function quote(value) {
    return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
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

module.exports = {
    readDatabases,
    forgetDatabases,
    readCharsets,
    createDatabase,
    changeDatabase,
    dropDatabase,
    createUser,
    changeUser,
    dropUser,
    rows,
    quote,
};
