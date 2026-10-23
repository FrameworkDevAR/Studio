"use strict";

// The small pieces every page uses: the pill tabs, toggles, toasts and formatting.

/**
 * Gives every pill-tab control its sliding thumb. It follows the active tab
 * by watching the tabs' classes, and their sizes too: a tab's width changes
 * with its count, and a control on a hidden page has no size until shown.
 * The first placement does not slide, so the thumb never flies in from 0.
 */
function setUpPillTabs() {
    for (const control of document.querySelectorAll(".segmented")) {
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
        new MutationObserver(place).observe(control, { subtree : true, attributes : true, attributeFilter : [ "class" ] });
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

function mosaic(box) {
    const panels = /** @type {HTMLElement[]} */ ([ ...box.querySelectorAll(":scope > .panel, :scope > .mosaic-col > .panel") ]);
    mosaicSizes.observe(box);
    if (!box.offsetWidth) {
        return;
    }
    box.dataset.mosaicWidth = String(box.offsetWidth);
    const count   = Math.max(1, Math.min(panels.length, Math.floor((box.offsetWidth + MOSAIC_GAP) / (MOSAIC_WIDTH + MOSAIC_GAP))));
    const columns = Array.from({ length : count }, () => Object.assign(document.createElement("div"), { className : "mosaic-col" }));
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

/** Whether a toggle button is on. */
function isPressed(id) {
    return document.getElementById(id).getAttribute("aria-pressed") === "true";
}

function setActive(button) {
    for (const sibling of button.parentElement.children) {
        sibling.classList.toggle("active", sibling === button);
    }
}

// ----------------------------------------------------------------- helpers ---

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
 */
function isListingNoise(line) {
    return /AH01630: client denied by server configuration: .*\/\.ht\w*$/.test(line);
}

function isErrorLine(line) {
    return /\b(error|fatal|alert|crit|emerg)\b/i.test(line);
}

function shortPath(dir) {
    return dir.replace(/^\/Users\/[^/]+/, "~");
}

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
    pecl   : "Added with pecl, built from its source for this PHP version. A new minor version, as 8.6, needs it built again",
    added  : "Added to PHP's extension folder by hand, not with pecl",
};

/**
 * One line of a package or extension list: the name, with a scope like
 * @babel/ dimmed so the name itself stands out, a link when given, and its tag; then, when
 * given, the size, the version with the newest one after it, and buttons.
 * A version's build part, as in 8.2.2+cordova.8.2.1, shows on hover only.
 */
function packageRow({ name, url = "", tag = "", size = null, version = "", latest = "", actions = null }) {
    const [ , scope, rest ] = name.match(/^(@[^/]+\/)?(.*)$/);
    const shown = version.replace(/\+.*/, "");
    const text  = `${scope ? `<span class="pkg-scope">${esc(scope)}</span>` : ""}${esc(rest)}`;
    return `
        <div class="pkg ${latest ? "outdated" : ""}">
            <span class="pkg-name">
                ${url ? `<a class="pkg-text" href="${esc(url)}" target="_blank" rel="noopener" title="Open on npm">${text}</a>` : `<span class="pkg-text">${text}</span>`}
                ${tag ? `<span class="tag amber" title="${esc(TAG_TIPS[tag] || "")}">${esc(tag)}</span>` : ""}
            </span>
            ${size === null ? "" : `<span class="pkg-size">${size ? bytes(size) : ""}</span>`}
            <span class="pkg-version" ${shown !== version ? `title="${esc(version)}"` : ""}>${esc(shown)}${latest ? `<span class="pkg-latest">→ ${esc(latest)}</span>` : ""}</span>
            ${actions === null ? "" : `<span class="pkg-actions">${actions}</span>`}
        </div>
    `;
}

/**
 * Marks the last line of each column of the lists in a box, which drops its
 * rule. CSS columns cannot select it, so it is found by where each line
 * sits, again whenever the box changes size.
 */
function markColumnEnds(box) {
    for (const list of box.querySelectorAll(".pkg-list")) {
        const rows = /** @type {HTMLElement[]} */ ([ ...list.children ]);
        rows.forEach((row, index) => {
            row.classList.toggle("end", index === rows.length - 1 || rows[index + 1].offsetLeft !== row.offsetLeft);
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
 */
function ask({ title, text = "", body = "", note = "", ok = "OK", danger = false, closeX = false, stay = false }) {
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

function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&" : "&amp;", "<" : "&lt;", ">" : "&gt;", "\"" : "&quot;", "'" : "&#39;",
    })[char]);
}
