"use strict";

// The file editor: config.json, PHP's overrides file, and Apache's httpd.conf and vhosts.

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
 * An ini file painted line by line: a comment, a [section] or a cnf file's
 * !include, or a setting -- its name, the =, and a value that is a text in
 * quotes, a number with its unit, a word PHP or MariaDB knows (On, Off,
 * E_ALL), or anything else.
 */
function paintIni(text) {
    return text.split("\n").map((line) => {
        if (/^\s*[;#]/.test(line)) {
            return `<span class="code-mark">${escapeCode(line)}</span>`;
        }
        if (/^\s*\[.*\]\s*$/.test(line) || /^\s*!include/.test(line)) {
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
 * An Apache config file painted line by line: a comment, a <Section> tag, or
 * a directive -- its name, then its arguments, each a text in quotes, a
 * number, a word Apache knows (On, Off, All, None), or anything else.
 */
function paintApache(text) {
    const paintArgs = (args) => args.replace(/("(?:\\.|[^"\\])*"?)|(\S+)/g, (part, quoted, word) => {
        if (quoted) {
            return `<span class="code-string">${escapeCode(part)}</span>`;
        }
        if (/^-?\d+(\.\d+)?[KMG]?$/i.test(word)) {
            return `<span class="code-number">${escapeCode(part)}</span>`;
        }
        if (/^(On|Off|All|None|granted|denied)$/i.test(word)) {
            return `<span class="code-word">${escapeCode(part)}</span>`;
        }
        return escapeCode(part);
    });
    return text.split("\n").map((line) => {
        if (/^\s*#/.test(line)) {
            return `<span class="code-mark">${escapeCode(line)}</span>`;
        }
        const section = line.match(/^(\s*)(<\/?)([\w.:-]+)([^>]*)(>?)(.*)$/);
        if (section) {
            const [ , lead, open, name, args, close, rest ] = section;
            return `${lead}<span class="code-mark">${escapeCode(open)}</span><span class="code-word">${escapeCode(name)}</span>`
                + `${paintArgs(args)}<span class="code-mark">${escapeCode(close)}</span>${escapeCode(rest)}`;
        }
        const directive = line.match(/^(\s*)([A-Za-z]\w*)(\s*)(.*)$/);
        if (!directive) {
            return escapeCode(line);
        }
        const [ , lead, name, gap, args ] = directive;
        return `${lead}<span class="code-key">${escapeCode(name)}</span>${gap}${paintArgs(args)}`;
    }).join("\n");
}

/**
 * HTML or XML painted: a comment, and a tag -- its name, its attributes'
 * names, and their values in quotes. The text between tags is left as it is.
 */
function paintMarkup(text) {
    let result = "";
    let last   = 0;
    for (const match of text.matchAll(/<!--[\s\S]*?(?:-->|$)|<[/?!]?[A-Za-z][\w:.-]*[^<>]*>?/g)) {
        result += escapeCode(text.slice(last, match.index));
        last    = match.index + match[0].length;

        const part = match[0];
        if (part.startsWith("<!--")) {
            result += `<span class="code-mark">${escapeCode(part)}</span>`;
            continue;
        }
        const [ , open, name, rest ] = part.match(/^(<[/?!]?)([^\s<>/?]+)([\s\S]*)$/);
        const close = rest.match(/[/?]?>$/)?.[0] || "";
        const attrs = rest.slice(0, rest.length - close.length).replace(/("[^"]*"?|'[^']*'?)|([^\s="']+)|[\s\S]/g, (all, quoted, word) => (quoted
            ? `<span class="code-string">${escapeCode(all)}</span>`
            : word ? `<span class="code-key">${escapeCode(all)}</span>` : escapeCode(all)));
        result += `<span class="code-mark">${escapeCode(open)}</span><span class="code-word">${escapeCode(name)}</span>${attrs}<span class="code-mark">${escapeCode(close)}</span>`;
    }
    return result + escapeCode(text.slice(last));
}

/**
 * A text with its line numbers and its painted copy, as the editor's, in a
 * box made as its body is: they follow the text as it is typed and
 * scrolled, Tab indents, and Enter keeps the line's indent. For a value
 * changed in a dialog.
 */
function codeArea(box, paint, indent = "    ") {
    const text   = box.querySelector("textarea");
    const lines  = box.querySelector(".editor-lines");
    const shown  = /** @type {HTMLElement} */ (box.querySelector(".editor-paint"));
    const update = () => {
        // A trailing newline keeps the paint as tall as the text when it ends in one.
        shown.innerHTML   = `${paint(text.value)}\n`;
        lines.textContent = Array.from({ length : text.value.split("\n").length }, (_, index) => index + 1).join("\n");
    };
    // As typing would, so ⌘Z undoes it.
    const put = (value) => {
        if (!document.execCommand("insertText", false, value)) {
            text.setRangeText(value, text.selectionStart, text.selectionEnd, "end");
        }
        update();
    };
    text.addEventListener("input", update);
    text.addEventListener("scroll", () => {
        lines.scrollTop       = text.scrollTop;
        shown.style.transform = `translate(${-text.scrollLeft}px, ${-text.scrollTop}px)`;
    });
    text.addEventListener("keydown", (event) => {
        if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            put(indent);
        } else if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.isComposing) {
            event.preventDefault();
            const start = text.value.lastIndexOf("\n", text.selectionStart - 1) + 1;
            put(`\n${text.value.slice(start, text.selectionStart).match(/^[ \t]*/)[0]}`);
        }
    });
    update();
}

