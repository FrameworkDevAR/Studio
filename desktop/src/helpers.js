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
    const element = document.createElement("div");
    element.className = `toast ${isError ? "error" : ""}`;
    element.textContent = message;
    document.getElementById("toasts").append(element);
    setTimeout(() => element.remove(), isError ? 9000 : 3500);
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

function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&" : "&amp;", "<" : "&lt;", ">" : "&gt;", "\"" : "&quot;", "'" : "&#39;",
    })[char]);
}
