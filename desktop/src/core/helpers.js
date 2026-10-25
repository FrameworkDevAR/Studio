"use strict";

// The small pieces every page uses: the pill tabs, toggles, toasts and formatting.

/**
 * Gives every pill-tab control its sliding thumb. It follows the active tab
 * by watching the tabs' classes, and their sizes too: a tab's width changes
 * with its count, and a control on a hidden page has no size until shown.
 * The first placement does not slide, so the thumb never flies in from 0.
 * @param {(Document | Element)=} root
 * @returns {void}
 */
function setUpPillTabs(root = document) {
    for (const control of root.querySelectorAll(".segmented:not(.has-thumb)")) {
        const thumb = document.createElement("span");
        thumb.className = "seg-thumb";
        control.prepend(thumb);
        control.classList.add("has-thumb");

        const place = () => {
            const active = /** @type {HTMLElement} */ (control.querySelector("button.active"));
            if (!active || !active.offsetWidth) {
                return;
            }

            thumb.style.width     = `${active.offsetWidth}px`;
            thumb.style.transform = `translateX(${active.offsetLeft}px)`;
            if (!control.classList.contains("ready")) {
                requestAnimationFrame(() => control.classList.add("ready"));
            }
        };

        new MutationObserver(place).observe(control, {
            subtree         : true,
            attributes      : true,
            attributeFilter : [ "class" ],
        });

        const sizes = new ResizeObserver(place);
        for (const button of control.querySelectorAll("button")) {
            sizes.observe(button);
        }

        place();
    }
}

/**
 * Lays a container's panels out as a mosaic: as many columns as fit, each
 * panel put in the shortest so far, in order, and the last of each column
 * stretched so they all end on one line. Laid out again as its width changes,
 * as when its page is shown.
 */
const MOSAIC_WIDTH = 300;
const MOSAIC_GAP   = 18;
const mosaicSizes  = new ResizeObserver((entries) => entries.forEach((entry) => {
    const box = /** @type {HTMLElement} */ (entry.target);
    if (box.offsetWidth && String(box.offsetWidth) !== box.dataset.mosaicWidth) {
        mosaic(box);
    }
}));

/**
 * Lays a box's panels out in as many columns as fit, and keeps it laid out.
 * @param {HTMLElement} box
 * @returns {void}
 */
function mosaic(box) {
    const panels = /** @type {HTMLElement[]} */ ([
        ...box.querySelectorAll(":scope > .panel, :scope > .mosaic-col > .panel"),
    ]);
    mosaicSizes.observe(box);
    if (!box.offsetWidth) {
        return;
    }

    box.dataset.mosaicWidth = String(box.offsetWidth);
    const count   = Math.max(1, Math.min(
        panels.length,
        Math.floor((box.offsetWidth + MOSAIC_GAP) / (MOSAIC_WIDTH + MOSAIC_GAP)),
    ));
    const columns = Array.from(
        { length : count },
        () => Object.assign(document.createElement("div"), { className : "mosaic-col" }),
    );

    box.querySelectorAll(":scope > .mosaic-col").forEach((column) => column.remove());
    box.prepend(...columns);

    // Each panel is measured in a column, all being as wide, before it is placed.
    panels.forEach((panel) => {
        panel.classList.remove("fill");
        columns[0].append(panel);
    });

    const heights = panels.map((panel) => panel.offsetHeight);
    const tall    = columns.map(() => 0);
    panels.forEach((panel, index) => {
        const shortest = tall.indexOf(Math.min(...tall));
        columns[shortest].append(panel);
        tall[shortest] += heights[index] + MOSAIC_GAP;
    });

    columns.forEach((column) => column.lastElementChild?.classList.add("fill"));
}

/**
 * Whether a toggle button is on.
 * @param {string} id
 * @returns {boolean}
 */
function isPressed(id) {
    return document.getElementById(id).getAttribute("aria-pressed") === "true";
}

/**
 * Marks a button active, and every other one beside it not.
 * @param {Element} button
 * @returns {void}
 */
function setActive(button) {
    for (const sibling of button.parentElement.children) {
        sibling.classList.toggle("active", sibling === button);
    }
}

// ----------------------------------------------------------------- helpers ---

/**
 * Shows a message for a few seconds, longer and in red for an error.
 * @param {string} message
 * @param {boolean=} isError
 * @returns {void}
 */
function toast(message, isError = false) {
    const box     = document.getElementById("toasts");
    const element = document.createElement("div");

    element.className = `toast ${isError ? "error" : ""}`;
    element.textContent = message;
    box.append(element);

    // A popover, shown again for each toast, sits in the top layer above any
    // dialog already open, which a z-index alone cannot do.
    if (box.matches(":popover-open")) {
        box.hidePopover();
    }
    box.showPopover();

    setTimeout(() => {
        element.remove();
        if (!box.children.length && box.matches(":popover-open")) {
            box.hidePopover();
        }
    }, isError ? 9000 : 3500);
}

