// The port each app and server wants, and what already holds it. The apps' Vite servers set
// strictPort, so one whose port is taken quits at once; this says by what, before it starts.

import fs from "node:fs";
import path from "node:path";

import { sh, HOME, EXTRA_SERVERS, STOPPING_FLAG } from "./config.js";
import { sleep, readFile, filesIn } from "./helpers.js";
import { appInfo, appRoots, appDirsOf } from "./apps.js";



// The env files Vite reads in development, each one over the one before.
const ENV_FILES = [ ".env", ".env.local", ".env.development", ".env.development.local" ];



/**
 * What holds the port an app or server wants: the process and the name it goes by.
 * @typedef {{ port: number, pid: string, name: string }} Blocker
 */



// ----------------------------------------------------------------- blocker ---

/**
 * What holds the port an app or a server wants, or null when the port is free, unknown, or
 * held by that same app. An app is given by its folder, a server by its id.
 * @param {string} target
 * @returns {Blocker | null}
 */
function blockerOf(target) {
    const server = EXTRA_SERVERS.find((one) => one.id === target);
    const dir    = server ? server.dir : target;
    const port   = server ? portOfServer(server.args) : portOfApp(dir);
    if (!port) {
        return null;
    }

    const pid = sh(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`).split("\n")[0];
    if (!pid) {
        return null;
    }

    // An app already running is no blocker of its own; the start just skips it.
    const where = dirOf(pid);
    if (where === realPathOf(dir)) {
        return null;
    }

    return { port, pid, name : nameOf(pid, where) };
}

/**
 * Stops what holds a port, and waits for the port to be free, up to ten seconds. The pid
 * is flagged as stopping, so the menu shows it going.
 * @param {Blocker} blocker
 * @returns {boolean} whether the port is free
 */
function freePort(blocker) {
    fs.writeFileSync(`${STOPPING_FLAG}${blocker.pid}`, "stopping…");
    sh(`kill -TERM ${blocker.pid}`);

    let free = false;
    for (let attempt = 0; attempt < 50 && !free; attempt++) {
        sleep(200);
        free = sh(`lsof -nP -t -iTCP:${blocker.port} -sTCP:LISTEN`) === "";
    }

    fs.rmSync(`${STOPPING_FLAG}${blocker.pid}`, { force : true });
    return free;
}



// ------------------------------------------------------------------- ports ---

/**
 * The port an app's Vite server is given: a number in its vite.config, or VITE_PORT in its
 * env files when the config reads it from there. A Node app without Vite goes by PORT in
 * its env files. Null when none says.
 * @param {string} dir
 * @returns {number | null}
 */
function portOfApp(dir) {
    const configs = filesIn(dir, "vite.config.").map(readFile).join("\n");
    const literal = configs.match(/^\s*port\s*:\s*(\d+)/m);
    if (literal) {
        return Number(literal[1]);
    }

    return envOf(dir, configs ? "VITE_PORT" : "PORT");
}

/**
 * The port a server's command line asks for, as --port=2000, --web-port 3051 or -p 8080.
 * Null when it gives none, as for a server whose port is in its own config.
 * @param {string[]} args
 * @returns {number | null}
 */
function portOfServer(args) {
    const found = args.join(" ").match(/(?:^|\s)(?:--[\w-]*port|-p)(?:=|\s+)(\d+)/);
    return found ? Number(found[1]) : null;
}

/**
 * A number in an app's env files, the last file that sets it winning, as in Vite.
 * @param {string} dir
 * @param {string} name
 * @returns {number | null}
 */
function envOf(dir, name) {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*["']?(\\d+)`, "m");
    let value     = null;

    for (const file of ENV_FILES) {
        const found = readFile(path.join(dir, file)).match(pattern);
        if (found) {
            value = Number(found[1]);
        }
    }

    return value;
}



// --------------------------------------------------------------- processes ---

/**
 * The folder a process runs in, as lsof gives it: its links resolved.
 * @param {string} pid
 * @returns {string}
 */
function dirOf(pid) {
    const line = sh(`lsof -a -d cwd -Fn -p ${pid}`).split("\n").find((one) => one[0] === "n");
    return line ? line.slice(1) : "";
}

/**
 * The name a process goes by: the app or server running in its folder, or its command
 * and folder, as "php in ~/Sites/old".
 * @param {string} pid
 * @param {string} dir
 * @returns {string}
 */
function nameOf(pid, dir) {
    const server = EXTRA_SERVERS.find((one) => realPathOf(one.dir) === dir);
    if (server) {
        return server.name;
    }

    const app = appRoots().flatMap(appDirsOf).find((one) => realPathOf(one) === dir);
    if (app) {
        return appInfo(app).name;
    }

    const command = path.basename(sh(`ps -p ${pid} -o comm=`)) || "A process";
    const home    = realPathOf(HOME);
    const folder  = dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir;
    return folder ? `${command} in ${folder}` : command;
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



// The public API
export {
    blockerOf,
    freePort,
};
