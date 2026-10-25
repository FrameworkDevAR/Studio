// Every click on the page, sent where it belongs.

import { act } from "./api.js";
import { closeEditor, insertSetting, openApacheConfig, openEditor, saveEditor } from "./editor.js";
import { ask, setActive, toggleMenu } from "./helpers.js";
import { navigate } from "./routes.js";
import { setLogName, setModuleFilter, starting, state } from "./state.js";
import { openRowDialog, rowAction } from "../database/cells.js";
import { columnAction, openColumnDialog } from "../database/columns.js";
import { importDatabase, openExportDialog } from "../database/export.js";
import { copyCreate, resetNext, saveInfo } from "../database/info.js";
import { browsePath, countTable, sortOverview } from "../database/page.js";
import {
    addFilter,
    clearFilters,
    openCell,
    removeFilter,
    sortRows,
    toggleDates,
    turnPage,
} from "../database/rows.js";
import {
    clearSqlHistory,
    forgetSql,
    keepSql,
    openResultExport,
    renderSqlMenus,
    runSql,
    useSql,
} from "../database/sql.js";
import {
    dropForeignKey,
    dropIndex,
    followForeignKey,
    openForeignKeyDialog,
    openIndexDialog,
    pickIndexKind,
} from "../database/structure.js";
import {
    openTableDialog,
    switchDatabase,
    tableAction,
    toggleDbSwitch,
    toggleTableMenu,
} from "../database/tables.js";
import { renderModules, toggleInclude, toggleModule } from "../pages/apache.js";
import { dropDatabase, openDatabaseDialog, pickUserMode } from "../pages/databases.js";
import { clearLog, copyLogEntry, loadLog, scrollLogToBottom } from "../pages/logs.js";
import {
    confirmUpdateAll,
    installNpm,
    isUpdating,
    openNpmDialog,
    showUpdateProgress,
    uninstallPackage,
    updatePackages,
} from "../pages/node.js";
import { installPecl, openPeclDialog, rebuildExtension, uninstallExtension } from "../pages/php.js";
import {
    choosePick,
    discardSettings,
    pickSetting,
    saveSettings,
    toggleUnset,
} from "../pages/settings.js";
import { renderSites } from "../pages/sites.js";
import {
    copyPassword,
    dropUser,
    makePassword,
    openUserDialog,
    pickAccess,
    pickPreset,
    toggleAdvanced,
} from "../pages/users.js";



/**
 * A click anywhere on the page: a link of the page's own changes the view, a
 * line of the recent errors opens, and a button or switch does what its data
 * attributes say.
 * @param {MouseEvent} event
 * @returns {void}
 */
