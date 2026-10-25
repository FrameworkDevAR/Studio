"use strict";

// The PHP page: its settings, where each comes from, and the extensions.

/**
 * The PHP page: its version, the count of settings saved here, the line under
 * the title, its problems, settings and extensions, and the PECL dialog when it is open.
 * @returns {void}
 */
function renderPhp() {
    const { php } = state;

    document.getElementById("php-version").textContent = php.version || "";
    document.getElementById("tab-overrides-count").textContent = String(
        php.settings.filter((setting) => setting.inFile).length + php.overrides.length,
    );

    renderPhpText();
    renderPhpProblems();
    renderSettings();
    renderExtensions();

    if (/** @type {HTMLDialogElement} */ (document.getElementById("pecl-dialog")).open) {
        renderPeclList();
    }
}

/**
 * The line under the title, about the tab shown.
 * @returns {void}
 */
function renderPhpText() {
    const { php } = state;
    const file    = php.iniFile.split("/").pop();
    document.getElementById("php-text").innerHTML = phpTab() === "settings"
        ? `Values saved here go to <code title="${esc(php.iniFile)}">${esc(file)}</code>, which PHP
            reads after <code title="${esc(php.mainIni)}">php.ini</code>, so they win over it.
            The × takes one out, back to php.ini's value. Changes wait in a panel until saved, then
            Apache reloads.`
        : `The extensions PHP loads. The ones added with pecl are built from their source for this
            PHP version, and can be updated or removed here; the rest come with PHP.`;
}

/**
 * What PHP complained about as it started, and the extensions php.ini or pecl
 * ask for that it could not load: after a new minor version, each has to be
 * built again for it.
 * @returns {void}
 */
function renderPhpProblems() {
    const { php } = state;
    const box     = document.getElementById("php-problem");
    const missing = php.missing.map((ext) => `
        <div class="problem-line">
            <span><b>${esc(ext.name)}</b> is not loaded. ${ext.pecl
                ? "It was built for another PHP version, or its file is gone."
                : "php.ini asks for it, but pecl did not install it."}</span>
            ${ext.pecl ? `<button class="small" data-pecl-rebuild="${esc(ext.name)}"
                ${updating.has(`pecl:${ext.name}`) ? "disabled" : ""}>${
                    updating.has(`pecl:${ext.name}`) ? "Building…" : "Build again"
                }</button>` : ""}
        </div>
    `);

    // Each failed extension also has a warning, said already by its line.
    const names    = php.missing.map((ext) => ext.name);
    const problems = php.problems
        .filter((line) => !names.some((name) => line.includes(`'${name}`)
            || line.includes(`${name}.so`)))
        .map((line) => `<div class="problem-line"><span>${esc(line)}</span></div>`);

    box.hidden    = !missing.length && !problems.length;
    box.innerHTML = box.hidden ? ""
        : `<b>PHP has something to say as it starts</b>${[ ...missing, ...problems ].join("")}`;
}

/**
 * The settings, in groups, with the timezones date.timezone suggests.
 * @returns {void}
 */
function renderSettings() {
    const { php } = state;
    renderSettingGroups("php", SETTING_GROUPS, php.settings, php.overrides,
        `<datalist id="timezones">${php.timezones
            .map((zone) => `<option value="${esc(zone)}">`)
            .join("")}</datalist>`);
}

// -------------------------------------------------------------- extensions ---

/**
 * The extensions: first the ones added to PHP, with their versions, sizes
 * and buttons, then, apart, the ones that come with it.
 * @returns {void}
 */
