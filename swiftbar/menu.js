// The menu as SwiftBar draws it: the title, the services, the projects with their apps
// and servers, and the items each is made of.

import path from "node:path";

import {
    APACHE_LOG, VHOSTS, GREEN, RED, PHP_INI, GREY, SERVERS_NAME, PROJECTS, SELF,
    PHPMYADMIN, EDITOR
} from "./config.js";
import { readFile } from "./helpers.js";
import {
    appRootOf, appDirsOf, appInfo, byProjectThenApp, titleOf, schemeOf, hostOf
} from "./apps.js";
import { urlOf } from "./state.js";
import { logOf } from "./starts.js";



/**
 * What the menu shows, as state.js reads it.
 * @typedef {import("./state.js").MenuState} MenuState
 */

/**
 * A menu item's parameters, each printed as key=value after its text.
 * @typedef {Object<string, string | number | boolean>} MenuParams
 */



// -------------------------------------------------------------------- menu ---

/**
 * The menu bar itself: the stack's health and how many servers are up.
 * Yellow means something is starting or stopping, or only part is up. Under
 * it, Studio, and the updates that are out, which open in Studio.
 * @param {MenuState} state
 * @returns {void}
 */
function renderTitle({ apacheWorkers, mysqlUp, servers, extras, stackBusy, updates, starts }) {
    const all  = [ ...extras, ...Object.values(starts) ];
    let icon   = "🔴";
    if (stackBusy || all.some((start) => start.starting)) {
        icon = "🟡";
    } else if (apacheWorkers && mysqlUp) {
        icon = "🟢";
    } else if (apacheWorkers || mysqlUp) {
        icon = "🟡";
    }

    // A start that failed shows in the bar too, as the menu is closed when it happens.
    const running = countRunning(servers, extras);
    const failed  = all.some((start) => start.failed) ? " ⚠️" : "";
    item(`${running ? `${icon} ${running}` : icon}${failed}`);
    separator();
    item("🎛️ Studio", onClick("open-studio", undefined, { refresh : false }));
    if (updates) {
        item(
            `⬆️ ${updates === 1 ? "An update is out" : `${updates} updates are out`}`,
            onClick("open-studio", "settings/updates", { refresh : false }),
        );
    }
    separator();
}

/**
 * Apache, MariaDB and Redis, plus PHP and phpMyAdmin, which run inside Apache.
 * @param {MenuState} state
 * @returns {void}
 */
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

/**
 * A project with servers of its own: the running ones, then the idle ones under Start….
 * @param {import("./apps.js").Project} project
 * @param {MenuState} state
 * @returns {void}
 */
function renderServers(project, state) {
    const servers = serversOf(project, state);
    const running = servers.filter((server) => server.pid);
    const title   = project.name || SERVERS_NAME;

    separator();
    item(running.length ? `${title} — ${running.length} running` : title, { size : 13 });
    renderRunningServers(servers, state);

    const idle = servers.filter((server) => !server.pid && !server.starting && !server.failed);
    if (idle.length) {
        item("Start…", { color : GREY });
        startAllItem(idle.length, onClick("start-extras", `"${title}"`));
        for (const server of idle) {
            subItem(server.name, onClick("start-extra", server.id));
        }
    }
}

/**
 * The project's own servers, as the state finds them.
 * @param {import("./apps.js").Project} project
 * @param {MenuState} state
 * @returns {import("./state.js").ExtraServer[]}
 */
function serversOf(project, { extras }) {
    const ids = new Set(project.servers.map((server) => server.id));
    return extras.filter((server) => ids.has(server.id));
}

/**
 * The running servers, and the ones starting.
 * @param {import("./state.js").ExtraServer[]} servers
 * @param {MenuState} state
 * @returns {void}
 */
function renderRunningServers(servers, { stopping }) {
    for (const server of servers) {
        if (server.pid) {
            runningServer({
                name : server.name,
                pid  : server.pid,
                url  : urlOf(server),
                dir  : server.dir,
                stopping  : stopping.has(server.pid),
                hotReload : server.hotReload,
            });
        } else if (server.starting) {
            startingItem(server.name);
        } else if (server.failed) {
            failedItem(server.name, server.failed, server.id, "start-extra");
        }
    }
}

/**
 * A section per project: its running apps, then the idle ones under Start….
 * Rows name only the app.
 * @param {MenuState} state
 * @returns {void}
 */
