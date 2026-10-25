"use strict";

// The Logs page: loading a log, and reading its lines into entries.

let logKey = "";

/**
 * A request of Apache's requests log: the method and path, the size of the
 * answer, the time it took, and the client when it is not this Mac.
 * @typedef {{ method: string, target: string, size: number, ms: number,
 *     client: string }} StudioLogRequest
 */

/**
 * A log line read into an entry: its time, its level as a tone and a label,
 * its source and message, and for a PHP error its place and stack trace.
 * The count is that of the lines it stands for, once repeats are collapsed.
 * @typedef {{ raw: string, date: Date, time: string, tone: string, label: string,
 *     source: string, message: string, client?: string, referer?: string,
 *     copy?: string, frames?: string[], thrown?: string, location?: string,
 *     count?: number, request?: StudioLogRequest }} StudioLogEntry
 */

/**
 * Loads a log and draws it as entries. Skipped when nothing changed, and the
 * open stack traces are opened again after a redraw, so following a log never
 * snaps a trace shut while it is being read.
 * @param {boolean=} jumpToEnd
 * @returns {Promise<void>}
 */
async function loadLog(jumpToEnd = false) {
    const query  = /** @type {HTMLInputElement} */ (document.getElementById("log-search")).value
        .trim().toLowerCase();
    // A search reaches further back than the 600 lines shown otherwise.
    const log    = await api(`/api/log?name=${logName}&lines=${query ? 2000 : 600}`);
    const errors = isPressed("log-errors");
    const box    = document.getElementById("log");
    const key    = `${logName}|${errors}|${query}|${log.lines.length}|${log.lines.at(-1) || ""}`;
    if (key === logKey && !jumpToEnd) {
        return;
    }

    logKey = key;

    const atEnd   = jumpToEnd || box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    const opened  = new Set([
        .../** @type {NodeListOf<HTMLElement>} */ (box.querySelectorAll("details[open]")),
    ].map((details) => details.dataset.key));
    const entries = collapseRepeats(log.lines.map((line) => parseLogLine(logName, line)))
        .filter((entry) => !errors || entry.tone === "error" || entry.tone === "warn")
        .filter((entry) => !query || entry.raw.toLowerCase().includes(query));

    renderLogMeta();

    let matches = "";
    if (query) {
        matches = `${entries.length} match${entries.length === 1 ? "" : "es"}`;
    }

    document.getElementById("log-matches").textContent = matches;

    if (entries.length) {
        box.innerHTML = renderLogEntries(entries);
    } else {
        let empty = "Nothing here.";
        if (query) {
            empty = `Nothing matches “${esc(query)}”.`;
        } else if (errors) {
            empty = "No errors or warnings.";
        }

        box.innerHTML = `<div class="log-empty">${empty}</div>`;
    }

    for (const details of box.querySelectorAll("details")) {
        details.open = opened.has(details.dataset.key);
    }

    if (query) {
        highlightMatches(box, query);
    }

    if (atEnd) {
        box.scrollTop = box.scrollHeight;
    }
    showLogBottom();
}

/**
 * The Latest button, shown while the log is scrolled up from its end.
 * @returns {void}
 */
function showLogBottom() {
    const box = document.getElementById("log");
    document.getElementById("log-bottom").hidden = box.scrollTop + box.clientHeight
        >= box.scrollHeight - 40;
}

/**
 * Scrolls the log to its end, smoothly.
 * @returns {void}
 */
function scrollLogToBottom() {
    const box = document.getElementById("log");
    box.scrollTo({ top : box.scrollHeight, behavior : "smooth" });
}

/**
 * Marks every match of the search in the drawn log, by wrapping it in its
 * text nodes, so the markup around it stays whole. A stack trace holding a
 * match is opened, or the match would be hidden.
 * @param {HTMLElement} box
 * @param {string} query
 * @returns {void}
 */
function highlightMatches(box, query) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const nodes  = [];

    while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.toLowerCase().includes(query)) {
            nodes.push(/** @type {Text} */ (walker.currentNode));
        }
    }

    for (const node of nodes) {
        const text  = node.nodeValue;
        const lower = text.toLowerCase();
        const parts = document.createDocumentFragment();
        let from = 0;
        for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, from)) {
            parts.append(text.slice(from, at));
            const mark = document.createElement("mark");
            mark.textContent = text.slice(at, at + query.length);
            parts.append(mark);
            from = at + query.length;
        }

        parts.append(text.slice(from));
        node.replaceWith(parts);
    }

    for (const mark of box.querySelectorAll("details mark")) {
        mark.closest("details").open = true;
    }
}

