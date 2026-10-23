"use strict";

// Talking to the server: the state, the actions and the recent errors.

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

/** Runs an action, says how it went, and redraws with what changed. */
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

async function refresh() {
    try {
        state = await api("/api/state");
        render();
    } catch {
        document.getElementById("brand-status").innerHTML = `<i class="dot off"></i> Not reachable`;
    }
}

/** The last few error lines of Apache's log, for the overview. */
async function loadRecentErrors() {
    const log = await api("/api/log?name=apache&lines=800");
    recentErrors = log.lines.filter((line) => isErrorLine(line) && !isListingNoise(line)).slice(-6).reverse();
    renderRecentErrors();
}
