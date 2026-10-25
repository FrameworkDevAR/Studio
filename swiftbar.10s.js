#!/usr/bin/env node
//
// <xbar.title>Studio</xbar.title>
// <xbar.version>v2.5</xbar.version>
// <xbar.author>Tomas Malbran</xbar.author>
// <xbar.desc>Start and stop the local stack and the apps and servers of each project.</xbar.desc>
//
// Drop SwiftBar's own menu items, so the menu holds only what this prints.
// Preferences go with them: `open swiftbar://preferences` reaches them.
// <swiftbar.hideAbout>true</swiftbar.hideAbout>
// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
// <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
// <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
// <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>
//
// With no arguments it prints the menu, every 10s (from the file name). With
// one it runs that action: the menu items call this same file back.
//
// The projects and servers come from config/config.json (or STUDIO_CONFIG);
// config/config.example.json shows its shape.
//
// Keep these:
//
//   1. The shebang is `env node`: SwiftBar's PATH has /usr/local/bin, where
//      node is linked (see the README).
//   2. Apache and MariaDB start with `brew services run`, never `start`, so
//      nothing comes up at login.
//   3. Links use a bash= action, never href=, so a browser built on Chrome
//      can reuse a tab already on the page instead of opening a new one.

"use strict";

const { readState } = require("./swiftbar/state");
const {
    renderTitle, renderServices, renderProjects, renderAppsFooter, renderFooter
} = require("./swiftbar/menu");
const { runAction } = require("./swiftbar/actions");

main();


// ------------------------------------------------------------------- entry ---

/** Runs the clicked action, or prints the menu when there is no argument. */
function main() {
    const [ , , action, argument ] = process.argv;
    if (action) {
        runAction(action, argument);
        return;
    }
    renderMenu();
}

/** The whole menu, in the order it appears. */
function renderMenu() {
    const state = readState();

    renderTitle(state);
    renderServices(state);
    renderProjects(state);
    renderAppsFooter(state);
    renderFooter();
}