// -------------------------------------------------------------------- logs ---

const MONTHS = {
    Jan : 0,
    Feb : 1,
    Mar : 2,
    Apr : 3,
    May : 4,
    Jun : 5,
    Jul : 6,
    Aug : 7,
    Sep : 8,
    Oct : 9,
    Nov : 10,
    Dec : 11,
};

/** Each log's levels, as a tone for the color and a label for the pill. */
const LEVELS = {
    emerg  : [ "error", "Emerg" ], alert : [ "error", "Alert" ], crit    : [ "error", "Crit" ],
    error  : [ "error", "Error" ], warn  : [ "warn", "Warn" ],   warning : [ "warn", "Warn" ],
    notice : [ "info", "Notice" ], info  : [ "info", "Info" ],   note    : [ "info", "Note" ],
    debug  : [ "info", "Debug" ],
};

/** PHP's own error kinds, which say more than the Apache level around them. */
const PHP_KINDS = {
    "Fatal error"       : [ "error", "Fatal" ],
    "Parse error"       : [ "error", "Parse" ],
    "Recoverable error" : [ "error", "Error" ],
    "Warning"           : [ "warn", "Warning" ],
    "Deprecated"        : [ "notice", "Deprecated" ],
    "Notice"            : [ "notice", "Notice" ],
};

/**
 * What sits under the Logs title: the shown log's file and size, with what
 * its rotated copies take, and a Clear for it.
 * @returns {void}
 */
function renderLogMeta() {
    const sizes = state?.logs;
    const shown = sizes?.[logName];
    const box   = document.getElementById("log-file");
    if (!shown) {
        box.textContent = "";
        return;
    }

    box.innerHTML = `
        ${shown.file ? `<code>${esc(shown.file)}</code>` : "<span>No log file yet.</span>"}
        <i class="sep">·</i>
        <span><b>${bytes(shown.size)}</b>${shown.archived
            ? ` + ${bytes(shown.archived)} rotated` : ""}</span>
        <button class="danger small clear-btn" data-clear-log="${logName}"
            title="Empty this log"><svg viewBox="0 0 24 24"><path
            d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1
            14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Clear</button>
    `;
}

/**
 * Empties a log, after asking, and draws it again.
 * @param {string} name
 * @param {HTMLElement} button
 * @returns {Promise<void>}
 */
async function clearLog(name, button) {
    const log   = state.logs[name];
    const label = {
        apache  : "the Apache + PHP log",
        access  : "the requests log",
        mariadb : "the MariaDB log",
        redis   : "the Redis log",
    }[name];
    const sure  = await ask({
        title  : `Clear ${label}?`,
        text   : `This deletes ${bytes(log.size
            + log.archived)} of history, including its rotated copies.`,
        ok     : "Clear",
        danger : true,
    });
    if (!sure) {
        return;
    }

    await act({ action : "clear-log", name }, button);
    logKey = "";
    loadLog(true);
    loadRecentErrors();
}

/**
 * One log line, taken apart into time, level, source and message, for the
 * three logs there are. A line in no known shape is kept as it is.
 * @param {string} name
 * @param {string} line
 * @returns {StudioLogEntry}
 */
