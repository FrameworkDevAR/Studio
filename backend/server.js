#!/usr/bin/env node

"use strict";

const fs   = require("fs");
const http = require("http");
const path = require("path");

const { ROOT, PHPMYADMIN, HTTPD_CONF, VHOSTS, MYSQL_DATA, versionOf }       = require("./system");
const { readServices, readDisk, serviceAction, startAll, restartAll, stopAll } = require("./services");
const { readDatabases }                                                     = require("./databases");
const { readModules, readListen, readVhosts, setModule, reloadApache }      = require("./apache");
const { readPhp, setPhpSetting, phpIniFile }                                = require("./php");
const { readNode, updatePackages, installPackage, uninstallPackage, searchPackages, readJob } = require("./node");
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
        if (url.pathname === "/api/npm-job" && request.method === "GET") {
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
    const [ services, php, node, databases, { apps, servers, branches }, disk ] = await Promise.all([
        readServices(),
        readPhp(),
        readNode(),
        readDatabases(),
        readApps(),
        readDisk(),
    ]);

    return {
        services,
        php,
        node,
        databases,
        apps,
        servers,
        branches,
        // The projects with a favicon, which the page asks /api/icon for.
        icons      : Object.keys(readIcons(apps, servers)),
        disk,
        listen     : readListen(),
        logs       : readLogSizes(),
        modules    : await readModules(),
        vhosts     : readVhosts(),
        phpmyadmin : { url : PHPMYADMIN, version : versionOf("phpmyadmin") },
        files      : {
            httpdConf : HTTPD_CONF,
            vhosts    : VHOSTS,
            phpIni    : phpIniFile(),
            mysqlData : MYSQL_DATA,
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
    case "php-setting":   return setPhpSetting(body.key, String(body.value ?? "").trim());
    case "module":        return setModule(body.name, Boolean(body.enabled));
    case "reload":        return reloadApache();
    case "open-file":     return openFile(body.file);
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
