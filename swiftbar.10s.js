#!/usr/bin/env node
//
// <xbar.title>Studio</xbar.title>
// <xbar.version>v2.5</xbar.version>
// <xbar.author>Tomas Malbran</xbar.author>
// <xbar.desc>Start and stop the local stack and the apps and servers of each project.</xbar.desc>
//
// Drop SwiftBar's own menu items, so the menu holds only what this prints.
// Preferences go with them: `open swiftbar://preferences` reaches them.
// <swiftbar.hideAbout>true</swiftbar.hideAbout>
// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
// <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
// <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
// <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>
//
// With no arguments it prints the menu, every 10s (from the file name). With
// one it runs that action: the menu items call this same file back.
//
// The projects and servers come from config/config.json (or STUDIO_CONFIG);
// config/config.example.json shows its shape.
//
// Keep these:
//
//   1. The shebang is `env node`: SwiftBar's PATH has /usr/local/bin, where
//      node is linked (see the README).
//   2. Apache and MariaDB start with `brew services run`, never `start`, so
//      nothing comes up at login.
//   3. Links use a bash= action, never href=, so a browser built on Chrome
//      can reuse a tab already on the page instead of opening a new one.

"use strict";

const { execSync, execFileSync, spawn } = require("child_process");
const fs   = require("fs");
const os   = require("os");
const path = require("path");

const { pathsOf, toolsOf, expandHome } = require("./backend/paths");


// ------------------------------------------------------------------ config ---

const HOME = os.homedir();

/** This machine's settings: see config.example.json for each of them. */
const CONFIG = readConfig();

// The paths of the stack: the config's, or Homebrew's own.
const PATHS      = pathsOf(CONFIG);
const BREW       = PATHS.brew;
const HTTPD      = PATHS.httpd;
const VHOSTS     = PATHS.vhosts;
const APACHE_LOG = PATHS.apacheLog;

// The local PHP settings. Brew keeps a folder per minor version (8.5), so this
// follows the linked one; the file loads after php.ini, so it wins.
const PHP_MINOR  = versionOf("php").split(".").slice(0, 2).join(".");
const PHP_INI    = PATHS.phpIni.replace("{php}", PHP_MINOR);

// Served on every vhost by an Alias in VHOSTS.
const PHPMYADMIN = toolsOf(CONFIG).phpMyAdmin;
// What opens the pages and the config files: the config's, or the Mac's default.
const BROWSER    = toolsOf(CONFIG).browser;
const EDITOR     = toolsOf(CONFIG).editor;


/** The projects, in the config's order, with their defaults filled in. */
const PROJECTS = (CONFIG.projects || []).map((project) => ({
    name      : project.name || "",
    dir       : project.dir ? expandHome(project.dir) : "",
    worktrees : Boolean(project.worktrees),
    mainApp   : project.mainApp || "desktop",
    nestedApp : project.nestedApp || "web",
    servers   : project.servers || [],
}));

// The settings of a folder that belongs to no project.
const NO_PROJECT = { name : "", worktrees : false, mainApp : "desktop", nestedApp : "web" };

// The projects with worktrees, named in the entry starting their desktop apps.
const WORKTREES_NAME = PROJECTS.filter((project) => project.worktrees && project.name).map((project) => project.name).join(" + ") || "Worktree";

// The fallback title of a project with servers and no name.
const SERVERS_NAME = PROJECTS.find((project) => project.servers.length)?.name || "Servers";

/**
 * The projects' own servers: each started by its own command, and found by
 * what listens on its port. `pathPrefix` goes before PATH for its command only.
 */
const EXTRA_SERVERS = PROJECTS.flatMap((project) => project.servers.map((server) => ({
    args    : [],
    ...server,
    dir     : expandHome(server.dir),
    group   : project.name || SERVERS_NAME,
})));

// Studio, started on demand. node resolves the link SwiftBar runs this through,
// so __dirname is Studio's folder.
const STUDIO = { dir : __dirname, port : 9900 };

