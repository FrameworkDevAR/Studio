"use strict";

// A database's tables or a table's rows exported, and a dump or a CSV imported.

// ------------------------------------------------------- export and import ---

/**
 * The export, as Sequel Ace's: from the database, the tables picked; from
 * the rows, all of the table's, the ones its filters show, or the ones
 * picked. As SQL, with the structure, the data or both; as CSV, with its
 * separator and a line of column names; or as JSON. What to export is sent
 * first, and the file then comes as a download, so the page stays.
 * @param {{ tables?: string[], rows?: "all" | "filtered" | "picked" }=} start
 * @returns {void}
 */
function openExportDialog({ tables = null, rows = null } = {}) {
    const fromRows = rows !== null && browse.rows;
    const picked   = fromRows ? pickedRows() : [];
    const filtered = fromRows && browse.filters.length > 0;
    const chosen   = tables || browse.tables.map((one) => one.name);
    const choice   = (value, label, on) => `<label class="check"><input type="radio" class="box"
        name="rows" value="${value}" ${on ? "checked" : ""}><span>${label}</span></label>`;
    const formats  = [
        [ "sql", "SQL" ],
        [ "csv", "CSV" ],
        [ "json", "JSON" ],
    ];

    formDialog({
        title  : fromRows ? `Export rows of ${browse.table}` : `Export ${browse.db}`,
        body   : `
            <div class="export-form">
                ${fromRows ? `
                    <div class="form-row"><span>Rows</span><div class="export-choices">
                        ${choice("all", `All the table's rows`, rows === "all"
                            || rows === "filtered" && !filtered
                            || rows === "picked" && !picked.length)}
                        ${filtered ? choice(
                            "filtered",
                            "The rows the filters show, in their order",
                            rows === "filtered",
                        ) : ""}
                        ${picked.length && rowsKeyed() ? choice(
                            "picked",
                            `The ${countOf(picked.length, "row")} picked`,
                            rows === "picked",
                        ) : ""}
                    </div></div>
                ` : `
                    <div class="form-row">
                        <span>Tables <span class="muted" data-export-count></span><span
                            class="export-all"><button type="button" class="link"
                            data-export-all="1">All</button> · <button type="button" class="link"
                            data-export-all="0">None</button></span></span>
                        <input type="search" class="export-filter" data-export-filter
                            placeholder="Filter tables…" spellcheck="false" autocomplete="off">
                        <div class="export-tables-box"><div
                            class="check-list export-tables">${browse.tables.map((one) => `
                            <label class="check"><input type="checkbox" class="box" name="tables"
                                value="${esc(one.name)}" ${chosen.includes(one.name) ? "checked"
                                    : ""}><span>${esc(one.name)}${one.view
                                        ? ` <span class="tag">view</span>` : ""}</span></label>
                        `).join("")}</div></div>
                    </div>
                `}
                <div class="form-row"><span>Format</span><div class="segmented">${formats
                    .map(([ value, label ], at) => `<button
                        type="button" data-export-format="${value}"
                        class="${at ? "" : "active"}">${label}</button>`)
                    .join("")}</div></div>
                <div class="column-checks" data-export-for="sql">
                    <label class="check"><input type="checkbox" class="box" name="structure"
                        ${fromRows ? "" : "checked"}><span>Structure<small>CREATE
                        TABLE${fromRows ? "" : ", views, triggers"}</small></span></label>
                    <label class="check"><input type="checkbox" class="box" name="data" checked
                        ${fromRows ? "disabled"
                            : ""}><span>Data<small>INSERT of the rows</small></span></label>
                </div>
                <div class="form-pair" data-export-for="csv" hidden>
                    <label class="form-row"><span>Separator</span><span
                        class="field select"><select name="separator">
                        <option value=",">Comma ,</option><option
                            value=";">Semicolon ;</option><option value="&#9;">Tab</option>
                    </select></span></label>
                    <label class="check export-header"><input type="checkbox" class="box"
                        name="header" checked><span>Column names first</span></label>
                </div>
                <label class="check" data-export-gzip><input type="checkbox" class="box"
                    name="gzip"><span>Compressed, as .gz<small
                    data-export-gzip-note></small></span></label>
                <p class="editor-status" data-export-note></p>
            </div>
        `,
        ok     : "Export",
        ready  : (fields) => {
            const form   = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const format = () => /** @type {HTMLElement} */ (
                fields.querySelector("[data-export-format].active")
            ).dataset.exportFormat;
            // Only what counts for the format shows; several tables as CSV come as a .zip, a file
            // each.
            const update = () => {
                const kind  = format();
                const boxes = /** @type {HTMLInputElement[]} */ ([
                    ...fields.querySelectorAll("input[name=tables]"),
                ]);
                const some  = boxes.filter((box) => box.checked);
                const views = some.filter(
                    (box) => browse.tables.find((one) => one.name === box.value)?.view,
                ).length;

                for (const pane of /** @type {NodeListOf<HTMLElement>} */ (
                    fields.querySelectorAll("[data-export-for]")
                )) {
                    pane.hidden = pane.dataset.exportFor !== kind;
                }

                const zip = kind === "csv" && some.length - views > 1;
                /** @type {HTMLElement} */ (
                    fields.querySelector("[data-export-gzip]")
                ).hidden = zip;
                fields.querySelector("[data-export-gzip-note]").textContent = kind === "sql"
                    ? "Much smaller; a .sql.gz imports here the same way"
                    : "Much smaller";

                const count = fields.querySelector("[data-export-count]");
                if (count) {
                    count.textContent = `${some.length} of ${boxes.length}`;
                }

                fields.querySelector("[data-export-note]").textContent = [
                    zip ? "Several tables as CSV come as a .zip, a file for each." : "",
                    kind !== "sql" && views
                        ? "Views are left out: they hold no rows of their own." : "",
                ].filter(Boolean).join(" ");
            };

            fields.addEventListener("click", (event) => {
                const button = /** @type {HTMLElement} */ (
                    /** @type {HTMLElement} */ (event.target).closest("button")
                );
                if (button?.dataset.exportFormat) {
                    fields.querySelector("[data-export-format].active").classList.remove("active");
                    button.classList.add("active");
                } else if (button?.dataset.exportAll) {
                    // All and None go by the tables the filter shows.
                    for (const box of /** @type {NodeListOf<HTMLInputElement>} */ (
                        fields.querySelectorAll("input[name=tables]")
                    )) {
                        if (!box.closest("label").hidden) {
                            box.checked = button.dataset.exportAll === "1";
                        }
                    }
                }
                update();
            });
            form.addEventListener("change", update);

            // The list fades at the edges it scrolls past, once the dialog shows and has its size.
            const list = /** @type {HTMLElement} */ (fields.querySelector(".export-tables"));
            if (list) {
                requestAnimationFrame(() => watchFades(list));
            }

            fields.querySelector("[data-export-filter]")?.addEventListener("input", (event) => {
                const search = /** @type {HTMLInputElement} */ (event.target).value
                    .trim()
                    .toLowerCase();

                for (const box of /** @type {NodeListOf<HTMLInputElement>} */ (
                    fields.querySelectorAll("input[name=tables]")
                )) {
                    box.closest("label").hidden = !box.value.toLowerCase().includes(search);
                }

                fadeEdges(fields.querySelector(".export-tables"));
            });

            // Enter in the filter filters, and doesn't export.
            fields.querySelector("[data-export-filter]")?.addEventListener("keydown", (event) => {
                if (/** @type {KeyboardEvent} */ (event).key === "Enter") {
                    event.preventDefault();
                }
            });

            update();
        },
        submit : async (form) => {
            const data = new FormData(form);
            const kind = /** @type {HTMLElement} */ (
                form.querySelector("[data-export-format].active")
            ).dataset.exportFormat;
            const spec = {
                action    : "db-export",
                db        : browse.db,
                format    : kind,
                structure : data.get("structure") === "on",
                data      : fromRows || data.get("data") === "on",
                separator : String(data.get("separator") || ","),
                header    : data.get("header") === "on",
                gzip      : data.get("gzip") === "on",
            };

            if (fromRows) {
                const part = String(data.get("rows"));
                Object.assign(spec, { table : browse.table, sort : browse.sort, dir : browse.dir },
                    part === "filtered"
                        ? { filters : JSON.stringify(browse.filters), match : browse.match }
                        : part === "picked" ? { keys : picked.map(rowKey) } : { filters : "[]" });
            } else {
                spec.tables = data.getAll("tables").map(String);
            }

            const { id } = await api("/api/action", spec);
            window.location.assign(`/api/db-export?id=${encodeURIComponent(id)}`);
            return { message : "Exporting: the file downloads as it is written" };
        },
    });
}

