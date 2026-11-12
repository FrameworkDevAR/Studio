// What the menu's items do when clicked: start and stop the stack, the apps and the
// servers, and open them.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
    sh, BREW, STACK_FLAG, STOPPING_FLAG, SELF, HOME, EXTRA_SERVERS,
    STUDIO, BROWSER
} from "./config.js";
import { refreshMenu, startDetached, sleep, waitForUrl, readFile } from "./helpers.js";
import {
    appRoots, appDirsOf, appInfo, byProjectThenApp, schemeOf, hostOf, appHomeOf
} from "./apps.js";
import {
    readExtraServers, readListeningPorts, readAppServers, readStoppingPids, urlOf
} from "./state.js";
import { blockerOf, freePort } from "./ports.js";
import { markStarting, startedPid, endStart, dismiss, logOf, reasonOf } from "./starts.js";



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

    // A flutter run's hot reload and hot restart, its r and R.
    case "reload-proc":  sh(`kill -USR1 ${argument}`); break;
    case "restart-proc": sh(`kill -USR2 ${argument}`); break;

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

    // From the menu, which asks first when the port wanted is taken.
    case "start-app":
        startAsked([ argument ]);
        break;

    // Several apps of one project, their folders joined by colons.
    case "start-apps":
        startAsked(argument.split(":").filter(Boolean));
        break;

    case "start-extra":
        startAsked([ argument ]);
        break;

    // Every stopped server, or those of the project named.
    case "start-extras":
        startAsked(readExtraServers(readListeningPorts())
            .filter((server) => !server.pid && !server.starting
                && (!argument || server.group === argument))
            .map((server) => server.id));
        break;

    // Not menu entries: Studio's starts, which ask in its page instead. start leaves an app
    // or server whose port is taken, and says by what; replace stops that first. Each
    // prints its answer as JSON.
    case "start": {
        const blocker = blockerOf(argument);
        if (!blocker) {
            startTarget(argument);
        }

        console.log(JSON.stringify({ started : !blocker, blocker }));
        break;
    }

    case "replace": {
        const blocker = blockerOf(argument);
        const free    = !blocker || freePort(blocker);
        if (free) {
            startTarget(argument);
        }

        refreshMenu();
        console.log(JSON.stringify({ started : free, blocker }));
        break;
    }

    // Detached: follows a start until it listens, or until what it started quits.
    case "await-start":  awaitStart(argument); break;

    // A failed start, once seen.
    case "dismiss":      dismiss(argument); break;

    case "open-url":     openInBrowser(argument); break;

    // Starts Studio if it is not running, then focuses its tab, at one of its pages when
    // given, as settings/updates.
    case "open-studio": {
        const page = /^[a-z/-]*$/.test(argument || "") ? argument || "" : "";
        const url  = `http://localhost:${STUDIO.port}/${page}`;

        if (!Object.values(readListeningPorts()).includes(String(STUDIO.port))) {
            startDetached("node", [ "backend/main.js" ], STUDIO.dir);
            waitForUrl(url);
        }

        // Studio's tab is found on any page, and taken to the one asked for.
        openInBrowser(url, `http://localhost:${STUDIO.port}/`);
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
            reload   : server.hotReload,
        }));

        console.log(JSON.stringify({ apps, servers }));
        break;
    }
    }
}

// ---------------------------------------------------------------- starting ---

/**
 * Starts apps and servers from the menu. Those whose port something else holds are asked
 * about in one dialog: stopping what holds them and starting them, or skipping them.
 * @param {string[]} targets app folders and server ids
 * @returns {void}
 */
function startAsked(targets) {
    const blocked = new Map();
    for (const target of targets) {
        const blocker = blockerOf(target);
        if (blocker) {
            blocked.set(target, blocker);
        } else {
            startTarget(target);
        }
    }

    if (!blocked.size || !askToFree([ ...blocked ])) {
        return;
    }

    for (const [ target, blocker ] of blocked) {
        if (freePort(blocker)) {
            startTarget(target);
        }
    }
    refreshMenu();
}

/**
 * Starts an app, by its folder, with its npm start, or a server, by its id, with its own
 * command, its output kept in a log. It is flagged as starting, and a detached copy
 * follows it, so the menu is not blocked; its page is not opened, as that is Open's job.
 * @param {string} target
 * @returns {void}
 */
function startTarget(target) {
    const server = EXTRA_SERVERS.find((one) => one.id === target);
    const log    = logOf(target);
    const pid    = server
        ? startDetached(server.command, server.args, server.dir, server.pathPrefix, log)
        : startDetached("npm", [ "run", "start" ], target, "", log);

    markStarting(target, pid);
    startDetached(SELF, [ "await-start", target ], HOME);
}

