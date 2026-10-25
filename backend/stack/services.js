"use strict";

// Apache, MariaDB and Redis: whether each runs, and starting and stopping them.

const { BREW, HTTPD, DISK, run, versionOf } = require("../core/system");
const { forgetDatabases } = require("../database/databases");



/**
 * The services, by brew formula. Redis uses `start` as in the SwiftBar plugin,
 * which leaves it out of start all because it is not always wanted.
 */
const SERVICES = {
    httpd   : { name : "Apache",  process : [ "-f", HTTPD ],          start : "run"   },
    mariadb : { name : "MariaDB", process : [ "-x", "mariadbd" ],     start : "run"   },
    redis   : { name : "Redis",   process : [ "-x", "redis-server" ], start : "start" },
};

/**
 * Each service: whether it runs, and the version installed.
 * @returns {Promise<Object<string, { name: string, running: boolean, version: string }>>}
 */
async function readServices() {
    /** @type {Object<string, { name: string, running: boolean, version: string }>} */
    const services = {};

    for (const [ formula, service ] of Object.entries(SERVICES)) {
        const found = await run("pgrep", service.process);
        services[formula] = {
            name    : service.name,
            running : found.stdout.trim() !== "",
            version : versionOf(formula),
        };
    }

    return services;
}

/**
 * Free and total space of the data volume, in bytes.
 * @returns {Promise<{ total: number, free: number }>}
 */
async function readDisk() {
    const result  = await run("df", [ "-k", DISK ]);
    const columns = result.stdout.trim().split("\n").pop().split(/\s+/);
    return {
        total : Number(columns[1]) * 1024,
        free  : Number(columns[3]) * 1024,
    };
}

/**
 * Starts, stops or restarts one service.
 * @param {string} formula
 * @param {"start" | "stop" | "restart"} op
 * @returns {Promise<{ message: string }>}
 */
async function serviceAction(formula, op) {
    const service = SERVICES[formula];
    if (!service || ![ "start", "stop", "restart" ].includes(op)) {
        throw new Error("Unknown service or operation");
    }

    if (op === "stop" || op === "restart") {
        await run(BREW, [ "services", "stop", formula ], 60_000);
    }

    if (op === "start" || op === "restart") {
        const result = await run(BREW, [ "services", service.start, formula ], 60_000);
        if (!result.ok) {
            throw new Error(result.stderr || `Could not start ${service.name}`);
        }
    }

    forgetDatabases();

    let done = "restarted";
    if (op === "stop") {
        done = "stopped";
    } else if (op === "start") {
        done = "started";
    }
    return {
        message : `${service.name} ${done}`,
    };
}

/**
 * Apache and MariaDB, as start all in the SwiftBar menu.
 * @returns {Promise<{ message: string }>}
 */
async function startAll() {
    await run(BREW, [ "services", "run", "httpd" ], 60_000);
    await run(BREW, [ "services", "run", "mariadb" ], 60_000);
    forgetDatabases();
    return { message : "Apache and MariaDB started" };
}

/**
 * Apache and MariaDB again, when both are already running.
 * @returns {Promise<{ message: string }>}
 */
async function restartAll() {
    await serviceAction("httpd", "restart");
    await serviceAction("mariadb", "restart");
    return { message : "Apache and MariaDB restarted" };
}

/**
 * Everything, Redis too, as stop all in the SwiftBar menu.
 * @returns {Promise<{ message: string }>}
 */
async function stopAll() {
    for (const formula of [ "redis", "httpd", "mariadb" ]) {
        await run(BREW, [ "services", "stop", formula ], 60_000);
    }
    return { message : "All services stopped" };
}



// The public API
module.exports = {
    readServices,
    readDisk,
    serviceAction,
    startAll,
    restartAll,
    stopAll,
};