// Flags that let the menu show "Starting…" while an action runs: the stack's
// holds its label, since it covers both start and stop all.
const STACK_FLAG    = "/tmp/dev-stack.busy";
const DESKTOPS_FLAG = "/tmp/dev-desktops.busy";

// One per pid being shut down.
const STOPPING_FLAG = "/tmp/dev-stopping.";
const SELF = process.argv[1];

// The folder of the node running this comes first, wherever it was installed,
// and /usr/local/bin holds the npm globals linked there.
const PATH = `${path.dirname(process.execPath)}:${PATHS.homebrew}/bin:${PATHS.homebrew}/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

const GREEN = "#4caf50";
const RED   = "#e57373";
const GREY  = "#888888";


main();


// ------------------------------------------------------------------- entry ---

/** Runs the clicked action, or prints the menu when there is no argument. */
function main() {
    const [ , , action, argument ] = process.argv;
    if (action) {
        runAction(action, argument);
        return;
    }
    renderMenu();
}

/** The whole menu, in the order it appears. */
function renderMenu() {
    const state = readState();

    renderTitle(state);
    renderServices(state);
    renderProjects(state);
    renderAppsFooter(state);
    renderFooter();
}


// -------------------------------------------------------------------- menu ---

/**
 * The menu bar itself: the stack's health and how many servers are up.
 * Yellow means something is starting or stopping, or only part is up.
 */
function renderTitle({ apacheWorkers, mysqlUp, servers, extras, stackBusy, desktopsBusy }) {
    let icon = "🔴";
    if (stackBusy || desktopsBusy || extras.some((server) => server.starting)) {
        icon = "🟡";
    } else if (apacheWorkers && mysqlUp) {
        icon = "🟢";
    } else if (apacheWorkers || mysqlUp) {
        icon = "🟡";
    }

    const running = countRunning(servers, extras);
    item(running ? `${icon} ${running}` : icon);
    separator();
    item("🎛️ Studio", onClick("open-studio", undefined, { refresh : false }));
    separator();
}

/** Apache, MariaDB and Redis, plus PHP and phpMyAdmin, which run inside Apache. */
function renderServices({ apacheWorkers, mysqlUp, redisUp, stackBusy, versions }) {
    item("Services", { size : 13 });

    service({
        label   : "Apache",
        version : versions.httpd,
        up      : apacheWorkers > 0,
        detail  : `${apacheWorkers} workers`,
        start   : "start-apache",
        stop    : "stop-apache",
    });
    subItem("Open error_log", opensLog(APACHE_LOG));
    subItem("Edit vhosts", opensFile(VHOSTS));

    service({
        label   : "MariaDB",
        version : versions.mariadb,
        up      : mysqlUp,
        start   : "start-mysql",
        stop    : "stop-mysql",
    });

    // Live whenever Apache is, being its module.
    item(`${apacheWorkers ? "🟢" : "🔴"} PHP (${versions.php})`, { color : apacheWorkers ? GREEN : RED });
    subItem("Edit php.ini", opensFile(PHP_INI));

    // It needs both Apache and MariaDB, so it is only green with both up.
    const adminUp = apacheWorkers > 0 && mysqlUp;
    item(`${adminUp ? "🟢" : "🔴"} phpMyAdmin (${versions.phpmyadmin})`, {
        ...opensPhpMyAdmin(apacheWorkers, mysqlUp),
        color : adminUp ? GREEN : RED,
    });
    subItem("Open", opensPhpMyAdmin(apacheWorkers, mysqlUp));

    service({
        label   : "Redis",
        version : versions.redis,
        up      : redisUp,
        start   : "start-redis",
        stop    : "stop-redis",
    });

    // While the stack comes up or down, one inert line replaces both entries.
    if (stackBusy) {
        item(`🟡 ${stackBusy}`, { color : GREY });
        return;
    }
    item("Start all", onClick("start-all"));
    item("Stop all", onClick("stop-all"));
}

/** A project with servers of its own: the running ones, then the idle ones under Start…. */
function renderServers(project, { extras, stopping }) {
    const ids     = new Set(project.servers.map((server) => server.id));
    const servers = extras.filter((server) => ids.has(server.id));
    const running = servers.filter((server) => server.pid);
    const title   = project.name || SERVERS_NAME;

    separator();
    item(running.length ? `${title} — ${running.length} running` : title, { size : 13 });

    for (const server of servers) {
        if (server.pid) {
            runningServer({
                name : server.name,
                pid  : server.pid,
                url  : urlOf(server),
                dir  : server.dir,
                stopping : stopping.has(server.pid),
            });
        } else if (server.starting) {
            item(`🟡 ${server.name} — starting…`, { color : GREY });
        }
    }

    const idle = servers.filter((server) => !server.pid && !server.starting);
    if (idle.length) {
        item("Start…", { color : GREY });
        startAllItem(idle.length, onClick("start-extras", `"${title}"`));
        for (const server of idle) {
            subItem(server.name, onClick("start-extra", server.id));
        }
    }
}

/**
 * A section per project: its running apps, then the idle ones under Start….
 * Rows name only the app, except in a project with worktrees, where they say
 * which worktree too: "Shop Alpha - desktop".
 */
function renderProjects(state) {
    const { servers, stopping, portByPid } = state;
    for (const project of PROJECTS) {
        if (project.servers.length) {
            renderServers(project, state);
        }
        if (!project.dir) {
            continue;
        }
        const worktrees = projectRoots()
            .filter((root) => root.project === project)
            .map(({ root }) => {
                const running = servers.filter((server) => appRootOf(server.dir) === root);
                const busy    = new Set(running.map((server) => server.dir));
                const idle    = appDirsOf(root)
                    .filter((dir) => !busy.has(dir) && readFile(path.join(dir, "package.json")).includes(`"start"`))
                    .map(appInfo)
                    .sort(byProjectThenApp);
                return { title : titleOf(path.basename(root)), running, idle };
            })
            .filter(({ running, idle }) => running.length || idle.length);
        if (!worktrees.length) {
            continue;
        }

        separator();
        const title   = project.name || titleOf(path.basename(project.dir));
        const running = worktrees.reduce((count, worktree) => count + worktree.running.length, 0);
        item(running ? `${title} — ${running} running` : title, { size : 13 });

        for (const worktree of worktrees.filter((one) => one.running.length)) {
            for (const server of worktree.running) {
                const port = portByPid[server.pid];
                runningServer({
                    name : project.worktrees ? server.name : server.app,
                    pid  : server.pid,
                    // A Node app that is not Vite, like a socket server, has no page
                    url  : port && server.isVite !== false ? `${schemeOf(server.dir)}://${hostOf(server.dir)}:${port}/` : null,
                    dir  : server.dir,
                    stopping : stopping.has(server.pid),
                });
            }
        }

        const idle = worktrees.filter((one) => one.idle.length);
        if (!idle.length) {
            continue;
        }
        item("Start…", { color : GREY });
        if (project.worktrees) {
            renderEveryWorktree(idle);
        } else {
            startAllItem(idle[0].idle.length, onClick("start-apps", `"${idle[0].idle.map((app) => app.dir).join(":")}"`));
        }
        idle.forEach((worktree, index) => {
            if (index) {
                separator(1);
            }
            for (const app of worktree.idle) {
                subItem(project.worktrees ? app.name : app.app, onClick("start-app", `"${app.dir}"`));
            }
        });
    }
}

