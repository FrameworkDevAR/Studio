"use strict";
// The paths of the stack, and the apps Studio opens things with, shared by
// the server and the SwiftBar plugin. Each can be set in config.json; what is
// not set is the default below.

const os = require("os");
const path = require("path");



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
};

/**
 * What opens what: the browser for the pages, the editor for the config
 * files, and where phpMyAdmin answers. An empty browser or editor is the
 * Mac's default one.
 */
const TOOLS = {
    browser    : "",
    editor     : "",
    phpMyAdmin : "http://localhost/phpmyadmin",
};

/**
 * The paths of a config, with the defaults filled in and `~` expanded. The
 * tools inside Homebrew -- brew, httpd, apachectl -- come from `homebrew`.
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

/** The tools of a config, with the defaults filled in. */
function toolsOf(config) {
    const tools = { ...TOOLS };
    for (const key of Object.keys(TOOLS)) {
        if (config && typeof config[key] === "string" && config[key]) {
            tools[key] = config[key];
        }
    }
    return tools;
}

/** ~/Projects -> /Users/someone/Projects, so the config can be shared. */
function expandHome(dir) {
    return String(dir || "").replace(/^~(?=\/|$)/, os.homedir());
}

module.exports = { DEFAULTS, TOOLS, pathsOf, toolsOf, expandHome };