/**
 * Apache logs this whenever it lists a folder holding an .htaccess, which it
 * hides from the listing. The site check asks for those listings every minute,
 * so it would bury the real errors.
 * @param {string} line
 * @returns {boolean}
 */
function isListingNoise(line) {
    return /AH01630: client denied by server configuration: .*\/\.ht\w*$/.test(line);
}

/**
 * Whether a log line is an error, by its level.
 * @param {string} line
 * @returns {boolean}
 */
function isErrorLine(line) {
    return /\b(error|fatal|alert|crit|emerg)\b/i.test(line);
}

/**
 * A path with the home folder as ~.
 * @param {string} dir
 * @returns {string}
 */
function shortPath(dir) {
    return dir.replace(/^\/Users\/[^/]+/, "~");
}

/**
 * A size in bytes, in the largest unit that fits, up to TB: "1.5 MB".
 * @param {number} value
 * @returns {string}
 */
function bytes(value) {
    const units = [ "B", "KB", "MB", "GB", "TB" ];
    let size = value;
    let unit = 0;

    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }

    return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

/** What a list's tags mean, shown on hover. */
const TAG_TIPS = {
    linked : "Linked with npm link: it points to a folder of yours, so changes there show at once",
    pecl   : "Added with pecl, built from its source for this PHP version. " +
        "A new minor version, as 8.6, needs it built again",
    added  : "Added to PHP's extension folder by hand, not with pecl",
};

/**
 * One line of a package or extension list: the name, with a scope like
 * @babel/ dimmed so the name itself stands out, a link when given, and its tag; then, when
 * given, the size, the version with the newest one after it, and buttons.
 * A version's build part, as in 8.2.2+cordova.8.2.1, shows on hover only.
 * @param {{
 *     name: string, url?: string, tag?: string, size?: number, version?: string,
 *     latest?: string, actions?: string,
 * }} pkg
 * @returns {string}
 */
function packageRow({
    name,
    url = "",
    tag = "",
    size = null,
    version = "",
    latest = "",
    actions = null
}) {
    const [ , scope, rest ] = name.match(/^(@[^/]+\/)?(.*)$/);
    const shown = version.replace(/\+.*/, "");
    const text  = `${scope ? `<span class="pkg-scope">${esc(scope)}</span>` : ""}${esc(rest)}`;

    return `
        <div class="pkg ${latest ? "outdated" : ""}">
            <span class="pkg-name">
                ${url
                    ? `<a class="pkg-text" href="${esc(url)}" target="_blank" rel="noopener"
                        title="Open on npm">${text}</a>`
                    : `<span class="pkg-text">${text}</span>`}
                ${tag ? `<span class="tag amber"
                    title="${esc(TAG_TIPS[tag] || "")}">${esc(tag)}</span>` : ""}
            </span>
            ${size === null ? "" : `<span class="pkg-size">${size ? bytes(size) : ""}</span>`}
            <span class="pkg-version"
                ${shown !== version ? `title="${esc(version)}"` : ""}>${esc(shown)}${latest
                    ? `<span class="pkg-latest">→ ${esc(latest)}</span>` : ""}</span>
            ${actions === null ? "" : `<span class="pkg-actions">${actions}</span>`}
        </div>
    `;
}

/**
 * Marks the last line of each column of the lists in a box, which drops its
 * rule. CSS columns cannot select it, so it is found by where each line
 * sits, again whenever the box changes size.
 * @param {Element} box
 * @returns {void}
 */
function markColumnEnds(box) {
    for (const list of box.querySelectorAll(".pkg-list, .configs")) {
        const rows = /** @type {HTMLElement[]} */ ([ ...list.children ]);
        rows.forEach((row, index) => {
            row.classList.toggle(
                "end",
                index === rows.length - 1 || rows[index + 1].offsetLeft !== row.offsetLeft,
            );
        });
    }
}

/**
 * Asks before something that cannot be undone, in Studio's own dialog. Gives
 * true when it is confirmed, and false on Cancel, Esc or a click outside.
 * The body, a list say, and the note under it are optional; a danger asks
 * with a red button. A dialog to pick from closes with an x at the top
 * instead of a Cancel beside its button. With stay, OK leaves the dialog
 * open, for the caller to show what follows in it.
 * @param {{
 *     title: string, text?: string, body?: string, note?: string, ok?: string,
 *     danger?: boolean, closeX?: boolean, stay?: boolean,
 * }} question
 * @returns {Promise<boolean>}
 */
