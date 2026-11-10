// The paths of the stack, and the apps Studio opens things with, shared by
// the server and the SwiftBar plugin. Each can be set in config.json; what is
// not set is the default below.

import os from "node:os";
import path from "node:path";



/** Where Homebrew puts things on Apple silicon, for whatever the config does not set. */
const DEFAULTS = {
    homebrew  : "/opt/homebrew",
    httpdConf : "/opt/homebrew/etc/httpd/httpd.conf",
    vhosts    : "/opt/homebrew/etc/httpd/extra/httpd-vhosts.conf",
    phpIni    : "/opt/homebrew/etc/php/{php}/conf.d/99-local-dev.ini",
    mysqlData : "/opt/homebrew/var/mysql",
    mysqlCnf  : "/opt/homebrew/etc/my.cnf.d/local-dev.cnf",
    apacheLog : "/opt/homebrew/var/log/httpd/error_log",
    accessLog : "/opt/homebrew/var/log/httpd/access_log",
    redisLog  : "/opt/homebrew/var/log/redis.log",
    hosts     : "/etc/hosts",
    certs     : path.join(os.homedir(), ".certs"),
};

/**
 * What opens what: the browser for the pages and the editor for the config files. An empty
 * one is the Mac's default.
 */
const TOOLS = {
    browser : "",
    editor  : "",
};

/** Where phpMyAdmin answers: the setup serves it there, by an Alias on every vhost. */
const PHPMYADMIN = "http://localhost/phpmyadmin";

/**
 * Studio's last check for updates, which the menu reads to show how many are out, as asking
 * brew itself every 10 seconds would be too slow. In /tmp with the menu's flags: a restart
 * clears it, and Studio checks again when it starts.
 */
const OUTDATED = "/tmp/studio-outdated.json";



/**
 * The paths of a config, with the defaults filled in and `~` expanded. The
 * tools inside Homebrew -- brew, httpd, apachectl -- come from `homebrew`.
 * @param {Object<string, *>} config
 * @returns {Object<string, string>}
 */
function pathsOf(config) {
    const paths    = { ...DEFAULTS };

    for (const [ key, value ] of Object.entries((config && config.paths) || {})) {
        if (key in DEFAULTS && typeof value === "string" && value) {
            paths[key] = expandHome(value);
        }
    }

    return {
        ...paths,
        brew      : path.join(paths.homebrew, "bin", "brew"),
        httpd     : path.join(paths.homebrew, "opt", "httpd", "bin", "httpd"),
        apachectl : path.join(paths.homebrew, "opt", "httpd", "bin", "apachectl"),
    };
}

/**
 * The tools of a config, with the defaults filled in.
 * @param {Object<string, *>} config
 * @returns {{ browser: string, editor: string }}
 */
function toolsOf(config) {
    const tools = { ...TOOLS };

    for (const key of Object.keys(TOOLS)) {
        if (config && typeof config[key] === "string" && config[key]) {
            tools[key] = config[key];
        }
    }

    return tools;
}

/**
 * ~/Projects -> /Users/someone/Projects, so the config can be shared.
 * @param {string} dir
 * @returns {string}
 */
function expandHome(dir) {
    return String(dir || "").replace(/^~(?=\/|$)/, os.homedir());
}



// The public API
export {
    DEFAULTS,
    TOOLS,
    PHPMYADMIN,
    OUTDATED,

    pathsOf,
    toolsOf,
    expandHome,
};
