// The stack's updates from Homebrew, which the server checks once an hour and offers as far as
// the config's ranges allow: a line on the Overview listing them with a button to update, and
// each one's new version by its own on its page. Those the ranges hold are on the line too,
// each with a button that moves its range and updates it.

import { esc } from "../core/helpers.js";
import { state } from "../core/state.js";



/** The page each package's update shows on, by its version. */
const PAGES = {
    httpd   : "apache",
    php     : "php",
    node    : "node",
    mariadb : "databases",
    redis   : "services",
};



/**
 * A package of the stack with a newer version, as the server gives it.
 * @typedef {{
 *     name: string, label: string, version: string, latest: string, pinned: boolean,
 * }} StackUpdate
 */

/**
 * An update the config's range holds: the range, and the one that would take it.
 * @typedef {StackUpdate & { range: string, next: string }} HeldUpdate
 */



// --------------------------------------------------------------- updates ---

/**
 * Draws the updates: the Overview's line, and the new version by each page's own.
 * @returns {void}
 */
function renderUpdates() {
    const packages = /** @type {StackUpdate[]} */ (state.updates.packages);
    const held     = /** @type {HeldUpdate[]} */ (state.updates.held);

    renderLine(packages, held);
    renderChips(packages);
}

/**
 * The Overview's line: how many updates are out and of what, with the button that updates
 * them, then those the config's ranges hold, each with its own; nothing when there are none.
 * @param {StackUpdate[]} packages
 * @param {HeldUpdate[]} held
 * @returns {void}
 */
function renderLine(packages, held) {
    const line = document.getElementById("updates");
    line.hidden = !packages.length && !held.length;
    if (line.hidden) {
        return;
    }

    let count = `${packages.length} updates are out`;
    if (!packages.length) {
        count = "Held by the config";
    } else if (packages.length === 1) {
        count = "An update is out";
    }

    line.innerHTML = `
        <i class="dot update"></i>
        <span class="updates-text"><b>${count}</b>${packages.map((pkg) => `
            <span class="updates-one">${esc(pkg.label)} <span class="muted">${esc(pkg.version)}
                →</span> ${esc(pkg.latest)}</span>`).join("")}${held.map(heldOf).join("")}</span>
        ${packages.length ? "<button class=\"small\" data-brew-update-all>Update…</button>" : ""}
    `;
}

/**
 * An update the config's range holds, on the Overview's line, with the button that moves its
 * range to take it and updates it.
 * @param {HeldUpdate} pkg
 * @returns {string}
 */
function heldOf(pkg) {
    return `
        <span class="updates-one">${esc(pkg.label)} ${esc(pkg.latest)} <span class="muted">kept
            at ${esc(pkg.range)}</span> <button class="updates-move"
            data-brew-move="${esc(pkg.name)}" title="Set it to ${esc(pkg.next)} in the config, and
            update ${esc(pkg.label)}">Move to ${esc(pkg.next)}…</button></span>`;
}

/**
 * The new version by the version on the page of Apache, PHP, Node.js and MariaDB, and by the
 * Services title for Redis, which opens the update with it picked.
 * @param {StackUpdate[]} packages
 * @returns {void}
 */
function renderChips(packages) {
    for (const name of Object.keys(PAGES)) {
        const chip = document.getElementById(`update-${name}`);
        const pkg  = packages.find((one) => one.name === name);

        chip.hidden = !pkg;
        if (pkg) {
            // Services lists more than Redis, so its chip names it.
            const label = name === "redis" ? `${pkg.label} ` : "";

            chip.textContent        = `${label}${pkg.latest} is out`;
            chip.dataset.brewUpdate = name;
            chip.title              = `Update ${pkg.label} from ${pkg.version} to ${pkg.latest}`;
        }
    }
}

/**
 * The newer version of a package of the stack, or "" when it has none, for the Overview's
 * tiles.
 * @param {string} name
 * @returns {string}
 */
function newerOf(name) {
    const pkg = /** @type {StackUpdate[]} */ (state.updates.packages)
        .find((one) => one.name === name);
    return pkg ? pkg.latest : "";
}



// The public API
export {
    renderUpdates,
    newerOf,
};