/**
 * Imports a .sql or .sql.gz file into the database: it is sent as it is
 * read, with its progress, and MariaDB runs it as it arrives, stopping at
 * the first statement that fails.
 * @returns {void}
 */
function importDatabase() {
    formDialog({
        title  : `Import into ${browse.db}`,
        text   : "Runs a .sql file, or a .sql.gz, in this database. " +
            "A dump's tables replace the ones of the same name.",
        body   : `
            <label class="file-drop" data-file-drop>
                <input type="file" name="file" accept=".sql,.gz">
                <svg viewBox="0 0 24 24"><path
                    d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path
                    d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/></svg>
                <span class="file-drop-text"><strong>Choose a .sql or .sql.gz
                    file</strong><small>or drop it here</small></span>
            </label>
        `,
        ok     : "Import",
        danger : true,
        ready  : (fields) => setUpFileDrop(/** @type {HTMLElement} */ (
            fields.querySelector("[data-file-drop]")
        )),
        submit : async (form) => {
            const file   = /** @type {HTMLInputElement} */ (
                form.querySelector("[name=file]")
            ).files[0];
            if (!file) {
                throw new Error("Choose the file to import first");
            }

            const status = document.getElementById("form-status");
            const result = await upload(`/api/db-import?${new URLSearchParams({
                db   : browse.db,
                name : file.name,
            })}`, file, (done) => {
                status.textContent = done < 1
                    ? `Sending ${Math.round(done * 100)}% of ${bytes(file.size)}…`
                    : "MariaDB is running it…";
            });

            await loadTables();
            if (browse.tab === "rows") {
                loadRows();
            }

            return result;
        },
    });
}

