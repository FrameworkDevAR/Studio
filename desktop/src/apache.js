"use strict";

// The Apache page: its modules, and turning one on or off.

function renderModules() {
    if (!state) {
        return;
    }
    const search  = /** @type {HTMLInputElement} */ (document.getElementById("module-search")).value.trim().toLowerCase();
    const modules = state.modules.filter((module) =>
        (moduleFilter === "all" || (moduleFilter === "on") === module.enabled) &&
        (!search || module.name.includes(search)));
    const on = state.modules.filter((module) => module.enabled).length;

    document.getElementById("module-count").textContent = `${on} of ${state.modules.length} on`;
    document.getElementById("modules").innerHTML = modules.map((module) => `
        <div class="module ${module.enabled ? "" : "off"}">
            <label class="switch" title="${module.protected ? "Apache needs this one" : module.enabled ? "Turn off" : "Turn on"}">
                <input type="checkbox" data-module="${esc(module.name)}" data-used="${module.used}"
                    ${module.enabled ? "checked" : ""} ${module.protected && module.enabled ? "disabled" : ""}>
                <span></span>
            </label>
            <span class="name">${esc(module.name.replace(/_module$/, ""))}</span>
            ${module.protected ? `<span class="tag">required</span>` : module.used ? `<span class="tag">used</span>` : ""}
        </div>
    `).join("") || `<div class="empty">No modules match.</div>`;
}

/** Asks first before turning off a module the sites use. */
function toggleModule(event, input) {
    const enabled = input.checked;
    if (!enabled && input.dataset.used === "true" &&
        !confirm(`Apache's config or your sites use ${input.dataset.module}. Turning it off will likely break them with a 500. Turn it off anyway?`)) {
        event.preventDefault();
        return;
    }
    act({ action : "module", name : input.dataset.module, enabled }, input);
}
