// The Sites page: the apps and servers in a block per project, and the vhosts.

import { esc, icon, shortPath } from "../core/helpers.js";
import { starting, state } from "../core/state.js";
import { projectTitle } from "./projects.js";
import { renderVhosts } from "./vhosts.js";



/**
 * A card of the Sites page: one app or server, with what its card shows.
 * @typedef {{ key: string, target: string, label: string, running: boolean,
 *     starting: boolean, stopping: boolean, url: string, port: number,
 *     mark?: string, site?: boolean, reload?: boolean }} SitesCard
 */

/**
 * A block of the Sites page: a project, and the cards of its apps or servers;
 * its kind is "servers", "apps", "sites" for a project with only those, or
 * "empty" for a project of the config with nothing yet. index is the project's
 * place in the config, -1 when unknown. groups are what Start all starts: the
 * plugin's name for the project's apps, and for its servers.
 * @typedef {{
 *     title: string, kind: string, project: string, index: number, cards: SitesCard[],
 *     groups: string[],
 * }} SitesBlock
 */



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
 * How many of a block's apps could be started now.
 * @param {SitesBlock} group
 * @returns {number}
 */
function stoppedCount(group) {
    return group.cards.filter((card) => !card.site && !card.running && !card.starting
        && !card.stopping).length;
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

    let hue;
    if (max === r) {
        hue = (g - b) / delta + (g < b ? 6 : 0);
    } else if (max === g) {
        hue = (b - r) / delta + 2;
    } else {
        hue = (r - g) / delta + 4;
    }

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
            const index = state.projects.findIndex((project) => project.sites
                .some((one) => one.id === server.id));
            groups.push({
                title,
                kind    : "servers",
                project : title,
                index,
                cards   : [],
                groups  : [ title ],
            });
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
            reload   : server.reload,
        });
    }

    for (const app of state.apps) {
        const title = app.name.split(" - ")[0];
        if (groups.at(-1)?.project !== app.project) {
            const index = projectIndexOf(app.root);
            groups.push({
                title,
                kind    : "apps",
                project : app.project,
                index,
                cards   : [],
                groups  : [ app.project ],
            });
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

    mergeServers(groups);

    // A start is done once its app runs, or given up on after 30s.
    for (const [ key, since ] of starting) {
        const card = groups.flatMap((group) => group.cards).find((one) => one.key === key);
        if (Date.now() - since > 30_000 || card?.running) {
            starting.delete(key);
        }
    }

    addSites(groups);

    // A project of the config with no apps found and no servers still shows, to change it.
    for (const project of state.projects) {
        if (!groups.some((group) => group.index === project.index)) {
            groups.push({
                title   : projectTitle(project),
                kind    : "empty",
                project : "",
                index   : project.index,
                cards   : [],
                groups  : [],
            });
        }
    }

    for (const group of groups) {
        markCards(group.cards);
    }

    document.getElementById("app-groups").innerHTML = groups.map((group, index) => {
        const apps   = group.cards.filter((card) => !card.site);
        const up     = apps.filter((card) => card.running).length;
        const branch = group.project ? state.branches[group.project] : "";
        const host   = group.project ? hostOf(group.project) : "";
        // The host opens the project's first running app, in the block's order
        // (its desktop app first); with none running, the project's Apache site.
        const first  = apps.find((card) => card.running && card.url);
        const vhost  = host
            ? state.vhosts.find((one) => one.name === host && !one.ssl)
                || state.vhosts.find((one) => one.name === host)
            : null;
        const target = first ? first.url : vhost?.url;
        const noun   = group.kind === "servers" ? "server" : "app";
        const count  = countText(apps.length, group.cards.length - apps.length, noun);
        const dots   = apps
            .map((card) => {
                let dot = "";
                if (card.running) {
                    dot = "on";
                } else if (card.starting || card.stopping) {
                    dot = "mid";
                }

                return `<i class="${dot}" title="${esc(card.label)}"></i>`;
            })
            .join("");

        let hostLink = "";
        if (host && target) {
            hostLink = `<a class="host" href="${esc(target)}" target="_blank"
                rel="noopener" title="Open ${esc(first
                    ? `${first.label} at ${target}`
                    : target)}">${GLOBE_ICON}${esc(host)}</a>`;
        } else if (host) {
            hostLink = `<span class="host"
                title="Where its apps answer">${GLOBE_ICON}${esc(host)}</span>`;
        }

        return `
            <div class="panel app-block tone-${BLOCK_TONES[index % BLOCK_TONES.length]}"
                style="${iconTone(group.project)}">
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
                            ${hostLink}
                            ${host ? `<span class="sep" aria-hidden="true">·</span>` : ""}
                            <span>${count}</span>
                        </div>
                    </div>
                    ${apps.length ? blockState(apps.length, up, dots) : ""}
                    ${startAll(group, noun)}
                    ${group.index >= 0 ? `<button class="icon-btn block-edit"
                        data-project-edit="${group.index}" title="Change the project"
                        aria-label="Change the project"><svg viewBox="0 0 24 24"><path
                        d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>`
                        : ""}
                </div>
                ${group.cards.length
                    ? `<div class="app-cards">${group.cards.map(appCard).join("")}</div>`
                    : emptyText(state.projects[group.index])}
            </div>
        `;
    }).join("");

    document.getElementById("tab-project-count").textContent = String(groups.length);
    document.getElementById("tab-vhost-count").textContent   = String(
        new Set(state.vhosts.map((vhost) => vhost.name + vhost.root)).size,
    );

    renderVhosts();
}

/**
 * Puts a project's servers in the block of its apps, when it has both, as the menu shows
 * them: the plugin names the two by the project's title and by its folder.
 * @param {SitesBlock[]} groups
 * @returns {void}
 */
function mergeServers(groups) {
    for (const servers of groups.filter((group) => group.kind === "servers")) {
        const apps = groups.find((group) => group.kind === "apps" && group.index >= 0
            && group.index === servers.index);

        if (apps) {
            apps.cards.push(...servers.cards);
            apps.groups.push(...servers.groups);
            groups.splice(groups.indexOf(servers), 1);
        }
    }
}

/**
 * A block's Start all, in every block so the headers line up; it is off with nothing
 * stopped to start.
 * @param {SitesBlock} group
 * @param {string} noun "app" or "server"
 * @returns {string}
 */
function startAll(group, noun) {
    const stopped = stoppedCount(group);

    let title = "Nothing to start";
    if (stopped) {
        title = `Start the ${stopped} stopped ${noun}${stopped === 1 ? "" : "s"}`;
    }

    return `
        <button class="ghost small group-start"
            data-group-start="${esc(JSON.stringify(group.groups))}"
            title="${title}" ${stopped ? "" : "disabled"}>
            <svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>Start all
        </button>
    `;
}

/**
 * Puts each project's sites in its first block, or in one of their own for a project with
 * nothing else. Apache serves them, so they are up while it runs: they are listed, never
 * requested to see.
 * @param {SitesBlock[]} groups
 * @returns {void}
 */
function addSites(groups) {
    const running = Boolean(state.services.httpd?.running);

    for (const project of state.projects) {
        // A site with a command is a server, which has its own card.
        const sites = project.sites.filter((site) => !site.command);
        if (!sites.length) {
            continue;
        }

        let group = groups.find((one) => one.index === project.index);
        if (!group) {
            group = {
                title   : projectTitle(project),
                kind    : "sites",
                project : "",
                index   : project.index,
                cards   : [],
                groups  : [],
            };
            groups.push(group);
        }

        for (const site of sites) {
            group.cards.push({
                key      : `site:${site.url}`,
                target   : "",
                label    : site.name,
                running,
                starting : false,
                stopping : false,
                url      : site.url,
                port     : null,
                site     : true,
            });
        }
    }
}

/**
 * What a block holds, as its header says it.
 * @param {number} apps its apps or servers
 * @param {number} sites
 * @param {string} noun "app" or "server"
 * @returns {string}
 */
function countText(apps, sites, noun) {
    const parts = [];
    if (apps) {
        parts.push(`${apps} ${noun}${apps === 1 ? "" : "s"}`);
    }
    if (sites) {
        parts.push(`${sites} site${sites === 1 ? "" : "s"}`);
    }

    return parts.join(", ") || "Nothing yet";
}

/**
 * The dots of a block's apps, green while they run, and how many do under them.
 * @param {number} count
 * @param {number} up how many run
 * @param {string} dots the dots, as HTML
 * @returns {string}
 */
function blockState(count, up, dots) {
    return `
        <div class="block-state" title="${up ? `${up} of ${count} running` : "None running"}">
            <span class="state-dots">${dots}</span>
            <span class="state-text ${up ? "on" : ""}">${up ? `${up} running` : "Stopped"}</span>
        </div>
    `;
}

/**
 * What a project with no apps and no sites says, in place of its cards: where its apps
 * are looked for, and a way to add a site.
 * @param {{ index: number, dir: string, home: string, worktrees: boolean }} project
 * @returns {string}
 */
function emptyText(project) {
    let where = "No apps, and no sites yet.";
    if (project.dir && project.worktrees) {
        where = `No worktrees with apps in ${esc(shortPath(project.home))} yet.`;
    } else if (project.dir) {
        where = `No apps in ${esc(shortPath(project.home))} yet: each is a folder with a
            package.json.`;
    }

    return `
        <div class="block-empty">
            <span class="muted">${where}</span>
            <button class="ghost small"
                data-server-add="${project.index}">${icon("plus")}Add site</button>
        </div>
    `;
}

/**
 * The place in the config of the project an app's folder is in: the project's own
 * folder, or a worktree in it. -1 when no project has it.
 * @param {string} root the project folder the plugin reports with the app
 * @returns {number}
 */
function projectIndexOf(root) {
    const clean  = (dir) => dir.replace(/\/+$/, "");
    const parent = clean(root).replace(/\/[^/]*$/, "");

    return state.projects.findIndex((project) => project.home && (clean(project.home)
        === clean(root) || (project.worktrees && clean(project.home) === parent)));
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

// A hot reload is a bolt and a hot restart a turning arrow, as in Flutter's own tools.
const ACTION_ICONS = {
    start   : `<path d="M7 4.5v15l12.5-7.5z"/>`,
    open    : `<path d="M7 17L17 7M9 7h8v8"/>`,
    stop    : `<rect x="6" y="6" width="12" height="12" rx="2"/>`,
    reload  : `<path d="M13 3L5 13.5h6.5L10.5 21 19 10.5h-6.5z"/>`,
    restart : `<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.7"/><path d="M20 4v4.7h-4.7"/>`,
};

/**
 * An action of a card as an icon button, its label for a title.
 * @param {"start" | "open" | "stop" | "reload" | "restart"} kind
 * @param {string} label
 * @param {string} attributes the button's data attributes, as HTML
 * @returns {string}
 */
function iconButton(kind, label, attributes) {
    return `<button class="icon-btn ${kind}" title="${esc(label)}" aria-label="${esc(label)}"
        ${attributes}><svg viewBox="0 0 24 24">${ACTION_ICONS[kind]}</svg></button>`;
}

/**
 * A flutter run's hot reload and hot restart, its r and R, which the menu has too.
 * @param {SitesCard} card
 * @returns {string}
 */
function reloadButtons(card) {
    return `
        ${iconButton("reload", `Hot reload ${card.label}`, `data-app-reload ${card.target}`)}
        ${iconButton("restart", `Hot restart ${card.label}`,
            `data-app-reload="restart" ${card.target}`)}
    `;
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
    let status  = "Stopped";
    if (card.running && card.port) {
        status = `Port ${card.port}${lock}`;
    } else if (card.running) {
        status = "Running";
    }

    const open  = card.url ? `<a class="icon-btn open" href="${esc(card.url)}" target="_blank"
        rel="noopener" title="Open ${esc(card.url)}" aria-label="Open"><svg
        viewBox="0 0 24 24">${ACTION_ICONS.open}</svg></a>` : "";

    let actions = iconButton("start", `Start ${card.label}`, `data-app-start ${card.target}`);

    if (card.stopping || (card.starting && !card.running)) {
        state   = "mid";
        status  = card.stopping ? "Stopping…" : "Starting…";
        actions = "";
    } else if (card.running) {
        actions = `
            ${card.reload ? reloadButtons(card) : ""}
            ${open}
            ${iconButton("stop", `Stop ${card.label}`, `data-app-stop ${card.target}`)}
        `;
    }

    // Apache starts and stops a site, so the card only opens it, and says where it is.
    if (card.site) {
        status  = card.running
            ? `${esc(card.url.replace(/^https?:\/\/|\/$/g, ""))}${lock}`
            : "Apache is stopped";
        actions = card.running ? open : "";
    }

    return `
        <div class="app-card ${state}${card.reload ? " wide" : ""}">
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



// The public API
export {
    allApps,
    renderSites,
};