function renderProjects(state) {
    const { servers, stopping, portByPid, starts } = state;

    for (const project of PROJECTS) {
        if (!project.menu) {
            continue;
        }

        // A project with a folder shows its servers in its own section, below
        if (!project.dir) {
            if (project.servers.length) {
                renderServers(project, state);
            }
            continue;
        }

        const extras      = serversOf(project, state);
        const extrasIdle  = extras.filter((server) => !server.pid && !server.starting
            && !server.failed);

        const root    = project.dir;
        const running = servers.filter((server) => appRootOf(server.dir) === root);
        const busy    = new Set(running.map((server) => server.dir));
        const stopped = appDirsOf(root)
            .filter((dir) => !busy.has(dir)
                && readFile(path.join(dir, "package.json")).includes(`"start"`))
            .map(appInfo)
            .sort(byProjectThenApp);

        // A start under way, or one that failed, shows in its own row instead of Start….
        const idle    = stopped.filter((app) => !starts[app.dir]?.starting
            && !starts[app.dir]?.failed);
        if (!running.length && !idle.length && !extras.length) {
            continue;
        }

        separator();
        const title = project.name || titleOf(path.basename(root));
        const count = running.length + extras.filter((server) => server.pid).length;
        item(count ? `${title} — ${count} running` : title, { size : 13 });

        for (const site of project.sites) {
            item(`🌐 ${site.name}`, onClick("open-url", site.url, { refresh : false }));
        }

        for (const server of running) {
            const port = portByPid[server.pid];
            if (starts[server.dir]?.starting) {
                startingItem(server.app);
                continue;
            }

            runningServer({
                name : server.app,
                pid  : server.pid,
                // A Node app that is not Vite, like a socket server, has no page
                url  : port && server.isVite !== false
                    ? `${schemeOf(server.dir)}://${hostOf(server.dir)}:${port}/`
                    : null,
                dir  : server.dir,
                stopping : stopping.has(server.pid),
            });
        }

        for (const app of stopped) {
            if (starts[app.dir]?.starting) {
                startingItem(app.app);
            } else if (starts[app.dir]?.failed) {
                failedItem(app.app, starts[app.dir].failed, app.dir, "start-app");
            }
        }

        renderRunningServers(extras, state);

        if (!idle.length && !extrasIdle.length) {
            continue;
        }

        item("Start…", { color : GREY });
        if (idle.length) {
            startAllItem(
                idle.length,
                onClick("start-apps", `"${idle.map((app) => app.dir).join(":")}"`),
            );
        }

        for (const app of idle) {
            subItem(app.app, onClick("start-app", `"${app.dir}"`));
        }

        if (extrasIdle.length) {
            if (idle.length) {
                separator(1);
            }
            for (const server of extrasIdle) {
                subItem(server.name, onClick("start-extra", server.id));
            }
        }
    }
}

/**
 * Start all, atop a Start… submenu with two or more entries.
 * @param {number} count
 * @param {MenuParams} action
 * @returns {void}
 */
function startAllItem(count, action) {
    if (count < 2) {
        return;
    }
    subItem(`🚀 Start all (${count})`, action);
    separator(1);
}

/**
 * Stopping every app, when any is running.
 * @param {MenuState} state
 * @returns {void}
 */
function renderAppsFooter({ servers }) {
    if (!servers.length) {
        return;
    }

    separator();
    item(`Stop all apps (${servers.length})`, onClick("stop-vite"));
}

/**
 * Just Refresh.
 * @returns {void}
 */
function renderFooter() {
    separator();
    item("Refresh", { refresh : true });
}


// --------------------------------------------------------------- menu parts ---

/**
 * Everything up: the Vite apps plus the extra servers that are listening.
 * @param {import("./state.js").AppServer[]} servers
 * @param {import("./state.js").ExtraServer[]} extras
 * @returns {number}
 */
function countRunning(servers, extras) {
    return servers.length + extras.filter((server) => server.pid).length;
}

/**
 * A service row with its start or stop entry underneath.
 * @param {{
 *     label: string, version: string, up: boolean, detail?: string, start: string,
 *     stop: string,
 * }} row
 * @returns {void}
 */
