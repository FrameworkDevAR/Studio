#!/usr/bin/env node

"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const system = require("./core/system");
const config = require("./core/config");
const jobs = require("./core/jobs");
const services = require("./stack/services");
const apache = require("./stack/apache");
const php = require("./stack/php");
const pecl = require("./stack/pecl");
const node = require("./stack/node");
const logs = require("./stack/logs");
const apps = require("./apps/apps");
const icons = require("./apps/icons");
const databases = require("./database/databases");
const mariadb = require("./database/mariadb");
const schema = require("./database/schema");
const rows = require("./database/rows");
const structure = require("./database/structure");
const tables = require("./database/tables");
const sql = require("./database/sql");
const exporter = require("./database/exports");
const importer = require("./database/imports");



// ------------------------------------------------------------------ config ---

const PORT    = 9900;
const HOST    = "127.0.0.1";
// The page, served as it is.
const DESKTOP = path.join(system.ROOT, "desktop");

const MIME = {
    ".html" : "text/html; charset=utf-8",
    ".css"  : "text/css; charset=utf-8",
    ".js"   : "text/javascript; charset=utf-8",
    ".svg"  : "image/svg+xml",
    ".png"  : "image/png",
    ".ico"  : "image/x-icon",
    ".woff2": "font/woff2",
};


// ------------------------------------------------------------------ server ---

http.createServer(handle).listen(PORT, HOST, () => {
    console.log(`Studio on http://localhost:${PORT}/`);
});



/**
 * Answers one request: the api, or a file of the page. An answer that is data goes back as
 * JSON; a file, an icon or an export is sent as it is read.
 * @param {import("http").IncomingMessage} request
 * @param {import("http").ServerResponse} response
 * @returns {Promise<void>}
 */
async function handle(request, response) {
    if (!isLocalHost(request.headers.host)) {
        return send(response, 403, { error : "Forbidden" });
    }

    // A POST changes something, so it needs the header only the page sends.
    if (request.method === "POST" && request.headers["x-studio"] !== "1") {
        return send(response, 403, { error : "Forbidden" });
    }

    try {
        const url    = new URL(request.url, `http://localhost:${PORT}`);
        const answer = await route(request, response, url);
        if (!response.headersSent) {
            send(response, 200, answer);
        }
    } catch (error) {
        send(response, 500, { error : error.message });
    }
}

/**
 * What a request asks for, by its method and path: the data to answer with, or nothing when
 * the answer was sent already.
 * @param {import("http").IncomingMessage} request
 * @param {import("http").ServerResponse} response
 * @param {URL} url
 * @returns {Promise<*>}
 */
async function route(request, response, url) {
    const query = url.searchParams;

    switch (`${request.method} ${url.pathname}`) {
    // The page, the stack and the apps.
    case "GET /api/state":           return readState();
    case "GET /api/config":          return config.readConfigFile();
    case "GET /api/icon":            return sendIcon(response, query.get("project"));
    case "GET /api/log":             return logs.readLog(
        query.get("name"),
        Number(query.get("lines")) || 200,
    );
    case "GET /api/job":             return jobs.readJob(query.get("id"));
    case "GET /api/npm-search":      return node.searchPackages(query.get("q"));
    case "GET /api/pecl-search":     return pecl.searchExtensions(query.get("q"));
    case "GET /api/php-directives":  return php.readDirectives();
    case "GET /api/php-overrides":   return php.readOverrides();
    case "GET /api/apache-file":     return apache.readApacheFile(
        query.get("kind"),
        query.get("file"),
    );

    // The databases.
    case "GET /api/charsets":        return databases.readCharsets();
    case "GET /api/mariadb-options": return mariadb.readOptionList();
    case "GET /api/mariadb-file":    return mariadb.readOptionsFile();
    case "GET /api/engines":         return schema.readEngines();
    case "GET /api/db-tables":       return schema.readTables(query.get("db"));
    case "GET /api/db-structure":    return schema.readStructure(
        query.get("db"),
        query.get("table"),
    );
    case "GET /api/db-rows":         return rows.readRows(Object.fromEntries(query));
    case "GET /api/db-count":        return rows.countRows(Object.fromEntries(query));
    case "GET /api/db-counts":       return rows.countSmallTables(query.get("db"));
    // The export asked for in an action, by its id, as a download.
    case "GET /api/db-export":       return exporter.runExport(response, query.get("id"));
    // A dump, or a CSV into a table: the file is the request's body itself, streamed, and the
    // options are in the address.
    case "POST /api/db-import":      return sql.importDatabase(request, Object.fromEntries(query));
    case "POST /api/db-import-csv":  return importer.importCsv(request, Object.fromEntries(query));

    // Every change the page asks for.
    case "POST /api/action": {
        const body = await readBody(request);
        return runAction(body);
    }

    default:
        if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
            return sendFile(response, url.pathname);
        }
        return send(response, 404, { error : "Not found" });
    }
}

