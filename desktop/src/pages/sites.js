"use strict";

// The Sites page: the apps and servers in a block per project, and the vhosts.

/**
 * The host a project's apps answer on: the one most of them use, leaving out
 * localhost. A project may have an app or two set to another one.
 * @param {string} project
 * @returns {string}
 */
function hostOf(project) {
    const counts = new Map();
    for (const app of state.apps) {
        if (app.project === project && app.host
            && app.host !== "localhost" && app.host !== "127.0.0.1") {
            counts.set(app.host, (counts.get(app.host) || 0) + 1);
        }
    }
    return [ ...counts ].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

/**
 * How many of the 4 columns each block takes. A block needs as many as it
 * has apps, so projects with an app or two share a row; then the blocks of a
 * row that is not full share out what is left, so the row is always filled.
 * Two projects of one app each take half a row each.
 * @param {number[]} needs
 * @returns {number[]}
 */
function blockSpans(needs) {
    const spans = [ ...needs ];
    let row = [];
    const fill = () => {
        let left = 4 - row.reduce((sum, index) => sum + spans[index], 0);
        for (let turn = 0; left > 0 && row.length; turn++, left--) {
            spans[row[turn % row.length]]++;
        }
        row = [];
    };
    needs.forEach((need, index) => {
        if (row.reduce((sum, at) => sum + spans[at], 0) + need > 4) {
            fill();
        }
        row.push(index);
    });
    fill();
    return spans;
}

/**
 * A card of the Sites page: one app or server, with what its card shows.
 * @typedef {{ key: string, target: string, label: string, running: boolean,
 *     starting: boolean, stopping: boolean, url: string, port: number,
 *     mark?: string }} SitesCard
 */

/**
 * A block of the Sites page: a project, and the cards of its apps or servers;
 * its kind is "servers" or "apps".
 * @typedef {{ title: string, kind: string, project: string, cards: SitesCard[] }} SitesBlock
 */

/**
 * How many of a block's apps could be started now.
 * @param {SitesBlock} group
 * @returns {number}
 */
function stoppedCount(group) {
    return group.cards.filter((card) => !card.running && !card.starting && !card.stopping).length;
}

/** Each block's color, in turn, starting in blue. */
const BLOCK_TONES    = [ "blue", "teal", "magenta", "cyan", "orange", "yellow", "green", "red" ];
const GLOBE_ICON     = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path
    d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7
    12 3z"/></svg>`;
const BRANCH_ICON    = `<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle
    cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path
    d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5"/></svg>`;

/**
 * The color of each project's favicon, by project, once read: a hue and a
 * saturation, or null for an icon with no color to speak of. The theme sets
 * the lightness (--icon-light), so the color reads on either background.
 */
const iconColors = new Map();

/**
 * The style giving a block its favicon's color, once known; the palette's until then.
 * @param {string} project
 * @returns {string}
 */
function iconTone(project) {
    const color = iconColors.get(project);
    if (color === undefined && state.icons.includes(project)) {
        iconColors.set(project, null);
        readIconColor(project);
    }
    return color ? ` --tone:hsl(${color.hue} ${color.saturation}% var(--icon-light));` : "";
}

/**
 * Reads a favicon's main color, drawing it small and counting its colored
 * pixels by hue: the busiest hue wins, weighted by how vivid each pixel is.
 * Greys, near-whites and near-blacks are left out, so a logo's own color
 * shows rather than its background. Draws the blocks again once known.
 * @param {string} project
 * @returns {void}
 */
function readIconColor(project) {
    const image = new Image();
    image.onload = () => {
        const size    = 32;
        const canvas  = document.createElement("canvas");
        canvas.width  = canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently : true });
        context.drawImage(image, 0, 0, size, size);
        const pixels  = context.getImageData(0, 0, size, size).data;
        const bins    = Array.from(
            { length : 36 },
            () => ({ weight : 0, hue : 0, saturation : 0 }),
        );
        for (let at = 0; at < pixels.length; at += 4) {
            if (pixels[at + 3] < 128) {
                continue;
            }
            const { hue, saturation, lightness } = toHsl(
                pixels[at],
                pixels[at + 1],
                pixels[at + 2],
            );
            if (saturation < 25 || lightness < 12 || lightness > 92) {
                continue;
            }
            const bin = bins[Math.floor(hue / 10) % 36];
            bin.weight     += saturation;
            bin.hue        += hue * saturation;
            bin.saturation += saturation * saturation;
        }
        const best = bins.reduce((top, bin) => (bin.weight > top.weight ? bin : top));
        if (best.weight > 0) {
            iconColors.set(project, {
                hue        : Math.round(best.hue / best.weight),
                saturation : Math.min(85, Math.round(best.saturation / best.weight)),
            });
            renderSites();
        }
    };
    image.src = `/api/icon?project=${encodeURIComponent(project)}`;
}