/**
 * A submenu atop a worktrees project's Start…, starting one app in every
 * worktree where it is stopped: "desktop (3)". Only apps stopped in two or
 * more worktrees, since for one the entry below does the same.
 */
function renderEveryWorktree(worktrees) {
    const dirsByApp = new Map();
    for (const app of worktrees.flatMap((worktree) => worktree.idle)) {
        dirsByApp.set(app.app, [ ...(dirsByApp.get(app.app) || []), app.dir ]);
    }
    const shared = [ ...dirsByApp ].filter(([ , dirs ]) => dirs.length > 1).sort(([ a ], [ b ]) => a.localeCompare(b));
    if (!shared.length) {
        return;
    }
    subItem("🚀 In every worktree");
    for (const [ app, dirs ] of shared) {
        item(`${app} (${dirs.length})`, onClick("start-apps", `"${dirs.join(":")}"`), 2);
    }
    separator(1);
}

/** Start all, atop a Start… submenu with two or more entries. */
function startAllItem(count, action) {
    if (count < 2) {
        return;
    }
    subItem(`🚀 Start all (${count})`, action);
    separator(1);
}

/** Starting every worktree's desktop app, and stopping every app, when there is any. */
function renderAppsFooter({ servers, desktopsBusy }) {
    const running = new Set(servers.map((server) => server.dir));
    const missing = desktopApps().filter((dir) => !running.has(dir));
    if (!desktopsBusy && !missing.length && !servers.length) {
        return;
    }
    separator();
    if (desktopsBusy) {
        item(`🟡 ${desktopsBusy}`, { color : GREY });
    } else if (missing.length) {
        item(`🖥️ ${WORKTREES_NAME} Desktop - Start ${missing.length}`, onClick("start-desktops"));
    }
    if (servers.length) {
        item(`Stop all apps (${servers.length})`, onClick("stop-vite"));
    }
}

