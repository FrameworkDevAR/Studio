// MariaDB's options: the ones the page shows, the options file Studio writes
// them to, and checking and applying a change.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    PATHS, MYSQL_CNF, MYSQL_DATA, run, readFile, filesIn, tailOf, versionOf
} from "../core/system.js";
import { serviceAction } from "../stack/services.js";
import { rows, quote, forgetDatabases } from "./databases.js";



// The config MariaDB reads first, which includes the others.
const MY_CNF = path.join(PATHS.homebrew, "etc", "my.cnf");

/**
 * The options the page shows on their own, by group in the page. Any other
 * can be added to the options file too, checked by MariaDB as it is saved.
 */
const OPTIONS = [
    "max_connections", "wait_timeout", "max_allowed_packet",
    "character_set_server", "collation_server",
    "innodb_buffer_pool_size", "innodb_log_file_size", "innodb_flush_log_at_trx_commit",
    "sql_mode", "default_storage_engine", "group_concat_max_len",
    "slow_query_log", "long_query_time", "general_log",
    "tmp_table_size", "max_heap_table_size", "sort_buffer_size", "join_buffer_size",
];

/** The options that are sizes in bytes, shown as 256M with a unit to pick. */
const SIZES = new RegExp(
    "(buffer_size|buffer_pool_size|log_file_size|_table_size|allowed_packet|query_cache_size|" +
    "query_cache_limit|net_buffer_length)$",
);

/** The variables that only say what MariaDB is, which no file can set. */
const FIXED = new RegExp(
    "^(have_|version|hostname|license|protocol_version|lower_case_file_system|system_time_zone|" +
    "in_transaction|last_|error_count|warning_count|identity|insert_id|timestamp|rand_seed|" +
    "pseudo_)",
);

/** The groups of a cnf file the server reads. */
const SERVER_GROUP = /^(mysqld|server|mariadb|mariadbd|client-server)(-[\d.]+)?$/i;



/**
 * A variable as MariaDB has it: its value now and by default, its type, the values an enum
 * takes, whether it can change as MariaDB runs, and what it is for.
 * @typedef {{ value: string, defaultValue: string, type: string, list: string[],
 *     dynamic: boolean, comment: string }} MariadbVariable
 */

/**
 * MariaDB's variables by name, and, not enumerable, each collation with its character set.
 * @typedef {Object<string, MariadbVariable> & { collations?: string[][] }} MariadbVariables
 */

/**
 * An option as the page shows it, with where its value comes from and what it goes back to.
 * @typedef {{ key: string, value: string, inFile: boolean, known: boolean,
 *     options: string[], size: boolean, dynamic: boolean, base: string,
 *     baseFrom: string, owner: string }} MariadbOption
 */



/**
 * The options as the page shows them: its own, then the options file's
 * others. One in the file shows the file's value; one that is not shows the
 * value MariaDB runs with, and says whether a file sets it or it is MariaDB's
 * default. What the file's value goes back to without it is said too.
 * @returns {Promise<{ available: boolean, version: string, file: string,
 *     settings: MariadbOption[], overrides: MariadbOption[] }>}
 */
async function readMariadb() {
    const variables = await readVariables();
    if (!variables) {
        return {
            available : false,
            version   : versionOf("mariadb"),
            file      : MYSQL_CNF,
            settings  : [],
            overrides : [],
        };
    }

    const own    = cnfKeys(readFile(MYSQL_CNF));
    const others = otherFiles();
    const option = (key) => {
        const known = variables[key];
        const from  = others[key];

        let base = "";
        if (from) {
            base = displayValue(key, from.value, known);
        } else if (known) {
            base = displayValue(key, known.defaultValue, known);
        }

        let value = "";
        if (key in own) {
            value = displayValue(key, own[key], known);
        } else if (known) {
            value = displayValue(key, known.value, known);
        }

        return {
            key,
            value,
            inFile   : key in own,
            known    : Boolean(known),
            options  : optionsOf(key, known, variables),
            size     : SIZES.test(key),
            dynamic  : Boolean(known?.dynamic),
            base,
            baseFrom : from ? path.basename(from.file) : "default",
            owner    : ownerOf(key),
        };
    };

    return {
        available : true,
        version   : versionOf("mariadb"),
        file      : MYSQL_CNF,
        settings  : OPTIONS.filter((key) => variables[key]).map(option),
        overrides : Object.keys(own).filter((key) => !OPTIONS.includes(key)).map(option),
    };
}

