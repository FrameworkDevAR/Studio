// How many of the stack's updates are out, from Studio's last check, for the menu's line that
// opens them in Studio. Only those the config's ranges allow count: a held one is held on
// purpose, and Studio shows it.

import { OUTDATED, VERSIONS, versionOf } from "./config.js";
import { readFile } from "./helpers.js";
import { patchesOf, satisfies } from "../backend/core/versions.js";



/**
 * A package Studio found a newer version of, as it keeps them.
 * @typedef {{ name: string, version: string, latest: string, pinned: boolean }} Outdated
 */



// ----------------------------------------------------------------- updates ---

/**
 * How many updates are out that the config's ranges allow. Each is checked against the version
 * installed now, so one updated since Studio checked, as from ./setup.sh, no longer counts.
 * Nothing when Studio has not checked since the Mac started.
 * @returns {number}
 */
function countUpdates() {
    /** @type {Outdated[]} */
    let packages = [];
    try {
        packages = JSON.parse(readFile(OUTDATED) || "{}").packages || [];
    } catch {
        return 0;
    }

    return packages.filter((one) => {
        const installed = installedOf(one);
        return installed && !one.pinned
            && !satisfies(installed, `>=${one.latest}`)
            && satisfies(one.latest, VERSIONS[one.name] || patchesOf(installed));
    }).length;
}

/**
 * The version of a package installed now: a formula's from its link. A cask's is the one
 * Studio saw, as it has no link, and Studio checks again after updating it.
 * @param {Outdated} one
 * @returns {string}
 */
function installedOf(one) {
    return versionOf(one.name) || (one.name === "swiftbar" ? one.version : "");
}



// The public API
export {
    countUpdates,
};