/**
 * A CSV's text read into rows, as the server reads it: up to as many as asked, quotes and all.
 * An empty field out of quotes is null.
 * @param {string} text
 * @param {string} separator
 * @param {number=} most
 * @returns {string[][]}
 */
function parseCsv(text, separator, most = Infinity) {
    const rows = [];
    let row = [], field = "", quoted = false, inQuotes = false;
    const endField = () => {
        row.push(!quoted && field === "" ? null : field);
        field  = "";
        quoted = false;
    };

    for (let at = 0; at < text.length && rows.length < most; at++) {
        const char = text[at];
        if (inQuotes) {
            if (char !== "\"") {
                field += char;
            } else if (text[at + 1] === "\"") {
                field += "\"";
                at++;
            } else {
                inQuotes = false;
            }
        } else if (char === "\"" && field === "" && !quoted) {
            inQuotes = quoted = true;
        } else if (char === separator) {
            endField();
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[at + 1] === "\n") {
                at++;
            }
            endField();
            if (!(row.length === 1 && row[0] === null)) {
                rows.push(row);
            }
            row = [];
        } else {
            field += char;
        }
    }

    if (rows.length < most && (field !== "" || row.length)) {
        endField();
        rows.push(row);
    }

    return rows;
}

/**
 * The separator a CSV's first line has most of, outside quotes.
 * @param {string} text
 * @returns {string}
 */
function guessSeparator(text) {
    const line   = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0].replace(/"(?:[^"]|"")*"/g, "");
    const counts = [ ",", ";", "\t", "|" ].map((one) => [ one, line.split(one).length - 1 ]);
    return counts.sort((a, b) => b[1] - a[1])[0][1] ? counts[0][0] : ",";
}

