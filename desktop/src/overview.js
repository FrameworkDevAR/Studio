"use strict";

// The sidebar's badges and the Overview page.

function render() {
    renderSidebar();
    renderOverview();
    renderServices();
    renderSites();
    renderPhp();
    renderModules();
    renderDatabases();
    renderLogMeta();
}

/** The status under the title, the counts by each link, and the disk meter. */
function renderSidebar() {
    const { services, disk, php, modules, databases } = state;
    const apps = allApps();
    const health = stackHealth();
    const labels = { on : "All running", mid : "Partly running", off : "Stopped" };
    document.getElementById("brand-status").innerHTML = `<i class="dot ${health}"></i> ${labels[health]}`;

    const running = Object.values(services).filter((service) => service.running).length;
    setBadge("services",  `${running}/${Object.keys(services).length}`, running === Object.keys(services).length ? "ok" : "");
    setBadge("sites",     `${apps.filter((app) => app.running).length}/${apps.length}`);
    setBadge("php",       php.version || "");
    setBadge("apache",    String(modules.filter((module) => module.enabled).length));
    setBadge("databases", databases.available ? String(databases.list.length) : "off", databases.available ? "" : "bad");

    const low = disk.free < 5 * 2 ** 30;
    document.getElementById("disk").classList.toggle("low", low);
    document.getElementById("disk-used").style.width = `${((disk.total - disk.free) / disk.total) * 100}%`;
    document.getElementById("disk-text").textContent = `${bytes(disk.free)} free`;
}

function setBadge(view, text, kind = "") {
    const badge = document.getElementById(`badge-${view}`);
    badge.textContent = text;
    badge.className   = kind;
}

/** on when Apache and MariaDB are both up, mid with one, off with neither. */
function stackHealth() {
    const { httpd, mariadb } = state.services;
    return httpd.running && mariadb.running ? "on" : httpd.running || mariadb.running ? "mid" : "off";
}

function renderOverview() {
    const { services, databases, disk, php } = state;
    const apps = allApps();
    const stopped = Object.values(services).filter((service) => !service.running && service.name !== "Redis");
    const appsUp  = apps.filter((app) => app.running).length;

    let title = "Everything is running";
    let text  = `Apache and MariaDB are up, with ${appsUp} app${appsUp === 1 ? "" : "s"} running.`;
    if (stopped.length === 2) {
        title = "The stack is stopped";
        text  = "Start all brings up Apache and MariaDB.";
    } else if (stopped.length) {
        title = `${stopped[0].name} is stopped`;
        text  = "Start it from Services, or with Start all.";
    }
    const health = stackHealth();
    const pill   = { on : "Healthy", mid : "Partly up", off : "Stopped" }[health];
    document.getElementById("hero-title").innerHTML = `${esc(title)}<span class="status-pill ${health}"><i class="dot ${health}"></i>${pill}</span>`;
    document.getElementById("hero-text").textContent  = text;

    const total = databases.list.reduce((sum, db) => sum + db.size, 0);
    const serviceTile = (formula, tone) => {
        const service = services[formula];
        return tile("services", service.name, esc(service.version), service.running ? "Running" : "Stopped", !service.running, tone, SERVICE_ICONS[formula]);
    };

    document.getElementById("tiles").innerHTML = [
        serviceTile("httpd", "orange"),
        serviceTile("mariadb", "teal"),
        tile("php", "PHP", esc(php.version || "—"), `${php.extensions.length} extensions`, false, "blue"),
        tile("sites", "Apps", `${appsUp}<small>/${apps.length}</small>`, "running", false, "cyan"),
        tile("databases", "Databases", databases.available ? String(databases.list.length) : "—", databases.available ? bytes(total) : "MariaDB is stopped", !databases.available, "magenta"),
        tile("overview", "Disk", bytes(disk.free).replace(" ", "<small> ") + "</small>", `free · logs ${bytes(Object.values(state.logs).reduce((sum, log) => sum + log.size + log.archived, 0))}`, disk.free < 5 * 2 ** 30, "yellow"),
    ].join("");

    /** @type {HTMLAnchorElement} */ (document.getElementById("shortcut-pma")).href = state.phpmyadmin.url;
    document.getElementById("php-ini-name").textContent = state.files.phpIni.split("/").pop();
}

/** The icons of the service tiles, which share the Services page. */
const SERVICE_ICONS = {
    httpd   : `<svg viewBox="0 0 24 24"><path d="M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z"/></svg>`,
    mariadb : `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>`,
};

/** The disk's icon, which has no page of its own to borrow one from. */
const DISK_ICON = `<svg viewBox="0 0 24 24"><path d="M22 12H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/><path d="M6 16h.01M10 16h.01"/></svg>`;

/** A summary tile, wearing its page's icon from the sidebar, or its own, and its tone. */
function tile(view, label, value, sub, bad, tone, ownIcon = "") {
    const icon = ownIcon || (view === "overview" ? DISK_ICON : document.querySelector(`nav a[data-view="${view}"] svg`).outerHTML);
    return `
        <a class="tile tone-${tone} ${bad ? "bad" : ""}" href="/${view}">
            <div class="label"><span class="icon">${icon}</span>${label}</div>
            <div class="value">${value}</div>
            <div class="sub">${sub}</div>
        </a>
    `;
}

function renderRecentErrors() {
    const box = document.getElementById("recent-errors");
    if (!recentErrors.length) {
        box.innerHTML = `<div class="recent-ok"><i class="dot on"></i> No errors in the Apache log lately.</div>`;
        return;
    }
    box.innerHTML = recentErrors.map((line) => {
        const time    = line.match(/^\[([^\]]+)\]/)?.[1]?.replace(/\.\d+/, "") || "";
        const message = line.replace(/^(\[[^\]]*\]\s*)+/, "");
        // PHP writes a stack trace as one line with literal \n in it: the
        // first part is the error, the rest shows when the line is clicked.
        const [ first, ...rest ] = message.split("\\n");
        return `
            <div class="recent-line ${/:warn\]|warning/i.test(line) ? "warn" : ""} ${rest.length ? "expandable" : ""}" title="${rest.length ? "Click for the stack trace" : ""}">
                <time>${esc(time)}</time>${esc(first)}${rest.length ? `<div class="trace">${esc(rest.join("\n"))}</div>` : ""}
            </div>`;
    }).join("");
}
