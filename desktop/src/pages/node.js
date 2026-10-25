"use strict";

// The Node.js page: Homebrew's node, with npm and corepack, and the global packages.

function renderNode() {
    const { node } = state;
    document.getElementById("node-version").textContent = node.version;
    const tools = [
        node.npm && `npm ${esc(node.npm)}`,
        node.corepack && `corepack ${esc(node.corepack)}`,
    ].filter(Boolean);
    document.getElementById("node-text").innerHTML = [
        `Homebrew's <code>node</code>${tools.length ? `, with ${tools.join(" and ")}` : ""}.`,
        node.root ? `Global packages go to <code>${esc(node.root)}</code>.` : "",
    ].join(" ");

    const problem = document.getElementById("node-problem");
    problem.hidden = !node.broken && Boolean(node.version);
    problem.innerHTML = node.broken
        ? `Node.js does not start: ${esc(node.broken)}. Run <code>brew upgrade node</code>, or
            <code>brew reinstall node</code> if it is already the newest.`
        : "Node.js is not installed. Run <code>brew install node</code>.";

    document.getElementById("node-packages").hidden = !problem.hidden;
    const behind = node.globals.filter((pkg) => pkg.latest).length;
    document.getElementById("node-count").textContent = String(node.globals.length);
    document.getElementById("node-outdated").innerHTML = !node.checked
        ? "Checking for updates…"
        : behind
            ? `<b>${behind} outdated</b>
               <button data-npm-update-all>${isUpdating("npm")
                   ? "Updating…" : "Update packages"}</button>`
            : "All up to date";
    // The filter keeps the packages whose name holds what is typed.
    const filter = /** @type {HTMLInputElement} */ (document.getElementById("node-filter"))
        .value.trim().toLowerCase();
    const shown  = node.globals.filter((pkg) => pkg.name.toLowerCase().includes(filter));
    // The linked packages first, apart, since they are the user's own.
    const lists  = [ shown.filter((pkg) => pkg.linked), shown.filter((pkg) => !pkg.linked) ];
    document.getElementById("node-globals").innerHTML = !shown.length
        ? `<div class="pkg-none">No packages match “${esc(filter)}”.</div>`
        : lists.filter((list) => list.length).map((list) => `
        <div class="pkg-list">${list.map((pkg) => packageRow({
            name    : pkg.name,
            // A linked package is a folder of the user's, with no page on npm.
            url     : pkg.linked ? "" : `https://www.npmjs.com/package/${pkg.name}`,
            tag     : pkg.linked ? "linked" : "",
            size    : pkg.size,
            version : pkg.version,
            latest  : pkg.latest,
            actions : packageButtons(pkg),
        })).join("")}</div>
    `).join("");
    markColumnEnds(document.getElementById("node-globals"));

    // The dialog's buttons follow what is installed, once npm is done.
    if (/** @type {HTMLDialogElement} */ (document.getElementById("npm-dialog")).open) {
        renderNpmList();
    }
}

/**
 * A row's buttons: update when there is a newer version, and remove, which
 * shows on hover. npm has no remove, since it is what removes the others.
 */
function packageButtons(pkg) {
    const removing = updating.has(`remove:${pkg.name}`);
    const remove   = pkg.name === "npm" ? "" : `
        <button class="icon-btn remove ${removing ? "busy" : ""}"
            title="${pkg.linked ? "Remove the link" : "Uninstall"}"
            aria-label="Uninstall ${esc(pkg.name)}" data-npm-uninstall="${esc(pkg.name)}"
            ${removing ? "disabled" : ""}>
            <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1
                14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
    `;
    return (pkg.latest ? updateButton(pkg.name) : "") + remove;
}

/** The button that updates one package, busy while any update of it runs. */
function updateButton(name) {
    const busy = updating.has(name);
    return `
        <button class="icon-btn update ${busy ? "busy" : ""}" title="Update to the newest"
            aria-label="Update ${esc(name)}" data-npm-update="${esc(name)}"
            ${busy ? "disabled" : ""}>
            <svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
        </button>
    `;
}

// ---------------------------------------------------------------- install ---

let npmSearchTimer = null;
let npmFound       = [];
let npmAsked       = "";

/** The install dialog, as npm's site: a search, then what it finds. */
function openNpmDialog() {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("npm-dialog"));
    const field  = /** @type {HTMLInputElement} */ (dialog.querySelector("input"));
    dialog.showModal();
    field.select();
    renderNpmList();
}

/**
 * Searches npm as the field changes, a moment after the typing stops. Text
 * with a version, as eslint@9, is not searched: it is shown as itself, ready
 * to install, since its name is already known.
 */
function searchNpm(now = false) {
    const text = /** @type {HTMLInputElement} */ (document.querySelector("#npm-search input"))
        .value.trim();
    clearTimeout(npmSearchTimer);
    if (text.length < 2 || /.@/.test(text)) {
        npmAsked = text;
        npmFound = [];
        renderNpmList();
        return;
    }
    npmSearchTimer = setTimeout(async () => {
        npmAsked = text;
        renderNpmList(true);
        try {
            const list = await api(`/api/npm-search?q=${encodeURIComponent(text)}`);
            // An older answer that comes in late is dropped.
            if (npmAsked === text) {
                npmFound = list;
                renderNpmList();
            }
        } catch (error) {
            if (npmAsked === text) {
                npmFound = [];
                renderNpmList(false, error.message);
            }
        }
    }, now ? 0 : 250);
}

/** The results, laid out as npm's search shows them. */
function renderNpmList(loading = false, failed = "") {
    const box       = document.getElementById("npm-list");
    const installed = new Map(state.node.globals.map((pkg) => [ pkg.name, pkg ]));
    if (/.@/.test(npmAsked)) {
        box.innerHTML = `
            <div class="npm-item">
                <div class="npm-item-body">
                    <span class="npm-name">${esc(npmAsked)}</span>
                    <p>Installs this version, or the one this tag points to.</p>
                </div>
                ${npmActions(npmAsked)}
            </div>
        `;
        return;
    }
    if (failed || loading || !npmFound.length) {
        const text = failed || (loading ? "Searching…"
            : npmAsked.length >= 2 ? `No packages match “${esc(npmAsked)}”.`
                : "Search the npm registry for a package to install globally.");
        box.innerHTML = `<div class="npm-empty">${text}</div>`;
        return;
    }
    box.innerHTML = npmFound.map((pkg) => `
        <div class="npm-item">
            <div class="npm-item-body">
                <a class="npm-name" href="https://www.npmjs.com/package/${esc(pkg.name)}"
                    target="_blank" rel="noopener">${esc(pkg.name)}</a>
                ${pkg.description ? `<p>${esc(pkg.description)}</p>` : ""}
                ${pkg.keywords.length
                    ? `<div class="npm-keywords">${pkg.keywords
                        .map((word) => `<span>${esc(word)}</span>`).join("")}</div>`
                    : ""}
                <div class="npm-meta">
                    ${[
                        pkg.publisher ? `<b>${esc(pkg.publisher)}</b>` : "",
                        `published ${esc(pkg.version)}${pkg.date ? ` · ${ago(pkg.date)}` : ""}`,
                        pkg.license ? esc(pkg.license) : "",
                        `${downloads(pkg.weekly)} weekly downloads`,
                    ].filter(Boolean).join(`<i class="sep">·</i>`)}
                </div>
            </div>
            ${npmActions(pkg.name, pkg.version, installed.get(pkg.name))}
        </div>
    `).join("");
}

/**
 * What a result offers. One not installed has Install. One installed says
 * which version is here, and the newest beside it when that is newer, with
 * Update for it and Uninstall. A linked package of the same name is the
 * user's own folder, not this one, so it is only named as such.
 */
function npmActions(spec, latest = "", mine = null) {
    if (updating.has(`install:${spec}`)) {
        return `<div class="npm-actions"><button class="npm-install"
            disabled>Installing…</button></div>`;
    }
    if (!mine) {
        return `<div class="npm-actions"><button class="npm-install"
            data-npm-install="${esc(spec)}">Install</button></div>`;
    }
    if (mine.linked) {
        return `<div class="npm-actions"><span class="npm-here">A linked folder of yours
            has this name</span></div>`;
    }
    const version  = mine.version.replace(/\+.*/, "");
    const newer    = latest && isNewer(latest, version);
    const busy     = updating.has(spec);
    const removing = updating.has(`remove:${spec}`);
    return `
        <div class="npm-actions">
            <span class="npm-here">Installed <b>${esc(version)}</b>${newer
                ? `<span class="pkg-latest">→ ${esc(latest)}</span>`
                : ` · newest`}</span>
            <span class="npm-buttons">
                ${newer ? `<button class="small" data-npm-update="${esc(spec)}"
                    ${busy ? "disabled" : ""}>${busy ? "Updating…" : "Update"}</button>` : ""}
                ${spec === "npm" ? "" : `<button class="small danger"
                    data-npm-uninstall="${esc(spec)}" ${removing ? "disabled" : ""}>${removing
                        ? "Removing…" : "Uninstall"}</button>`}
            </span>
        </div>
    `;
}

/** Whether one version is past another, number by number. */
function isNewer(version, than) {
    const [ a, b ] = [ version, than ].map((one) => one.split(/[.-]/).slice(0, 3)
        .map((part) => parseInt(part, 10) || 0));
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) {
            return a[i] > b[i];
        }
    }
    return false;
}

/** How long ago a date was, in the largest unit that fits, as npm says it. */
function ago(date) {
    const days = (Date.now() - Date.parse(date)) / 86_400_000;
    const say  = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    return days < 1 ? "today"
        : days < 30 ? say(Math.floor(days), "day")
            : days < 365 ? say(Math.floor(days / 30), "month")
                : say(Math.floor(days / 365), "year");
}

function downloads(count) {
    return count >= 1e6 ? `${(count / 1e6).toFixed(count >= 1e7 ? 0 : 1)}M`
        : count >= 1e3 ? `${Math.round(count / 1e3)}K`
            : String(count);
}

/** Installs a package from the dialog, which stays open for the next one. */
async function installNpm(spec) {
    if (updating.has(`install:${spec}`)) {
        return;
    }
    updating.add(`install:${spec}`);
    renderNpmList();
    try {
        await followJob({ action : "npm-install", name : spec });
    } finally {
        updating.delete(`install:${spec}`);
        renderNpmList();
    }
}

/** Uninstalls a package, after asking, since its commands go with it. */
async function uninstallPackage(name) {
    const pkg = state.node.globals.find((one) => one.name === name);
    const sure = await ask(pkg?.linked
        ? {
            title  : `Remove the link to ${name}?`,
            text   : "Its folder stays as it is.",
            ok     : "Remove",
            danger : true,
        }
        : {
            title  : `Uninstall ${name}?`,
            text   : "Its commands go with it.",
            ok     : "Uninstall",
            danger : true,
        });
    if (!sure) {
        return;
    }
    updating.add(`remove:${name}`);
    renderNode();
    try {
        await followJob({ action : "npm-uninstall", name });
    } finally {
        updating.delete(`remove:${name}`);
        renderNode();
    }
}

/**
 * What can be updated in the update dialog: npm's global packages, or the
 * extensions pecl installed. Each says what it calls one, the action that
 * updates some, what of it is installed, and which page to redraw. The busy
 * keys of the extensions are apart, since a package can share a name.
 */
const UPDATE_KINDS = {
    npm : {
        noun   : "package",
        action : "npm-update",
        key    : (name) => name,
        list   : () => state.node.globals,
        render : () => renderNode(),
    },
    pecl : {
        noun   : "extension",
        action : "pecl-update",
        key    : (name) => `pecl:${name}`,
        list   : () => state.php.extensions.filter((ext) => ext.pecl)
            .map((ext) => ({ ...ext, name : ext.name.toLowerCase() })),
        render : () => renderPhp(),
    },
};

/** One package or extension, or a count of them: "1 package", "3 extensions". */
function countOf(count, noun) {
    return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Asks before updating outdated packages, in a dialog listing each with the
 * version it goes to, and which of them are major versions, to pick from.
 */
async function confirmUpdateAll(kind = "npm") {
    const { noun } = UPDATE_KINDS[kind];
    const outdated = UPDATE_KINDS[kind].list().filter((pkg) => pkg.latest);
    const majors   = outdated.filter((pkg) => isMajor(pkg.version, pkg.latest)).length;
    const waiting  = ask({
        title : `Update ${noun}s`,
        text  : `${countOf(outdated.length, noun)} ${outdated.length === 1
            ? "has a newer version" : "have newer versions"}${majors
            ? `, ${majors} of them major` : ""}. Pick the ones to update.`,
        body  : `
            <label class="pkg pick all">
                <input type="checkbox" data-pick-all>
                <span class="pkg-name"><span class="pkg-text">Select all</span></span>
            </label>
            ${outdated.map((pkg) => `
                <label class="pkg pick">
                    <input type="checkbox" value="${esc(pkg.name)}">
                    <span class="pkg-name"><span class="pkg-text">${esc(pkg.name)}</span>${isMajor(
                        pkg.version, pkg.latest) ? `<span class="tag red">major</span>` : ""}</span>
                    <span class="pkg-version">${esc(pkg.version.replace(/\+.*/, ""))}<span
                        class="pkg-latest">→ ${esc(pkg.latest)}</span></span>
                </label>
            `).join("")}
        `,
        note  : majors ? `<span class="tag red">major</span> may change how the ${noun} works` : "",
        ok     : "Update",
        closeX : true,
        stay   : true,
    });

    // The button says how many are picked, and waits for at least one.
    const box    = document.getElementById("ask-body");
    const all    = /** @type {HTMLInputElement} */ (box.querySelector("[data-pick-all]"));
    const picks  = /** @type {HTMLInputElement[]} */ ([ ...box.querySelectorAll("input[value]") ]);
    const button = /** @type {HTMLButtonElement} */ (document.getElementById("ask-ok"));
    const sync   = () => {
        const count       = picks.filter((pick) => pick.checked).length;
        all.checked       = count === picks.length;
        all.indeterminate = count > 0 && count < picks.length;
        button.disabled   = !count;
        button.textContent = count ? `Update ${countOf(count, noun)}` : "Update";
    };
    box.onchange = (event) => {
        if (event.target === all) {
            picks.forEach((pick) => { pick.checked = all.checked; });
        }
        sync();
    };
    sync();

    const names = (await waiting)
        ? picks.filter((pick) => pick.checked).map((pick) => pick.value) : [];
    box.onchange = null;
    // The same dialog, still open, turns into the update's progress.
    if (names.length) {
        updatePackages(names, kind);
    }
}

/**
 * Whether going from one version to another is a major change: the first
 * number changes, or the second while the first is 0, as semver counts it.
 */
function isMajor(from, to) {
    const [ a, b ] = [ from, to ].map((version) => version.split(/[.+-]/).map(Number));
    return a[0] !== b[0] || (a[0] === 0 && a[1] !== b[1]);
}

/**
 * Updates some packages, one after the other, showing each in the update
 * dialog as it goes: waiting, a loader while npm works on it, then a tick or
 * what went wrong. Closing the dialog leaves the update going, and the busy
 * Update button opens it again.
 */
async function updatePackages(names, kind = "npm") {
    const { noun, action, key, list, render } = UPDATE_KINDS[kind];
    const byName = Object.fromEntries(list().map((pkg) => [ pkg.name, pkg ]));
    updateJob = {
        kind,
        noun,
        state : "waiting",
        items : names.map((name) => ({
            name,
            from  : byName[name]?.version || "",
            to    : byName[name]?.latest || "",
            state : "waiting",
            error : "",
        })),
    };
    names.forEach((name) => updating.add(key(name)));
    showUpdateProgress();
    render();
    try {
        await followJob({ action, name : names }, (job) => {
            job.items.forEach((item, index) => Object.assign(updateJob.items[index], {
                state : item.state,
                error : item.error,
            }));
            updateJob.state = job.state;
            renderUpdateProgress();
        });
    } finally {
        names.forEach((name) => updating.delete(key(name)));
        render();
    }
}

// -------------------------------------------------------------------- jobs ---

// The last update, which the update dialog shows while it runs and after.
let updateJob = null;

/** Whether an update of npm's packages, or of pecl's extensions, is running. */
function isUpdating(kind) {
    return Boolean(updateJob && updateJob.kind === kind
        && (updateJob.state === "waiting" || updateJob.state === "running"));
}

/**
 * Asks npm or pecl for some work, then follows it to the end: the server answers at
 * once with a job, which is asked about every moment, each answer handed to
 * onChange. At the end it says how it went and redraws the page.
 */
async function followJob(body, onChange = null) {
    let started;
    try {
        started = await api("/api/action", body);
    } catch (error) {
        toast(error.message, true);
        if (updateJob && onChange) {
            updateJob.state = "failed";
            renderUpdateProgress();
        }
        return;
    }
    for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        let job;
        try {
            job = await api(`/api/job?id=${started.job}`);
        } catch {
            continue;
        }
        onChange?.(job);
        if (job.state === "done" || job.state === "failed") {
            toast(job.message, job.state === "failed");
            await refresh();
            return;
        }
    }
}

/** Shows the update in the update dialog, opening it again if it was closed. */
function showUpdateProgress() {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("ask"));
    dialog.dataset.mode = "progress";
    if (!dialog.open) {
        dialog.showModal();
    }
    renderUpdateProgress();
}

/** Each package of the update, with its versions and where it stands. */
function renderUpdateProgress() {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("ask"));
    if (!updateJob || dialog.dataset.mode !== "progress") {
        return;
    }
    const items   = updateJob.items;
    const done    = items.filter((item) => item.state === "done").length;
    const failed  = items.filter((item) => item.state === "failed").length;
    const running = updateJob.state === "waiting" || updateJob.state === "running";
    document.getElementById("ask-title").textContent = running
        ? `Updating ${items.length === 1 ? items[0].name : countOf(items.length, updateJob.noun)}`
        : failed ? "Update finished with errors" : "Update finished";
    // The description says what the update does; how far it got is below.
    document.getElementById("ask-text").textContent =
        `Updates ${items.length === 1 ? `this ${updateJob.noun}` : `these ${countOf(
            items.length, updateJob.noun)}`} to the newest version, one at a time${
            updateJob.kind === "pecl" ? ", building each from its source" : ""}.`;
    // The rows and the bar change in place once drawn: drawing them again
    // every moment would restart the loader's turn and the bar's slide.
    const body = document.getElementById("ask-body");
    body.hidden = false;
    const rows  = /** @type {HTMLElement[]} */ ([ ...body.querySelectorAll(".step") ]);
    if (rows.length !== items.length
        || rows.some((row, index) => row.dataset.name !== items[index].name)) {
        body.innerHTML = items.map((item) => `
            <div class="pkg step" data-name="${esc(item.name)}">
                <span class="step-mark"></span>
                <span class="pkg-name"><span class="pkg-text">${esc(item.name)}</span></span>
                <span class="pkg-version">${esc(item.from.replace(/\+.*/, ""))}${item.to
                    ? `<span class="pkg-latest">→ ${esc(item.to)}</span>` : ""}</span>
            </div>
        `).join("");
    }
    /** @type {NodeListOf<HTMLElement>} */ (body.querySelectorAll(".step"))
        .forEach((row, index) => {
        const item = items[index];
        if (!row.classList.contains(item.state)) {
            row.className = `pkg step ${item.state}`;
            // Once updated, the row shows the version it has now.
            if (item.state === "done" && item.to) {
                row.querySelector(".pkg-version").textContent = item.to;
            }
        }
        row.title = item.error;
    });

    // The footer has the progress: a bar and a count, green once it is all
    // done, red when something failed.
    const finished = done + failed;
    const note     = document.getElementById("ask-note");
    if (!note.querySelector(".progress-bar")) {
        note.innerHTML = `<span class="progress-bar"><i></i></span><span
            class="progress-text"></span>`;
    }
    note.className = `editor-status progress ${running ? "" : failed ? "bad" : "ok"}`;
    /** @type {HTMLElement} */ (note.querySelector(".progress-bar i")).style.width =
        `${(finished / items.length) * 100}%`;
    note.querySelector(".progress-text").textContent = running
        ? `${done} of ${items.length} updated · closing this leaves it going`
        : `${done} updated${failed
            ? `, ${failed} failed · hover one for ${updateJob.kind === "pecl"
                ? "pecl" : "npm"}'s error`
            : ""}`;
    /** @type {HTMLElement} */ (dialog.querySelector(".editor-foot")).hidden = false;
    document.getElementById("ask-x").hidden      = false;
    document.getElementById("ask-cancel").hidden = true;
    document.getElementById("ask-ok").hidden     = true;
}