/** Just Refresh. */
function renderFooter() {
    separator();
    item("Refresh", { refresh : true });
}


// --------------------------------------------------------------- menu parts ---

/** Everything up: the Vite apps plus the extra servers that are listening. */
function countRunning(servers, extras) {
    return servers.length + extras.filter((server) => server.pid).length;
}

/** A service row with its start or stop entry underneath. */
function service({ label, version, up, detail = "", start, stop }) {
    const suffix = up && detail ? ` — ${detail}` : "";
    item(`${up ? "🟢" : "🔴"} ${label} (${version})${suffix}`, { color : up ? GREEN : RED });
    subItem(up ? `Stop ${label}` : `Start ${label}`, onClick(up ? stop : start));
}

/** A running server row: Open (reusing the tab), a terminal, then Stop. */
function runningServer({ name, url, pid, dir, stopping }) {
    // Mid shutdown there is nothing left to open or stop.
    if (stopping) {
        item(`🟡 ${name} — stopping…`, { color : GREY });
        return;
    }
    if (url) {
        item(`🟢 ${name}`, onClick("open-url", url, { refresh : false }));
        subItem("Open", onClick("open-url", url, { refresh : false }));
    } else {
        item(`🟢 ${name}`);
    }
    subItem("Open in Terminal", opensTerminal(dir));
    separator(1);
    subItem("Stop", onClick("stop-proc", pid));
}


// --------------------------------------------------------- menu primitives ---

/** Prints one menu item. Depth 1 makes it a submenu entry of the one above. */
function item(text, params = {}, depth = 0) {
    const prefix = depth ? `${"--".repeat(depth)} ` : "";
    const attrs  = Object.entries(params).map(([ key, value ]) => `${key}=${value}`).join(" ");
    console.log(attrs ? `${prefix}${text} | ${attrs}` : `${prefix}${text}`);
}

function subItem(text, params = {}) {
    item(text, params, 1);
}

function separator(depth = 0) {
    console.log(depth ? "-----" : "---");
}

/** Params making a menu item re-invoke this script with an action. */
function onClick(action, argument, { terminal = false, refresh = true } = {}) {
    const params = {
        bash   : `"${SELF}"`,
        param1 : action,
    };
    if (argument !== undefined) {
        params.param2 = argument;
    }
    params.terminal = terminal;
    if (refresh) {
        params.refresh = true;
    }
    return params;
}

/** Params opening a file in Console.app, used for the log entries. */
function opensLog(file) {
    return {
        bash     : "/usr/bin/open",
        param1   : "-a",
        param2   : "Console",
        param3   : file,
        terminal : false,
    };
}

/**
 * Params opening a terminal at a directory. terminal=true lets SwiftBar open a
 * window in the running terminal; `open -na` would start a new instance each time.
 */
function opensTerminal(dir) {
    return {
        bash     : "cd",
        param1   : dir,
        terminal : true,
    };
}