function service({ label, version, up, detail = "", start, stop }) {
    const suffix = up && detail ? ` — ${detail}` : "";
    item(`${up ? "🟢" : "🔴"} ${label} (${version})${suffix}`, { color : up ? GREEN : RED });
    subItem(up ? `Stop ${label}` : `Start ${label}`, onClick(up ? stop : start));
}

/**
 * A row for an app or server on its way up, until it listens.
 * @param {string} name
 * @returns {void}
 */
function startingItem(name) {
    item(`🟡 ${name} — starting…`, { color : GREY });
}

/**
 * A row for an app or server that quit before it listened: why, from its output, its log,
 * and starting it again, or forgetting it.
 * @param {string} name
 * @param {string} reason
 * @param {string} target its folder, or its id
 * @param {string} start the action that starts it
 * @returns {void}
 */
function failedItem(name, reason, target, start) {
    item(`⚠️ ${name} — did not start`, { color : RED });
    subItem(reason.replace(/\|/g, "/"), { color : GREY });
    separator(1);
    subItem("Show the log", opensLog(logOf(target)));
    subItem("Try again", onClick(start, `"${target}"`));
    subItem("Dismiss", onClick("dismiss", `"${target}"`));
}

/**
 * A running server row: Open (reusing the tab), a terminal, then Stop. A `flutter run`
 * has no terminal to press r or R in, so it gets Reload and Restart, sending it the
 * signals that do the same.
 * @param {{
 *     name: string, url: string, pid: string, dir: string, stopping: boolean,
 *     hotReload?: boolean,
 * }} server
 * @returns {void}
 */
function runningServer({ name, url, pid, dir, stopping, hotReload = false }) {
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
    if (hotReload) {
        separator(1);
        subItem("Reload", onClick("reload-proc", pid, { refresh : false }));
        subItem("Restart", onClick("restart-proc", pid, { refresh : false }));
    }
    separator(1);
    subItem("Stop", onClick("stop-proc", pid));
}


// --------------------------------------------------------- menu primitives ---

/**
 * Prints one menu item. Depth 1 makes it a submenu entry of the one above.
 * @param {string} text
 * @param {MenuParams=} params
 * @param {number=} depth
 * @returns {void}
 */
function item(text, params = {}, depth = 0) {
    const prefix = depth ? `${"--".repeat(depth)} ` : "";
    const attrs  = Object.entries(params).map(([ key, value ]) => `${key}=${value}`).join(" ");
    console.log(attrs ? `${prefix}${text} | ${attrs}` : `${prefix}${text}`);
}

/**
 * Prints a submenu entry of the item above.
 * @param {string} text
 * @param {MenuParams=} params
 * @returns {void}
 */
function subItem(text, params = {}) {
    item(text, params, 1);
}

/**
 * Prints a separator line, in the menu or, at depth 1, in the submenu above.
 * @param {number=} depth
 * @returns {void}
 */
function separator(depth = 0) {
    console.log(depth ? "-----" : "---");
}

/**
 * Params making a menu item re-invoke this script with an action.
 * @param {string} action
 * @param {string=} argument
 * @param {{ terminal?: boolean, refresh?: boolean }=} options
 * @returns {MenuParams}
 */
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

/**
 * Params opening a file in Console.app, used for the log entries.
 * @param {string} file
 * @returns {MenuParams}
 */
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
 * @param {string} dir
 * @returns {MenuParams}
 */
function opensTerminal(dir) {
    return {
        bash     : "cd",
        param1   : dir,
        terminal : true,
    };
}

/**
 * Params opening phpMyAdmin, which needs Apache and MariaDB up; else it is greyed out.
 * @param {number} apacheWorkers
 * @param {boolean} mysqlUp
 * @returns {MenuParams}
 */
function opensPhpMyAdmin(apacheWorkers, mysqlUp) {
    if (!mysqlUp || !apacheWorkers) {
        return { color : GREY };
    }
    return onClick("open-url", PHPMYADMIN, { refresh : false });
}

/**
 * Params opening a file in the default text editor.
 * @param {string} file
 * @returns {MenuParams}
 */
function opensFile(file) {
    return {
        bash     : "/usr/bin/open",
        param1   : EDITOR ? "-a" : "-t",
        ...(EDITOR ? { param2 : `"${EDITOR}"`, param3 : file } : { param2 : file }),
        terminal : false,
    };
}



// The public API
export {
    renderTitle,
    renderServices,
    renderProjects,
    renderAppsFooter,
    renderFooter,
};
