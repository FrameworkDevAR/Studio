// The apps and servers of each project, through the SwiftBar plugin's own actions.

import { SWIFTBAR, run } from "../core/system.js";



/**
 * An app as the plugin lists it: its project, its folder, whether it runs, and where.
 * @typedef {{
 *     name: string, project: string, app: string, dir: string, running: boolean,
 *     stopping: boolean, pid: number, port: number, url: string, host: string,
 *     root: string,
 * }} StudioApp
 */

/**
 * A project's own server as the plugin lists it: its id, its project, whether it runs, and
 * whether it takes a hot reload, as a flutter run does.
 * @typedef {{
 *     id: string, name: string, project: string, dir: string, running: boolean,
 *     starting: boolean, stopping: boolean, pid: number, port: number, url: string,
 *     reload: boolean,
 * }} StudioServer
 */

/**
 * An app or server left stopped as something else holds the port it wants: its name, the
 * port, and the name of what holds it.
 * @typedef {{ name: string, port: number, by: string }} Blocked
 */

/**
 * A start's answer: what it says, and those it left stopped for their ports, for the page
 * to ask about stopping what holds them.
 * @typedef {{ message: string, blocked: Blocked[] }} Started
 */



/**
 * The apps and servers of each project, with whether each runs and where. The
 * plugin finds them by their processes, so this makes no requests to them.
 * @returns {Promise<{
 *     apps: StudioApp[], servers: StudioServer[], branches: Object<string, string>,
 * }>}
 */
async function readApps() {
    const result = await run(SWIFTBAR, [ "json" ]);

    try {
        const { apps, servers } = JSON.parse(result.stdout);
        return {
            apps     : apps || [],
            servers  : servers || [],
            branches : await readBranches(apps || []),
        };
    } catch {
        return { apps : [], servers : [], branches : {} };
    }
}

/**
 * The git branch each project is on, by project. A project's folder holds its
 * apps, or holds the folder holding a nested one (shop/tv/web). Kept for
 * 15s, since the page asks every 5s and branches rarely change.
 */
let branchCache = { at : 0, data : {} };

/**
 * The branch of each project's folder, by project, read with git.
 * @param {StudioApp[]} apps
 * @returns {Promise<Object<string, string>>}
 */
async function readBranches(apps) {
    if (Date.now() - branchCache.at < 15_000) {
        return branchCache.data;
    }

    const roots    = projectRoots(apps);
    /** @type {Object<string, string>} */
    const branches = {};

    await Promise.all(Object.entries(roots).map(async ([ project, root ]) => {
        const found = await run("git", [ "-C", root, "branch", "--show-current" ]);
        branches[project] = found.ok ? found.stdout.trim() : "";
    }));

    branchCache = { at : Date.now(), data : branches };
    return branches;
}

/**
 * Starts one app with the SwiftBar plugin's own actions, so it goes exactly as from the
 * menu. Only an app the plugin lists can be asked for. When something else holds its port
 * it is not started, and the answer says what, for the page to ask; with replace, that is
 * stopped first.
 * @param {string} dir
 * @param {boolean=} replace
 * @returns {Promise<Started>}
 */
async function startApp(dir, replace = false) {
    const { apps } = await readApps();
    const app      = apps.find((one) => one.dir === dir);
    if (!app) {
        throw new Error("Unknown app");
    }

    if (app.running) {
        return { message : `${app.name} is running`, blocked : [] };
    }
    return startOne(app.dir, app.name, replace);
}

/**
 * Stops one running app, by its folder, with the plugin's own action.
 * @param {string} dir
 * @returns {Promise<{ message: string }>}
 */
async function stopApp(dir) {
    const { apps } = await readApps();
    const app      = apps.find((one) => one.dir === dir);
    if (!app || !app.pid) {
        throw new Error("That app is not running");
    }

    await run(SWIFTBAR, [ "stop-proc", String(app.pid) ]);
    return { message : `Stopping ${app.name}…` };
}

/**
 * Every stopped app or server of one block of the Sites page: a project's
 * servers, by its title, and the apps of a project folder, as a block may
 * hold both. Only a group the plugin lists can be asked for. Those whose port
 * something else holds are left stopped, and the answer lists them; with
 * replace, what holds them is stopped first.
 * @param {string|string[]} group one, or the several of a block
 * @param {boolean=} replace
 * @returns {Promise<Started>}
 */