/**
 * A CSV into a table, as Sequel Ace's import: the file, its separator,
 * guessed, and whether its first line names the columns; then each of its
 * columns matched to one of the table's, by name when it names them, else
 * in order, or left out, with its first values to tell; and what a row
 * whose key is there does. It runs in one transaction.
 * @param {string} table
 * @returns {Promise<void>}
 */
async function openCsvImport(table) {
    let structure;
    try {
        structure = await api(`/api/db-structure?db=${encodeURIComponent(browse.db)}&table=${
            encodeURIComponent(table)
        }`);
    } catch (error) {
        toast(error.message, true);
        return;
    }

    const targets = structure.columns.filter(
        (column) => ![ "virtual", "stored" ].includes(column.value.kind),
    );
    let   sample  = "";

    formDialog({
        title  : `Import a CSV into ${table}`,
        text   :
            "Its rows are added in one transaction: on an error, an InnoDB table stays as it was.",
        body   : `
            <label class="file-drop" data-file-drop>
                <input type="file" name="file" accept=".csv,.tsv,.txt,text/csv">
                <svg viewBox="0 0 24 24"><path
                    d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path
                    d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/></svg>
                <span class="file-drop-text"><strong>Choose a .csv
                    file</strong><small>or drop it here</small></span>
            </label>
            <div class="form-pair">
                <label class="form-row"><span>Separator</span><span
                    class="field select"><select name="separator">
                    <option value=",">Comma ,</option><option
                        value=";">Semicolon ;</option><option value="&#9;">Tab</option><option
                        value="|">Bar |</option>
                </select></span></label>
                <label class="form-row"><span>If a row's key is there already</span><span
                    class="field select"><select name="duplicate">
                    <option value="error">Stop, importing nothing</option><option
                        value="skip">Skip that row</option><option
                        value="update">Update that row</option>
                </select></span></label>
            </div>
            <label class="check"><input type="checkbox" class="box" name="header"
                checked><span>The first line names the columns</span></label>
            <div class="csv-map" data-csv-map></div>
        `,
        ok     : "Import",
        ready  : (fields) => {
            const form = /** @type {HTMLFormElement} */ (fields.closest("form"));
            const map  = /** @type {HTMLElement} */ (fields.querySelector("[data-csv-map]"));
            // The file's columns, each with its first values and the table's column it goes to.
            const draw = (fresh) => {
                if (!sample) {
                    map.innerHTML = "";
                    return;
                }

                const separator = /** @type {HTMLSelectElement} */ (
                    form.elements.namedItem("separator")
                ).value;
                const header    = /** @type {HTMLInputElement} */ (
                    form.elements.namedItem("header")
                ).checked;
                const rows      = parseCsv(sample, separator, 6);
                const width     = Math.max(0, ...rows.map((row) => row.length));
                const names     = header ? rows[0] || [] : [];
                const values    = header ? rows.slice(1) : rows;
                const kept      = fresh ? [] : [ ...map.querySelectorAll("select") ]
                    .map((one) => /** @type {HTMLSelectElement} */ (one).value);
                const byName    = names.some((name) => targets.some(
                    (column) => column.name.toLowerCase()
                        === String(name ?? "").trim().toLowerCase(),
                ));

                map.innerHTML = `
                    <div class="csv-map-head"><span>In the file</span><span>Into
                        ${esc(table)}</span></div>
                    ${Array.from({ length : width }, (_, at) => {
                        const name   = String(names[at] ?? "").trim();
                        const guess  = byName ? targets.find(
                            (column) => column.name.toLowerCase() === name.toLowerCase(),
                        )?.name || "" : targets[at]?.name || "";
                        const picked = fresh ? guess : kept[at] ?? guess;
                        const shown  = values.map((row) => row[at])
                            .filter((value) => value !== undefined)
                            .slice(0, 3)
                            .map((value) => (value === null ? "NULL"
                                : value.replace(/\s+/g, " ")))
                            .join(" · ");

                        return `
                            <div class="csv-map-row">
                                <div class="csv-map-file"><strong>${esc(name
                                    || `Column ${at + 1}`)}</strong><small>${esc(shown)
                                    || "empty"}</small></div>
                                <span class="field select"><select data-csv-column="${at}">
                                    <option value="">Leave out</option>
                                    ${targets.map((column) => `<option value="${esc(column.name)}"
                                        ${column.name === picked
                                            ? "selected" : ""}>${esc(column.name)}
                                        · ${esc(column.type)}</option>`).join("")}
                                </select></span>
                            </div>
                        `;
                    }).join("")}
                `;
            };

            setUpFileDrop(/** @type {HTMLElement} */ (
                fields.querySelector("[data-file-drop]")
            ), async (file) => {
                // The start of the file is enough to see its columns.
                sample = await file.slice(0, 64 * 1024).text();
                /** @type {HTMLSelectElement} */ (
                    form.elements.namedItem("separator")
                ).value = guessSeparator(sample);
                draw(true);
            });

            form.elements.namedItem("separator").addEventListener("change", () => draw(true));
            form.elements.namedItem("header").addEventListener("change", () => draw(true));
        },
        submit : async (form) => {
            const file = /** @type {HTMLInputElement} */ (
                form.querySelector("[name=file]")
            ).files[0];
            if (!file) {
                throw new Error("Choose the file to import first");
            }

            const data    = new FormData(form);
            const mapping = [ ...form.querySelectorAll("[data-csv-column]") ]
                .map((one) => /** @type {HTMLSelectElement} */ (one).value || null);
            const spec    = {
                separator : String(data.get("separator")),
                header    : data.get("header") === "on",
                duplicate : String(data.get("duplicate")),
                mapping,
            };
            const status  = document.getElementById("form-status");
            const result  = await upload(`/api/db-import-csv?${new URLSearchParams({
                db   : browse.db,
                table,
                spec : JSON.stringify(spec),
            })}`, file, (done) => {
                status.textContent = done < 1
                    ? `Sending ${Math.round(done * 100)}% of ${bytes(file.size)}…`
                    : "MariaDB is adding the rows…";
            });

            await loadTables();
            if (browse.tab === "rows" && browse.table === table) {
                loadRows();
            }

            return result;
        },
    });
}