function ask({
    title,
    text = "",
    body = "",
    note = "",
    ok = "OK",
    danger = false,
    closeX = false,
    stay = false
}) {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("ask"));
    dialog.dataset.mode = "ask";

    document.getElementById("ask-title").textContent = title;
    document.getElementById("ask-text").textContent  = text;
    document.getElementById("ask-body").innerHTML    = body;
    document.getElementById("ask-body").hidden       = !body;
    document.getElementById("ask-note").innerHTML    = note;
    document.getElementById("ask-note").className    = "editor-status";
    document.getElementById("ask-x").hidden          = !closeX;
    document.getElementById("ask-cancel").hidden     = closeX;

    const button = /** @type {HTMLButtonElement} */ (document.getElementById("ask-ok"));
    button.textContent = ok;
    button.className   = danger ? "danger-fill" : "";
    button.disabled    = false;
    button.hidden      = false;

    /** @type {HTMLElement} */ (dialog.querySelector(".editor-foot")).hidden = false;
    dialog.returnValue = "";

    if (!dialog.open) {
        dialog.showModal();
    }
    button.focus();

    return new Promise((resolve) => {
        const form   = dialog.querySelector("form");
        const submit = (event) => {
            if (stay && event.submitter?.value === "ok") {
                event.preventDefault();
                done(true);
            }
        };
        const close = () => done(dialog.returnValue === "ok");
        const done  = (answer) => {
            form.removeEventListener("submit", submit);
            dialog.removeEventListener("close", close);
            resolve(answer);
        };

        form.addEventListener("submit", submit);
        dialog.addEventListener("close", close);
    });
}

/**
 * Opens the form dialog with its fields, as a new database's. Its button
 * gives the form to submit, and what that gives is said in a toast once the
 * dialog closes; what it throws stays in the dialog, by the button, to fix.
 * ready gets the fields once they are in, for listeners of their own. A
 * remove, as a row's Delete, is a red button at the left, which closes the
 * dialog when what it runs gives true.
 * @param {{
 *     title: string, text?: string, body: string, ok: string, danger?: boolean,
 *     submit: (form: HTMLFormElement) => Promise<{ message: string }>,
 *     ready?: (fields: HTMLElement) => void,
 *     remove?: { label: string, run: () => Promise<boolean> },
 * }} dialogSpec
 * @returns {void}
 */
function formDialog({
    title,
    text = "",
    body,
    ok,
    danger = false,
    submit,
    ready = null,
    remove = null
}) {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("form"));
    const form   = /** @type {HTMLFormElement} */ (document.getElementById("form-form"));
    const button = /** @type {HTMLButtonElement} */ (document.getElementById("form-ok"));
    const status = document.getElementById("form-status");
    const fields = document.getElementById("form-body");

    document.getElementById("form-title").textContent = title;
    document.getElementById("form-text").textContent  = text;
    document.getElementById("form-text").hidden       = !text;

    fields.innerHTML   = body;
    button.textContent = ok;
    button.className   = danger ? "danger-fill" : "";
    button.disabled    = false;
    status.textContent = "";
    status.className   = "editor-status";

    const drop = /** @type {HTMLButtonElement} */ (document.getElementById("form-remove"));
    drop.hidden      = !remove;
    drop.textContent = remove?.label || "";
    drop.onclick     = async () => {
        if (await remove.run()) {
            dialog.close();
        }
    };

    ready?.(fields);
    setUpPillTabs(fields);

    form.onsubmit = async (event) => {
        event.preventDefault();
        if (button.disabled) {
            return;
        }

        button.disabled    = true;
        status.textContent = "Saving…";
        status.className   = "editor-status";

        try {
            const result = await submit(form);
            dialog.close();
            toast(result.message);
            await refresh();
        } catch (error) {
            status.textContent = error.message;
            status.className   = "editor-status bad";
        } finally {
            button.disabled = false;
        }
    };

    dialog.showModal();
    /** @type {HTMLElement} */ (
        fields.querySelector("input:not([readonly]):not([disabled]), select")
    )?.focus();
}

/**
 * A value as text safe to put in HTML or an attribute, nothing for null or undefined.
 * @param {*} value
 * @returns {string}
 */
function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&" : "&amp;", "<" : "&lt;", ">" : "&gt;", "\"" : "&quot;", "'" : "&#39;",
    })[char]);
}

/**
 * Opens a button's menu, or closes it; any other open menu closes.
 * @param {HTMLElement} button
 * @returns {void}
 */
function toggleMenu(button) {
    const menu = document.getElementById(button.dataset.menu);
    closeMenus(menu);
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
}

/**
 * Closes the open menus, but the one given.
 * @param {Element=} keep
 * @returns {void}
 */
function closeMenus(keep = null) {
    for (const menu of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll(".menu:not([hidden])")
    )) {
        if (menu !== keep) {
            menu.hidden = true;
            document.querySelector(`[data-menu="${menu.id}"]`)
                ?.setAttribute("aria-expanded", "false");
        }
    }
}