/**
 * Every variable a file can set, with its value now, the choices it takes
 * and whether the options file has it, for the dialog that adds one.
 * @returns {Promise<{ key: string, value: string, inFile: boolean, options: string[],
 *     size: boolean, owner: string, comment: string }[]>}
 */
async function readOptionList() {
    const variables = await readVariables();
    if (!variables) {
        throw new Error("MariaDB is not running");
    }

    const own = cnfKeys(readFile(MYSQL_CNF));
    return Object.entries(variables)
        .filter(([ key ]) => !FIXED.test(key))
        .map(([ key, known ]) => ({
            key,
            value   : displayValue(key, key in own ? own[key] : known.value, known),
            inFile  : key in own,
            options : optionsOf(key, known, variables),
            size    : SIZES.test(key),
            owner   : ownerOf(key),
            comment : known.comment,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * MariaDB's variables by name, lowercase as the files write them. Kept for
 * 30s: the page asks every few seconds, and they change only as it is told.
 */
let variableCache = { at : 0, data : null };
/**
 * MariaDB's variables, kept for 30s, or null when MariaDB does not answer.
 * @returns {Promise<MariadbVariables>}
 */
async function readVariables() {
    if (Date.now() - variableCache.at < 30_000 && variableCache.data) {
        return variableCache.data;
    }

    const [ found, charsets, collations ] = await Promise.all([
        rows(`SELECT LOWER(VARIABLE_NAME), GLOBAL_VALUE, DEFAULT_VALUE, VARIABLE_TYPE,
              ENUM_VALUE_LIST, READ_ONLY, VARIABLE_COMMENT
              FROM information_schema.SYSTEM_VARIABLES`),
        rows(
            "SELECT CHARACTER_SET_NAME FROM information_schema.CHARACTER_SETS " +
            "ORDER BY CHARACTER_SET_NAME",
        ),
        rows(
            "SELECT CHARACTER_SET_NAME, FULL_COLLATION_NAME " +
            "FROM information_schema.COLLATION_CHARACTER_SET_APPLICABILITY " +
            "ORDER BY FULL_COLLATION_NAME",
        ),
    ]);
    if (!found) {
        return null;
    }

    const nothing = (value) => (value === "NULL" ? "" : value ?? "");
    /** @type {MariadbVariables} */
    const data    = {};

    for (const [ key, value, preset, type, list, readOnly, comment ] of found) {
        data[key] = {
            value        : nothing(value),
            defaultValue : nothing(preset),
            type,
            list         : nothing(list) ? list.split(",") : null,
            dynamic      : readOnly === "NO",
            comment      : nothing(comment),
        };
    }

    // The server's character sets and the collations of each, for its two selects.
    if (data.character_set_server) {
        data.character_set_server.list = (charsets || []).map(([ name ]) => name);
    }

    Object.defineProperty(data, "collations", { value : collations || [], enumerable : false });
    variableCache = { at : Date.now(), data };
    return data;
}

/**
 * The choices an option takes: a switch's ON and OFF, an enum's values, and
 * the collations of the server's character set. A set, as sql_mode, is
 * written as a list, so it has none.
 * @param {string} key
 * @param {MariadbVariable} known
 * @param {MariadbVariables} variables
 * @returns {string[]}
 */
function optionsOf(key, known, variables) {
    if (!known) {
        return null;
    }
    if (known.type === "BOOLEAN") {
        return [ "ON", "OFF" ];
    }
    if (key === "collation_server") {
        const set = variables.character_set_server?.value;
        return variables.collations.filter(([ charset ]) => charset === set)
            .map(([ , name ]) => name);
    }
    return known.type === "ENUM" || key === "character_set_server" ? known.list : null;
}

/**
 * A value as the page shows it: a size in bytes as 256M when it divides
 * evenly, a switch as ON or OFF, as a file may write it 1, on or not at all,
 * and a number of seconds as 10, which MariaDB gives as 10.000000.
 * @param {string} key
 * @param {string} value
 * @param {MariadbVariable} known
 * @returns {string}
 */
function displayValue(key, value, known) {
    const text = String(value ?? "");

    if (known?.type === "BOOLEAN") {
        return /^(1|on|yes|true|)$/i.test(text) ? "ON" : "OFF";
    }
    if (known?.type === "DOUBLE" && /^-?\d+\.\d+$/.test(text)) {
        return String(Number(text));
    }

    if (SIZES.test(key) && /^\d+$/.test(text) && Number(text) > 0) {
        const number = Number(text);
        /** @type {[ string, number ][]} */
        const units = [ [ "G", 1024 ** 3 ], [ "M", 1024 ** 2 ], [ "K", 1024 ] ];
        for (const [ unit, size ] of units) {
            if (number % size === 0) {
                return `${number / size}${unit}`;
            }
        }
    }

    return text;
}

/**
 * What an option is part of, to group the many the dialog lists.
 * @param {string} key
 * @returns {string}
 */
function ownerOf(key) {
    /** @type {[ RegExp, string ][]} */
    const groups = [
        [ /^innodb_/, "InnoDB" ],
        [ /^aria_/, "Aria" ],
        [ /^myisam_|^key_/, "MyISAM" ],
        [ /^performance_schema/, "Performance schema" ],
        [ /^(character_set|collation)_/, "Encoding" ],
        [ /^query_cache/, "Query cache" ],
        [ /^(binlog_|log_bin|sync_binlog|expire_logs|max_binlog)/, "Binary log" ],
        [ /^(slave_|replicate_|rpl_|relay_|master_|gtid_|wsrep_)/, "Replication" ],
        [ /^(log_|slow_|general_log|long_query)/, "Logging" ],
    ];

    return (groups.find(([ pattern ]) => pattern.test(key)) || [ null, "Server" ])[1];
}


// ----------------------------------------------------------------- changes ---

/**
 * Writes some options to the options file, replacing their lines or adding
 * them, once MariaDB reads the file without a complaint. A change MariaDB
 * can take as it runs is set at once; any other, or an option taken out,
 * restarts it, and should it not come back, the file before is put back.
 * @param {{ key: string, value?: string, remove?: boolean }
 *     | { key: string, value?: string, remove?: boolean }[]} changes
 * @returns {Promise<{ message: string }>}
 */
async function setOptions(changes) {
    const list = [].concat(changes || []).map((change) => ({
        key    : String(change?.key || "").trim().toLowerCase().replace(/-/g, "_"),
        value  : String(change?.value ?? "").trim(),
        remove : Boolean(change?.remove),
    }));
    if (!list.length) {
        throw new Error("Nothing to save");
    }

    const current   = await readVariables();
    const variables = current || {};
    let   text      = readFile(MYSQL_CNF);

    for (const { key, value, remove } of list) {
        if (!/^[a-z][\w.]*$/.test(key)) {
            throw new Error(`${key} is not an option`);
        }
        text = remove ? withoutOption(text, key) : withOption(text, key, value);
    }

    const live = list.every(({ key, remove }) => !remove && variables[key]?.dynamic);

    let said;
    if (list.length > 1) {
        said = `${list.length} changes saved`;
    } else if (list[0].remove) {
        said = `${list[0].key} taken out`;
    } else {
        said = `${list[0].key} set to ${list[0].value}`;
    }
    const outcome = await writeOptions(text, live ? list : null);
    return { message : `${said}. ${outcome}` };
}

/**
 * Saves the options file from the editor. What changed in it is not known
 * here, so MariaDB restarts to read it.
 * @param {string} text
 * @returns {Promise<{ message: string }>}
 */
async function saveOptionsFile(text) {
    if (typeof text !== "string") {
        throw new Error("No text to save");
    }

    const outcome = await writeOptions(text.replace(/\r\n/g, "\n"), null);
    return {
        message : `Saved ${path.basename(MYSQL_CNF)}. ${outcome}`,
    };
}

/**
 * The options file, whether it is there, and its text, for the editor.
 * @returns {{ file: string, exists: boolean, text: string }}
 */
function readOptionsFile() {
    return { file : MYSQL_CNF, exists : fs.existsSync(MYSQL_CNF), text : readFile(MYSQL_CNF) };
}

/**
 * What MariaDB says of a text as its options file. The server reads it as
 * it would start, and stops there, with --help: an unknown option, a value
 * it does not take or a broken group is an error, and a switch it does not
 * understand only a warning, which it would set to OFF, so that is one too.
 * @param {string} text
 * @returns {Promise<{ problems: string[] }>}
 */
async function checkOptions(text) {
    // By its real path, /private/var/..., which is how MariaDB names it.
    const temp = path.join(fs.realpathSync(os.tmpdir()), `studio-${process.pid}-${Date.now()}.cnf`);
    fs.writeFileSync(temp, String(text ?? ""));
    const result = await run(
        "mariadbd",
        [ `--defaults-file=${temp}`, "--help", "--verbose" ],
        20_000,
    );
    fs.rmSync(temp, { force : true });

    const problems = result.stderr.split("\n")
        .filter((line) => /\[ERROR\]|\[Warning\] option '|^error:/i.test(line))
        .map((line) => line
            .replace(/^\d{4}-\d\d-\d\d\s+\d+:\d\d:\d\d\s+\d+\s+/, "")
            .replace(/^\[(ERROR|Warning)\]\s+(mariadbd:\s+)?/, "")
            .replace(/^error:\s*/i, "")
            .split(temp).join(path.basename(MYSQL_CNF))
            .replace(/^./, (first) => first.toUpperCase()));

    // The line of the option a problem names, which MariaDB leaves out, so the editor can mark it.
    const lines = String(text ?? "").split("\n");
    problems.forEach((problem, index) => {
        const name = problem.match(/(?:option|variable|to) '([\w.-]+)/i)?.[1];
        const key  = (one) => one.match(/^\s*([A-Za-z][\w.-]*)/)?.[1];
        const line = name && !/\bline \d+/.test(problem)
            ? lines.findIndex((one) => key(one) && optionName(key(one)) === optionName(name))
            : -1;

        if (line !== -1) {
            problems[index] = `${problem.replace(/\.$/, "")}, on line ${line + 1}`;
        }
    });

    if (!result.ok && !problems.length) {
        problems.push(result.stderr.trim().split("\n").pop() || "MariaDB does not take it");
    }

    return { problems };
}

/**
 * Writes the options file once MariaDB takes it, keeping the one before as
 * .bak. The changes given are set as MariaDB runs, each put back as it was
 * should one fail; without them, MariaDB restarts, and the file before comes
 * back when it does not start with this one.
 * @param {string} text
 * @param {{ key: string, value: string }[]} live
 * @returns {Promise<string>}
 */
async function writeOptions(text, live) {
    const { problems } = await checkOptions(text);
    if (problems.length) {
        throw new Error(`MariaDB does not take it: ${problems[0]}`);
    }

    const before = fs.existsSync(MYSQL_CNF) ? readFile(MYSQL_CNF) : null;

    if (live) {
        const variables = await readVariables();
        const done      = [];

        for (const { key, value } of live) {
            const result = await run(
                "mariadb",
                [ "-N", "-B" ],
                15_000,
                `SET GLOBAL ${key} = ${sqlValue(value)};`,
            );
            if (!result.ok) {
                for (const one of done) {
                    await run(
                        "mariadb",
                        [ "-N", "-B" ],
                        15_000,
                        `SET GLOBAL ${one.key} = ${sqlValue(one.value)};`,
                    );
                }

                throw new Error(`MariaDB does not take it: ${
                    result.stderr.replace(/^ERROR \d+ \(\w+\) at line \d+: /, "").trim()
                }`);
            }

            done.push({ key, value : variables[key].value });
        }

        writeFile(text, before);
        variableCache.at = 0;
        return "MariaDB uses it already";
    }

    writeFile(text, before);
    variableCache.at = 0;
    forgetDatabases();
    await serviceAction("mariadb", "restart");

    const back = await answers();
    if (back) {
        return "MariaDB restarted";
    }

    // It did not come back: the file before goes back, and MariaDB with it.
    const why = startError();

    if (before === null) {
        fs.rmSync(MYSQL_CNF, { force : true });
    } else {
        fs.writeFileSync(MYSQL_CNF, before);
    }

    await serviceAction("mariadb", "restart");
    throw new Error(`MariaDB did not start with it, so the file was put back${
        why ? `: ${why}` : ""
    }`);
}

/**
 * Writes the options file, the one before kept as .bak, or its folder made when there was none.
 * @param {string} text
 * @param {string} before
 * @returns {void}
 */
function writeFile(text, before) {
    if (before !== null) {
        fs.writeFileSync(`${MYSQL_CNF}.bak`, before);
    } else {
        fs.mkdirSync(path.dirname(MYSQL_CNF), { recursive : true });
    }

    fs.writeFileSync(MYSQL_CNF, text);
}

/**
 * Whether MariaDB answers, given up to 20s to start.
 * @returns {Promise<boolean>}
 */
async function answers() {
    for (let tries = 0; tries < 40; tries++) {
        const result = await run("mariadb", [ "-N", "-B", "-e", "SELECT 1" ], 5_000);
        if (result.ok) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return false;
}

/**
 * The last error MariaDB logged, as it failed to start.
 * @returns {string}
 */
function startError() {
    const log = filesIn(MYSQL_DATA, "").find((file) => file.endsWith(".err"));
    if (!log) {
        return "";
    }

    const line = tailOf(log, 40).reverse()
        .find((one) => /\[ERROR\]/.test(one) && !/Aborting/.test(one)) || "";
    return line.replace(/^.*?\[ERROR\]\s+(mariadbd:\s+)?/, "");
}

/**
 * A value as SET GLOBAL needs it: a size's unit worked out, a word in quotes.
 * @param {string} value
 * @returns {string}
 */
function sqlValue(value) {
    const size = String(value).match(/^(\d+)([KMGT])$/i);
    if (size) {
        return String(Number(size[1]) * 1024 ** ("KMGT".indexOf(size[2].toUpperCase()) + 1));
    }
    return /^-?\d+(\.\d+)?$/.test(value) ? value : quote(value);
}


// --------------------------------------------------------------- the files ---

/**
 * The options of a cnf text's server groups, by name as MariaDB knows it --
 * lowercase, with _ for -, and without the loose- that only says to skip it
 * quietly when unknown. A line with no = is a switch turned on. The last
 * line wins, as for MariaDB.
 * @param {string} text
 * @returns {Object<string, string>}
 */
function cnfKeys(text) {
    /** @type {Object<string, string>} */
    const values = {};
    let   group  = "";

    for (const line of text.split("\n")) {
        const head = line.match(/^\s*\[([^\]]+)\]/);
        if (head) {
            group = head[1].trim();
            continue;
        }

        const found = line.match(/^\s*([A-Za-z][\w.-]*)\s*(?:=\s*(.*?))?\s*$/);
        if (found && SERVER_GROUP.test(group)) {
            values[optionName(found[1])] = unquote(stripComment(found[2] ?? ""));
        }
    }

    return values;
}

/**
 * An option's name as MariaDB knows it: lowercase, with _ for -, and without loose_.
 * @param {string} name
 * @returns {string}
 */
function optionName(name) {
    return name.toLowerCase().replace(/-/g, "_").replace(/^loose_/, "");
}

/**
 * A value without the comment after it.
 * @param {string} value
 * @returns {string}
 */
function stripComment(value) {
    return value.replace(/\s+[#;].*$/, "").trim();
}

/**
 * A value without the quotes around it.
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
    return value.replace(/^(["'])(.*)\1$/, "$2");
}

/**
 * The options the other cnf files set, each with the file that sets it last:
 * what an option goes back to once the options file no longer has it. They
 * are my.cnf and what it includes, in MariaDB's order.
 * @returns {Object<string, { value: string, file: string }>}
 */
function otherFiles() {
    /** @type {Object<string, { value: string, file: string }>} */
    const found = {};

    for (const file of cnfFiles(MY_CNF, new Set())) {
        if (path.resolve(file) === path.resolve(MYSQL_CNF)) {
            continue;
        }

        for (const [ key, value ] of Object.entries(cnfKeys(readFile(file)))) {
            found[key] = { value, file };
        }
    }

    return found;
}

/**
 * A cnf file and the ones it includes, each folder's .cnf files sorted by name.
 * @param {string} file
 * @param {Set<string>} seen
 * @returns {string[]}
 */
function cnfFiles(file, seen) {
    if (seen.has(file) || !fs.existsSync(file)) {
        return [];
    }

    seen.add(file);
    const files = [ file ];

    for (const line of readFile(file).split("\n")) {
        const include = line.match(/^\s*!include\s+(.+?)\s*$/);
        const folder  = line.match(/^\s*!includedir\s+(.+?)\s*$/);
        if (include) {
            files.push(...cnfFiles(include[1], seen));
        } else if (folder) {
            const inside = filesIn(folder[1], "").filter((one) => one.endsWith(".cnf")).sort();
            files.push(...inside.flatMap((one) => cnfFiles(one, seen)));
        }
    }

    return files;
}

/**
 * A cnf text with an option set: its line in a server group replaced, or a
 * line added at the end of the [mysqld] group, which is made when missing.
 * @param {string} text
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
function withOption(text, key, value) {
    const line  = `${key} = ${/[#;\s]/.test(value) ? `"${value}"` : value}`;
    const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
    let   group = "";
    let   last  = -1;
    let   found = false;

    lines.forEach((one, index) => {
        const head = one.match(/^\s*\[([^\]]+)\]/);
        if (head) {
            group = head[1].trim();
            return;
        }

        const option = one.match(/^\s*([A-Za-z][\w.-]*)\s*(=|$)/);
        if (option && SERVER_GROUP.test(group) && optionName(option[1]) === key) {
            lines[index] = line;
            found        = true;
        }

        if (/^mysqld$/i.test(group) && one.trim()) {
            last = index;
        }
    });

    if (!found) {
        const mysqld = lines.findIndex((one) => /^\s*\[mysqld\]\s*$/i.test(one));
        if (mysqld === -1) {
            lines.push(...(lines.length ? [ "" ] : []), "[mysqld]", line);
        } else {
            lines.splice(Math.max(last, mysqld) + 1, 0, line);
        }
    }

    return `${lines.join("\n")}\n`;
}

/**
 * A cnf text without an option's lines in its server groups.
 * @param {string} text
 * @param {string} key
 * @returns {string}
 */
function withoutOption(text, key) {
    let group = "";
    let found = false;

    const kept = text.split("\n").filter((one) => {
        const head = one.match(/^\s*\[([^\]]+)\]/);
        if (head) {
            group = head[1].trim();
            return true;
        }

        const option = one.match(/^\s*([A-Za-z][\w.-]*)\s*(=|$)/);
        const drop   = Boolean(option && SERVER_GROUP.test(group) && optionName(option[1]) === key);
        found = found || drop;
        return !drop;
    });

    if (!found) {
        throw new Error(`${key} is not in the options file`);
    }

    return kept.join("\n");
}



// The public API
export {
    readMariadb,
    readOptionList,
    setOptions,
    readOptionsFile,
    saveOptionsFile,
    checkOptions,
};
