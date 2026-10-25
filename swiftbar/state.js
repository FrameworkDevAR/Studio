// What is running now: the services, the apps' and the projects' servers, and what is
// starting or stopping.

import fs from "node:fs";
import path from "node:path";

import {
    sh, HTTPD, versionOf, STACK_FLAG, DESKTOPS_FLAG, EXTRA_SERVERS, STOPPING_FLAG
} from "./config.js";
import { isRunning, waitForUrl, sleep, filesIn } from "./helpers.js";
import { appInfo, byProjectThenApp, appRoots, appDirsOf } from "./apps.js";



/**
 * A running app: a Vite server, or another Node app, which is not Vite.
 * @typedef {import("./apps.js").AppInfo & { pid: string, isVite?: boolean }} AppServer
 */

/**
 * One of the projects' own servers, as the config gives it, with its project's name as its
 * group, and the process serving it, if any.
 * @typedef {{
 *     id: string, name: string, command: string, args: string[], dir: string,
 *     pathPrefix?: string, group: string, pid: string, port: number, starting: boolean,
 * }} ExtraServer
 */

/**
 * What the menu shows: the services, the running apps and servers, and what is busy.
 * @typedef {{
 *     apacheWorkers: number, mysqlUp: boolean, redisUp: boolean,
 *     versions: {
 *         httpd: string, mariadb: string, php: string, phpmyadmin: string, redis: string,
 *     },
 *     servers: AppServer[], extras: ExtraServer[], stackBusy: string, desktopsBusy: string,
 *     stopping: Set<string>, portByPid: Object<string, string>,
 * }} MenuState
 */



// ------------------------------------------------------------------- state ---

/**
 * Everything the menu needs to know, gathered once.
 * @returns {MenuState}
 */
function readState() {
    const portByPid = readListeningPorts();

    return {
        apacheWorkers : sh(`pgrep -f "${HTTPD}"`).split("\n").filter(Boolean).length,
        mysqlUp       : isRunning("-x mariadbd"),
        redisUp       : isRunning("-x redis-server"),
        versions      : {
            httpd      : versionOf("httpd"),
            mariadb    : versionOf("mariadb"),
            php        : versionOf("php"),
            phpmyadmin : versionOf("phpmyadmin"),
            redis      : versionOf("redis"),
        },
        servers       : readAppServers(portByPid),
        extras        : readExtraServers(portByPid),
        stackBusy     : readFlag(STACK_FLAG, 120_000),
        desktopsBusy  : readFlag(DESKTOPS_FLAG, 60_000),
        stopping      : readStoppingPids(),
        portByPid,
    };
}

/**
 * The label inside a flag file, or null when it is missing or stale, so an
 * action that died cannot leave the menu on "Starting…" forever.
 * @param {string} flagFile
 * @param {number} withinMs
 * @returns {string}
 */
function readFlag(flagFile, withinMs) {
    try {
        if (Date.now() - fs.statSync(flagFile).mtimeMs >= withinMs) {
            return null;
        }
        return fs.readFileSync(flagFile, "utf8").trim();
    } catch {
        return null;
    }
}

/**
 * Each of the projects' own servers, with the process serving it, if any.
 * The port is the server's own business -- its command or its folder's config
 * sets it -- so it is found the way the Node apps are: a process listening on
 * a port, running in the server's folder. The lowest port wins, should there
 * be more than one.
 * @param {Object<string, string>} portByPid
 * @returns {ExtraServer[]}
 */
function readExtraServers(portByPid) {
    const pidsByDir = listeningDirs(portByPid);

    return EXTRA_SERVERS.map((server) => {
        const pid = (pidsByDir.get(realPathOf(server.dir)) || [])
            .sort((a, b) => Number(portByPid[a]) - Number(portByPid[b]))[0];
        return {
            ...server,
            pid,
            port     : pid ? Number(portByPid[pid]) : null,
            starting : readFlag(startingFlagOf(server), 30_000) !== null,
        };
    });
}

/**
 * The pids listening on a port, by the folder they run in, from one lsof call.
 * @param {Object<string, string>} portByPid
 * @returns {Map<string, string[]>}
 */
