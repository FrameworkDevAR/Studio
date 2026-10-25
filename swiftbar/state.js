"use strict";

// What is running now: the services, the apps' and the projects' servers, and what is
// starting or stopping.

const fs = require("fs");
const path = require("path");

const {
    sh, HTTPD, versionOf, STACK_FLAG, DESKTOPS_FLAG, EXTRA_SERVERS, STOPPING_FLAG
} = require("./config");
const { isRunning, waitForUrl, sleep, filesIn } = require("./helpers");
const { appInfo, byProjectThenApp, appRoots, appDirsOf } = require("./apps");


// ------------------------------------------------------------------- state ---

/** Everything the menu needs to know, gathered once. */
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
 */
function readExtraServers(portByPid) {
    const pidsByDir = listeningDirs(portByPid);
    return EXTRA_SERVERS.map((server) => {
        const pid = (pidsByDir.get(realPathOf(server.dir)) || [])
            .sort((a, b) => portByPid[a] - portByPid[b])[0];
        return {
            ...server,
            pid,
            port     : pid ? Number(portByPid[pid]) : null,
            starting : readFlag(startingFlagOf(server), 30_000) !== null,
        };
    });
}

/** The pids listening on a port, by the folder they run in, from one lsof call. */
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

/** A folder with its links resolved, as lsof reports it: /tmp -> /private/tmp. */
function realPathOf(dir) {
    try {
        return fs.realpathSync(dir);
    } catch {
        return dir;
    }
}

function urlOf(server) {
    return server.port ? `http://localhost:${server.port}/` : null;
}

/** Waits for a server just started to listen and answer; its URL, or null. */
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

function startingFlagOf(server) {
    return `/tmp/dev-${server.id}.starting`;
}

/** The pids currently being shut down, tidying away any stale flags. */
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

/** Listening port per pid, from a single lsof call. */
function readListeningPorts() {
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

/** Every running Vite server, found by its `.bin/vite` process. */
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


module.exports = {
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