function onClick(event) {
    const clicked = /** @type {Element} */ (event.target);

    // The page's own links change the view in place, without a reload.
    const link = clicked.closest("a[href^='/']");
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
        event.preventDefault();
        navigate(link.getAttribute("href"));
        return;
    }

    const expandable = clicked.closest(".recent-line.expandable");
    if (expandable) {
        expandable.classList.toggle("open");
        return;
    }

    const target = /** @type {HTMLElement|null} */ (
        clicked.closest("button, input[data-module], input[data-include]")
    );
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
    } else if (target.dataset.npmUpdateAll !== undefined
        || target.dataset.peclUpdateAll !== undefined) {
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
    } else if (target.dataset.pickSetting) {
        pickSetting({ scope : target.dataset.pickSetting });
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
    } else if (target.dataset.editMariadb !== undefined) {
        openEditor("mariadb");
    } else if (target.dataset.browseTab) {
        navigate(browsePath(target.dataset.browseTab));
    } else if (target.dataset.cellOpen !== undefined) {
        openCell(target);
    } else if (target.dataset.asDate) {
        toggleDates(target.dataset.asDate);
    } else if (target.dataset.filterAdd !== undefined) {
        addFilter();
    } else if (target.dataset.filterRemove !== undefined) {
        removeFilter(Number(target.dataset.filterRemove));
    } else if (target.dataset.filterClear !== undefined) {
        clearFilters();
    } else if (target.dataset.countTable) {
        countTable(target);
    } else if (target.dataset.resetNext !== undefined) {
        resetNext(/** @type {HTMLButtonElement} */ (target));
    } else if (target.dataset.copyCreate !== undefined) {
        copyCreate();
    } else if (target.dataset.infoSave !== undefined) {
        saveInfo();
    } else if (target.dataset.fkAdd !== undefined) {
        openForeignKeyDialog();
    } else if (target.dataset.fkDrop) {
        dropForeignKey(target.dataset.fkDrop);
    } else if (target.dataset.fkFollow) {
        followForeignKey(Number(target.dataset.fkFollow), Number(target.closest("tr").dataset.row));
    } else if (target.dataset.dbSwitch !== undefined) {
        toggleDbSwitch();
    } else if (target.dataset.dbGo) {
        switchDatabase(target.dataset.dbGo);
    } else if (target.dataset.resultExport) {
        openResultExport(Number(target.dataset.resultExport));
    } else if (target.dataset.sqlUse) {
        useSql(target.dataset.sqlUse);
    } else if (target.dataset.sqlForget) {
        forgetSql(target.dataset.sqlForget);
    } else if (target.dataset.sqlKeep !== undefined) {
        keepSql();
    } else if (target.dataset.sqlClear !== undefined) {
        clearSqlHistory();
    } else if (target.dataset.sqlCurrent !== undefined) {
        runSql("current");
    } else if (target.dataset.sqlExplain !== undefined) {
        runSql("explain");
    } else if (target.dataset.menu) {
        if (target.dataset.menu.startsWith("sql-")) {
            renderSqlMenus();
        }
        toggleMenu(target);
    } else if (target.dataset.indexAdd !== undefined) {
        openIndexDialog();
    } else if (target.dataset.indexKind) {
        pickIndexKind(target);
    } else if (target.dataset.indexDrop) {
        dropIndex(target.dataset.indexDrop);
    } else if (target.dataset.overviewSort) {
        sortOverview(target.dataset.overviewSort);
    } else if (target.dataset.sort) {
        sortRows(target.dataset.sort);
    } else if (target.dataset.page) {
        turnPage(Number(target.dataset.page));
    } else if (target.dataset.rowNew !== undefined) {
        openRowDialog();
    } else if (target.dataset.columnAct) {
        columnAction(target.dataset.columnAct);
    } else if (target.dataset.columnAdd !== undefined) {
        openColumnDialog();
    } else if (target.dataset.tableMenu !== undefined) {
        toggleTableMenu(target);
    } else if (target.dataset.tableAct) {
        tableAction(target.dataset.tableAct);
    } else if (target.dataset.tableAdd !== undefined) {
        openTableDialog();
    } else if (target.dataset.rowAct) {
        rowAction(target.dataset.rowAct);
    } else if (target.dataset.sqlRun !== undefined) {
        runSql();
    } else if (target.dataset.dbExport !== undefined) {
        openExportDialog();
    } else if (target.dataset.dbImport !== undefined) {
        importDatabase();
    } else if (target.dataset.dbTab) {
        navigate(target.dataset.dbTab === "databases" ? "/databases"
            : `/databases/${target.dataset.dbTab}`);
    } else if (target.dataset.dbNew !== undefined) {
        openDatabaseDialog();
    } else if (target.dataset.dbEdit) {
        openDatabaseDialog(target.dataset.dbEdit);
    } else if (target.dataset.dbDrop) {
        dropDatabase(target.dataset.dbDrop);
    } else if (target.dataset.userNew !== undefined) {
        openUserDialog();
    } else if (target.dataset.userEdit) {
        openUserDialog(target.dataset.userEdit);
    } else if (target.dataset.userDrop) {
        dropUser(target.dataset.userDrop);
    } else if (target.dataset.userMode) {
        pickUserMode(target);
    } else if (target.dataset.access) {
        pickAccess(target);
    } else if (target.dataset.preset) {
        pickPreset(target);
    } else if (target.dataset.advanced !== undefined) {
        toggleAdvanced(target);
    } else if (target.dataset.makePassword !== undefined) {
        /** @type {HTMLInputElement} */ (target.parentElement.querySelector("input")).value =
            makePassword();
    } else if (target.dataset.copyPassword !== undefined) {
        copyPassword(target);
    } else if (target.dataset.closeForm !== undefined) {
        /** @type {HTMLDialogElement} */ (document.getElementById("form")).close();
    } else if (target.dataset.unset !== undefined) {
        toggleUnset(target.closest(".setting"));
    } else if (target.dataset.logBottom !== undefined) {
        scrollLogToBottom();
    } else if (target.dataset.appStart !== undefined || target.dataset.appStop !== undefined) {
        const which  = target.dataset.appId ? { id : target.dataset.appId }
            : { dir : target.dataset.appDir };
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
            ...state.servers.filter((server) => server.project === group && !server.running)
                .map((server) => `id:${server.id}`),
            ...state.apps.filter((app) => app.project === group && !app.running)
                .map((app) => `dir:${app.dir}`),
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
            ask({ title : `Stop ${name}?`, ok : "Stop", danger : true })
                .then((sure) => sure && act({ action : "service", service, op }, target));
        } else {
            act({ action : "service", service, op }, target);
        }
    } else if (target.dataset.action) {
        const action = target.dataset.action;
        if (action === "stop-all") {
            ask({
                title  : "Stop the services?",
                text   : "Apache, MariaDB and Redis all stop, and the sites with them.",
                ok     : "Stop all",
                danger : true,
            }).then((sure) => sure && act({ action }, target));
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
        act({
            action : "open-file",
            file   : target.dataset.openFile,
            path   : target.dataset.openPath,
        }, target);
    } else if (target.dataset.saveSettings) {
        saveSettings(target.dataset.saveSettings);
    } else if (target.dataset.discardSettings) {
        discardSettings(target.dataset.discardSettings);
    } else if (target.dataset.module) {
        toggleModule(event, /** @type {HTMLInputElement} */ (target));
    } else if (target.dataset.include) {
        toggleInclude(event, /** @type {HTMLInputElement} */ (target));
    } else if (target.dataset.filter) {
        setModuleFilter(target.dataset.filter);
        setActive(target);
        renderModules();
    } else if (target.classList.contains("toggle")) {
        const pressed = target.getAttribute("aria-pressed") !== "true";
        target.setAttribute("aria-pressed", String(pressed));
        // Turning Follow back on jumps to the newest lines, as it promises.
        loadLog(target.id === "log-follow" && pressed);
    } else if (target.dataset.log) {
        setLogName(target.dataset.log);
        setActive(target);
        loadLog(true);
    }
}



// The public API
export {
    onClick,
};