/**
 * An RGB color as hue (0-360), saturation and lightness (0-100).
 * @param {number} red
 * @param {number} green
 * @param {number} blue
 * @returns {{ hue: number, saturation: number, lightness: number }}
 */
function toHsl(red, green, blue) {
    const [ r, g, b ] = [ red / 255, green / 255, blue / 255 ];
    const max   = Math.max(r, g, b);
    const min   = Math.min(r, g, b);
    const light = (max + min) / 2;
    if (max === min) {
        return { hue : 0, saturation : 0, lightness : light * 100 };
    }
    const delta = max - min;
    const sat   = light > .5 ? delta / (2 - max - min) : delta / (max + min);
    const hue   = max === r ? (g - b) / delta + (g < b ? 6 : 0)
        : max === g ? (b - r) / delta + 2
            : (r - g) / delta + 4;
    return { hue : hue * 60, saturation : sat * 100, lightness : light * 100 };
}

/**
 * A project's badge: the initials of its first two words, so Shop Alpha is SA.
 * @param {string} title
 * @returns {string}
 */
function monogramOf(title) {
    const words = title.split(/\s+/);
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

/**
 * The apps and the servers together, for the counts.
 * @returns {Object<string, *>[]}
 */
function allApps() {
    return [ ...state.apps, ...state.servers ];
}

/**
 * The apps as cards, in a block per project: the projects with servers of
 * their own first, as their servers come, then each project's apps in the
 * menu's order. A project's title is its apps' names up to the " - ".
 * @returns {void}
 */
function renderSites() {
    const groups = [];
    for (const server of state.servers) {
        const title = server.project;
        if (groups.at(-1)?.project !== title) {
            groups.push({ title, kind : "servers", project : title, cards : [] });
        }
        groups.at(-1).cards.push({
            key      : `id:${server.id}`,
            target   : `data-app-id="${esc(server.id)}"`,
            // The block names the project, so "Shop Docs" is just "Docs" in it.
            label    : server.name.startsWith(`${title} `)
                ? server.name.slice(title.length + 1)
                : server.name,
            running  : server.running,
            starting : server.starting || starting.has(`id:${server.id}`),
            stopping : server.stopping,
            url      : server.running ? server.url : null,
            port     : server.port,
        });
    }
    for (const app of state.apps) {
        const title = app.name.split(" - ")[0];
        if (groups.at(-1)?.project !== app.project) {
            groups.push({ title, kind : "apps", project : app.project, cards : [] });
        }
        groups.at(-1).cards.push({
            key      : `dir:${app.dir}`,
            target   : `data-app-dir="${esc(app.dir)}"`,
            label    : app.name.includes(" - ")
                ? app.name.split(" - ").slice(1).join(" - ")
                : app.name,
            running  : app.running,
            starting : starting.has(`dir:${app.dir}`),
            stopping : app.stopping,
            url      : app.url,
            port     : app.port,
        });
    }

    // A start is done once its app runs, or given up on after 30s.
    for (const [ key, since ] of starting) {
        const card = groups.flatMap((group) => group.cards).find((one) => one.key === key);
        if (Date.now() - since > 30_000 || card?.running) {
            starting.delete(key);
        }
    }

    for (const group of groups) {
        markCards(group.cards);
    }

    const spans = blockSpans(groups.map((group) => Math.min(group.cards.length, 4)));
    document.getElementById("apps-pane").innerHTML = groups.map((group, index) => {
        const cols   = Math.min(group.cards.length, 4);
        const span   = spans[index];
        const up     = group.cards.filter((card) => card.running).length;
        const branch = group.project ? state.branches[group.project] : "";
        const host   = group.project ? hostOf(group.project) : "";
        // The host opens the project's first running app, in the block's order
        // (its desktop app first); with none running, the project's Apache site.
        const first  = group.cards.find((card) => card.running && card.url);
        const vhost  = host
            ? state.vhosts.find((one) => one.name === host && !one.ssl)
                || state.vhosts.find((one) => one.name === host)
            : null;
        const target = first ? first.url : vhost?.url;
        const noun   = group.kind === "servers" ? "server" : "app";
        const count  = `${group.cards.length} ${noun}${group.cards.length === 1 ? "" : "s"}`;
        const dots   = group.cards
            .map((card) => `<i class="${card.running ? "on"
                : card.starting || card.stopping ? "mid" : ""}" title="${esc(card.label)}"></i>`)
            .join("");
        return `
            <div class="panel app-block tone-${BLOCK_TONES[index % BLOCK_TONES.length]}"
                style="--span:${span}; --cols:${cols};${iconTone(group.project)}">
                <div class="block-head">
                    <span class="block-badge ${state.icons.includes(group.project)
                        ? "icon" : ""}">${state.icons.includes(group.project)
                        ? `<img src="/api/icon?project=${encodeURIComponent(group.project)}"
                            alt="">`
                        : esc(monogramOf(group.title))}</span>
                    <div class="block-title">
                        <h2>${esc(group.title)}</h2>
                        <div class="block-meta">
                            ${branch ? `<span class="branch"
                                title="Git branch">${BRANCH_ICON}${esc(branch)}</span>` : ""}
                            ${host ? (target
                                ? `<a class="host" href="${esc(target)}" target="_blank"
                                    rel="noopener" title="Open ${esc(first
                                        ? `${first.label} at ${target}`
                                        : target)}">${GLOBE_ICON}${esc(host)}</a>`
                                : `<span class="host"
                                    title="Where its apps answer">${GLOBE_ICON}${esc(host)}</span>`)
                                : ""}
                            ${host ? `<span class="sep" aria-hidden="true">·</span>` : ""}
                            <span>${count}</span>
                        </div>
                    </div>
                    ${stoppedCount(group) >= 2 ? `
                        <button class="ghost small group-start"
                            data-group-start="${esc(group.project)}"
                            title="Start the ${stoppedCount(group)} stopped ${noun}s">
                            <svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>Start all
                        </button>` : ""}
                    <div class="block-state" title="${up
                        ? `${up} of ${group.cards.length} running`
                        : "None running"}">
                        <span class="state-dots">${dots}</span>
                        <span class="state-text ${up ? "on" : ""}">${up
                            ? `${up} running` : "Stopped"}</span>
                    </div>
                </div>
                <div class="app-cards">${group.cards.map(appCard).join("")}</div>
            </div>
        `;
    }).join("");

    const all = allApps();
    document.getElementById("tab-apps-count").textContent   = `${all
        .filter((app) => app.running).length}/${all.length}`;
    document.getElementById("tab-apache-count").textContent = String(
        new Set(state.vhosts.map((vhost) => vhost.name + vhost.root)).size,
    );
    renderVhosts();
}

/**
 * Gives each card of a block its monogram: the first two letters of its name,
 * as "DE" for desktop. A card whose two letters another one in the block
 * already has takes the next letter instead, so chat and checkin are "CH" and
 * "CE", and no two cards in a block look the same.
 * @param {SitesCard[]} cards
 * @returns {void}
 */
function markCards(cards) {
    const taken = new Set();
    for (const card of cards) {
        const letters = card.label.replace(/[^\p{L}\p{N}]/gu, "");
        const first   = letters[0] || "?";
        const second  = [ ...letters.slice(1) ]
            .find((letter) => !taken.has(`${first}${letter}`.toLowerCase())) || "";
        card.mark     = `${first}${second}`.toUpperCase();
        taken.add(card.mark.toLowerCase());
    }
}

const ACTION_ICONS = {
    start : `<path d="M7 4.5v15l12.5-7.5z"/>`,
    open  : `<path d="M7 17L17 7M9 7h8v8"/>`,
    stop  : `<rect x="6" y="6" width="12" height="12" rx="2"/>`,
};

/**
 * An action of a card as an icon button, its label for a title.
 * @param {"start" | "open" | "stop"} kind
 * @param {string} label
 * @param {string} attributes the button's data attributes, as HTML
 * @returns {string}
 */
function iconButton(kind, label, attributes) {
    return `<button class="icon-btn ${kind}" title="${esc(label)}" aria-label="${esc(label)}"
        ${attributes}><svg viewBox="0 0 24 24">${ACTION_ICONS[kind]}</svg></button>`;
}

/**
 * One app: its monogram with the status dot on its corner, the name and where it
 * answers, then the actions as icon buttons. A running app wears its block's
 * color; a stopped one stays grey until hovered.
 * @param {SitesCard} card
 * @returns {string}
 */
function appCard(card) {
    let state   = card.running ? "on" : "idle";
    // The block's header names the project's host, so the card only says what
    // is its own: the port, and a lock when it is https. The whole address is
    // on hover.
    const lock  = card.url?.startsWith("https")
        ? `<svg class="lock" viewBox="0 0 24 24" aria-label="HTTPS"><rect x="4" y="11" width="16"
            height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`
        : "";
    let status  = card.running && card.port ? `Port ${card.port}${lock}`
        : card.running ? "Running"
            : "Stopped";
    let actions = iconButton("start", `Start ${card.label}`, `data-app-start ${card.target}`);
    if (card.stopping || (card.starting && !card.running)) {
        state   = "mid";
        status  = card.stopping ? "Stopping…" : "Starting…";
        actions = "";
    } else if (card.running) {
        actions = `
            ${card.url ? `<a class="icon-btn open" href="${esc(card.url)}" target="_blank"
                rel="noopener" title="Open ${esc(card.url)}" aria-label="Open"><svg
                viewBox="0 0 24 24">${ACTION_ICONS.open}</svg></a>` : ""}
            ${iconButton("stop", `Stop ${card.label}`, `data-app-stop ${card.target}`)}
        `;
    }
    return `
        <div class="app-card ${state}">
            <span class="app-icon">${esc(card.mark)}<i class="dot ${state}"></i></span>
            <div class="app-text">
                <strong>${esc(card.label)}</strong>
                ${card.url && card.running
                    ? `<a href="${esc(card.url)}" target="_blank" rel="noopener"
                        title="${esc(card.url)}">${status}</a>`
                    : `<span>${status}</span>`}
            </div>
            <div class="app-actions">${actions}</div>
        </div>
    `;
}

/**
 * The vhosts, one row per name with its http and https side by side, never checked.
 * @returns {void}
 */
function renderVhosts() {
    const rows = new Map();
    for (const vhost of state.vhosts) {
        const key = `${vhost.name}:${vhost.ssl ? 80 : vhost.port}:${vhost.root}`;
        const row = rows.get(key) || {
            name   : vhost.name,
            root   : vhost.root,
            exists : vhost.exists,
            http   : null,
            https  : null,
        };
        row[vhost.ssl ? "https" : "http"] = vhost;
        rows.set(key, row);
    }
    const link = (vhost, label) => vhost
        ? `<a href="${esc(vhost.url)}" target="_blank" rel="noopener">${label}</a>`
        : `<span class="muted">—</span>`;

    document.getElementById("vhost-table").innerHTML = `
        <colgroup><col style="width:26%"><col><col style="width:80px"><col
            style="width:80px"></colgroup>
        <thead><tr><th>Site</th><th>Folder</th><th class="num">HTTP</th><th
            class="num">HTTPS</th></tr></thead>
        <tbody>
            ${[ ...rows.values() ].map((row) => `
                <tr>
                    <td><strong>${esc(row.name)}</strong>${row.http && row.http.port !== 80
                        ? `<span class="muted">:${row.http.port}</span>` : ""}</td>
                    <td class="path">${esc(shortPath(row.root))}${row.exists
                        ? "" : ` <span class="badge bad">missing</span>`}</td>
                    <td class="num">${link(row.http, "Open")}</td>
                    <td class="num">${link(row.https, "Open")}</td>
                </tr>
            `).join("")}
        </tbody>
    `;
}
