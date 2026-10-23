"use strict";

// The Services page.

function renderServices() {
    const { services, php, phpmyadmin } = state;
    const cards = Object.entries(services).map(([ formula, service ]) => {
        const info = SERVICE_INFO[formula];
        return serviceCard({
            mark    : info.mark,
            color   : info.color,
            name    : service.name,
            version : service.version,
            running : service.running,
            text    : info.text(state),
            actions : service.running
                ? `<button class="ghost small" data-service="${formula}" data-op="restart">Restart</button>
                   <button class="danger small" data-service="${formula}" data-op="stop">Stop</button>`
                : `<button class="small" data-service="${formula}" data-op="start">Start</button>`,
        });
    });

    // PHP is Apache's module and phpMyAdmin a site of it, so neither is a
    // service of its own: they are up whenever Apache is.
    cards.push(serviceCard({
        mark    : "P",
        color   : "var(--magenta)",
        name    : "PHP",
        version : php.version,
        running : services.httpd.running,
        text    : "Runs inside Apache, so it is up whenever Apache is.",
        actions : `<a class="button ghost small" href="/php">Settings</a>`,
    }));
    cards.push(serviceCard({
        mark    : "pma",
        color   : "var(--amber)",
        name    : "phpMyAdmin",
        version : phpmyadmin.version,
        running : services.httpd.running && services.mariadb.running,
        text    : "Served by Apache at /phpmyadmin on every site. Needs MariaDB too.",
        actions : `<a class="button ghost small" href="${phpmyadmin.url}" target="_blank" rel="noopener">Open</a>`,
    }));
    document.getElementById("service-cards").innerHTML = cards.join("");
}

function serviceCard({ mark, color, name, version, running, text, actions }) {
    return `
        <div class="panel service">
            <div class="service-icon" style="background:${color}; font-size:${mark.length > 1 ? 12 : 16}px">${mark}</div>
            <div class="service-body">
                <h2>${name} <span class="version">${esc(version || "")}</span></h2>
                <p>${esc(text)}</p>
                <div class="actions" style="justify-content:space-between">
                    <span class="service-state ${running ? "on" : "off"}"><i class="dot ${running ? "on" : "off"}"></i>&nbsp; ${running ? "Running" : "Stopped"}</span>
                    <span class="actions">${actions}</span>
                </div>
            </div>
        </div>
    `;
}