/** Params opening phpMyAdmin, which needs Apache and MariaDB up; else it is greyed out. */
function opensPhpMyAdmin(apacheWorkers, mysqlUp) {
    if (!mysqlUp || !apacheWorkers) {
        return { color : GREY };
    }
    return onClick("open-url", PHPMYADMIN, { refresh : false });
}

/** Params opening a file in the default text editor. */
function opensFile(file) {
    return {
        bash     : "/usr/bin/open",
        param1   : EDITOR ? "-a" : "-t",
        ...(EDITOR ? { param2 : `"${EDITOR}"`, param3 : file } : { param2 : file }),
        terminal : false,
    };
}


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
        const pid = (pidsByDir.get(realPathOf(server.dir)) || []).sort((a, b) => portByPid[a] - portByPid[b])[0];
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
            const dir  = text.replace(/^\d+\s+node\s+/, "").replace(/\/node_modules\/\.bin\/vite.*$/, "");
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
        } else if (line.startsWith("n") && portByPid[pid] && apps.has(line.slice(1)) && !others.has(line.slice(1))) {
            others.set(line.slice(1), { pid, ...appInfo(line.slice(1)), isVite : false });
        }
    }
    return [ ...vite, ...others.values() ].sort(byProjectThenApp);
}


// ----------------------------------------------------------------- actions ---

