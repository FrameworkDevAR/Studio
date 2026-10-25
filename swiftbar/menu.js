"use strict";

// The menu as SwiftBar draws it: the title, the services, the projects with their apps
// and servers, and the items each is made of.

const path = require("path");

const {
    APACHE_LOG, VHOSTS, GREEN, RED, PHP_INI, GREY, SERVERS_NAME, PROJECTS, WORKTREES_NAME, SELF,
    PHPMYADMIN, EDITOR
} = require("./config");
const { readFile } = require("./helpers");
const {
    projectRoots, appRootOf, appDirsOf, appInfo, byProjectThenApp, titleOf, schemeOf, hostOf,
    desktopApps
} = require("./apps");
const { urlOf } = require("./state");


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
    item(`${apacheWorkers ? "🟢" : "🔴"} PHP (${versions.php})`, {
        color : apacheWorkers ? GREEN : RED,
    });
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
                    .filter((dir) => !busy.has(dir)
                        && readFile(path.join(dir, "package.json")).includes(`"start"`))
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
                    url  : port && server.isVite !== false
                        ? `${schemeOf(server.dir)}://${hostOf(server.dir)}:${port}/`
                        : null,
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
            startAllItem(
                idle[0].idle.length,
                onClick("start-apps", `"${idle[0].idle.map((app) => app.dir).join(":")}"`),
            );
        }
        idle.forEach((worktree, index) => {
            if (index) {
                separator(1);
            }
            for (const app of worktree.idle) {
                subItem(
                    project.worktrees ? app.name : app.app,
                    onClick("start-app", `"${app.dir}"`),
                );
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
    const shared = [ ...dirsByApp ].filter(([ , dirs ]) => dirs.length > 1)
        .sort(([ a ], [ b ]) => a.localeCompare(b));
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
        item(
            `🖥️ ${WORKTREES_NAME} Desktop - Start ${missing.length}`,
            onClick("start-desktops"),
        );
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


module.exports = {
    renderTitle,
    renderServices,
    renderProjects,
    renderAppsFooter,
    renderFooter,
};