function parseLogLine(name, line) {
    const entry = {
        raw     : line,
        date    : null,
        time    : "",
        tone    : "plain",
        label   : "",
        source  : "",
        message : line,
    };

    // Apache: [Thu Oct 22 13:48:45.562604 2026] [php:error] [pid 6642] [client ::1:50644] message
    const apache = line.match(new RegExp(
        "^\\[\\w{3} (\\w{3}) (\\d+) (\\d\\d:\\d\\d:\\d\\d)[.\\d]* (\\d{4})\\] " +
        "\\[([\\w-]+):(\\w+)\\] \\[pid [^\\]]+\\](?: \\[client ([^\\]]+)\\])? ?(.*)$",
    ));

    // MariaDB: 2026-10-22 16:59:48 0 [Note] message
    const mariadb = line.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d:\d\d) \d+ \[(\w+)\] (.*)$/);

    // MariaDB's start script, in an older shape: 261022 10:24:41 mysqld_safe message
    const safe = line.match(
        /^(\d\d)(\d\d)(\d\d) +(\d?\d:\d\d:\d\d) (mysqld_safe|mariadbd-safe) (.*)$/,
    );

    // Apache's requests: ::1 - - [22/Oct/2026:19:37:04 -0300] "POST /api/x HTTP/1.1" 200 3339
    // site.local:80 238855
    // -- the site and the microseconds were added to the format later, so older lines lack them.
    const request = line.match(new RegExp(
        "^(\\S+) \\S+ \\S+ \\[(\\d+)\\/(\\w{3})\\/(\\d{4}):(\\d\\d:\\d\\d:\\d\\d) [^\\]]+\\] " +
        "\"(\\S+) (\\S+)[^\"]*\" (\\d{3}) (\\S+)(?: (\\S+?):(\\d+) (\\d+))?$",
    ));

    // Redis: 39822:M 10 Aug 2026 15:49:08.350 # message
    const redis = line.match(/^\d+:\w (\d+) (\w{3}) (\d{4}) (\d\d:\d\d:\d\d)\.\d+ ([.*#-]) (.*)$/);

    if (request) {
        const [
            ,
            client,
            day,
            month,
            year,
            time,
            method,
            target,
            status,
            size,
            site,
            port,
            micros
        ] = request;
        const code = Number(status);
        let tone   = "ok";
        if (code >= 500) {
            tone = "error";
        } else if (code >= 400) {
            tone = "warn";
        } else if (code >= 300) {
            tone = "info";
        }

        let source = "";
        if (site) {
            source = port === "80" || port === "443" ? site : `${site}:${port}`;
        }

        Object.assign(entry, {
            date    : new Date(Number(year), MONTHS[month], Number(day)),
            time,
            tone,
            label   : status,
            source,
            message : `${method} ${target}`,
            request : {
                method,
                target,
                size   : size === "-" ? 0 : Number(size),
                ms     : micros ? Number(micros) / 1000 : null,
                client : client === "::1" || client === "127.0.0.1" ? "" : client,
            },
        });
        return entry;
    }

    if (apache) {
        const [ , month, day, time, year, source, level, client, rest ] = apache;
        Object.assign(entry, {
            date   : new Date(Number(year), MONTHS[month], Number(day)),
            time,
            source,
            client : client ? client.replace(/:\d+$/, "") : "",
        }, levelOf(level));

        const referer = rest.match(/^(.*), referer: (\S+)$/);
        entry.message = referer ? referer[1] : rest;
        entry.referer = referer ? referer[2] : "";
        readPhpError(entry);
    } else if (mariadb) {
        const [ , year, month, day, time, level, message ] = mariadb;
        const source = message.match(/^(InnoDB|Aria|mariadbd|Event Scheduler|Plugin '[^']+'): /);
        Object.assign(entry, {
            date    : new Date(Number(year), Number(month) - 1, Number(day)),
            time,
            source  : source ? source[1] : "",
            message : source ? message.slice(source[0].length) : message,
        }, levelOf(level));
    } else if (safe) {
        const [ , year, month, day, time, source, message ] = safe;
        let level = "note";
        if (/error|abort|fail/i.test(message)) {
            level = "error";
        } else if (/already exists/i.test(message)) {
            level = "warning";
        }

        Object.assign(entry, {
            date : new Date(2000 + Number(year), Number(month) - 1, Number(day)),
            time : time.padStart(8, "0"),
            source,
            message,
        }, levelOf(level));
    } else if (redis) {
        const [ , day, month, year, time, mark, message ] = redis;
        const level = { "#" : "warning", "*" : "notice", "-" : "info", "." : "debug" }[mark];
        Object.assign(entry, {
            date : new Date(Number(year), MONTHS[month], Number(day)),
            time,
            message,
        }, levelOf(level));

        if (/fail|error|abort|can't/i.test(message)) {
            Object.assign(entry, levelOf("error"));
        }
    }

    return entry;
}

/**
 * A level as a log writes it, as a tone and a label; an unknown one is info.
 * @param {string} level
 * @returns {{ tone: string, label: string }}
 */
function levelOf(level) {
    const [ tone, label ] = LEVELS[String(level).toLowerCase()] || [ "info", level ];
    return { tone, label };
}

/**
 * A PHP error inside an Apache line: its kind becomes the level, and its stack
 * trace, which Apache writes on the same line with literal \n, is split into
 * frames. Apache also doubles the backslashes, which are halved back here.
 * @param {StudioLogEntry} entry
 * @returns {void}
 */
function readPhpError(entry) {
    const found = entry.message.match(/^PHP ([A-Z][a-z]+(?: error)?):\s+(.*)$/);
    if (!found || !PHP_KINDS[found[1]]) {
        return;
    }
    const [ tone, label ] = PHP_KINDS[found[1]];
    const lines = found[2].replace(/\\(.)/g, (_, char) => char === "n" ? "\n" : char).split("\n");

    entry.tone   = tone;
    entry.label  = label;
    entry.copy   = entry.raw.replace(found[2], lines.join("\n"));
    entry.frames = lines.filter((line) => /^#\d+ /.test(line));
    entry.thrown = lines.find((line) => /^\s*thrown in /.test(line))?.trim() || "";

    // "Uncaught Error: X not found in /path/File.php:57": the place goes on its own line.
    const place = lines[0].match(/^(.*?) in (\/\S+?)(?::(\d+)| on line (\d+))$/);
    entry.message  = place ? place[1] : lines[0];
    entry.location = place ? `${place[2]}:${place[3] || place[4]}` : "";
}

/**
 * Lines repeating the one before, but for time and client, become one with a count.
 * @param {StudioLogEntry[]} entries
 * @returns {StudioLogEntry[]}
 */
function collapseRepeats(entries) {
    const result = [];

    for (const entry of entries) {
        const previous = result.at(-1);
        if (previous
            && previous.message === entry.message
            && previous.label === entry.label
            && previous.source === entry.source
            && previous.location === entry.location) {
            previous.count = (previous.count || 1) + 1;
            previous.time  = entry.time;
            continue;
        }

        result.push(entry);
    }

    return result;
}

/**
 * The entries, with a divider whenever the day changes.
 * @param {StudioLogEntry[]} entries
 * @returns {string}
 */
function renderLogEntries(entries) {
    let day = "";
    return entries.map((entry, index) => {
        let divider = "";
        const today = entry.date ? entry.date.toLocaleDateString(undefined, {
            weekday : "short",
            month   : "short",
            day     : "numeric",
            year    : "numeric",
        }) : "";

        if (today && today !== day) {
            divider = `<div class="log-day"><span>${esc(today)}</span></div>`;
            day = today;
        }

        return divider + renderLogEntry(entry, index);
    }).join("");
}

/**
 * A request, on one line: its status as the pill, the method and path, and
 * at the end the site that answered, the size and the time it took.
 * @param {StudioLogEntry} entry
 * @returns {string}
 */
function renderRequest(entry) {
    const { method, target, size, ms, client } = entry.request;
    let timing = "";
    if (ms !== null) {
        let speed = "";
        if (ms >= 1000) {
            speed = "slow";
        } else if (ms >= 300) {
            speed = "slowish";
        }

        timing = `<span class="${speed}">${ms
            >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`}</span>`;
    }

    const meta = [
        entry.source ? esc(entry.source) : "",
        client ? `from ${esc(client)}` : "",
        size ? bytes(size) : "",
        timing,
    ].filter(Boolean).join(`<i class="sep">·</i>`);

    return `
        <div class="entry request tone-${entry.tone}">
            ${copyButton(entry)}
            <time>${esc(entry.time)}</time>
            <span class="lvl">${esc(entry.label)}</span>
            <div class="req-line">
                <span class="method m-${esc(method.toLowerCase())}">${esc(method)}</span>
                <span class="req-path" title="${esc(target)}">${formatLogText(target)}</span>
                ${entry.count ? `<span class="count">×${entry.count}</span>` : ""}
                <span class="req-meta">${meta}</span>
            </div>
        </div>
    `;
}

const COPY_ICONS = {
    copy : `<rect x="9" y="9" width="12" height="12" rx="2"/><path
        d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>`,
    done : `<path d="M5 12.5l4.5 4.5L19 7"/>`,
};

/**
 * The button that copies an entry: its line as written, a PHP trace on lines of its own.
 * @param {StudioLogEntry} entry
 * @returns {string}
 */
function copyButton(entry) {
    return `
        <button class="icon-btn copy" title="Copy" aria-label="Copy"
            data-copy="${esc(entry.copy || entry.raw)}">
            <svg viewBox="0 0 24 24">${COPY_ICONS.copy}</svg>
        </button>
    `;
}

/**
 * Puts an entry on the clipboard, and shows a tick on its button for a moment.
 * @param {HTMLElement} button
 * @returns {Promise<void>}
 */
async function copyLogEntry(button) {
    try {
        await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
        toast("Could not copy", true);
        return;
    }

    button.classList.add("done");
    button.querySelector("svg").innerHTML = COPY_ICONS.done;
    clearTimeout(Number(button.dataset.timer));
    button.dataset.timer = String(setTimeout(() => {
        button.classList.remove("done");
        button.querySelector("svg").innerHTML = COPY_ICONS.copy;
    }, 1500));
}

/**
 * One entry: its time, level and message, with where it happened, who asked
 * and from where, and a PHP error's stack trace to open. A request has its own
 * line, and a line in no known shape shows as it is.
 * @param {StudioLogEntry} entry
 * @param {number} index
 * @returns {string}
 */
function renderLogEntry(entry, index) {
    if (entry.request) {
        return renderRequest(entry);
    }
    if (entry.tone === "plain" && !entry.time) {
        return `<div class="entry plain">${copyButton(entry)}<div class="entry-body"><div
            class="msg">${formatLogText(entry.message)}</div></div></div>`;
    }

    const meta = [
        entry.location ? `<span class="where">${formatLogText(entry.location)}</span>` : "",
        entry.client   ? `<span>from ${esc(entry.client)}</span>` : "",
        entry.referer  ? `<span>via ${esc(entry.referer.replace(/^https?:\/\//, ""))}</span>` : "",
    ].filter(Boolean).join(`<i class="sep">·</i>`);

    let trace = "";
    if (entry.frames?.length) {
        trace = `
            <details data-key="${esc(`${index}|${entry.raw.slice(0, 120)}`)}">
                <summary>Stack trace · ${entry.frames.length}
                    frame${entry.frames.length > 1 ? "s" : ""}</summary>
                <ol class="frames">
                    ${entry.frames.map((frame) => {
                        const [ , number, rest ] = frame.match(/^#(\d+) (.*)$/);
                        return `<li><span
                            class="frame-n">#${number}</span><span>${
                                formatLogText(rest)}</span></li>`;
                    }).join("")}
                </ol>
                ${entry.thrown ? `<div class="thrown">${formatLogText(entry.thrown)}</div>` : ""}
            </details>
        `;
    }

    return `
        <div class="entry tone-${entry.tone}">
            ${copyButton(entry)}
            <time>${esc(entry.time)}</time>
            <span class="lvl">${esc(entry.label)}</span>
            <div class="entry-body">
                <div class="msg">${entry.source ? `<span class="src">${esc(entry.source)}</span>`
                    : ""}${formatLogText(entry.message)}${entry.count
                    ? `<span class="count">×${entry.count}</span>` : ""}</div>
                ${meta ? `<div class="meta">${meta}</div>` : ""}
                ${trace}
            </div>
        </div>
    `;
}

/**
 * Escapes a message and marks what is worth finding in it: file paths, cut to
 * the home folder with the file name and line standing out, quoted names, and
 * Apache's AH codes.
 * @param {string} text
 * @returns {string}
 */
function formatLogText(text) {
    return esc(text)
        .replace(/^(AH\d{5}):\s*/, `<span class="code">$1</span>`)
        .replace(new RegExp(
            "(\\/(?:Users|opt|private|tmp|Applications)\\/[^\\s&()'\",]+?)([^\\/\\s&()'\",]+)" +
            "(?:(:)(\\d+)|\\((\\d+)\\)|( on line )(\\d+))?(?=$|[\\s,)&;:])", "g"),
            (_, dir, file, colon, line1, line2, onLine, line3) => {
                const line = line1 || line2 || line3;
                return `<span class="path">${shortPath(dir)}<b>${file}</b>${line
                    ? `<span class="line">:${line}</span>` : ""}</span>`;
            })
        .replace(/&quot;(.+?)&quot;/g, `<span class="quoted">$1</span>`);
}
