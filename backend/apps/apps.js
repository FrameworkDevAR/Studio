"use strict";

// The apps and servers of each project, through the SwiftBar plugin's own actions.

const { SWIFTBAR, run } = require("../core/system");



/**
 * The apps and servers of each project, with whether each runs and where. The
 * plugin finds them by their processes, so this makes no requests to them.
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
async function readBranches(apps) {
    if (Date.now() - branchCache.at < 15_000) {
        return branchCache.data;
    }
    const roots    = projectRoots(apps);
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
 */
async function startApp(dir) {
    const app = (await readApps()).apps.find((one) => one.dir === dir);
    if (!app) {
        throw new Error("Unknown app");
    }
    if (!app.running) {
        await run(SWIFTBAR, [ "start-app", app.dir ]);
    }
    return { message : `Starting ${app.name}…` };
}

async function stopApp(dir) {
    const app = (await readApps()).apps.find((one) => one.dir === dir);
    if (!app || !app.pid) {
        throw new Error("That app is not running");
    }
    await run(SWIFTBAR, [ "stop-proc", String(app.pid) ]);
    return { message : `Stopping ${app.name}…` };
}

/**
 * Every stopped app or server of one block of the Sites page: a project's
 * servers, by its title, or the apps of a project folder. Only a group the
 * plugin lists can be asked for.
 */
async function startGroup(group) {
    const { apps, servers } = await readApps();
    const own = servers.filter((server) => server.project === group);
    if (own.length) {
        const stopped = own.filter((server) => !server.running && !server.starting);
        await run(SWIFTBAR, [ "start-extras", group ]);
        return {
            message : `Starting ${stopped.length} server${
                stopped.length === 1 ? "" : "s"
            } of ${group}…`,
        };
    }
    const projectApps = apps.filter((app) => app.project === group);
    if (!projectApps.length) {
        throw new Error("Unknown project");
    }
    const stopped = projectApps.filter((app) => !app.running);
    for (const app of stopped) {
        await run(SWIFTBAR, [ "start-app", app.dir ]);
    }
    return {
        message : `Starting ${stopped.length} app${stopped.length === 1 ? "" : "s"} of ${
            projectApps[0].name.split(" - ")[0]
        }…`,
    };
}

/** A project's server, which the plugin knows by its id. */
async function startServer(id) {
    const server = (await readApps()).servers.find((one) => one.id === id);
    if (!server) {
        throw new Error("Unknown server");
    }
    if (!server.running && !server.starting) {
        await run(SWIFTBAR, [ "start-extra", server.id ]);
    }
    return { message : `Starting ${server.name}…` };
}

async function stopServer(id) {
    const server = (await readApps()).servers.find((one) => one.id === id);
    if (!server || !server.pid) {
        throw new Error("That server is not running");
    }
    await run(SWIFTBAR, [ "stop-proc", String(server.pid) ]);
    return { message : `Stopping ${server.name}…` };
}

/** Each project's folder, by project, as the plugin reports it with each app. */
function projectRoots(apps) {
    return Object.fromEntries(apps.map((app) => [ app.project, app.root ]));
}

module.exports = {
    projectRoots,
    readApps,
    startApp,
    stopApp,
    startGroup,
    startServer,
    stopServer,
};