async function startGroup(group, replace = false) {
    const names   = [ group ].flat().map(String);
    const { apps, servers } = await readApps();
    const own     = servers.filter((server) => names.includes(server.project));
    const mine    = apps.filter((app) => names.includes(app.project));
    if (!own.length && !mine.length) {
        throw new Error("Unknown project");
    }

    // One at a time, as each start reads what listens, and the one before may take a port.
    const stoppedServers = own.filter((server) => !server.running && !server.starting);
    const stoppedApps    = mine.filter((app) => !app.running);
    const blocked        = [];
    let startedServers   = 0;
    let startedApps      = 0;

    for (const server of stoppedServers) {
        const found = await startTarget(server.id, server.name, replace);
        if (found) {
            blocked.push(found);
        } else {
            startedServers++;
        }
    }

    for (const app of stoppedApps) {
        const found = await startTarget(app.dir, app.name, replace);
        if (found) {
            blocked.push(found);
        } else {
            startedApps++;
        }
    }

    const parts = [];
    if (startedApps || !own.length) {
        parts.push(`${startedApps} app${startedApps === 1 ? "" : "s"}`);
    }
    if (own.length) {
        parts.push(`${startedServers} server${startedServers === 1 ? "" : "s"}`);
    }

    const title = mine[0]?.name.split(" - ")[0] || own[0].project;
    return { message : `Starting ${parts.join(" and ")} of ${title}…`, blocked };
}

/**
 * A project's server, which the plugin knows by its id. Its port is checked as an app's.
 * @param {string} id
 * @param {boolean=} replace
 * @returns {Promise<Started>}
 */
async function startServer(id, replace = false) {
    const { servers } = await readApps();
    const server      = servers.find((one) => one.id === id);
    if (!server) {
        throw new Error("Unknown server");
    }

    if (server.running || server.starting) {
        return { message : `${server.name} is running`, blocked : [] };
    }
    return startOne(server.id, server.name, replace);
}

/**
 * Starts one app or server, and says so, or what holds its port.
 * @param {string} target
 * @param {string} name
 * @param {boolean} replace
 * @returns {Promise<Started>}
 */
async function startOne(target, name, replace) {
    const blocked = await startTarget(target, name, replace);
    if (blocked) {
        return {
            message : `Port ${blocked.port} is in use by ${blocked.by}`,
            blocked : [ blocked ],
        };
    }

    return { message : `Starting ${name}…`, blocked : [] };
}

/**
 * Starts an app, by its folder, or a server, by its id, through the plugin, unless something
 * else holds the port it wants: then it gives what. With replace, the plugin stops that
 * first, and throws when it does not stop.
 * @param {string} target
 * @param {string} name
 * @param {boolean} replace
 * @returns {Promise<Blocked | null>}
 */
async function startTarget(target, name, replace) {
    const result = await run(SWIFTBAR, [ replace ? "replace" : "start", target ], 30_000);
    const answer = parseJson(result.stdout);
    if (answer?.started) {
        return null;
    }

    if (replace || !answer?.blocker) {
        throw new Error(`${answer?.blocker?.name || "What holds its port"} did not stop`);
    }
    return { name, port : answer.blocker.port, by : answer.blocker.name };
}

/**
 * The plugin's JSON answer, or null when it gave none.
 * @param {string} text
 * @returns {*}
 */
function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Stops one running server of a project, by its id, with the plugin's own action.
 * @param {string} id
 * @returns {Promise<{ message: string }>}
 */
async function stopServer(id) {
    const { servers } = await readApps();
    const server      = servers.find((one) => one.id === id);
    if (!server || !server.pid) {
        throw new Error("That server is not running");
    }

    await run(SWIFTBAR, [ "stop-proc", String(server.pid) ]);
    return { message : `Stopping ${server.name}…` };
}

/**
 * Hot reloads or hot restarts a running server that takes them, a flutter run, with the
 * plugin's own action, as the menu does: its r and R, with no terminal to press them in.
 * @param {string} id
 * @param {boolean} restart a hot restart, which starts the app over, rather than a reload
 * @returns {Promise<{ message: string }>}
 */
async function reloadServer(id, restart) {
    const { servers } = await readApps();
    const server      = servers.find((one) => one.id === id);
    if (!server || !server.pid || !server.reload) {
        throw new Error("That server is not running, or cannot be reloaded");
    }

    await run(SWIFTBAR, [ restart ? "restart-proc" : "reload-proc", String(server.pid) ]);
    return { message : `${restart ? "Restarting" : "Reloading"} ${server.name}…` };
}

/**
 * Each project's folder, by project, as the plugin reports it with each app.
 * @param {StudioApp[]} apps
 * @returns {Object<string, string>}
 */
function projectRoots(apps) {
    return Object.fromEntries(apps.map((app) => [ app.project, app.root ]));
}



// The public API
export {
    projectRoots,
    readApps,
    startApp,
    stopApp,
    startGroup,
    startServer,
    stopServer,
    reloadServer,
};
