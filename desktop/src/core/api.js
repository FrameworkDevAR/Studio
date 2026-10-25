// Talking to the server: the state, the actions and the recent errors.

import { isErrorLine, isListingNoise, toast } from "./helpers.js";
import { setRecentErrors, setState } from "./state.js";
import { render, renderRecentErrors } from "../pages/overview.js";



/**
 * Asks the server for a path, posting the body as JSON when there is one, and gives what it
 * answers. A failure is thrown with the server's own words.
 * @param {string} path
 * @param {Object<string, *>=} body
 * @returns {Promise<*>}
 */
async function api(path, body) {
    const options = body ? {
        method  : "POST",
        headers : { "Content-Type" : "application/json", "X-Studio" : "1" },
        body    : JSON.stringify(body),
    } : {};

    const response = await fetch(path, options);
    const data     = await response.json();
    if (!response.ok) {
        throw new Error(data.error || response.statusText);
    }
    return data;
}

/**
 * Runs an action, says how it went, and redraws with what changed.
 * @param {Object<string, *>} body
 * @param {(HTMLElement & { disabled?: boolean })=} button disabled while it runs
 * @returns {Promise<void>}
 */
async function act(body, button) {
    if (button) {
        button.disabled = true;
    }

    try {
        const result = await api("/api/action", body);
        toast(result.message);
    } catch (error) {
        toast(error.message, true);
    } finally {
        if (button) {
            button.disabled = false;
        }
        await refresh();
    }
}

/**
 * Asks for the state again and redraws every view from it.
 * @returns {Promise<void>}
 */
async function refresh() {
    try {
        const fresh = await api("/api/state");
        setState(fresh);
        render();
    } catch {
        document.getElementById("brand-status").innerHTML = `<i class="dot off"></i> Not reachable`;
    }
}

/**
 * The last few error lines of Apache's log, for the overview.
 * @returns {Promise<void>}
 */
async function loadRecentErrors() {
    const log = await api("/api/log?name=apache&lines=800");
    const errors = log.lines.filter((line) => isErrorLine(line) && !isListingNoise(line));
    setRecentErrors(errors.slice(-6).reverse());
    renderRecentErrors();
}



// The public API
export {
    api,
    act,
    refresh,
    loadRecentErrors,
};
