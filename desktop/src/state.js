// The page of Studio. One view shows at a time, picked by the path
// (/sites). The state is asked for every few seconds and every view is
// redrawn from it, except the PHP settings while one is being edited, so a
// refresh never throws away what is being typed.

"use strict";

const REFRESH_MS = 5000;
const VIEWS      = [ "overview", "services", "sites", "php", "node", "apache", "databases", "logs" ];
const TITLES     = {
    overview  : "Overview",
    services  : "Services",
    sites     : "Sites",
    php       : "PHP",
    node      : "Node.js",
    apache    : "Apache",
    databases : "Databases",
    logs      : "Logs",
};

/** How each service card looks and what it says. */
const SERVICE_INFO = {
    httpd   : { text : (state) => `Serves every site, with PHP inside. Ports ${state.listen.join(", ")}.` },
    mariadb : { text : (state) => `The database server, on port 3306. Data in ${state.files.mysqlData}.` },
    redis   : { text : () => "Cache server on port 6379. Not part of Start all." },
};

const SETTING_GROUPS = [
    { title : "Limits", keys : [ "memory_limit", "upload_max_filesize", "post_max_size", "max_execution_time", "max_input_time" ] },
    { title : "Errors", keys : [ "display_errors", "log_errors", "error_reporting" ] },
    { title : "Date",   keys : [ "date.timezone" ] },
    { title : "Xdebug", keys : [ "xdebug.mode" ] },
];

const SETTING_HINTS = {
    "memory_limit"        : "Per request, -1 for none",
    "upload_max_filesize" : "Largest single upload",
    "post_max_size"       : "Whole request, ≥ upload size",
    "max_execution_time"  : "Seconds, 0 for none",
    "max_input_time"      : "Seconds to read the request",
    "display_errors"      : "Print errors in the page",
    "log_errors"          : "Write errors to the log",
    "error_reporting"     : "Which errors count",
    "date.timezone"       : "Default timezone",
    "xdebug.mode"         : "Off is fastest",
};

let state        = null;
// Global packages being updated, by name, so a redraw keeps their buttons busy.
let updating     = new Set();
// Apps asked to start, by folder, until their process shows up.
let starting     = new Map();
let moduleFilter = "all";
let logName      = "apache";
let settingsKey  = "";
let recentErrors = [];