/**
 * A file box: the file picked or dropped shows by its name and size, and
 * goes to the function given, if any.
 * @param {HTMLElement} box
 * @param {((file: File) => void)=} picked
 * @returns {void}
 */
function setUpFileDrop(box, picked = null) {
    const input = /** @type {HTMLInputElement} */ (box.querySelector("input"));
    const empty = box.querySelector("strong").textContent;
    const show  = () => {
        const file = input.files[0];
        box.classList.toggle("chosen", Boolean(file));
        box.querySelector("strong").textContent = file ? file.name : empty;
        if (file) {
            picked?.(file);
        }
        box.querySelector("small").textContent  = file
            ? `${bytes(file.size)} · click to pick another` : "or drop it here";
    };

    input.addEventListener("change", show);
    box.addEventListener("dragover", (event) => {
        event.preventDefault();
        box.classList.add("over");
    });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (event) => {
        event.preventDefault();
        box.classList.remove("over");
        if (event.dataTransfer.files.length) {
            input.files = event.dataTransfer.files;
            show();
        }
    });
}

/**
 * Sends a file as a request's body, saying how much has gone; fetch cannot tell.
 * @param {string} url
 * @param {File} file
 * @param {(done: number) => void} progress The part sent, from 0 to 1.
 * @returns {Promise<{ message: string }>}
 */
function upload(url, file, progress) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", url);
        request.setRequestHeader("X-Studio", "1");

        request.upload.onprogress = (event) => progress(event.loaded / event.total);
        request.upload.onload     = () => progress(1);
        request.onload  = () => {
            const data = JSON.parse(request.responseText || "{}");
            if (request.status === 200) {
                resolve(data);
            } else {
                reject(new Error(data.error || request.statusText));
            }
        };
        request.onerror = () => reject(new Error("The file could not be sent"));

        request.send(file);
    });
}