/**
 * Follows a start, up to its flag's limit: done once it listens, failed when what was
 * started quits first. A failure is kept with why, from its log, for the menu to show,
 * and said in a notification, as the menu may be closed.
 * @param {string} target
 * @returns {void}
 */
function awaitStart(target) {
    let pid = startedPid(target);

    while (pid && !isListening(target)) {
        if (sh(`ps -p ${pid} -o pid=`) === "") {
            const reason = reasonOf(target);
            endStart(target, reason);
            notify(`${targetName(target)} did not start`, reason);
            refreshMenu();
            return;
        }

        sleep(300);
        pid = startedPid(target);
    }

    endStart(target);
    refreshMenu();
}

/**
 * Whether an app, by its folder, or a server, by its id, listens on a port. A Vite server
 * is listed from the moment its process is there, so its port is what tells.
 * @param {string} target
 * @returns {boolean}
 */
function isListening(target) {
    const portByPid = readListeningPorts();
    if (EXTRA_SERVERS.some((one) => one.id === target)) {
        return Boolean(readExtraServers(portByPid).find((one) => one.id === target)?.pid);
    }
    return readAppServers(portByPid)
        .some((server) => server.dir === target && portByPid[server.pid]);
}

/**
 * Shows a notification, as the menu's own.
 * @param {string} title
 * @param {string} text
 * @returns {void}
 */
function notify(title, text) {
    try {
        execFileSync("/usr/bin/osascript", [ "-", title, text ], {
            stdio : [ "pipe", "ignore", "ignore" ],
            input : `
on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run
`,
        });
    } catch {
        // A notification that cannot show leaves the menu to say it.
    }
}

/**
 * Asks in a dialog whether to stop what holds the ports of the apps and servers about to
 * start. True to stop them and start these, false to skip these.
 * @param {[string, import("./ports.js").Blocker][]} blocked each target with its blocker
 * @returns {boolean}
 */
function askToFree(blocked) {
    const lines = blocked.map(([ target, blocker ]) =>
        `${targetName(target)}: port ${blocker.port} is in use by ${blocker.name}.`);
    const title = blocked.length === 1 ? "A port is in use" : "Some ports are in use";

    try {
        execFileSync("/usr/bin/osascript", [ "-", title, lines.join("\n") ], {
            stdio : [ "pipe", "ignore", "ignore" ],
            input : `
on run argv
  display dialog (item 2 of argv) with title (item 1 of argv) with icon caution ¬
    buttons {"Skip", "Stop and start"} default button "Stop and start" cancel button "Skip"
end run
`,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * What an app or a server is called in the menu: a server's name, an app's own.
 * @param {string} target
 * @returns {string}
 */
function targetName(target) {
    return EXTRA_SERVERS.find((one) => one.id === target)?.name || appInfo(target).name;
}



// ----------------------------------------------------------------- browser ---

/**
 * Opens a page in the browser of the config, or the Mac's default one. A
 * browser built on Chrome (Chrome, Brave, Edge, Vivaldi) shows the tab already
 * on the page instead of opening another; any other just opens it.
 * @param {string} url
 * @param {string=} match the start of a tab's address that counts as the page's
 * @returns {void}
 */
function openInBrowser(url, match = url) {
    if (!BROWSER) {
        execFileSync("/usr/bin/open", [ url ]);
        return;
    }

    if (hasHeadlessCopy(BROWSER)) {
        execFileSync("/usr/bin/open", [ "-a", BROWSER, url ]);
        return;
    }

    try {
        focusTab(BROWSER, url, match);
    } catch {
        execFileSync("/usr/bin/open", [ "-a", BROWSER, url ]);
    }
}

/**
 * Whether a headless copy of the browser is running. AppleScript can reach that copy instead
 * of the one on screen, and the page opens where nobody sees it, while `open` never does.
 * @param {string} browser
 * @returns {boolean}
 */
function hasHeadlessCopy(browser) {
    try {
        execFileSync("/usr/bin/pgrep", [ "-f", `${browser}\\.app/.* --headless` ]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Focuses the tab of a Chrome-like browser already on this URL, or opens one if there is none.
 * A tab whose address starts with the match counts too, and goes to the URL when it differs
 * from the match, as Studio's tab on another of its pages.
 * @param {string} browser
 * @param {string} url
 * @param {string} match
 * @returns {void}
 */
function focusTab(browser, url, match) {
    execFileSync("/usr/bin/osascript", [ "-", browser, url, match ], {
        stdio : [ "pipe", "ignore", "ignore" ],
        input : `
on run argv
  set theURL to item 2 of argv
  set theMatch to item 3 of argv
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
          if (URL of t) starts with theMatch then
            if theURL is not theMatch then set URL of t to theURL
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
export {
    runAction,
};