/** Performs the action behind a clicked menu item. */
function runAction(action, argument) {
    switch (action) {
    case "start-apache": sh(`${BREW} services run httpd`);     break;
    case "stop-apache":  sh(`${BREW} services stop httpd`);    break;
    case "start-mysql":  sh(`${BREW} services run mariadb`);   break;
    case "stop-mysql":   sh(`${BREW} services stop mariadb`);  break;
    case "start-redis":  sh(`${BREW} services start redis`);    break;
    case "stop-redis":   sh(`${BREW} services stop redis`);     break;

    // Apache and MariaDB. Redis is not always wanted, so only stop all takes it.
    case "start-all":
        fs.writeFileSync(STACK_FLAG, "Starting…");
        refreshMenu();
        // One formula per call -- brew services takes no list.
        sh(`${BREW} services run httpd`);
        sh(`${BREW} services run mariadb`);
        fs.rmSync(STACK_FLAG, { force : true });
        refreshMenu();
        break;

    case "stop-all":
        fs.writeFileSync(STACK_FLAG, "Stopping…");
        refreshMenu();
        sh(`${BREW} services stop redis`);
        sh(`${BREW} services stop httpd`);
        sh(`${BREW} services stop mariadb`);
        fs.rmSync(STACK_FLAG, { force : true });
        refreshMenu();
        break;

    // Flag the pid as stopping; a detached copy clears it once it is gone.
    case "stop-proc":
        fs.writeFileSync(`${STOPPING_FLAG}${argument}`, "stopping…");
        sh(`kill -TERM ${argument}`);
        startDetached(SELF, [ "await-stop", argument ], HOME);
        break;

    case "await-stop":
        for (let attempt = 0; attempt < 60; attempt++) {
            if (sh(`ps -p ${argument} -o pid=`) === "") {
                break;
            }
            sleep(250);
        }
        fs.rmSync(`${STOPPING_FLAG}${argument}`, { force : true });
        refreshMenu();
        break;
    case "stop-vite":
        for (const pid of sh(`pgrep -f "node .*/\\.bin/vite"`).split("\n").filter(Boolean)) {
            sh(`kill -TERM ${pid}`);
        }
        break;

    case "start-app":
        startDetached("npm", [ "run", "start" ], argument);
        break;

    // Several apps of one project, their folders joined by colons.
    case "start-apps":
        for (const dir of argument.split(":").filter(Boolean)) {
            startDetached("npm", [ "run", "start" ], dir);
        }
        break;

    // Every worktree's desktop app, waited for by a detached copy.
    case "start-desktops": {
        const running = new Set(readViteServers().map((server) => server.dir));
        const missing = desktopApps().filter((dir) => !running.has(dir));
        for (const dir of missing) {
            startDetached("npm", [ "run", "start" ], dir);
        }
        fs.writeFileSync(DESKTOPS_FLAG, `${WORKTREES_NAME} Desktop - Starting ${missing.length}…`);
        startDetached(SELF, [ "await-desktops" ], HOME);
        break;
    }

    // Detached: clears the flag once they are all up, or gives up.
    case "await-desktops":
        for (let attempt = 0; attempt < 60; attempt++) {
            const running = new Set(readViteServers().map((server) => server.dir));
            if (desktopApps().every((dir) => running.has(dir))) {
                break;
            }
            sleep(500);
        }
        fs.rmSync(DESKTOPS_FLAG, { force : true });
        refreshMenu();
        break;

    // Flags it as starting and leaves the wait to a detached copy, so the menu
    // is not blocked. Its page is not opened: that is the Open entry's job.
    case "start-extra": {
        const server = EXTRA_SERVERS.find((one) => one.id === argument);
        if (!server) {
            break;
        }
        startDetached(server.command, server.args, server.dir, server.pathPrefix);
        fs.writeFileSync(startingFlagOf(server), "starting");
        startDetached(SELF, [ "await-extra", server.id ], server.dir);
        break;
    }

    // Every stopped server, or those of the project named.
    case "start-extras": {
        const missing = readExtraServers(readListeningPorts())
            .filter((server) => !server.pid && !server.starting && (!argument || server.group === argument));
        for (const server of missing) {
            startDetached(server.command, server.args, server.dir, server.pathPrefix);
            fs.writeFileSync(startingFlagOf(server), "starting");
            startDetached(SELF, [ "await-extra", server.id ], server.dir);
        }
        break;
    }

    // Detached: clears the starting flag once the server answers, or gives up.
    case "await-extra": {
        const server = EXTRA_SERVERS.find((one) => one.id === argument);
        if (!server) {
            break;
        }
        waitForServer(server.id);
        fs.rmSync(startingFlagOf(server), { force : true });
        refreshMenu();
        break;
    }

    case "open-url":     openInBrowser(argument); break;

    // Starts Studio if it is not running, then focuses its tab.
    case "open-studio": {
        const url = `http://localhost:${STUDIO.port}/`;
        if (!Object.values(readListeningPorts()).includes(String(STUDIO.port))) {
            startDetached("node", [ "backend/server.js" ], STUDIO.dir);
            waitForUrl(url);
        }
        openInBrowser(url);
        break;
    }

    // Not a menu entry: Studio reads the apps this way, so both list the same.
    case "json": {
        const portByPid = readListeningPorts();
        const running   = readAppServers(portByPid);
        const stopping  = readStoppingPids();
        const byDir     = new Map(running.map((server) => [ server.dir, server ]));
        const dirs      = new Set([
            ...appRoots().flatMap(appDirsOf).filter((dir) => readFile(path.join(dir, "package.json")).includes(`"start"`)),
            ...running.map((server) => server.dir),
        ]);
        const apps = [ ...dirs ].map(appInfo).sort(byProjectThenApp).map((app) => {
            const server = byDir.get(app.dir);
            const port   = server ? portByPid[server.pid] : null;
            return {
                ...app,
                running  : Boolean(server),
                stopping : Boolean(server && stopping.has(server.pid)),
                pid      : server ? Number(server.pid) : null,
                port     : port ? Number(port) : null,
                url      : port && server.isVite !== false ? `${schemeOf(app.dir)}://${hostOf(app.dir)}:${port}/` : null,
                // Where it answers, known even while stopped.
                host     : hostOf(app.dir),
                // The project's folder: the one holding the app, or holding the folder of a nested one.
                root     : path.dirname(appHomeOf(app.dir)),
            };
        });
        // And the projects' own servers, as their sections find them.
        const servers = readExtraServers(portByPid).map((server) => ({
            id       : server.id,
            name     : server.name,
            project  : server.group,
            dir      : server.dir,
            running  : Boolean(server.pid),
            starting : server.starting,
            stopping : Boolean(server.pid && stopping.has(server.pid)),
            pid      : server.pid ? Number(server.pid) : null,
            port     : server.port,
            url      : urlOf(server),
        }));
        console.log(JSON.stringify({ apps, servers }));
        break;
    }
    }
}

