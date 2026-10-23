"use strict";

// The config editor.

/**
 * The parts of a JSON, to be told apart as they are painted: a text, with
 * the colon that makes it a key, a word, a number, or a bracket. Taken from
 * the JSON project (source/json/Syntax.js), which paints its text the same way.
 */
const JSON_PARTS = /("(?:\\.|[^"\\\n])*"?)(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;

/**
 * The JSON with each part in the color of what it is. Whatever is not a part
 * of a JSON is left as it was, so a text that is not one yet -- being typed --
 * is still painted as far as it can be.
 */
function paintJson(text) {
    const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let result = "";
    let last   = 0;

    JSON_PARTS.lastIndex = 0;
    for (let match = JSON_PARTS.exec(text); match; match = JSON_PARTS.exec(text)) {
        result += escape(text.slice(last, match.index));
        last    = match.index + match[0].length;

        const part = match[0];
        if (match[1]) {
            result += match[2]
                ? `<span class="code-key">${escape(match[1])}</span>${match[2]}`
                : `<span class="code-string">${escape(part)}</span>`;
        } else if (part === "true" || part === "false" || part === "null") {
            result += `<span class="code-word">${part}</span>`;
        } else if (part.length > 1 || /\d/.test(part)) {
            result += `<span class="code-number">${part}</span>`;
        } else {
            result += `<span class="code-mark">${part}</span>`;
        }
    }
    return result + escape(text.slice(last));
}


/**
 * The editor of config.json, in a dialog over the page: the file's text with
 * its line numbers, checked as it is typed, so a mistake shows before saving
 * and Save stays off until the JSON reads. ⌘S saves, Esc closes, and Tab
 * indents with 4 spaces, as the file is written.
 */
let configSaved = "";

async function openConfigEditor() {
    const config = await api("/api/config");
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("config-text"));
    configSaved  = config.exists ? config.text : "";
    text.value   = config.text;
    document.getElementById("config-path").textContent = config.exists ? config.file : `${config.file} — new, from the example`;
    updateConfigEditor();
    /** @type {HTMLDialogElement} */ (document.getElementById("config-editor")).showModal();
    text.focus();
    text.setSelectionRange(0, 0);
    text.scrollTop = 0;
}

function closeConfigEditor() {
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("config-text"));
    if (text.value !== configSaved && !confirm("Close without saving the changes?")) {
        return;
    }
    /** @type {HTMLDialogElement} */ (document.getElementById("config-editor")).close();
}

async function saveConfigEditor() {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("config-text"));
    const button = /** @type {HTMLButtonElement} */ (document.getElementById("config-save"));
    if (button.disabled) {
        return;
    }
    button.disabled = true;
    try {
        const result = await api("/api/action", { action : "save-config", text : text.value });
        configSaved = text.value;
        toast(result.message);
        /** @type {HTMLDialogElement} */ (document.getElementById("config-editor")).close();
        await refresh();
    } catch (error) {
        toast(error.message, true);
    } finally {
        updateConfigEditor();
    }
}

/** The line numbers and the colors under the text, and whether it is valid JSON. */
function updateConfigEditor() {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("config-text"));
    const lines  = text.value.split("\n").length;
    const status = document.getElementById("config-status");
    document.getElementById("config-lines").textContent = Array.from({ length : lines }, (_, index) => index + 1).join("\n");
    // A trailing newline keeps the paint as tall as the text when it ends in one.
    document.getElementById("config-paint").innerHTML = `${paintJson(text.value)}\n`;

    let error = "";
    try {
        JSON.parse(text.value);
    } catch (problem) {
        error = problem.message.replace(/^JSON\.parse: /, "");
    }
    const dirty = text.value !== configSaved;
    status.className = `editor-status ${error ? "bad" : dirty ? "dirty" : "ok"}`;
    status.textContent = error ? error : dirty ? "Valid JSON, not saved yet" : "Saved";
    /** @type {HTMLButtonElement} */ (document.getElementById("config-save")).disabled = Boolean(error) || !dirty;
}

(() => {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("config-text"));
    const lines = document.getElementById("config-lines");
    const editor = document.getElementById("config-editor");
    text.addEventListener("input", updateConfigEditor);
    // The text is typed in a transparent area over its painted copy, which
    // follows it as it scrolls, as do the line numbers.
    const paint = document.getElementById("config-paint");
    text.addEventListener("scroll", () => {
        lines.scrollTop = text.scrollTop;
        paint.style.transform = `translate(${-text.scrollLeft}px, ${-text.scrollTop}px)`;
    });
    text.addEventListener("keydown", (event) => {
        if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            text.setRangeText("    ", text.selectionStart, text.selectionEnd, "end");
            updateConfigEditor();
        }
    });
    editor.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            saveConfigEditor();
        }
    });
    // Esc would close the dialog at once; it goes through the same question.
    editor.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeConfigEditor();
    });
})();