/**
 * Whether a request's Host header is Studio's own address, so no other site can ask.
 * @param {string} host
 * @returns {boolean}
 */
function isLocalHost(host) {
    return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}`;
}

/**
 * Sends some data as JSON, never cached.
 * @param {import("http").ServerResponse} response
 * @param {number} status
 * @param {*} data
 * @returns {void}
 */
function send(response, status, data) {
    response.writeHead(status, {
        "Content-Type"  : "application/json; charset=utf-8",
        "Cache-Control" : "no-store",
    });
    response.end(JSON.stringify(data));
}

/**
 * A file of the page, never one outside desktop/. A path with no extension is
 * one of the page's views, like /sites/apache, so it gets the page itself.
 * @param {import("http").ServerResponse} response
 * @param {string} pathname
 * @returns {void}
 */
function sendFile(response, pathname) {
    const file = path.join(DESKTOP, path.extname(pathname) ? pathname : "index.html");
    if (!file.startsWith(DESKTOP + path.sep) || !fs.existsSync(file)) {
        return send(response, 404, { error : "Not found" });
    }

    response.writeHead(200, {
        "Content-Type"  : MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control" : "no-store",
    });
    fs.createReadStream(file).pipe(response);
}

/**
 * A project's favicon. It is another project's file served from Studio's
 * address, where an SVG opened on its own could run scripts, so it is sent
 * with a policy that lets it be nothing but an image.
 * @param {import("http").ServerResponse} response
 * @param {string} project
 * @returns {void}
 */
function sendIcon(response, project) {
    const file = icons.iconFile(project || "");
    if (!file || !fs.existsSync(file)) {
        return send(response, 404, { error : "Not found" });
    }

    response.writeHead(200, {
        "Content-Type"            : MIME[path.extname(file).toLowerCase()]
            || "application/octet-stream",
        "Content-Security-Policy" : "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        "X-Content-Type-Options"  : "nosniff",
        "Cache-Control"           : "max-age=300",
    });
    fs.createReadStream(file).pipe(response);
}

/**
 * A request's body, read as JSON; {} when it is empty.
 * @param {import("http").IncomingMessage} request
 * @returns {Promise<*>}
 */
function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => {
            body += chunk;
        });
        request.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
    });
}


// ------------------------------------------------------------------- state ---

/**
 * Everything the page shows, gathered in parallel.
 * @returns {Promise<Object<string, *>>}
 */
async function readState() {
    const [
        serviceList, phpState, nodeState, databaseList, mariadbState, projects, disk,
    ] = await Promise.all([
        services.readServices(),
        php.readPhp(),
        node.readNode(),
        databases.readDatabases(),
        mariadb.readMariadb(),
        apps.readApps(),
        services.readDisk(),
    ]);

    return {
        services   : serviceList,
        php        : phpState,
        node       : nodeState,
        databases  : databaseList,
        mariadb    : mariadbState,
        apps       : projects.apps,
        servers    : projects.servers,
        branches   : projects.branches,
        // The projects with a favicon, which the page asks /api/icon for.
        icons      : Object.keys(icons.readIcons(projects.apps, projects.servers)),
        disk,
        listen     : apache.readListen(),
        logs       : logs.readLogSizes(),
        modules    : await apache.readModules(),
        includes   : apache.readIncludes(),
        apache     : { version : system.versionOf("httpd") },
        vhosts     : apache.readVhosts(),
        phpmyadmin : { url : system.PHPMYADMIN, version : system.versionOf("phpmyadmin") },
        files      : {
            httpdConf : system.HTTPD_CONF,
            vhosts    : system.VHOSTS,
            phpIni    : php.phpIniFile(),
            mysqlData : system.MYSQL_DATA,
            mysqlCnf  : system.MYSQL_CNF,
        },
    };
}


// ----------------------------------------------------------------- actions ---

/**
 * Performs one change asked for by the page.
 * @param {*} body
 * @returns {Promise<*>}
 */
async function runAction(body) {
    switch (body.action) {
    // The services.
    case "service":         return services.serviceAction(body.service, body.op);
    case "start-all":       return services.startAll();
    case "restart-all":     return services.restartAll();
    case "stop-all":        return services.stopAll();

    // PHP's settings and its extensions.
    case "php-setting":     return php.setPhpSetting(
        String(body.key || ""),
        String(body.value ?? "").trim(),
    );
    case "php-settings":    return php.setPhpSettings(body.changes);
    case "php-save":        return php.saveOverrides(body.text);
    case "php-check":       return php.checkOverrides(body.text);
    case "pecl-install":    return pecl.installExtension(body.name);
    case "pecl-update":     return pecl.updateExtensions(body.name);
    case "pecl-rebuild":    return pecl.reinstallExtension(body.name);
    case "pecl-remove":     return pecl.uninstallExtension(body.name);

    // Node's global packages.
    case "npm-update":      return node.updatePackages(body.name);
    case "npm-install":     return node.installPackage(body.name);
    case "npm-uninstall":   return node.uninstallPackage(body.name);

    // Apache: its modules, the files it includes, and its own files.
    case "module":          return apache.setModule(body.name, Boolean(body.enabled));
    case "reload":          return apache.reloadApache();
    case "apache-check":    return apache.checkApacheFile(body.kind, body.text, body.file);
    case "apache-save":     return apache.saveApacheFile(body.kind, body.text, body.file);
    case "apache-include":  return apache.setInclude(
        String(body.file || ""),
        Boolean(body.enabled),
    );

    // The apps and their servers.
    case "app-start":       return body.id ? apps.startServer(body.id) : apps.startApp(body.dir);
    case "app-stop":        return body.id ? apps.stopServer(body.id) : apps.stopApp(body.dir);
    case "group-start":     return apps.startGroup(body.group);

    // Studio's config, the logs, and a file opened in its editor. A file Apache includes
    // opens by its path, once it is known to be one.
    case "save-config":     return config.saveConfig(body.text);
    case "clear-log":       return logs.clearLog(body.name);
    case "open-file":       return config.openFile(
        body.file,
        body.file === "apacheInclude" ? apache.apacheFile("include", body.path) : "",
    );

    // The databases, their users, and MariaDB's settings.
    case "db-create":       return databases.createDatabase(body);
    case "db-change":       return databases.changeDatabase(body);
    case "db-drop":         return databases.dropDatabase(body);
    case "user-create":     return databases.createUser(body);
    case "user-change":     return databases.changeUser(body);
    case "user-drop":       return databases.dropUser(body);
    case "mariadb-options": return mariadb.setOptions(body.changes);
    case "mariadb-save":    return mariadb.saveOptionsFile(body.text);
    case "mariadb-check":   return mariadb.checkOptions(body.text);

    // A database's tables.
    case "db-table-create": return tables.createTable(body);
    case "db-table-change": return tables.changeTable(body);
    case "db-table-rename": return tables.renameTable(body);
    case "db-table-copy":   return tables.duplicateTable(body);
    case "db-table-empty":  return tables.emptyTable(body);
    case "db-table-drop":   return tables.dropTable(body);
    case "db-table-upkeep": return tables.maintainTables(body);
    case "db-next-id":      return tables.nextId(body);

    // A table's columns, indexes and foreign keys.
    case "db-column-save":  return structure.saveColumn(body);
    case "db-column-move":  return structure.moveColumn(body);
    case "db-column-drop":  return structure.dropColumn(body);
    case "db-index-add":    return structure.addIndex(body);
    case "db-index-drop":   return structure.dropIndex(body);
    case "db-fk-save":      return structure.saveForeignKey(body);
    case "db-fk-drop":      return structure.dropForeignKey(body);

    // A table's rows.
    case "db-row":          return rows.readRow(body);
    case "db-row-save":     return rows.saveRow(body);
    case "db-row-delete":   return rows.deleteRow(body);
    case "db-rows-set":     return rows.setColumn(body);

    // SQL, and the export, which is then fetched by its id.
    case "db-sql":          return sql.runSql(body);
    case "db-export":       return exporter.prepareExport(body);

    default:                throw new Error(`Unknown action ${body.action}`);
    }
}
