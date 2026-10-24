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
    const target = event.target.closest("button, input[data-module], input[data-include]");
    if (!target) {
        return;
    }

    if (target.dataset.copy !== undefined) {
        copyLogEntry(target);
    } else if (target.dataset.npmUpdate) {
        updatePackages([ target.dataset.npmUpdate ]);
    } else if (target.dataset.npmOpen !== undefined) {
        openNpmDialog();
    } else if (target.dataset.closeNpm !== undefined) {
        /** @type {HTMLDialogElement} */ (document.getElementById("npm-dialog")).close();
    } else if (target.dataset.npmInstall) {
        installNpm(target.dataset.npmInstall);
    } else if (target.dataset.npmUninstall) {
        uninstallPackage(target.dataset.npmUninstall);
    } else if (target.dataset.npmUpdateAll !== undefined || target.dataset.peclUpdateAll !== undefined) {
        // While an update runs, the button opens its progress again.
        const kind = target.dataset.peclUpdateAll !== undefined ? "pecl" : "npm";
        if (isUpdating(kind)) {
            showUpdateProgress();
        } else {
            confirmUpdateAll(kind);
        }
    } else if (target.dataset.peclUpdate) {
        updatePackages([ target.dataset.peclUpdate ], "pecl");
    } else if (target.dataset.peclOpen !== undefined) {
        openPeclDialog();
    } else if (target.dataset.closePecl !== undefined) {
        /** @type {HTMLDialogElement} */ (document.getElementById("pecl-dialog")).close();
    } else if (target.dataset.peclInstall) {
        installPecl(target.dataset.peclInstall);
    } else if (target.dataset.peclRemove) {
        uninstallExtension(target.dataset.peclRemove);
    } else if (target.dataset.peclRebuild) {
        rebuildExtension(target.dataset.peclRebuild);
    } else if (target.dataset.pickSetting !== undefined) {
        addSetting();
    } else if (target.dataset.closePick !== undefined) {
        /** @type {HTMLDialogElement} */ (document.getElementById("pick")).close();
    } else if (target.dataset.pickKey) {
        choosePick(target.dataset.pickKey);
    } else if (target.dataset.insertSetting !== undefined) {
        insertSetting();
    } else if (target.dataset.editApache) {
        openEditor(target.dataset.editApache);
    } else if (target.dataset.editInclude) {
        openApacheConfig(target.dataset.editInclude);
    } else if (target.dataset.apacheTab) {
        navigate(target.dataset.apacheTab === "configs" ? "/apache/configs" : "/apache");
    } else if (target.dataset.editPhp !== undefined) {
        openEditor("php");
    } else if (target.dataset.unset !== undefined) {
        toggleUnset(target.closest(".setting"));

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
    } else if (target.dataset.phpTab) {
        navigate(target.dataset.phpTab === "extensions" ? "/php/extensions" : "/php");
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
        openEditor("config");
    } else if (target.dataset.closeEditor !== undefined) {
        closeEditor();
    } else if (target.dataset.saveEditor !== undefined) {
        saveEditor();
    } else if (target.dataset.openFile) {
        act({ action : "open-file", file : target.dataset.openFile, path : target.dataset.openPath }, target);
    } else if (target.dataset.phpSave !== undefined) {
        saveSettings();
    } else if (target.dataset.phpDiscard !== undefined) {
        discardSettings();
    } else if (target.dataset.module) {
        toggleModule(event, target);
    } else if (target.dataset.include) {
        toggleInclude(event, target);
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
