// The config, as the editor on the page reads, checks and saves it.

import fs from "node:fs";
import path from "node:path";

import { DEFAULTS, TOOLS, pathsOf, toolsOf } from "./paths.js";
import {
    ROOT, CONFIG, PATHS, HTTPD_CONF, VHOSTS, MYSQL_CNF, run, readFile, readJson
} from "./system.js";
import { isRange } from "./versions.js";
import { phpIniFile } from "../stack/php.js";



/**
 * The config's text, for the editor on the page. Without one yet, the
 * example's, so there is something to start from; saving creates the file.
 * @returns {{ file: string, exists: boolean, text: string }}
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
 * @param {string} text
 * @returns {Promise<{ message: string }>}
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

    await storeConfig(text);
    const moved = JSON.stringify(pathsOf(config)) !== JSON.stringify(PATHS);

    return {
        message : `Saved ${path.basename(CONFIG)}${
            moved ? ". Restart Studio to use the new paths" : ""
        }`,
    };
}

/**
 * The config as it is saved, for the forms that change a part of it: {} without
 * one yet. A file that is not JSON is refused rather than read as {}, which
 * saving would then write over.
 * @returns {Object<string, *>}
 */
function readConfig() {
    if (!fs.existsSync(CONFIG)) {
        return {};
    }

    try {
        return JSON.parse(readFile(CONFIG));
    } catch {
        throw new Error(`${path.basename(CONFIG)} is not valid JSON: fix it with Edit config`);
    }
}

/**
 * Saves a config a form changed, checked as the editor's is, and written the
 * way the example is laid out, so it still reads well in the editor.
 * @param {Object<string, *>} config
 * @returns {Promise<void>}
 */
async function writeConfig(config) {
    const problem = configProblem(config);
    if (problem) {
        throw new Error(`The config was not saved: ${problem}`);
    }

    await storeConfig(`${formatConfig(config)}\n`);
}

/**
 * Writes the config's text, keeping the previous file as config.json.bak, and
 * redraws the menu, which reads the config on every run, so it lists the
 * projects at once rather than in up to 10s.
 * @param {string} text
 * @returns {Promise<void>}
 */
async function storeConfig(text) {
    if (fs.existsSync(CONFIG)) {
        fs.copyFileSync(CONFIG, `${CONFIG}.bak`);
    }

    fs.writeFileSync(CONFIG, text.endsWith("\n") ? text : `${text}\n`);
    await run("/usr/bin/open", [ "-g", "swiftbar://refreshplugin?name=swiftbar" ]);
}

/**
 * A value as JSON laid out like the example: an object a key per line with
 * the colons aligned, a list of texts or numbers on one line, a list of
 * objects one per line. At the top, the settings that are a text or a number
 * stay together and the rest stand apart, a blank line around each; each group
 * aligns its own colons. A project's sites with no command take a line each, being so
 * short.
 * @param {*} value
 * @param {number=} depth
 * @param {boolean=} flat whether an object with no command goes on one line
 * @returns {string}
 */
function formatConfig(value, depth = 0, flat = false) {
    const pad   = " ".repeat(4 * depth);
    const inner = " ".repeat(4 * (depth + 1));
    const isBig = (one) => Boolean(one) && typeof one === "object";

    if (Array.isArray(value)) {
        if (!value.length) {
            return "[]";
        }
        if (!value.some(isBig)) {
            return `[ ${value.map((one) => JSON.stringify(one)).join(", ")} ]`;
        }
        return `[\n${value.map((one) => inner + formatConfig(one, depth + 1, flat))
            .join(",\n")}\n${pad}]`;
    }

    if (!isBig(value)) {
        return JSON.stringify(value);
    }

    const keys = Object.keys(value);
    if (!keys.length) {
        return "{}";
    }

    if (flat && value.command === undefined) {
        const pairs = keys.map((key) => `${JSON.stringify(key)} : ${JSON.stringify(value[key])}`);
        return `{ ${pairs.join(", ")} }`;
    }

    // The groups of keys, each aligned on its own: one inside, several at the top.
    const groups = [];
    for (const key of keys) {
        const alone = depth === 0 && isBig(value[key]);
        if (!groups.length || alone || groups.at(-1).alone) {
            groups.push({ alone, keys : [] });
        }
        groups.at(-1).keys.push(key);
    }

    const lines = groups.map((group) => {
        const width = Math.max(...group.keys.map((key) => JSON.stringify(key).length));
        return group.keys.map((key) => `${inner}${JSON.stringify(key).padEnd(width)} : ${
            formatConfig(value[key], depth + 1, key === "sites")
        }`).join(",\n");
    });

    return `{\n${lines.join(depth === 0 ? ",\n\n" : ",\n")}\n${pad}}`;
}

