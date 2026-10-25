#!/usr/bin/env node

"use strict";

const fs   = require("fs");
const http = require("http");
const path = require("path");

const { ROOT, PHPMYADMIN, HTTPD_CONF, VHOSTS, MYSQL_DATA, MYSQL_CNF, versionOf } = require("./system");
const { readServices, readDisk, serviceAction, startAll, restartAll, stopAll } = require("./services");
const db                                                                    = require("./databases");
const mariadb                                                               = require("./mariadb");
const tables                                                                = require("./tables");
const exporter                                                              = require("./exports");
const importer                                                              = require("./imports");
const { readModules, readListen, readVhosts, setModule, reloadApache, readIncludes, setInclude,
        apacheFile, readApacheFile, checkApacheFile, saveApacheFile }       = require("./apache");
const php                                                                   = require("./php");
const { readNode, updatePackages, installPackage, uninstallPackage, searchPackages } = require("./node");
const { readJob }                                                           = require("./jobs");
const { readApps, startApp, stopApp, startGroup, startServer, stopServer } = require("./apps");
const { readLogSizes, readLog, clearLog }                                   = require("./logs");
const { readConfigFile, saveConfig, openFile }                              = require("./config");
const { readIcons, iconFile }                                               = require("./icons");



// ------------------------------------------------------------------ config ---

const PORT    = 9900;
const HOST    = "127.0.0.1";
// The page, served as it is.
const DESKTOP = path.join(ROOT, "desktop");

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

/** Answers one request: the api, or a file of the page. */
async function handle(request, response) {
    if (!isLocalHost(request.headers.host)) {
        return send(response, 403, { error : "Forbidden" });
    }

    const url = new URL(request.url, `http://localhost:${PORT}`);
    try {
        if (url.pathname === "/api/state" && request.method === "GET") {
            return send(response, 200, await readState());
        }
        if (url.pathname === "/api/config" && request.method === "GET") {
            return send(response, 200, readConfigFile());
        }
        if (url.pathname === "/api/icon" && request.method === "GET") {
            return sendIcon(response, url.searchParams.get("project"));
        }
        if (url.pathname === "/api/log" && request.method === "GET") {
            return send(response, 200, readLog(url.searchParams.get("name"), Number(url.searchParams.get("lines")) || 200));
        }
        if (url.pathname === "/api/npm-search" && request.method === "GET") {
            return send(response, 200, await searchPackages(url.searchParams.get("q")));
        }
        if (url.pathname === "/api/pecl-search" && request.method === "GET") {
            return send(response, 200, await php.searchExtensions(url.searchParams.get("q")));
        }
        if (url.pathname === "/api/php-directives" && request.method === "GET") {
            return send(response, 200, await php.readDirectives());
        }
        if (url.pathname === "/api/php-overrides" && request.method === "GET") {
            return send(response, 200, php.readOverrides());
        }
        if (url.pathname === "/api/apache-file" && request.method === "GET") {
            return send(response, 200, readApacheFile(url.searchParams.get("kind"), url.searchParams.get("file")));
        }
        if (url.pathname === "/api/charsets" && request.method === "GET") {
            return send(response, 200, await db.readCharsets());
        }
        if (url.pathname === "/api/mariadb-options" && request.method === "GET") {
            return send(response, 200, await mariadb.readOptionList());
        }
        if (url.pathname === "/api/mariadb-file" && request.method === "GET") {
            return send(response, 200, mariadb.readOptionsFile());
        }
        if (url.pathname === "/api/db-tables" && request.method === "GET") {
            return send(response, 200, await tables.readTables(url.searchParams.get("db")));
        }
        if (url.pathname === "/api/db-structure" && request.method === "GET") {
            return send(response, 200, await tables.readStructure(url.searchParams.get("db"), url.searchParams.get("table")));
        }
        if (url.pathname === "/api/db-rows" && request.method === "GET") {
            return send(response, 200, await tables.readRows(Object.fromEntries(url.searchParams)));
        }
        if (url.pathname === "/api/engines" && request.method === "GET") {
            return send(response, 200, await tables.readEngines());
        }
        if (url.pathname === "/api/db-counts" && request.method === "GET") {
            return send(response, 200, await tables.countSmallTables(url.searchParams.get("db")));
        }
        if (url.pathname === "/api/db-count" && request.method === "GET") {
            return send(response, 200, await tables.countRows(Object.fromEntries(url.searchParams)));
        }
        // The export asked for in an action, by its id, as a download.
        if (url.pathname === "/api/db-export" && request.method === "GET") {
            return await exporter.runExport(response, url.searchParams.get("id"));
        }
        // The file to import is the request's body itself, streamed, so it is
        // a POST with the header every action needs.
        if (url.pathname === "/api/db-import" && request.method === "POST") {
            if (request.headers["x-studio"] !== "1") {
                return send(response, 403, { error : "Forbidden" });
            }
            return send(response, 200, await tables.importDatabase(request, Object.fromEntries(url.searchParams)));
        }
        // A CSV into a table, streamed as the import of a dump is, its options in the address.
        if (url.pathname === "/api/db-import-csv" && request.method === "POST") {
            if (request.headers["x-studio"] !== "1") {
                return send(response, 403, { error : "Forbidden" });
            }
            return send(response, 200, await importer.importCsv(request, Object.fromEntries(url.searchParams)));
        }
        if (url.pathname === "/api/job" && request.method === "GET") {
            return send(response, 200, readJob(url.searchParams.get("id")));
        }
        if (url.pathname === "/api/action" && request.method === "POST") {
            if (request.headers["x-studio"] !== "1") {
                return send(response, 403, { error : "Forbidden" });
            }
            return send(response, 200, await runAction(await readBody(request)));
        }
        if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
            return sendFile(response, url.pathname);
        }
        send(response, 404, { error : "Not found" });
    } catch (error) {
        send(response, 500, { error : error.message });
    }
}

