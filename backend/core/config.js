"use strict";

const fs = require("fs");
const path = require("path");

// The config, as the editor on the page reads, checks and saves it.

const { DEFAULTS, TOOLS : TOOL_DEFAULTS, pathsOf, toolsOf } = require("./paths");
const {
    ROOT, CONFIG, PATHS, TOOLS, HTTPD_CONF, VHOSTS, MYSQL_CNF, run, readFile
} = require("./system");
const { phpIniFile } = require("../stack/php");



/**
 * The config's text, for the editor on the page. Without one yet, the
 * example's, so there is something to start from; saving creates the file.
 */
function readConfigFile() {
    const exists = fs.existsSync(CONFIG);
    const source = exists ? CONFIG : path.join(ROOT, "config", "config.example.json");
    return { file : CONFIG, exists, text : readFile(source) };
}

/**
 * Saves the config from the editor on the page. It must be JSON holding an
 * object, with each setting of the shape the plugin expects, or the menu
 * would lose its projects; the previous file is kept as config.json.bak.
 */
async function saveConfig(text) {
    if (typeof text !== "string" || text.length > 200_000) {
        throw new Error("The config is missing or too long");
    }
    let config;
    try {
        config = JSON.parse(text);
    } catch (error) {
        throw new Error(`The config is not valid JSON: ${error.message}`);
    }
    const problem = configProblem(config);
    if (problem) {
        throw new Error(`The config was not saved: ${problem}`);
    }

    if (fs.existsSync(CONFIG)) {
        fs.copyFileSync(CONFIG, `${CONFIG}.bak`);
    }
    fs.writeFileSync(CONFIG, text.endsWith("\n") ? text : `${text}\n`);
    const moved = JSON.stringify(pathsOf(config)) !== JSON.stringify(PATHS)
        || JSON.stringify(toolsOf(config)) !== JSON.stringify(TOOLS);
    return {
        message : `Saved ${path.basename(CONFIG)}${
            moved ? ". Restart Studio to use the new paths and tools" : ""
        }`,
    };
}

/** What is wrong with a config's shape, or "" when nothing is. */
function configProblem(config) {
    const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
    const isList   = (value) => Array.isArray(value)
        && value.every((one) => typeof one === "string");
    if (!isObject(config)) {
        return "it must be an object, between { and }";
    }
    if (config.paths !== undefined && (!isObject(config.paths)
        || Object.values(config.paths).some((value) => typeof value !== "string"))) {
        return "paths must be an object of folders and files, by name";
    }
    const tool = Object.keys(TOOL_DEFAULTS)
        .find((key) => config[key] !== undefined && typeof config[key] !== "string");
    if (tool) {
        return `${tool} must be a text`;
    }
    const unknown = Object.keys(config.paths || {}).find((key) => !(key in DEFAULTS));
    if (unknown) {
        return `there is no path called ${unknown}: they are ${Object.keys(DEFAULTS).join(", ")}`;
    }
    if (config.projects === undefined) {
        return "";
    }
    if (!Array.isArray(config.projects)) {
        return "projects must be a list";
    }
    for (const [ index, project ] of config.projects.entries()) {
        const name = isObject(project) && (project.name || project.dir)
            ? `the project "${project.name || project.dir}"`
            : `project ${index + 1}`;
        if (!isObject(project)) {
            return `${name} must be an object, between { and }`;
        }
        if (!project.dir && !project.servers) {
            return `${name} needs a dir, or servers`;
        }
        if (project.dir !== undefined && typeof project.dir !== "string") {
            return `the dir of ${name} must be a folder`;
        }
        for (const key of [ "name", "mainApp", "nestedApp" ]) {
            if (project[key] !== undefined && typeof project[key] !== "string") {
                return `the ${key} of ${name} must be a text`;
            }
        }
        if (project.servers === undefined) {
            continue;
        }
        if (!Array.isArray(project.servers)) {
            return `the servers of ${name} must be a list`;
        }
        for (const [ at, server ] of project.servers.entries()) {
            const which = isObject(server) && server.id ? `the server "${server.id}"`
                : `server ${at + 1} of ${name}`;
            if (!isObject(server) || typeof server.id !== "string" || !server.id) {
                return `${which} needs an id`;
            }
            if (typeof server.dir !== "string" || typeof server.command !== "string") {
                return `${which} needs a dir and a command`;
            }
            if (server.args !== undefined && !isList(server.args)) {
                return `the args of ${which} must be a list of texts`;
            }
        }
    }
    return "";
}

/**
 * Opens one of the config files in the default text editor, or a file Apache
 * includes, by the path the server checked it is one. Changes to
 * config.json show in the apps on the next refresh: the plugin reads it on
 * every run.
 */
async function openFile(which, included = "") {
    const files = {
        httpdConf     : HTTPD_CONF,
        vhosts        : VHOSTS,
        phpIni        : phpIniFile(),
        mysqlCnf      : MYSQL_CNF,
        config        : CONFIG,
        apacheInclude : included,
    };
    if (!files[which]) {
        throw new Error("Unknown file");
    }

    // A machine without a config yet gets one from the example, to fill in.
    let created = false;
    if (which === "config" && !fs.existsSync(CONFIG)) {
        fs.copyFileSync(path.join(ROOT, "config", "config.example.json"), CONFIG);
        created = true;
    }
    // The editor of the config, when it names one and it opens; the Mac's
    // default text editor otherwise.
    const opened = TOOLS.editor
        && (await run("/usr/bin/open", [ "-a", TOOLS.editor, files[which] ])).ok;
    if (!opened) {
        await run("/usr/bin/open", [ "-t", files[which] ]);
    }
    return { message : created
        ? `Created ${path.basename(CONFIG)} from the example and opened it`
        : `Opened ${path.basename(files[which])}` };
}

module.exports = {
    readConfigFile,
    saveConfig,
    openFile,
};
