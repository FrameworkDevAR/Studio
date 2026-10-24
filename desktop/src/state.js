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

    "max_connections"                : "Clients at once",
    "wait_timeout"                   : "Seconds an idle client is kept",
    "max_allowed_packet"             : "Largest query or row, as an import's",
    "character_set_server"           : "For new databases",
    "collation_server"               : "How new databases sort and compare",
    "innodb_buffer_pool_size"        : "Memory for data and indexes",
    "innodb_log_file_size"           : "Redo log, larger for big writes",
    "innodb_flush_log_at_trx_commit" : "1 is safest, 2 is faster",
    "sql_mode"                       : "How strict queries are",
    "default_storage_engine"         : "For new tables",
    "group_concat_max_len"           : "Longest GROUP_CONCAT",
    "slow_query_log"                 : "Log queries slower than the limit",
    "long_query_time"                : "Seconds a query is slow at",
    "general_log"                    : "Log every query, for debugging",
    "tmp_table_size"                 : "In-memory temporary tables",
    "max_heap_table_size"            : "MEMORY tables, ≥ tmp table size",
    "sort_buffer_size"               : "Per sort",
    "join_buffer_size"               : "Per join without an index",
};

/** MariaDB's options the Options tab shows in groups, as SETTING_GROUPS for PHP. */
const OPTION_GROUPS = [
    { title : "Connections", keys : [ "max_connections", "wait_timeout", "max_allowed_packet" ] },
    { title : "Encoding",    keys : [ "character_set_server", "collation_server" ] },
    { title : "InnoDB",      keys : [ "innodb_buffer_pool_size", "innodb_log_file_size", "innodb_flush_log_at_trx_commit" ] },
    { title : "Queries",     keys : [ "sql_mode", "default_storage_engine", "group_concat_max_len" ] },
    { title : "Logging",     keys : [ "slow_query_log", "long_query_time", "general_log" ] },
    { title : "Memory",      keys : [ "tmp_table_size", "max_heap_table_size", "sort_buffer_size", "join_buffer_size" ] },
];

let state        = null;
// Global packages being updated, by name, so a redraw keeps their buttons busy.
let updating     = new Set();
// Apps asked to start, by folder, until their process shows up.
let starting     = new Map();
let moduleFilter = "all";
let logName      = "apache";
// What each settings page was last drawn from, so a refresh that changes nothing skips it.
/** @type {Record<string, string>} */
let settingsKeys = {};
let recentErrors = [];
