"use strict";

// Selects that search: each select in a .select wrapper shows as a button,
// and its options open in a list under it, filtered as typed, its groups
// kept, with ↑, ↓, Enter and Escape. The select itself stays, hidden, with
// its value, so forms, FormData and the code reading or setting .value, or
// listening for change, go on as before. The list is a popover, so it shows
// over a dialog too.

/** @type {{ select : HTMLSelectElement, button : HTMLButtonElement, at : number, items : HTMLOptionElement[] } | null} */
let picking = null;

// The select's own value and selectedIndex, which the button's are set through.
const SELECT_VALUE = /** @type {{ get : () => string, set : (value : string) => void }} */ (Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value"));
const SELECT_INDEX = /** @type {{ get : () => number, set : (index : number) => void }} */ (Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex"));

/** The button for a select, which shows its option picked, follows it, and opens the list. */
function enhanceSelect(select) {
    if (select.dataset.picker || select.multiple || select.classList.contains("cell-input") || !select.parentElement?.classList.contains("select")) {
        return;
    }
    select.dataset.picker = "1";
    const button = document.createElement("button");
    button.type      = "button";
    button.className = "picker";
    button.setAttribute("aria-haspopup", "listbox");
    for (const name of [ "aria-label", "title" ]) {
        if (select.hasAttribute(name)) {
            button.setAttribute(name, select.getAttribute(name));
        }
    }
    select.after(button);
    select.tabIndex = -1;
    select.classList.add("picker-source");
    // The button shows what the select holds, however it changes.
    const show = () => {
        const option = select.selectedOptions[0];
        button.textContent = option ? option.textContent : "";
        button.disabled    = select.disabled;
        button.title       = select.title || (option ? option.textContent : "");
    };
    Object.defineProperty(select, "value", {
        get : () => SELECT_VALUE.get.call(select),
        set : (value) => { SELECT_VALUE.set.call(select, value); show(); },
    });
    Object.defineProperty(select, "selectedIndex", {
        get : () => SELECT_INDEX.get.call(select),
        set : (index) => { SELECT_INDEX.set.call(select, index); show(); },
    });
    new MutationObserver(show).observe(select, { childList : true, subtree : true, attributes : true, attributeFilter : [ "disabled", "selected", "label" ] });
    select.addEventListener("change", show);
    // Focus given to the select, as a dialog gives its first field, goes to its button.
    select.addEventListener("focus", () => button.focus());
    button.addEventListener("click", () => (picking?.select === select ? closePicker() : openPicker(select, button)));
    button.addEventListener("keydown", (event) => {
        if ([ "ArrowDown", "ArrowUp", "Enter", " " ].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            openPicker(select, button);
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            // Typing on the button starts the search with it.
            event.preventDefault();
            event.stopPropagation();
            openPicker(select, button, event.key);
        }
    });
    show();
}

/** Every select there now, and every one drawn later. */
function enhanceSelects(root = document) {
    root.querySelectorAll(".select > select").forEach(enhanceSelect);
}
new MutationObserver((records) => {
    for (const record of records) {
        for (const node of record.addedNodes) {
            if (node.nodeType === 1) {
                const element = /** @type {Element} */ (node);
                if (element.matches(".select > select")) {
                    enhanceSelect(element);
                } else if (element.querySelector(".select > select")) {
                    enhanceSelects(element);
                }
            }
        }
    }
}).observe(document.documentElement, { childList : true, subtree : true });

/** @param {string} [typed] What was typed on the button, to search for. */
function openPicker(select, button, typed = "") {
    const box    = document.getElementById("picker");
    const search = /** @type {HTMLInputElement} */ (box.querySelector("input"));
    picking?.button.setAttribute("aria-expanded", "false");
    picking = { select, button, at : 0, items : [] };
    button.setAttribute("aria-expanded", "true");
    // A short list needs no search.
    search.hidden = select.options.length < 8 && !typed;
    search.value  = typed;
    // In an open dialog, the list goes in it, as all else is inert then.
    const host = select.closest("dialog[open]") || document.body;
    if (box.parentElement !== host) {
        if (box.matches(":popover-open")) {
            box.hidePopover();
        }
        host.append(box);
    }
    if (!box.matches(":popover-open")) {
        box.showPopover();
    }
    renderPicker(true);
    placePicker();
    (search.hidden ? box : search).focus({ preventScroll : true });
}

function closePicker(back = true) {
    const box = document.getElementById("picker");
    const was = picking;
    picking = null;
    was?.button.setAttribute("aria-expanded", "false");
    if (box.matches(":popover-open")) {
        box.hidePopover();
    }
    if (back) {
        was?.button.focus({ preventScroll : true });
    }
}

/**
 * The options that hold what is typed, in their groups, the group's name
 * counting too; the one picked marked, and the cursor on it at first.
 */
function renderPicker(first = false) {
    const { select } = picking;
    const box    = document.getElementById("picker");
    const search = /** @type {HTMLInputElement} */ (box.querySelector("input")).value.trim().toLowerCase();
    const list   = box.querySelector(".picker-list");
    const items  = [];
    let html = "";
    for (const part of select.children) {
        const group   = part.tagName === "OPTGROUP" ? /** @type {HTMLOptGroupElement} */ (part) : null;
        const options = /** @type {HTMLOptionElement[]} */ (group ? [ ...group.children ] : [ part ]);
        const inGroup = group && group.label.toLowerCase().includes(search);
        const shown   = options.filter((option) => !search || inGroup || option.textContent.toLowerCase().includes(search) || option.value.toLowerCase().includes(search));
        if (!shown.length) {
            continue;
        }
        if (group) {
            html += `<div class="picker-group">${esc(group.label)}</div>`;
        }
        for (const option of shown) {
            if (option.disabled) {
                // A divider, as some lists have, or an option that can't be picked.
                html += /^[─-]+$/.test(option.textContent.trim()) ? (search ? "" : `<hr>`) : `<div class="picker-option off ${group ? "in-group" : ""}">${esc(option.textContent)}</div>`;
                continue;
            }
            html += `<div class="picker-option ${group ? "in-group" : ""} ${option.selected ? "picked" : ""}" role="option" data-pick="${items.length}">${esc(option.textContent)}</div>`;
            items.push(option);
        }
    }
    picking.items = items;
    picking.at    = first ? Math.max(0, items.findIndex((option) => option.selected)) : Math.min(picking.at, Math.max(0, items.length - 1));
    if (first && search) {
        picking.at = 0;
    }
    list.innerHTML = html || `<div class="picker-none">Nothing matches.</div>`;
    markPicker();
}

function markPicker() {
    const box = document.getElementById("picker");
    box.querySelector(".picker-option.active")?.classList.remove("active");
    const row = box.querySelector(`[data-pick="${picking.at}"]`);
    row?.classList.add("active");
    row?.scrollIntoView({ block : "nearest" });
}

/** Under the button, as wide as it at least, above it when there is no room under it. */
function placePicker() {
    const box  = document.getElementById("picker");
    const area = picking.button.getBoundingClientRect();
    box.style.minWidth = `${Math.max(area.width, 200)}px`;
    box.style.left     = `${Math.max(8, Math.min(area.left, innerWidth - box.offsetWidth - 8))}px`;
    const below = innerHeight - area.bottom - 8;
    box.style.top = `${below >= Math.min(box.offsetHeight, 300) ? area.bottom + 4 : Math.max(8, area.top - box.offsetHeight - 4)}px`;
}

/** Picks an option: the select takes it, and says so as a person's pick does. */
function pickOption(at = picking.at) {
    const option = picking?.items[at];
    if (!option) {
        return;
    }
    const { select } = picking;
    const changed = !option.selected;
    select.value = option.value;
    closePicker();
    if (changed) {
        select.dispatchEvent(new Event("input", { bubbles : true }));
        select.dispatchEvent(new Event("change", { bubbles : true }));
    }
}

function pickerKeys(event) {
    if (!picking) {
        return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        picking.at = Math.max(0, Math.min(picking.items.length - 1, picking.at + (event.key === "ArrowDown" ? 1 : -1)));
        markPicker();
    } else if (event.key === "Enter") {
        event.preventDefault();
        pickOption();
    } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
    } else if (event.key === "Tab") {
        closePicker();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        // Typing in a short list without its search opens the search.
        const search = /** @type {HTMLInputElement} */ (document.querySelector("#picker input"));
        if (search.hidden) {
            search.hidden = false;
            search.focus();
        }
    }
    event.stopPropagation();
}

document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("picker");
    box.querySelector("input").addEventListener("input", () => renderPicker(true));
    box.addEventListener("keydown", pickerKeys);
    box.addEventListener("mousedown", (event) => {
        const row = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest("[data-pick]"));
        if (row) {
            event.preventDefault();
            pickOption(Number(row.dataset.pick));
        }
    });
    box.addEventListener("mousemove", (event) => {
        const row = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest("[data-pick]"));
        if (row && Number(row.dataset.pick) !== picking?.at) {
            picking.at = Number(row.dataset.pick);
            markPicker();
        }
    });
    enhanceSelects();
});
// A click elsewhere, a scroll outside it or a resize closes it.
document.addEventListener("pointerdown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (picking && !target.closest("#picker") && target !== picking.button) {
        closePicker(false);
    }
}, true);
document.addEventListener("scroll", (event) => {
    if (picking && !/** @type {HTMLElement} */ (event.target).closest?.("#picker")) {
        closePicker(false);
    }
}, true);
window.addEventListener("resize", () => picking && closePicker(false));