function renderExtensions() {
    const { php } = state;
    const added   = php.extensions.filter((ext) => ext.added);
    const builtIn = php.extensions.filter((ext) => !ext.added);
    const behind  = added.filter((ext) => ext.latest).length;

    document.getElementById("ext-count").textContent       = String(php.extensions.length);
    document.getElementById("ext-panel-count").textContent = String(php.extensions.length);
    document.getElementById("pecl-outdated").innerHTML = !added.some((ext) => ext.pecl)
        ? ""
        : !php.checked
            ? "Checking for updates…"
            : behind
                ? `<b>${behind} outdated</b> <button data-pecl-update-all>${isUpdating("pecl")
                    ? "Updating…" : "Update extensions"}</button>`
                : "All up to date";

    // The ones being installed, from the dialog, open or closed, until PHP
    // loads them, in their places among the others.
    const names    = new Set(php.extensions.map((ext) => ext.name.toLowerCase()));
    const building = [ ...updating ]
        .filter((key) => key.startsWith("pecl-install:") && !names.has(key.slice(13)))
        .map((key) => ({ name : key.slice(13), building : true }));
    // The filter keeps the extensions whose name holds what is typed.
    const filter   = /** @type {HTMLInputElement} */ (document.getElementById("php-ext-filter"))
        .value.trim().toLowerCase();
    const matches  = (ext) => ext.name.toLowerCase().includes(filter);
    const rows     = [ ...added, ...building ]
        .filter(matches)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity : "base" }));
    const others   = builtIn.filter(matches);

    document.getElementById("php-extensions").innerHTML = !rows.length && !others.length
        ? `<div class="pkg-none">No extensions match “${esc(filter)}”.</div>`
        : [
        rows.length ? `<div class="pkg-list wide">${rows.map((ext) => (ext.building ? packageRow({
            name    : ext.name,
            url     : `https://pecl.php.net/package/${ext.name}`,
            tag     : "pecl",
            size    : 0,
            version : "Building…",
            actions : `<span class="pkg-building" title="Being built and installed"
                aria-label="Building"></span>`,
        }) : packageRow({
            name    : ext.name,
            url     : ext.pecl ? `https://pecl.php.net/package/${ext.name}` : "",
            tag     : ext.pecl ? "pecl" : "added",
            size    : ext.size,
            version : ext.version,
            latest  : ext.latest,
            actions : extensionButtons(ext),
        }))).join("")}</div>` : "",
        others.length ? `<div class="pkg-list">${others
            .map((ext) => packageRow({ name : ext.name, tag : "", actions : null }))
            .join("")}</div>` : "",
        ].join("");
    markColumnEnds(document.getElementById("php-extensions"));
}

/**
 * An added extension's buttons: update when newer, and remove, for pecl's.
 * @param {{ name: string, version: string, added: boolean, pecl: boolean, latest: string,
 *           size: number }} ext
 * @returns {string}
 */
function extensionButtons(ext) {
    if (!ext.pecl) {
        return "";
    }

    const id       = ext.name.toLowerCase();
    const busy     = updating.has(`pecl:${id}`);
    const removing = updating.has(`pecl-remove:${id}`);

    return `
        ${ext.latest ? `
            <button class="icon-btn update ${busy ? "busy" : ""}" title="Update to the newest"
                aria-label="Update ${esc(ext.name)}" data-pecl-update="${esc(id)}"
                ${busy ? "disabled" : ""}>
                <svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
            </button>
        ` : ""}
        <button class="icon-btn remove ${removing ? "busy" : ""}" title="Uninstall"
            aria-label="Uninstall ${esc(ext.name)}" data-pecl-remove="${esc(id)}"
            ${removing ? "disabled" : ""}>
            <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2
                2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
    `;
}

/**
 * Uninstalls an extension pecl added, after asking, and follows the job.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function uninstallExtension(name) {
    if (!await ask({
        title  : `Uninstall ${name}?`,
        text   : "Its file and its line in php.ini go, and Apache reloads without it.",
        ok     : "Uninstall",
        danger : true,
    })) {
        return;
    }

    updating.add(`pecl-remove:${name}`);
    renderPhp();

    try {
        await followJob({ action : "pecl-remove", name });
    } finally {
        updating.delete(`pecl-remove:${name}`);
        renderPhp();
    }
}

/**
 * Builds an extension again for this PHP version, as pecl install does.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function rebuildExtension(name) {
    updating.add(`pecl:${name}`);
    renderPhp();

    try {
        await followJob({ action : "pecl-rebuild", name });
    } finally {
        updating.delete(`pecl:${name}`);
        renderPhp();
    }
}

// ---------------------------------------------------------------- install ---

let peclSearchTimer = null;
let peclFound       = [];
let peclAsked       = "";

/**
 * Opens the dialog that searches PECL for an extension to install, its field selected.
 * @returns {void}
 */
function openPeclDialog() {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("pecl-dialog"));
    dialog.querySelector(".logo-tile").innerHTML = logoSvg("php");
    dialog.showModal();
    /** @type {HTMLInputElement} */ (dialog.querySelector("input")).select();
    renderPeclList();
}

/**
 * Searches PECL as the field changes, a moment after the typing stops.
 * @param {boolean=} now
 * @returns {void}
 */
function searchPecl(now = false) {
    const text = /** @type {HTMLInputElement} */ (document.querySelector("#pecl-search input"))
        .value.trim();
    clearTimeout(peclSearchTimer);

    if (text.length < 2) {
        peclAsked = text;
        peclFound = [];
        renderPeclList();
        return;
    }

    peclSearchTimer = setTimeout(async () => {
        peclAsked = text;
        renderPeclList(true);

        try {
            const list = await api(`/api/pecl-search?q=${encodeURIComponent(text)}`);
            if (peclAsked === text) {
                peclFound = list;
                renderPeclList();
            }
        } catch (error) {
            if (peclAsked === text) {
                peclFound = [];
                renderPeclList(false, error.message);
            }
        }
    }, now ? 0 : 300);
}

/**
 * The results, as the npm dialog shows its own. An extension whose newest
 * release is years old likely does not build on a PHP this new, which it
 * says beside the date.
 * @param {boolean=} loading
 * @param {string=} failed
 * @returns {void}
 */
function renderPeclList(loading = false, failed = "") {
    const box = document.getElementById("pecl-list");

    if (failed || loading || !peclFound.length) {
        const text = failed || (loading ? "Searching…"
            : peclAsked.length >= 2 ? `No extensions match “${esc(peclAsked)}”.`
                : "Search PECL for an extension to build and add to PHP. " +
                    "Most others are part of PHP already.");
        box.innerHTML = `<div class="npm-empty">${text}</div>`;
        return;
    }

    const minor = (state.php.version || "").split(".").slice(0, 2).join(".");
    box.innerHTML = peclFound.map((ext) => {
        const years = ext.date ? (Date.now() - Date.parse(ext.date)) / (365 * 86_400_000) : 0;
        return `
            <div class="npm-item">
                <div class="npm-item-body">
                    <a class="npm-name" href="https://pecl.php.net/package/${esc(ext.name)}"
                        target="_blank" rel="noopener">${esc(ext.name)}</a>
                    ${ext.summary ? `<p>${esc(ext.summary)}</p>` : ""}
                    <div class="npm-meta">
                        ${[
                            ext.version
                                ? `latest <b>${esc(ext.version)}</b>${ext.stable ? ""
                                    : ` <span class="tag amber">beta</span>`}`
                                : "no releases",
                            ext.date ? `${ago(ext.date)}${years > 3 ? ` <span class="tag amber"
                                title="Old extensions often do not build on new PHP versions">may
                                not build on PHP ${esc(minor)}</span>` : ""}` : "",
                            ext.license ? esc(ext.license) : "",
                        ].filter(Boolean).join(`<i class="sep">·</i>`)}
                    </div>
                </div>
                ${peclActions(ext)}
            </div>
        `;
    }).join("");
}

/**
 * What a result offers: Install, or for one here its version, Update when
 * PECL has a newer one, and Uninstall. One that comes with PHP says so.
 * @param {{ name: string, version: string, stable: boolean, summary: string,
 *           license: string, date: string }} ext
 * @returns {string}
 */
function peclActions(ext) {
    const id   = ext.name.toLowerCase();
    const mine = state.php.extensions.find((one) => one.name.toLowerCase() === id);
    if (updating.has(`pecl-install:${id}`)) {
        return `<div class="npm-actions"><button class="npm-install"
            disabled>Building…</button></div>`;
    }
    if (!mine) {
        return `<div class="npm-actions"><button class="npm-install"
            data-pecl-install="${esc(ext.name)}"
            ${ext.version ? "" : "disabled"}>Install</button></div>`;
    }
    if (!mine.pecl) {
        return `<div class="npm-actions"><span class="npm-here">${mine.added
            ? "Added by hand, not with pecl" : "Part of PHP already"}</span></div>`;
    }

    const newer    = ext.version && isNewer(ext.version, mine.version);
    const busy     = updating.has(`pecl:${id}`);
    const removing = updating.has(`pecl-remove:${id}`);

    return `
        <div class="npm-actions">
            <span class="npm-here">Installed <b>${esc(mine.version)}</b>${newer
                ? `<span class="pkg-latest">→ ${esc(ext.version)}</span>`
                : " · newest"}</span>
            <span class="npm-buttons">
                ${newer ? `<button class="small" data-pecl-update="${esc(id)}"
                    ${busy ? "disabled" : ""}>${busy ? "Updating…" : "Update"}</button>` : ""}
                <button class="small danger" data-pecl-remove="${esc(id)}"
                    ${removing ? "disabled" : ""}>${removing ? "Removing…" : "Uninstall"}</button>
            </span>
        </div>
    `;
}

/**
 * Builds and installs an extension from the dialog, which stays open. A
 * PECL release that is only a beta is named with its version, since pecl
 * installs stable ones by name alone.
 * @param {string} name
 * @returns {Promise<void>}
 */
async function installPecl(name) {
    const id  = name.toLowerCase();
    const ext = peclFound.find((one) => one.name.toLowerCase() === id);
    if (updating.has(`pecl-install:${id}`)) {
        return;
    }

    updating.add(`pecl-install:${id}`);
    renderPeclList();
    renderExtensions();

    try {
        await followJob({
            action : "pecl-install",
            name   : ext && !ext.stable ? `${id}-${ext.version}` : id,
        });
    } finally {
        updating.delete(`pecl-install:${id}`);
        renderPeclList();
        renderExtensions();
    }
}
