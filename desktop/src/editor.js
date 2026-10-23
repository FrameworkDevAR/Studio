"use strict";

// The file editor: config.json, and PHP's overrides file.

/**
 * The parts of a JSON, to be told apart as they are painted: a text, with
 * the colon that makes it a key, a word, a number, or a bracket. Taken from
 * the JSON project (source/json/Syntax.js), which paints its text the same way.
 */
const JSON_PARTS = /("(?:\\.|[^"\\\n])*"?)(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;

function escapeCode(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The JSON with each part in the color of what it is. Whatever is not a part
 * of a JSON is left as it was, so a text that is not one yet -- being typed --
 * is still painted as far as it can be.
 */
function paintJson(text) {
    let result = "";
    let last   = 0;

    JSON_PARTS.lastIndex = 0;
    for (let match = JSON_PARTS.exec(text); match; match = JSON_PARTS.exec(text)) {
        result += escapeCode(text.slice(last, match.index));
        last    = match.index + match[0].length;

        const part = match[0];
        if (match[1]) {
            result += match[2]
                ? `<span class="code-key">${escapeCode(match[1])}</span>${match[2]}`
                : `<span class="code-string">${escapeCode(part)}</span>`;
        } else if (part === "true" || part === "false" || part === "null") {
            result += `<span class="code-word">${part}</span>`;
        } else if (part.length > 1 || /\d/.test(part)) {
            result += `<span class="code-number">${part}</span>`;
        } else {
            result += `<span class="code-mark">${part}</span>`;
        }
    }
    return result + escapeCode(text.slice(last));
}

/**
 * An ini file painted line by line: a comment, a [section], or a setting --
 * its name, the =, and a value that is a text in quotes, a number with its
 * unit, a word PHP knows (On, Off, E_ALL), or anything else.
 */
function paintIni(text) {
    return text.split("\n").map((line) => {
        if (/^\s*;/.test(line)) {
            return `<span class="code-mark">${escapeCode(line)}</span>`;
        }
        if (/^\s*\[.*\]\s*$/.test(line)) {
            return `<span class="code-word">${escapeCode(line)}</span>`;
        }
        const found = line.match(/^(\s*)([^=;\s][^=;]*?)(\s*=\s*)([^;]*?)(\s*;.*)?$/);
        if (!found) {
            return escapeCode(line);
        }
        const [ , lead, key, equals, value, comment = "" ] = found;
        const kind = /^".*"?$/.test(value) ? "code-string"
            : /^-?\d+[KMGkmg]?$/.test(value) ? "code-number"
            : /^(On|Off|True|False|Yes|No|None|Null)$/i.test(value) || /^[~(!]*E_[A-Z_]+/.test(value) ? "code-word"
            : "";
        return `${lead}<span class="code-key">${escapeCode(key)}</span><span class="code-mark">${escapeCode(equals)}</span>`
            + `${kind ? `<span class="${kind}">${escapeCode(value)}</span>` : escapeCode(value)}`
            + `${comment ? `<span class="code-mark">${escapeCode(comment)}</span>` : ""}`;
    }).join("\n");
}

/**
 * What the editor can open: where it reads the file, how it paints and checks
 * it, and the action that saves it. config.json is checked here as it is
 * typed. The overrides file is checked by PHP, on the server, a moment after
 * the typing stops; a line that is not a setting is caught at once.
 */
const EDITOR_FILES = {
    config : {
        title  : "config.json",
        url    : "/api/config",
        open   : "config",
        paint  : paintJson,
        save   : "save-config",
        check  : (text) => {
            try {
                JSON.parse(text);
                return "";
            } catch (problem) {
                return problem.message.replace(/^JSON\.parse: /, "");
            }
        },
        valid : "Valid JSON",
    },
    php : {
        title  : "PHP overrides",
        url    : "/api/php-overrides",
        open   : "phpIni",
        paint  : paintIni,
        save   : "php-save",
        check  : (text) => {
            const index = text.split("\n").findIndex((line) => line.trim() && !/^\s*(;|\[.*\]\s*$|[\w.]+\s*=)/.test(line));
            return index === -1 ? "" : `Line ${index + 1} is not a setting: write it as name = value, or start it with ; for a note`;
        },
        server : true,
        valid  : "PHP takes it",
    },
};

/**
 * The editor, in a dialog over the page: the file's text with its line
 * numbers, checked as it is typed, so a mistake shows before saving and Save
 * stays off until the file reads. ⌘S saves, Esc closes, and Tab indents
 * with 4 spaces, as the files are written.
 */
let editorKind  = "config";
let editorSaved = "";
let editorCheck = { text : null, problem : "", timer : null };

async function openEditor(kind) {
    editorKind = kind;
    const file = EDITOR_FILES[kind];
    const data = await api(file.url);
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    editorSaved = data.exists ? data.text : "";
    editorCheck = { text : null, problem : "", timer : null };
    text.value  = data.text;
    document.getElementById("editor-title").textContent = file.title;
    document.getElementById("editor-path").textContent  = data.exists ? data.file : `${data.file} — new${kind === "config" ? ", from the example" : ""}`;
    /** @type {HTMLElement} */ (document.querySelector("[data-editor-open]")).dataset.openFile = file.open;
    document.getElementById("editor-insert").hidden = kind !== "php";
    updateEditor();
    /** @type {HTMLDialogElement} */ (document.getElementById("editor")).showModal();
    text.focus();
    text.setSelectionRange(0, 0);
    text.scrollTop = 0;
}

async function closeEditor() {
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    if (text.value !== editorSaved && !await ask({ title : "Close without saving?", text : `The changes to ${EDITOR_FILES[editorKind].title} are lost.`, ok : "Close", danger : true })) {
        return;
    }
    /** @type {HTMLDialogElement} */ (document.getElementById("editor")).close();
}

async function saveEditor() {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const button = /** @type {HTMLButtonElement} */ (document.getElementById("editor-save"));
    if (button.disabled) {
        return;
    }
    button.disabled = true;
    try {
        const result = await api("/api/action", { action : EDITOR_FILES[editorKind].save, text : text.value });
        editorSaved = text.value;
        toast(result.message);
        /** @type {HTMLDialogElement} */ (document.getElementById("editor")).close();
        settingsKey = "";
        await refresh();
    } catch (error) {
        toast(error.message, true);
    } finally {
        updateEditor();
    }
}

/** The line numbers and the colors under the text, and whether it reads. */
function updateEditor() {
    const file   = EDITOR_FILES[editorKind];
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const lines  = text.value.split("\n").length;
    const status = document.getElementById("editor-status");
    document.getElementById("editor-lines").textContent = Array.from({ length : lines }, (_, index) => index + 1).join("\n");
    // A trailing newline keeps the paint as tall as the text when it ends in one.
    document.getElementById("editor-paint").innerHTML = `${file.paint(text.value)}\n`;

    const dirty  = text.value !== editorSaved;
    let   error  = file.check(text.value);
    let   asking = false;
    // PHP is asked about a text that reads, once per text.
    if (!error && file.server && dirty) {
        if (editorCheck.text === text.value) {
            error = editorCheck.problem;
        } else {
            asking = true;
            checkOnServer(text.value);
        }
    }
    status.className   = `editor-status ${error ? "bad" : dirty ? "dirty" : "ok"}`;
    status.textContent = error ? error : asking ? "Checking with PHP…" : dirty ? `${file.valid}, not saved yet` : "Saved";
    /** @type {HTMLButtonElement} */ (document.getElementById("editor-save")).disabled = Boolean(error) || asking || !dirty;
}

function checkOnServer(value) {
    clearTimeout(editorCheck.timer);
    editorCheck.timer = setTimeout(async () => {
        let problem = "";
        try {
            const result = await api("/api/action", { action : "php-check", text : value });
            problem = result.problems[0] || "";
        } catch (error) {
            problem = error.message;
        }
        editorCheck = { text : value, problem, timer : null };
        // Only when the text is still the one asked about.
        if (/** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text")).value === value) {
            updateEditor();
        }
    }, 400);
}

/**
 * Puts a setting picked in the setting dialog on a line of its own, after
 * the line the cursor is on, or replaces its line when the file has it.
 */
async function insertSetting() {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const picked = await pickSetting({ inEditor : true, text : text.value });
    if (!picked) {
        text.focus();
        return;
    }
    const line    = `${picked.key} = ${picked.value}`;
    const pattern = new RegExp(`^[ \\t]*${picked.key.replace(/\./g, "\\.")}[ \\t]*=.*$`, "m");
    const found   = text.value.match(pattern);
    let   start;
    if (found) {
        start = found.index;
        text.setRangeText(line, start, start + found[0].length, "end");
    } else {
        const end = text.value.indexOf("\n", text.selectionEnd);
        start     = end === -1 ? text.value.length : end;
        const gap = start > 0 && text.value[start - 1] !== "\n" || end !== -1 ? "\n" : "";
        text.setRangeText(`${gap}${line}`, start, start, "end");
        start += gap.length;
    }
    text.focus();
    text.setSelectionRange(start + line.length - String(picked.value).length, start + line.length);
    updateEditor();
}

(() => {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const lines  = document.getElementById("editor-lines");
    const editor = document.getElementById("editor");
    text.addEventListener("input", updateEditor);
    // The text is typed in a transparent area over its painted copy, which
    // follows it as it scrolls, as do the line numbers.
    const paint = document.getElementById("editor-paint");
    text.addEventListener("scroll", () => {
        lines.scrollTop = text.scrollTop;
        paint.style.transform = `translate(${-text.scrollLeft}px, ${-text.scrollTop}px)`;
    });
    text.addEventListener("keydown", (event) => {
        if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            text.setRangeText("    ", text.selectionStart, text.selectionEnd, "end");
            updateEditor();
        }
    });
    editor.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            saveEditor();
        }
    });
    // Esc would close the dialog at once; it goes through the same question.
    editor.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeEditor();
    });
})();