function listeningDirs(portByPid) {
    const pidsByDir = new Map();
    const pids      = Object.keys(portByPid);
    if (!pids.length) {
        return pidsByDir;
    }

    // -F prints a "p<pid>" line and then an "n<path>" line for each process
    let pid = "";
    for (const line of sh(`lsof -a -d cwd -Fpn -p ${pids.join(",")}`).split("\n")) {
        if (line.startsWith("p")) {
            pid = line.slice(1);
        } else if (line.startsWith("n")) {
            pidsByDir.set(line.slice(1), [ ...(pidsByDir.get(line.slice(1)) || []), pid ]);
        }
    }

    return pidsByDir;
}

/**
 * A folder with its links resolved, as lsof reports it: /tmp -> /private/tmp.
 * @param {string} dir
 * @returns {string}
 */
function realPathOf(dir) {
    try {
        return fs.realpathSync(dir);
    } catch {
        return dir;
    }
}

/**
 * The page of a server on its port, or null when it is not listening.
 * @param {{ port: number }} server
 * @returns {string}
 */
function urlOf(server) {
    return server.port ? `http://localhost:${server.port}/` : null;
}

/**
 * Waits for a server just started to listen and answer; its URL, or null.
 * @param {string} id
 * @returns {string}
 */
function waitForServer(id) {
    for (let attempt = 0; attempt < 75; attempt++) {
        const server = readExtraServers(readListeningPorts()).find((one) => one.id === id);
        if (server && server.port) {
            return waitForUrl(urlOf(server)) ? urlOf(server) : null;
        }
        sleep(200);
    }

    return null;
}

/**
 * The flag file that says a server is starting.
 * @param {{ id: string }} server
 * @returns {string}
 */
function startingFlagOf(server) {
    return `/tmp/dev-${server.id}.starting`;
}

/**
 * The pids currently being shut down, tidying away any stale flags.
 * @returns {Set<string>}
 */
function readStoppingPids() {
    const pids   = new Set();
    const prefix = path.basename(STOPPING_FLAG);

    for (const file of filesIn(path.dirname(STOPPING_FLAG), prefix)) {
        if (readFlag(file, 30_000) !== null) {
            pids.add(path.basename(file).slice(prefix.length));
        } else {
            fs.rmSync(file, { force : true });
        }
    }

    return pids;
}

/**
 * Listening port per pid, from a single lsof call.
 * @returns {Object<string, string>}
 */
function readListeningPorts() {
    /** @type {Object<string, string>} */
    const portByPid = {};

    for (const line of sh("lsof -nP -iTCP -sTCP:LISTEN").split("\n").slice(1)) {
        const columns = line.split(/\s+/);
        const port    = (columns[8] || "").split(":").pop();
        if (columns[1] && port && !portByPid[columns[1]]) {
            portByPid[columns[1]] = port;
        }
    }

    return portByPid;
}

/**
 * Every running Vite server, found by its `.bin/vite` process.
 * @returns {AppServer[]}
 */
function readViteServers() {
    return sh("ps -Ao pid,args").split("\n")
        .filter((line) => /node .*\/\.bin\/vite/.test(line))
        .map((line) => {
            const text = line.trim();
            const dir  = text.replace(/^\d+\s+node\s+/, "")
                .replace(/\/node_modules\/\.bin\/vite.*$/, "");
            return {
                pid : text.split(/\s+/)[0],
                ...appInfo(dir),
            };
        })
        .filter((server) => fs.existsSync(server.dir))
        .sort(byProjectThenApp);
}

/**
 * The running Vite servers, plus the other Node apps: node processes that
 * listen on a port and run in an app folder.
 * @param {Object<string, string>} portByPid
 * @returns {AppServer[]}
 */
function readAppServers(portByPid) {
    const vite    = readViteServers();
    const running = new Set(vite.map((server) => server.dir));
    const apps    = new Set(appRoots().flatMap(appDirsOf).filter((dir) => !running.has(dir)));
    const others  = new Map();

    // -F prints a "p<pid>" line and then an "n<path>" line for each process
    let pid = "";
    for (const line of sh("lsof -a -c node -d cwd -Fpn").split("\n")) {
        if (line.startsWith("p")) {
            pid = line.slice(1);
        } else if (line.startsWith("n") && portByPid[pid] && apps.has(line.slice(1))
            && !others.has(line.slice(1))) {
            others.set(line.slice(1), { pid, ...appInfo(line.slice(1)), isVite : false });
        }
    }

    return [ ...vite, ...others.values() ].sort(byProjectThenApp);
}



// The public API
export {
    readState,
    urlOf,
    readViteServers,
    startingFlagOf,
    readExtraServers,
    readListeningPorts,
    waitForServer,
    readAppServers,
    readStoppingPids,
};