function isLocalHost(host) {
    return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}`;
}

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
 */
function sendIcon(response, project) {
    const file = iconFile(project || "");
    if (!file || !fs.existsSync(file)) {
        return send(response, 404, { error : "Not found" });
    }
    response.writeHead(200, {
        "Content-Type"            : MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Security-Policy" : "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        "X-Content-Type-Options"  : "nosniff",
        "Cache-Control"           : "max-age=300",
    });
    fs.createReadStream(file).pipe(response);
}

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

/** Everything the page shows, gathered in parallel. */
async function readState() {
    const [ services, phpState, node, databases, options, { apps, servers, branches }, disk ] = await Promise.all([
        readServices(),
        php.readPhp(),
        readNode(),
        db.readDatabases(),
        mariadb.readMariadb(),
        readApps(),
        readDisk(),
    ]);

    return {
        services,
        php : phpState,
        node,
        databases,
        mariadb : options,
        apps,
        servers,
        branches,
        // The projects with a favicon, which the page asks /api/icon for.
        icons      : Object.keys(readIcons(apps, servers)),
        disk,
        listen     : readListen(),
        logs       : readLogSizes(),
        modules    : await readModules(),
        includes   : readIncludes(),
        apache     : { version : versionOf("httpd") },
        vhosts     : readVhosts(),
        phpmyadmin : { url : PHPMYADMIN, version : versionOf("phpmyadmin") },
        files      : {
            httpdConf : HTTPD_CONF,
            vhosts    : VHOSTS,
            phpIni    : php.phpIniFile(),
            mysqlData : MYSQL_DATA,
            mysqlCnf  : MYSQL_CNF,
        },
    };
}


// ----------------------------------------------------------------- actions ---

/** Performs one change asked for by the page. */
async function runAction(body) {
    switch (body.action) {
    case "service":       return serviceAction(body.service, body.op);
    case "start-all":     return startAll();
    case "restart-all":   return restartAll();
    case "stop-all":      return stopAll();
    case "php-setting":   return php.setPhpSetting(String(body.key || ""), String(body.value ?? "").trim());
    case "php-settings":  return php.setPhpSettings(body.changes);
    case "php-save":      return php.saveOverrides(body.text);
    case "php-check":     return php.checkOverrides(body.text);
    case "pecl-install":  return php.installExtension(body.name);
    case "pecl-update":   return php.updateExtensions(body.name);
    case "pecl-rebuild":  return php.reinstallExtension(body.name);
    case "pecl-remove":   return php.uninstallExtension(body.name);
    case "module":        return setModule(body.name, Boolean(body.enabled));
    case "reload":        return reloadApache();
    case "apache-check":  return checkApacheFile(body.kind, body.text, body.file);
    case "apache-save":   return saveApacheFile(body.kind, body.text, body.file);
    case "apache-include": return setInclude(String(body.file || ""), Boolean(body.enabled));
    // A file Apache includes opens by its path, once it is known to be one.
    case "open-file":     return openFile(body.file, body.file === "apacheInclude" ? apacheFile("include", body.path) : "");
    case "db-create":     return db.createDatabase(body);
    case "db-change":     return db.changeDatabase(body);
    case "db-drop":       return db.dropDatabase(body);
    case "user-create":   return db.createUser(body);
    case "user-change":   return db.changeUser(body);
    case "user-drop":     return db.dropUser(body);
    case "mariadb-options": return mariadb.setOptions(body.changes);
    case "mariadb-save":  return mariadb.saveOptionsFile(body.text);
    case "mariadb-check": return mariadb.checkOptions(body.text);
    case "db-row":        return tables.readRow(body);
    case "db-row-save":   return tables.saveRow(body);
    case "db-row-delete": return tables.deleteRow(body);
    case "db-rows-set":   return tables.setColumn(body);
    case "db-sql":        return tables.runSql(body);
    case "db-index-add":  return tables.addIndex(body);
    case "db-index-drop": return tables.dropIndex(body);
    case "db-fk-save":    return tables.saveForeignKey(body);
    case "db-fk-drop":    return tables.dropForeignKey(body);
    case "db-table-change": return tables.changeTable(body);
    case "db-export":       return exporter.prepareExport(body);
    case "db-table-create": return tables.createTable(body);
    case "db-table-rename": return tables.renameTable(body);
    case "db-table-copy":   return tables.duplicateTable(body);
    case "db-table-empty":  return tables.emptyTable(body);
    case "db-table-drop":   return tables.dropTable(body);
    case "db-table-upkeep": return tables.maintainTables(body);
    case "db-column-save":  return tables.saveColumn(body);
    case "db-column-move":  return tables.moveColumn(body);
    case "db-column-drop":  return tables.dropColumn(body);
    case "db-next-id":    return tables.nextId(body);
    case "save-config":   return saveConfig(body.text);
    case "clear-log":     return clearLog(body.name);
    case "app-start":     return body.id ? startServer(body.id) : startApp(body.dir);
    case "app-stop":      return body.id ? stopServer(body.id) : stopApp(body.dir);
    case "group-start":   return startGroup(body.group);
    case "npm-update":    return updatePackages(body.name);
    case "npm-install":   return installPackage(body.name);
    case "npm-uninstall": return uninstallPackage(body.name);
    default:              throw new Error(`Unknown action ${body.action}`);
    }
}
