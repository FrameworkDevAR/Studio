// The Apache page: its modules and the config files it includes, and turning one on or off.

import { act } from "../core/api.js";
import { ask, esc, markColumnEnds } from "../core/helpers.js";
import { moduleFilter, state } from "../core/state.js";



/**
 * The Apache page: its modules, filtered by the search and by on or off, each
 * with its switch, and the config files it includes.
 * @returns {void}
 */
function renderModules() {
    if (!state) {
        return;
    }

    const search  = /** @type {HTMLInputElement} */ (document.getElementById("module-search"))
        .value.trim().toLowerCase();
    const modules = state.modules.filter((module) =>
        (moduleFilter === "all" || (moduleFilter === "on") === module.enabled) &&
        (!search || module.name.includes(search)));
    const on = state.modules.filter((module) => module.enabled).length;

    document.getElementById("apache-version").textContent = state.apache.version || "";
    document.getElementById("module-count").textContent   = `${on} of ${state.modules.length} on`;
    document.getElementById("tab-modules-count").textContent = String(on);

    renderConfigs();
    document.getElementById("modules").innerHTML = modules.map((module) => {
        let title;
        if (module.protected) {
            title = "Apache needs this one";
        } else if (module.enabled) {
            title = "Turn off";
        } else {
            title = "Turn on";
        }

        let tag;
        if (module.protected) {
            tag = `<span class="tag">required</span>`;
        } else if (module.used) {
            tag = `<span class="tag">used</span>`;
        } else {
            tag = "";
        }

        return `
        <div class="module ${module.enabled ? "" : "off"}">
            <label class="switch" title="${title}">
                <input type="checkbox" data-module="${esc(module.name)}" data-used="${module.used}"
                    ${module.enabled ? "checked" : ""}
                    ${module.protected && module.enabled ? "disabled" : ""}>
                <span></span>
            </label>
            <span class="name">${esc(module.name.replace(/_module$/, ""))}</span>
            ${tag}
        </div>
    `;
    }).join("") || `<div class="empty">No modules match.</div>`;
}

/**
 * The config files httpd.conf includes, in its order: a switch for each, its
 * note, the module it waits for, and Edit, which opens it in the editor.
 * @returns {void}
 */
function renderConfigs() {
    const { includes } = state;
    const on = includes.filter((one) => one.enabled).length;

    document.getElementById("config-count").textContent     = `${on} of ${includes.length} on`;
    document.getElementById("tab-configs-count").textContent = String(on);

    document.getElementById("apache-configs").innerHTML = includes.map((one) => {
        let needs = "";
        if (one.module) {
            needs = `${one.note ? " · " : ""}only with ${esc(one.module)}`;
        }

        return `
        <div class="config-row ${one.enabled ? "" : "off"}">
            <label class="switch" title="${one.enabled ? "Turn off" : "Turn on"}">
                <input type="checkbox" data-include="${esc(one.file)}"
                    ${one.enabled ? "checked" : ""}>
                <span></span>
            </label>
            <span class="config-text">
                <span class="name" title="${esc(one.file)}">${esc(one.name)}</span>
                <small>${esc(one.note)}${needs}</small>
            </span>
            ${one.editable
                ? `<button class="ghost small" data-edit-include="${esc(one.file)}">Edit</button>`
                : ""}
        </div>
    `;
    }).join("") || `<div class="empty">httpd.conf includes no other files.</div>`;
    markColumnEnds(document.getElementById("apache-configs-pane"));
}

/**
 * Turns an included file on or off. Turning off the vhosts asks first, since
 * every site is in them.
 * @param {MouseEvent} event
 * @param {HTMLInputElement} input
 * @returns {Promise<void>}
 */
async function toggleInclude(event, input) {
    const enabled = input.checked;
    if (!enabled && input.dataset.include === state.files.vhosts) {
        event.preventDefault();

        const sure = await ask({
            title  : "Turn off the vhosts?",
            text   : "Every site in them stops answering by its name.",
            ok     : "Turn them off",
            danger : true,
        });
        if (!sure) {
            return;
        }

        input.checked = false;
    }

    act({ action : "apache-include", file : input.dataset.include, enabled }, input);
}

/**
 * Asks first before turning off a module the sites use. The switch stays on
 * while the dialog is open, and turns off only once it is confirmed.
 * @param {MouseEvent} event
 * @param {HTMLInputElement} input
 * @returns {Promise<void>}
 */
async function toggleModule(event, input) {
    const enabled = input.checked;
    if (!enabled && input.dataset.used === "true") {
        event.preventDefault();

        const sure = await ask({
            title  : `Turn off ${input.dataset.module}?`,
            text   : "Apache's config or your sites use it. " +
                "Turning it off will likely break them with a 500.",
            ok     : "Turn it off",
            danger : true,
        });
        if (!sure) {
            return;
        }

        input.checked = false;
    }

    act({ action : "module", name : input.dataset.module, enabled }, input);
}



// The public API
export {
    renderModules,
    toggleInclude,
    toggleModule,
};
