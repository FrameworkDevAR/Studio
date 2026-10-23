"use strict";

// The Databases page.

function renderDatabases() {
    const { databases, phpmyadmin } = state;
    /** @type {HTMLAnchorElement} */ (document.getElementById("phpmyadmin-link")).href = phpmyadmin.url;

    if (!databases.available) {
        document.getElementById("db-total").textContent = "";
        document.getElementById("db-table").innerHTML = `<tr><td class="empty">MariaDB is not running. Start it from Services.</td></tr>`;
        return;
    }
    const total   = databases.list.reduce((sum, db) => sum + db.size, 0);
    const largest = Math.max(1, ...databases.list.map((db) => db.size));
    document.getElementById("db-total").textContent = `${databases.list.length} · ${bytes(total)}`;
    document.getElementById("db-table").innerHTML = `
        <thead><tr><th>Database</th><th class="num">Tables</th><th class="num">Size</th><th></th></tr></thead>
        <tbody>
            ${databases.list.map((db) => `
                <tr>
                    <td class="mono"><strong>${esc(db.name)}</strong></td>
                    <td class="num">${db.tables}</td>
                    <td class="num">
                        <div class="size-bar">
                            <span>${bytes(db.size)}</span>
                            <div class="meter"><div style="width:${Math.max(2, (db.size / largest) * 100)}%"></div></div>
                        </div>
                    </td>
                    <td class="num"><a href="${esc(db.url)}" target="_blank" rel="noopener">Open →</a></td>
                </tr>
            `).join("")}
        </tbody>
    `;
}