/**
 * Opens a page in the browser of the config, or the Mac's default one. A
 * browser built on Chrome (Chrome, Brave, Edge, Vivaldi) shows the tab already
 * on the page instead of opening another; any other just opens it.
 */
function openInBrowser(url) {
    if (!BROWSER) {
        execFileSync("/usr/bin/open", [ url ]);
        return;
    }
    try {
        focusTab(BROWSER, url);
    } catch {
        execFileSync("/usr/bin/open", [ "-a", BROWSER, url ]);
    }
}

/** Focuses the tab of a Chrome-like browser already on this URL, or opens one if there is none. */
function focusTab(browser, url) {
    execFileSync("/usr/bin/osascript", [ "-", browser, url ], { stdio : [ "pipe", "ignore", "ignore" ], input : `
on run argv
  set theURL to item 2 of argv
  -- Chrome's words for windows and tabs, which every browser built on it shares.
  using terms from application "Google Chrome"
    tell application (item 1 of argv)
      if (count of windows) = 0 then
        make new window
        set URL of active tab of front window to theURL
        activate
        return
      end if
      repeat with w in windows
        set i to 1
        repeat with t in tabs of w
          if (URL of t) starts with theURL then
            set active tab index of w to i
            set index of w to 1
            activate
            return
          end if
          set i to i + 1
        end repeat
      end repeat
      tell front window to make new tab with properties {URL:theURL}
      activate
    end tell
  end using terms from
end run
` });
}


// -------------------------------------------------------------------- apps ---

/**
 * The folders that hold apps, in the config's order, each with its project:
 * a project's own folder, or each subfolder of one with worktrees.
 */
function projectRoots() {
    return PROJECTS
        .filter((project) => project.dir)
        .flatMap((project) => (project.worktrees ? subDirsOf(project.dir) : [ project.dir ])
            .map((root) => ({ root, project })));
}

/** The directories scanned one level deep for apps. */
function appRoots() {
    return projectRoots().map(({ root }) => root);
}

/** The settings of the project a folder is in: the closest root holding it. */
function settingsOf(dir) {
    const found = projectRoots()
        .filter(({ root }) => dir === root || dir.startsWith(`${root}/`))
        .sort((a, b) => b.root.length - a.root.length)[0];
    return found ? found.project : NO_PROJECT;
}

/** Where a project goes: the config's order, and its worktrees by folder name. */
function projectRank(project) {
    const index = projectRoots().findIndex(({ root }) => path.basename(root) === project);
    return index === -1 ? Infinity : index;
}

/** The main app of every worktree, whether running or not. */
function desktopApps() {
    return projectRoots()
        .filter(({ project }) => project.worktrees)
        .map(({ root, project }) => path.join(root, project.mainApp))
        .filter((dir) => fs.existsSync(path.join(dir, "package.json")));
}

/** An app's name, its project's folder and its own. */
function appInfo(dir) {
    const home = appHomeOf(dir);
    return {
        name    : nameOf(dir),
        project : path.basename(path.dirname(home)),
        app     : path.basename(home),
        dir,
    };
}

/** The project folder an app is in: the closest root holding it. */
function appRootOf(dir) {
    return appRoots()
        .filter((root) => dir.startsWith(`${root}/`))
        .sort((a, b) => b.length - a.length)[0];
}

/** The folders that can hold an app: each subfolder, and the nested app folder in it (shop/tv/web). */
function appDirsOf(root) {
    const nested = settingsOf(root).nestedApp;
    return subDirsOf(root).flatMap((dir) => [ dir, path.join(dir, nested) ]);
}

/** The folder an app is named after: itself, or its parent when it is a nested one. */
function appHomeOf(dir) {
    const clean = dir.replace(/\/$/, "");
    return path.basename(clean) === settingsOf(clean).nestedApp ? path.dirname(clean) : clean;
}

/** Orders apps by project, in the config's order, then the main app first and the rest alphabetically. */
function byProjectThenApp(a, b) {
    if (a.project !== b.project) {
        return projectRank(a.project) - projectRank(b.project) || a.project.localeCompare(b.project);
    }
    const main = settingsOf(a.dir).mainApp;
    if (a.app !== b.app && (a.app === main || b.app === main)) {
        return a.app === main ? -1 : 1;
    }
    return a.app.localeCompare(b.app);
}