/**
 * What is wrong with a config's shape, or "" when nothing is.
 * @param {*} config
 * @returns {string}
 */
function configProblem(config) {
    const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
    const isList   = (value) => Array.isArray(value)
        && value.every((one) => typeof one === "string");

    if (!isObject(config)) {
        return "it must be an object, between { and }";
    }
    if (config.paths !== undefined && (!isObject(config.paths)
        || Object.values(config.paths).some((value) => typeof value !== "string"))
    ) {
        return "paths must be an object of folders and files, by name";
    }

    const tool = Object.keys(TOOLS)
        .find((key) => config[key] !== undefined && typeof config[key] !== "string");
    if (tool) {
        return `${tool} must be a text`;
    }

    // The versions each part of the stack may update to, by its name in Homebrew.
    if (config.versions !== undefined && (!isObject(config.versions)
        || !Object.values(config.versions).every(isRange))
    ) {
        return "versions must be an object of ranges, as \"~8.5\" or \"^25\", by package";
    }

    const unknown = Object.keys(config.paths || {}).find((key) => !(key in DEFAULTS));
    if (unknown) {
        return `there is no path called ${unknown}: they are ${Object.keys(DEFAULTS).join(", ")}`;
    }

    if (config.projects === undefined) {
        return "";
    }

    // The plugin starts a server by its id, so two with one would start the same.
    const ids = [];
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

        if (!project.name && !project.dir && !project.sites) {
            return `${name} needs a name, a dir, or sites`;
        }

        if (project.dir !== undefined && typeof project.dir !== "string") {
            return `the dir of ${name} must be a folder`;
        }

        for (const key of [ "https", "menu" ]) {
            if (project[key] !== undefined && typeof project[key] !== "boolean") {
                return `the ${key} of ${name} must be true or false`;
            }
        }

        for (const key of [ "name", "host" ]) {
            if (project[key] !== undefined && typeof project[key] !== "string") {
                return `the ${key} of ${name} must be a text`;
            }
        }

        if (project.servers !== undefined) {
            return `the servers of ${name} go in its sites now, as they are`;
        }

        if (project.sites === undefined) {
            continue;
        }
        if (!Array.isArray(project.sites)) {
            return `the sites of ${name} must be a list`;
        }

        for (const [ at, server ] of project.sites.entries()) {
            const which = isObject(server) && (server.id || server.name)
                ? `the site "${server.id || server.name}"`
                : `site ${at + 1} of ${name}`;

            // One with no command is Apache's, served at its host; a url is from before.
            if (isObject(server) && server.command === undefined) {
                if (server.url !== undefined) {
                    return `${which} has a url: it takes a host now, and "https" : true`;
                }
                if (typeof server.name !== "string" || typeof server.host !== "string") {
                    return `${which} needs a name and a host, or a command`;
                }
                continue;
            }

            if (!isObject(server) || typeof server.id !== "string" || !server.id) {
                return `${which} needs an id`;
            }
            if (typeof server.dir !== "string" || typeof server.command !== "string") {
                return `${which} needs a dir and a command`;
            }
            if (server.args !== undefined) {
                return `${which} has args: they go in its command now, as "npm run dev"`;
            }
            if (ids.includes(server.id)) {
                return `two sites have the id "${server.id}"`;
            }

            ids.push(server.id);
        }
    }

    return "";
}

/**
 * Opens one of the config files in the default text editor, or a file Apache
 * includes, by the path the server checked it is one. Changes to
 * config.json show in the apps on the next refresh: the plugin reads it on
 * every run.
 * @param {string} which
 * @param {string=} included
 * @returns {Promise<{ message: string }>}
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
    // default text editor otherwise. It is read each time, as the Settings page changes it.
    const editor = toolsOf(readJson(CONFIG)).editor;
    let opened   = false;
    if (editor) {
        const result = await run("/usr/bin/open", [ "-a", editor, files[which] ]);
        opened       = result.ok;
    }

    if (!opened) {
        await run("/usr/bin/open", [ "-t", files[which] ]);
    }

    return { message : created
        ? `Created ${path.basename(CONFIG)} from the example and opened it`
        : `Opened ${path.basename(files[which])}` };
}



// The public API
export {
    readConfigFile,
    saveConfig,
    readConfig,
    writeConfig,
    openFile,
};
