"use strict";

// The Services page.

function renderServices() {
    const { services, php, node, phpmyadmin } = state;
    const cards = Object.entries(services).map(([ formula, service ]) => {
        const info = SERVICE_INFO[formula];
        return serviceCard({
            logo    : formula,
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
        logo    : "php",
        name    : "PHP",
        version : php.version,
        running : services.httpd.running,
        text    : "Runs inside Apache, so it is up whenever Apache is.",
        actions : `<a class="button ghost small" href="/php">Settings</a>`,
    }));
    cards.push(serviceCard({
        logo    : "phpmyadmin",
        name    : "phpMyAdmin",
        version : phpmyadmin.version,
        running : services.httpd.running && services.mariadb.running,
        text    : "Served by Apache at /phpmyadmin on every site. Needs MariaDB too.",
        actions : `<a class="button ghost small" href="${phpmyadmin.url}" target="_blank" rel="noopener">Open</a>`,
    }));
    // Node.js is not a service either: nothing runs until an app starts it.
    cards.push(serviceCard({
        logo    : "node",
        name    : "Node.js",
        version : node.version,
        running : Boolean(node.version) && !node.broken,
        status  : node.broken ? "Does not start" : node.version ? "Installed" : "Not installed",
        text    : "Runs the apps' servers and npm. It is not a service, so there is nothing to start.",
        actions : `<a class="button ghost small" href="/node">Packages</a>`,
    }));
    document.getElementById("service-cards").innerHTML = cards.join("");
}

function serviceCard({ logo, name, version, running, status = "", text, actions }) {
    return `
        <div class="panel service">
            <div class="service-icon" style="background:${LOGOS[logo].color}">${logoSvg(logo)}</div>
            <div class="service-body">
                <h2>${name} <span class="version">${esc(version || "")}</span></h2>
                <p>${esc(text)}</p>
                <div class="actions" style="justify-content:space-between">
                    <span class="service-state ${running ? "on" : "off"}"><i class="dot ${running ? "on" : "off"}"></i>&nbsp; ${status || (running ? "Running" : "Stopped")}</span>
                    <span class="actions">${actions}</span>
                </div>
            </div>
        </div>
    `;
}
