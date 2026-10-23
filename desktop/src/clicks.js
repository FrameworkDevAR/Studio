"use strict";

// Every click on the page, sent where it belongs.

function onClick(event) {
    // The page's own links change the view in place, without a reload.
    const link = event.target.closest("a[href^='/']");
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
        event.preventDefault();
        navigate(link.getAttribute("href"));
        return;
    }
    const expandable = event.target.closest(".recent-line.expandable");
    if (expandable) {
        expandable.classList.toggle("open");
        return;
    }
    const target = event.target.closest("button, input[data-module]");
    if (!target) {
        return;
    }

    if (target.dataset.copy !== undefined) {
        copyLogEntry(target);
    } else if (target.dataset.logBottom !== undefined) {
        scrollLogToBottom();
    } else if (target.dataset.appStart !== undefined || target.dataset.appStop !== undefined) {
        const which  = target.dataset.appId ? { id : target.dataset.appId } : { dir : target.dataset.appDir };
        const action = target.dataset.appStart !== undefined ? "app-start" : "app-stop";
        if (action === "app-start") {
            starting.set(which.id ? `id:${which.id}` : `dir:${which.dir}`, Date.now());
            renderSites();
        }
        act({ action, ...which }, target);
    } else if (target.dataset.clearLog) {
        clearLog(target.dataset.clearLog, target);
    } else if (target.dataset.groupStart) {
        const group = target.dataset.groupStart;
        const cards = [
            ...state.servers.filter((server) => server.project === group && !server.running).map((server) => `id:${server.id}`),
            ...state.apps.filter((app) => app.project === group && !app.running).map((app) => `dir:${app.dir}`),
        ];
        for (const key of cards) {
            starting.set(key, Date.now());
        }
        renderSites();
        act({ action : "group-start", group }, target);
    } else if (target.dataset.siteTab) {
        navigate(target.dataset.siteTab === "apache" ? "/sites/apache" : "/sites");
    } else if (target.dataset.service) {
        const { service, op } = target.dataset;
        const name = state.services[service].name;
        if (op === "stop") {
            ask({ title : `Stop ${name}?`, ok : "Stop", danger : true }).then((sure) => sure && act({ action : "service", service, op }, target));
        } else {
            act({ action : "service", service, op }, target);
        }
    } else if (target.dataset.action) {
        const action = target.dataset.action;
        if (action === "stop-all") {
            ask({ title : "Stop the services?", text : "Apache, MariaDB and Redis all stop, and the sites with them.", ok : "Stop all", danger : true })
                .then((sure) => sure && act({ action }, target));
        } else {
            act({ action }, target);
        }
    } else if (target.dataset.editConfig !== undefined) {
        openConfigEditor();
    } else if (target.dataset.closeConfig !== undefined) {
        closeConfigEditor();
    } else if (target.dataset.saveConfig !== undefined) {
        saveConfigEditor();
    } else if (target.dataset.openFile) {
        act({ action : "open-file", file : target.dataset.openFile }, target);
    } else if (target.dataset.save !== undefined) {
        saveSetting(target.closest(".setting"));
    } else if (target.dataset.module) {
        toggleModule(event, target);
    } else if (target.dataset.filter) {
        moduleFilter = target.dataset.filter;
        setActive(target);
        renderModules();
    } else if (target.classList.contains("toggle")) {
        const pressed = target.getAttribute("aria-pressed") !== "true";
        target.setAttribute("aria-pressed", String(pressed));
        // Turning Follow back on jumps to the newest lines, as it promises.
        loadLog(target.id === "log-follow" && pressed);
    } else if (target.dataset.log) {
        logName = target.dataset.log;
        setActive(target);
        loadLog(true);
    }
}