/** /path/to/shop-alpha/desktop -> "Shop Alpha - desktop" */
function nameOf(dir) {
    const home = appHomeOf(dir);
    return `${projectTitleOf(path.dirname(home))} - ${path.basename(home)}`;
}

/** A project folder's title: the config's name, or one made from the folder. */
function projectTitleOf(root) {
    const settings = settingsOf(root);
    return settings.name && !settings.worktrees ? settings.name : titleOf(path.basename(root));
}

/** shop-alpha -> "Shop Alpha" */
function titleOf(folder) {
    return folder.split("-").map(capitalize).join(" ");
}

/** The scheme an app is served on: https when its vite.config sets server.https. */
function schemeOf(dir) {
    const configs   = filesIn(dir, "vite.config.");
    const usesHttps = configs.some((config) => /^\s*https\s*[,:]/m.test(readFile(config)));
    return usesHttps ? "https" : "http";
}

/** The host an app is served on: VITE_HOST in its .env files, else vite.config. */
function hostOf(dir) {
    for (const envFile of [ ".env.development.local", ".env.development" ]) {
        const found = readFile(path.join(dir, envFile)).match(/^\s*VITE_HOST\s*=\s*"?([^"\n]*)"?/m);
        if (found && found[1].trim()) {
            return found[1].trim();
        }
    }
    for (const config of filesIn(dir, "vite.config.")) {
        const found = readFile(config).match(/^\s*host\s*:\s*"([^"]+)"/m);
        if (found) {
            return found[1];
        }
    }
    return "localhost";
}


// ----------------------------------------------------------------- helpers ---

/**
 * This machine's settings, from config/config.json or the file in
 * STUDIO_CONFIG. Without one the menu still works, with no projects.
 */
function readConfig() {
    const file = process.env.STUDIO_CONFIG || path.join(__dirname, "config", "config.json");
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

/** Runs a command and returns its trimmed output, or "" if it failed. */
function sh(command) {
    try {
        return execSync(command, {
            encoding : "utf8",
            env      : { ...process.env, PATH },
        }).trim();
    } catch {
        return "";
    }
}

/**
 * The installed version of a formula, from where its opt link points, which
 * is cheaper than running the binaries every 10s.
 */
function versionOf(formula) {
    try {
        return path.basename(fs.realpathSync(path.join(PATHS.homebrew, "opt", formula))).replace(/_\d+$/, "");
    } catch {
        return "";
    }
}

/** True when at least one process matches the pgrep pattern. */
function isRunning(pattern) {
    return sh(`pgrep ${pattern}`) !== "";
}

/**
 * Polls a URL until it answers, or gives up. The wait is long because a start
 * right after a stop also waits out the port's TIME_WAIT.
 */
function waitForUrl(url, attempts = 75, waitMs = 200) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (sh(`curl -s -o /dev/null -w "%{http_code}" -m 1 ${url}`) === "200") {
            return true;
        }
        sleep(waitMs);
    }
    return false;
}

/** Asks SwiftBar to redraw now, instead of waiting for the next 10s tick. */
function refreshMenu() {
    sh(`open -g "swiftbar://refreshplugin?name=swiftbar"`);
}

/** Blocks the thread; the menu actions are synchronous by design. */
function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Starts a long-lived process that outlives this script. Output is dropped. */
function startDetached(command, args, cwd, pathPrefix = "") {
    spawn(command, args, {
        cwd,
        detached : true,
        stdio    : "ignore",
        env      : { ...process.env, PATH : pathPrefix ? `${pathPrefix}:${PATH}` : PATH },
    }).unref();
}

function subDirsOf(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes : true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(dir, entry.name));
    } catch {
        return [];
    }
}

function filesIn(dir, prefix) {
    try {
        return fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).map((f) => path.join(dir, f));
    } catch {
        return [];
    }
}

function readFile(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
}

function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
}