/**
 * What the editor can open: where it reads the file, how it paints and checks
 * it, and the action that saves it. config.json is checked here as it is
 * typed. The overrides file is checked by PHP, on the server, a moment after
 * the typing stops; a line that is not a setting is caught at once, and
 * MariaDB's options file the same way, by mariadbd. Apache's files are
 * checked by httpd, on a copy of its config with the text in place.
 */
const EDITOR_FILES = {
    config : {
        title  : "config.json",
        url    : "/api/config",
        open   : "config",
        paint  : paintJson,
        lang   : "json",
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
        lang   : "ini",
        mark   : ";",
        save   : "php-save",
        check  : (text) => {
            const index = text.split("\n").findIndex((line) => line.trim() && !/^\s*(;|\[.*\]\s*$|[\w.]+\s*=)/.test(line));
            return index === -1 ? "" : `Line ${index + 1} is not a setting: write it as name = value, or start it with ; for a note`;
        },
        server : "php-check",
        who    : "PHP",
        valid  : "PHP takes it",
    },
    mariadb : {
        title  : "MariaDB options",
        url    : "/api/mariadb-file",
        open   : "mysqlCnf",
        paint  : paintIni,
        lang   : "ini",
        mark   : "#",
        save   : "mariadb-save",
        check  : (text) => {
            const index = text.split("\n").findIndex((line) => line.trim() && !/^\s*([#;]|\[.*\]\s*$|!include|[A-Za-z][\w.-]*\s*(=|$))/.test(line));
            return index === -1 ? "" : `Line ${index + 1} is not an option: write it as name = value, or start it with # for a note`;
        },
        server : "mariadb-check",
        who    : "MariaDB",
        valid  : "MariaDB takes it",
    },
    httpd : {
        title  : "httpd.conf",
        url    : "/api/apache-file?kind=httpd",
        open   : "httpdConf",
        paint  : paintApache,
        lang   : "apache",
        mark   : "#",
        save   : "apache-save",
        check  : () => "",
        server : "apache-check",
        who    : "Apache",
        body   : { kind : "httpd" },
        valid  : "Apache takes it",
    },
    vhosts : {
        title  : "Virtual hosts",
        url    : "/api/apache-file?kind=vhosts",
        open   : "vhosts",
        paint  : paintApache,
        lang   : "apache",
        mark   : "#",
        save   : "apache-save",
        check  : () => "",
        server : "apache-check",
        who    : "Apache",
        body   : { kind : "vhosts" },
        valid  : "Apache takes it",
    },
};

/**
 * The editor, in a dialog over the page: the file's text with its line
 * numbers, checked as it is typed, so a mistake shows before saving and Save
 * stays off until the file reads. ⌘S saves, Esc closes, and Tab indents
 * with 4 spaces, as the files are written. ⌘/ comments the lines out or back
 * in, ⌘F finds, and Enter keeps the line's indent. A problem's line is marked
 * in red, and clicking the problem goes to it.
 */
let editorKind  = "config";
let editorSaved = "";
// Whether the text was changed since it opened, so the status says nothing until it is.
let editorEdited = false;
let editorCheck = { text : null, problem : "", timer : null };
let editorFile  = "";

async function openEditor(kind) {
    editorKind = kind;
    const file = EDITOR_FILES[kind];
    const open = /** @type {HTMLElement} */ (document.querySelector("[data-editor-open]"));
    const data = await api(file.url);
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    editorSaved  = data.exists ? data.text : "";
    editorEdited = false;
    editorCheck = { text : null, problem : "", timer : null };
    editorFile  = data.file;
    text.value  = data.text;
    closeFind(false);
    document.getElementById("editor-title").textContent = file.title;
    document.getElementById("editor-path").textContent  = data.exists ? data.file : `${data.file} — new${kind === "config" ? ", from the example" : ""}`;
    open.dataset.openFile = file.open;
    open.dataset.openPath = file.body?.file || "";
    document.getElementById("editor-insert").hidden      = kind !== "php" && kind !== "mariadb";
    document.getElementById("editor-insert").textContent = kind === "mariadb" ? "Insert option" : "Insert setting";
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
        const result = await api("/api/action", { action : EDITOR_FILES[editorKind].save, text : text.value, ...EDITOR_FILES[editorKind].body });
        editorSaved = text.value;
        toast(result.message);
        /** @type {HTMLDialogElement} */ (document.getElementById("editor")).close();
        settingsKeys = {};
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
    // A trailing newline keeps the paint as tall as the text when it ends in one.
    document.getElementById("editor-paint").innerHTML = `${file.paint(text.value)}\n`;

    const dirty  = text.value !== editorSaved;
    editorEdited = editorEdited || dirty;
    let   error  = file.check(text.value);
    let   asking = false;
    // PHP or Apache is asked about a text that reads, once per text.
    if (!error && file.server && dirty) {
        if (editorCheck.text === text.value) {
            error = editorCheck.problem;
        } else {
            asking = true;
            checkOnServer(text.value);
        }
    }
    // The line the problem is on, when it is in this file, numbered in red.
    const bad = problemLine(error, text.value);
    document.getElementById("editor-lines").innerHTML = Array.from({ length : lines }, (_, index) => (index + 1 === bad ? `<span class="bad">${index + 1}</span>` : index + 1)).join("\n");
    if (bad) {
        status.dataset.line = String(bad);
        status.title        = `Go to line ${bad}`;
    } else {
        delete status.dataset.line;
        status.title = "";
    }
    renderMarks();
    status.className   = `editor-status ${error ? "bad" : dirty ? "dirty" : ""}`;
    status.textContent = error ? error : asking ? `Checking with ${file.who}…` : dirty ? `${file.valid}, not saved yet` : editorEdited ? "No changes" : "";
    /** @type {HTMLButtonElement} */ (document.getElementById("editor-save")).disabled = Boolean(error) || asking || !dirty;
}

function checkOnServer(value) {
    const file = EDITOR_FILES[editorKind];
    clearTimeout(editorCheck.timer);
    editorCheck.timer = setTimeout(async () => {
        let problem = "";
        try {
            const result = await api("/api/action", { action : file.server, text : value, ...file.body });
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
 * The line a problem names -- "line 12", or a JSON's "position 140" -- when
 * it is about this file: one naming another, an included .conf say, is not.
 */
function problemLine(problem, value) {
    if (!problem) {
        return 0;
    }
    const named = problem.match(/\b(?:of|in)\s+(\S+\.(?:conf|ini|json))\b/);
    if (named && named[1].split("/").pop() !== editorFile.split("/").pop()) {
        return 0;
    }
    const line = problem.match(/\bline (\d+)/i);
    if (line) {
        return Number(line[1]);
    }
    const position = problem.match(/\bposition (\d+)/i);
    return position ? value.slice(0, Number(position[1])).split("\n").length : 0;
}

/** Selects a line of the text and scrolls to it, as a problem's link does. */
function goToLine(line) {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const lines = text.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((sum, one) => sum + one.length + 1, 0);
    text.focus();
    text.setSelectionRange(start, start + (lines[line - 1] || "").length);
    reveal(start);
}

/** Scrolls the text so a place in it shows, a third of the way down. */
function reveal(offset) {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const style  = getComputedStyle(text);
    const height = parseFloat(style.lineHeight);
    const before = text.value.slice(0, offset).split("\n");
    const top    = (before.length - 1) * height;
    if (top < text.scrollTop || top > text.scrollTop + text.clientHeight - height * 2) {
        text.scrollTop = Math.max(0, top - text.clientHeight / 3);
    }
    const canvas = /** @type {any} */ (reveal).canvas || (/** @type {any} */ (reveal).canvas = document.createElement("canvas"));
    const pen    = canvas.getContext("2d");
    pen.font     = `${style.fontSize} ${style.fontFamily}`;
    const left   = pen.measureText(before[before.length - 1]).width;
    if (left < text.scrollLeft || left > text.scrollLeft + text.clientWidth - 80) {
        text.scrollLeft = Math.max(0, left - text.clientWidth / 2);
    }
}

/**
 * Puts text in place of a part of the editor's, as typing would, so ⌘Z
 * undoes it, then selects from start to end of what was put.
 */
function replaceText(from, to, value, select = [ from + value.length, from + value.length ]) {
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    text.focus();
    text.setSelectionRange(from, to);
    if (!document.execCommand("insertText", false, value)) {
        text.setRangeText(value, from, to, "end");
    }
    text.setSelectionRange(select[0], select[1]);
    updateEditor();
}

/**
 * ⌘/: comments out the selected lines, or the caret's, with the file's mark,
 * # or ;, or comments them back in when all of them already are. JSON has
 * no comments.
 */
function toggleComment() {
    const mark = EDITOR_FILES[editorKind].mark;
    const text = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    if (!mark) {
        return;
    }
    const value = text.value;
    const from  = value.lastIndexOf("\n", text.selectionStart - 1) + 1;
    // A selection ending at a line's start leaves that line out.
    const last  = text.selectionEnd > text.selectionStart && value[text.selectionEnd - 1] === "\n" ? text.selectionEnd - 1 : text.selectionEnd;
    const found = value.indexOf("\n", last);
    const to    = found === -1 ? value.length : found;
    const lines = value.slice(from, to).split("\n");
    const out   = lines.every((line) => !line.trim() || line.trimStart().startsWith(mark));
    const next  = lines.map((line) => (!line.trim() ? line
        : out ? line.replace(new RegExp(`^(\\s*)\\${mark} ?`), "$1")
            : line.replace(/^(\s*)/, `$1${mark}`))).join("\n");
    const single = lines.length === 1 && text.selectionStart === text.selectionEnd;
    const caret  = Math.max(from, text.selectionStart + next.length - (to - from));
    replaceText(from, to, next, single ? [ caret, caret ] : [ from, from + next.length ]);
}

/**
 * Enter: the new line starts at the indent of the caret's line. After an
 * Apache <Section> it is indented one more, with the section closed under
 * it unless it already is; after a JSON { or [ the same, its closing moved
 * down when it was right after the caret.
 */
function newLine() {
    const file   = EDITOR_FILES[editorKind];
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const value  = text.value;
    const caret  = text.selectionStart;
    const start  = value.lastIndexOf("\n", caret - 1) + 1;
    const before = value.slice(start, caret);
    const indent = before.match(/^[ \t]*/)[0];
    const inner  = `${indent}    `;
    const end    = value.indexOf("\n", caret);
    const rest   = value.slice(caret, end === -1 ? value.length : end);

    const section = file.lang === "apache" && !rest.trim() && before.trim().match(/^<([A-Za-z][\w.:-]*)\b[^>]*>$/);
    if (section) {
        const close = `</${section[1]}>`;
        const after = value.slice(end === -1 ? value.length : end + 1).split("\n").find((line) => line.trim());
        if (after?.trim().toLowerCase() === close.toLowerCase() && after.match(/^[ \t]*/)[0] === indent) {
            return replaceText(caret, text.selectionEnd, `\n${inner}`);
        }
        return replaceText(caret, text.selectionEnd, `\n${inner}\n${indent}${close}`, [ caret + inner.length + 1, caret + inner.length + 1 ]);
    }
    const opens = file.lang === "json" && /[{[]\s*$/.test(before);
    if (opens) {
        const closing = /^\s*[}\]]/.test(rest);
        return replaceText(caret, text.selectionEnd, closing ? `\n${inner}\n${indent}` : `\n${inner}`, [ caret + inner.length + 1, caret + inner.length + 1 ]);
    }
    return replaceText(caret, text.selectionEnd, `\n${indent}`);
}

// --------------------------------------------------------------------- find ---

/**
 * The find bar: the matches of what is typed, any case, marked under the
 * text; Enter goes to the next, Shift+Enter to the one before, and Esc
 * closes it, leaving the match selected.
 */
let findState = { matches : [], index : -1 };

function openFind() {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const bar   = document.getElementById("editor-find");
    const input = /** @type {HTMLInputElement} */ (document.getElementById("editor-find-text"));
    const picked = text.value.slice(text.selectionStart, text.selectionEnd);
    if (picked && !picked.includes("\n")) {
        input.value = picked;
    }
    bar.hidden = false;
    input.focus();
    input.select();
    searchText(text.selectionStart);
}

function closeFind(focus = true) {
    document.getElementById("editor-find").hidden = true;
    findState = { matches : [], index : -1 };
    renderMarks();
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    if (focus) {
        text.focus();
    }
}

/** Finds every match, and goes to the first from a place in the text. */
function searchText(from = 0) {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const needle = /** @type {HTMLInputElement} */ (document.getElementById("editor-find-text")).value.toLowerCase();
    const hay    = text.value.toLowerCase();
    findState.matches = [];
    for (let at = needle ? hay.indexOf(needle) : -1; at !== -1; at = hay.indexOf(needle, at + needle.length)) {
        findState.matches.push([ at, at + needle.length ]);
    }
    findState.index = findState.matches.length ? Math.max(0, findState.matches.findIndex(([ at ]) => at >= from)) : -1;
    showMatch();
}

function stepFind(step) {
    if (findState.matches.length) {
        findState.index = (findState.index + step + findState.matches.length) % findState.matches.length;
        showMatch();
    }
}

function showMatch() {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const input = /** @type {HTMLInputElement} */ (document.getElementById("editor-find-text"));
    document.getElementById("editor-find-count").textContent = !input.value ? "" : findState.matches.length ? `${findState.index + 1} of ${findState.matches.length}` : "No matches";
    const match = findState.matches[findState.index];
    if (match) {
        text.setSelectionRange(match[0], match[1]);
        reveal(match[0]);
    }
    renderMarks();
}

/** The matches marked in a copy of the text under the paint. */
function renderMarks() {
    const text  = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const marks = document.getElementById("editor-marks");
    if (document.getElementById("editor-find").hidden || !findState.matches.length) {
        marks.innerHTML = "";
        return;
    }
    let html = "";
    let last = 0;
    findState.matches.forEach(([ from, to ], index) => {
        html += `${escapeCode(text.value.slice(last, from))}<mark class="${index === findState.index ? "current" : ""}">${escapeCode(text.value.slice(from, to))}</mark>`;
        last  = to;
    });
    marks.innerHTML = `${html}${escapeCode(text.value.slice(last))}\n`;
}

/** Opens a config file httpd.conf includes, by its path. */
function openApacheConfig(path) {
    EDITOR_FILES.include = {
        ...EDITOR_FILES.httpd,
        title : path.split("/").pop(),
        url   : `/api/apache-file?kind=include&file=${encodeURIComponent(path)}`,
        open  : "apacheInclude",
        body  : { kind : "include", file : path },
    };
    return openEditor("include");
}

/**
 * Puts a setting picked in the setting dialog on a line of its own, after
 * the line the cursor is on, or replaces its line when the file has it.
 */
async function insertSetting() {
    const text   = /** @type {HTMLTextAreaElement} */ (document.getElementById("editor-text"));
    const picked = await pickSetting({ inEditor : true, text : text.value, scope : editorKind === "mariadb" ? "mariadb" : "php" });
    if (!picked) {
        text.focus();
        return;
    }
    const line    = `${picked.key} = ${picked.value}`;
    // MariaDB reads innodb-buffer-pool-size as innodb_buffer_pool_size, so either is its line.
    const name    = picked.key.replace(/\./g, "\\.").replace(/[_-]/g, "[_-]");
    const pattern = new RegExp(`^[ \\t]*${name}[ \\t]*(=.*)?$`, "m");
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
    const marks = document.getElementById("editor-marks");
    text.addEventListener("scroll", () => {
        lines.scrollTop = text.scrollTop;
        paint.style.transform = `translate(${-text.scrollLeft}px, ${-text.scrollTop}px)`;
        marks.style.transform = paint.style.transform;
    });
    text.addEventListener("keydown", (event) => {
        const command = event.metaKey || event.ctrlKey;
        if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            replaceText(text.selectionStart, text.selectionEnd, "    ");
        } else if (command && event.key === "/") {
            event.preventDefault();
            toggleComment();
        } else if (event.key === "Enter" && !command && !event.shiftKey && !event.altKey && !event.isComposing) {
            event.preventDefault();
            newLine();
        }
    });
    editor.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            saveEditor();
        } else if ((event.metaKey || event.ctrlKey) && event.key === "f") {
            event.preventDefault();
            openFind();
        }
    });
    // The find bar: typing finds, Enter steps, Esc closes it and not the dialog.
    const findText = /** @type {HTMLInputElement} */ (document.getElementById("editor-find-text"));
    findText.addEventListener("input", () => searchText(findState.matches[findState.index]?.[0] || 0));
    findText.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            stepFind(event.shiftKey ? -1 : 1);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeFind();
        }
    });
    document.getElementById("editor-find").addEventListener("click", (event) => {
        const button = /** @type {HTMLElement} */ (event.target).closest("button");
        if (button?.dataset.findStep) {
            stepFind(Number(button.dataset.findStep));
        } else if (button?.dataset.findClose !== undefined) {
            closeFind();
        }
    });
    // A problem naming a line goes to it.
    document.getElementById("editor-status").addEventListener("click", (event) => {
        const line = Number(/** @type {HTMLElement} */ (event.currentTarget).dataset.line);
        if (line) {
            goToLine(line);
        }
    });
    // Esc would close the dialog at once; it goes through the same question.
    editor.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeEditor();
    });
})();
