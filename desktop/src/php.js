"use strict";

// The PHP page: its settings, and saving one.

/**
 * The settings, in groups. Skipped while a field is focused or has an unsaved
 * change, and when nothing changed, so it does not flicker every 5s.
 */
function renderPhp() {
    const { php } = state;
    document.getElementById("php-version").textContent  = php.version || "";
    document.getElementById("php-ini-file").textContent = php.iniFile;

    const box  = document.getElementById("php-settings");
    const key  = JSON.stringify(php.settings);
    const busy = box.contains(document.activeElement) || box.querySelector(".dirty");
    if (key !== settingsKey && !busy) {
        settingsKey = key;
        const byKey = Object.fromEntries(php.settings.map((setting) => [ setting.key, setting ]));
        box.innerHTML = SETTING_GROUPS.map((group) => `
            <div class="panel">
                <div class="panel-head"><h2>${group.title}</h2></div>
                ${group.keys.filter((one) => byKey[one]).map((one) => settingRow(byKey[one])).join("")}
            </div>
        `).join("") + `<datalist id="timezones">${php.timezones.map((zone) => `<option value="${esc(zone)}">`).join("")}</datalist>`;

        for (const field of /** @type {NodeListOf<HTMLInputElement>} */ (box.querySelectorAll("input, select"))) {
            field.addEventListener("input", markDirty);
            field.addEventListener("change", markDirty);
            field.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    saveSetting(field.closest(".setting"));
                }
                if (event.key === "Escape") {
                    field.value = /** @type {HTMLElement} */ (field.closest(".setting")).dataset.value;
                    markDirty({ target : field });
                }
            });
        }
    }

    document.getElementById("ext-count").textContent = String(php.extensions.length);
    document.getElementById("php-extensions").innerHTML = php.extensions.map((name) => {
        const pecl = php.pecl.includes(name.toLowerCase());
        return packageRow({ name, tag : pecl ? "pecl" : "" });
    }).join("");
    markColumnEnds(document.getElementById("php-extensions").parentElement);
}

function settingRow(setting) {
    let field;
    if (setting.options) {
        const options = setting.options.includes(setting.value) ? setting.options : [ setting.value, ...setting.options ];
        field = `<span class="field select"><select>${options.map((option) => `<option ${option === setting.value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></span>`;
    } else if (setting.timezone) {
        field = `<span class="field"><input list="timezones" value="${esc(setting.value)}" spellcheck="false"></span>`;
    } else {
        field = `<span class="field"><input value="${esc(setting.value)}" spellcheck="false"></span>`;
    }
    return `
        <div class="setting" data-key="${esc(setting.key)}" data-value="${esc(setting.value)}">
            <label>${esc(setting.key)}<small>${SETTING_HINTS[setting.key] || ""}${setting.inFile ? "" : " · PHP default"}</small></label>
            <button class="small" data-save>Save</button>
            ${field}
        </div>
    `;
}

function markDirty(event) {
    const row = event.target.closest(".setting");
    row.classList.toggle("dirty", event.target.value !== row.dataset.value);
}

async function saveSetting(row) {
    const field = row.querySelector("input, select");
    if (field.value === row.dataset.value) {
        return;
    }
    row.classList.remove("dirty");
    field.blur();
    settingsKey = "";
    await act({ action : "php-setting", key : row.dataset.key, value : field.value }, row.querySelector("button"));
}
