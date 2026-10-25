"use strict";

// What the menu's items do when clicked: start and stop the stack, the apps and the
// servers, and open them.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const {
    sh, BREW, STACK_FLAG, STOPPING_FLAG, SELF, HOME, DESKTOPS_FLAG, WORKTREES_NAME, EXTRA_SERVERS,
    STUDIO, BROWSER
} = require("./config");
const { refreshMenu, startDetached, sleep, waitForUrl, readFile } = require("./helpers");
const {
    desktopApps, appRoots, appDirsOf, appInfo, byProjectThenApp, schemeOf, hostOf, appHomeOf
} = require("./apps");
const {
    readViteServers, startingFlagOf, readExtraServers, readListeningPorts, waitForServer,
    readAppServers, readStoppingPids, urlOf
} = require("./state");


// ----------------------------------------------------------------- actions ---

/**
 * Performs the action behind a clicked menu item.
 * @param {string} action
 * @param {string=} argument
 * @returns {void}
 */
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

        fs.writeFileSync(
            DESKTOPS_FLAG,
            `${WORKTREES_NAME} Desktop - Starting ${missing.length}…`,
        );
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
            .filter((server) => !server.pid && !server.starting
                && (!argument || server.group === argument));

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
            ...appRoots().flatMap(appDirsOf)
                .filter((dir) => readFile(path.join(dir, "package.json")).includes(`"start"`)),
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
                url      : port && server.isVite !== false
                    ? `${schemeOf(app.dir)}://${hostOf(app.dir)}:${port}/`
                    : null,
                // Where it answers, known even while stopped.
                host     : hostOf(app.dir),
                // The project's folder: the one holding the app, or holding the folder
                // of a nested one.
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
 * @param {string} url
 * @returns {void}
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

/**
 * Focuses the tab of a Chrome-like browser already on this URL, or opens one if there is none.
 * @param {string} browser
 * @param {string} url
 * @returns {void}
 */
function focusTab(browser, url) {
    execFileSync("/usr/bin/osascript", [ "-", browser, url ], {
        stdio : [ "pipe", "ignore", "ignore" ],
        input : `
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
`,
    });
}



// The public API
module.exports = {
    runAction,
};
