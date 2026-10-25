"use strict";

// Code painted as it is typed: JSON, PHP's ini, Apache's config and HTML; and a text box
// with line numbers that paints its text under it.

/**
 * The parts of a JSON, to be told apart as they are painted: a text, with
 * the colon that makes it a key, a word, a number, or a bracket. Taken from
 * the JSON project (source/json/Syntax.js), which paints its text the same way.
 */
const JSON_PARTS = new RegExp(
    /("(?:\\.|[^"\\\n])*"?)(\s*:)?|\b(?:true|false|null)\b/.source +
    /|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/.source,
    "g",
);

/**
 * A text made safe to put in HTML: its &, < and > as entities.
 * @param {string} value
 * @returns {string}
 */
function escapeCode(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The JSON with each part in the color of what it is. Whatever is not a part
 * of a JSON is left as it was, so a text that is not one yet -- being typed --
 * is still painted as far as it can be.
 * @param {string} text
 * @returns {string}
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
 * @param {string} text
 * @returns {string}
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
            : /^(On|Off|True|False|Yes|No|None|Null)$/i.test(value)
                || /^[~(!]*E_[A-Z_]+/.test(value) ? "code-word"
            : "";
        return `${lead}<span class="code-key">${escapeCode(key)}</span><span
            class="code-mark">${escapeCode(equals)}</span>`
            + `${kind ? `<span class="${kind}">${escapeCode(value)}</span>` : escapeCode(value)}`
            + `${comment ? `<span class="code-mark">${escapeCode(comment)}</span>` : ""}`;
    }).join("\n");
}

/**
 * An Apache config file painted line by line: a comment, a <Section> tag, or
 * a directive -- its name, then its arguments, each a text in quotes, a
 * number, a word Apache knows (On, Off, All, None), or anything else.
 * @param {string} text
 * @returns {string}
 */
function paintApache(text) {
    const paintArgs = (args) => args
        .replace(/("(?:\\.|[^"\\])*"?)|(\S+)/g, (part, quoted, word) => {
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
            return `${lead}<span class="code-mark">${escapeCode(open)}</span><span
                class="code-word">${escapeCode(name)}</span>`
                + `${paintArgs(args)}<span
                    class="code-mark">${escapeCode(close)}</span>${escapeCode(rest)}`;
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
 * @param {string} text
 * @returns {string}
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
        const attrs = rest.slice(0, rest.length - close.length)
            .replace(/("[^"]*"?|'[^']*'?)|([^\s="']+)|[\s\S]/g, (all, quoted, word) => (quoted
                ? `<span class="code-string">${escapeCode(all)}</span>`
                : word ? `<span class="code-key">${escapeCode(all)}</span>` : escapeCode(all)));
        result += `<span class="code-mark">${escapeCode(open)}</span><span
            class="code-word">${escapeCode(name)}</span>${attrs}<span
            class="code-mark">${escapeCode(close)}</span>`;
    }
    return result + escapeCode(text.slice(last));
}

/**
 * A text with its line numbers and its painted copy, as the editor's, in a
 * box made as its body is: they follow the text as it is typed and
 * scrolled, Tab indents, and Enter keeps the line's indent. For a value
 * changed in a dialog.
 * @param {HTMLElement} box
 * @param {(text: string) => string} paint
 * @param {string=} indent
 * @returns {void}
 */
function codeArea(box, paint, indent = "    ") {
    const text   = box.querySelector("textarea");
    const lines  = box.querySelector(".editor-lines");
    const shown  = /** @type {HTMLElement} */ (box.querySelector(".editor-paint"));
    const update = () => {
        // A trailing newline keeps the paint as tall as the text when it ends in one.
        shown.innerHTML   = `${paint(text.value)}\n`;
        lines.textContent = Array.from(
            { length : text.value.split("\n").length },
            (_, index) => index + 1,
        ).join("\n");
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
        } else if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey
            && !event.altKey && !event.isComposing) {
            event.preventDefault();
            const start = text.value.lastIndexOf("\n", text.selectionStart - 1) + 1;
            put(`\n${text.value.slice(start, text.selectionStart).match(/^[ \t]*/)[0]}`);
        }
    });
    update();
}
