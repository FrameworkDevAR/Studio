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
 * Starts or stops one app with the SwiftBar plugin's own actions, so it goes
 * exactly as from the menu, which also shows it stopping. Only an app the
 * plugin lists can be asked for.
 * @param {string} dir
 * @returns {Promise<{ message: string }>}
 */
async function startApp(dir) {
    const { apps } = await readApps();
    const app      = apps.find((one) => one.dir === dir);
    if (!app) {
        throw new Error("Unknown app");
    }

    if (!app.running) {
        await run(SWIFTBAR, [ "start-app", app.dir ]);
    }

    return { message : `Starting ${app.name}…` };
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
 * hold both. Only a group the plugin lists can be asked for.
 * @param {string|string[]} group one, or the several of a block
 * @returns {Promise<{ message: string }>}
 */
async function startGroup(group) {
    const names   = [ group ].flat().map(String);
    const { apps, servers } = await readApps();
    const own     = servers.filter((server) => names.includes(server.project));
    const mine    = apps.filter((app) => names.includes(app.project));
    if (!own.length && !mine.length) {
        throw new Error("Unknown project");
    }

    const stoppedServers = own.filter((server) => !server.running && !server.starting);
    for (const name of new Set(own.map((server) => server.project))) {
        await run(SWIFTBAR, [ "start-extras", name ]);
    }

    const stoppedApps = mine.filter((app) => !app.running);
    for (const app of stoppedApps) {
        await run(SWIFTBAR, [ "start-app", app.dir ]);
    }

    const parts = [];
    if (stoppedApps.length || !own.length) {
        parts.push(`${stoppedApps.length} app${stoppedApps.length === 1 ? "" : "s"}`);
    }
    if (own.length) {
        parts.push(`${stoppedServers.length} server${stoppedServers.length === 1 ? "" : "s"}`);
    }

    const title = mine[0]?.name.split(" - ")[0] || own[0].project;
    return { message : `Starting ${parts.join(" and ")} of ${title}…` };
}

/**
 * A project's server, which the plugin knows by its id.
 * @param {string} id
 * @returns {Promise<{ message: string }>}
 */
async function startServer(id) {
    const { servers } = await readApps();
    const server      = servers.find((one) => one.id === id);
    if (!server) {
        throw new Error("Unknown server");
    }

    if (!server.running && !server.starting) {
        await run(SWIFTBAR, [ "start-extra", server.id ]);
    }

    return { message : `Starting ${server.name}…` };
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
