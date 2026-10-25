# Studio

A local control panel for the Homebrew dev stack (Apache, MariaDB, PHP, Node.js, Redis), and
the apps and servers of each project. See the README.

- `backend/` is the server. `server.js` answers the page and the api; the rest is in folders
  by what it covers, a file per part:
  - `core/`: `system.js` with the paths and helpers the others share, `paths.js` with the
    stack's paths and their defaults (for the plugin too), `config.js`, and `jobs.js`, which
    runs the npm and pecl installs the page follows as they go.
  - `stack/`: `services.js`, `apache.js`, PHP's `php.js` (settings and overrides), `ini.js`
    (asking PHP, the ini files) and `pecl.js` (extensions), `node.js` and `logs.js`.
  - `apps/`: the projects' apps and their icons.
  - `database/`: `databases.js` (databases and users), `mariadb.js` (MariaDB's options), and
    a database's own page: `client.js` (the mariadb client every query goes through),
    `schema.js`, `rows.js`, `structure.js`, `tables.js`, `sql.js`, `exports.js`, `imports.js`.
- `desktop/` is the whole page: `index.html`, its stylesheets in `styles/`, icons in `icons/`,
  fonts in `fonts/`, and its script in
  `src/`: `core/` (state, helpers, routes, the editor and the selects, clicks and start),
  `pages/` (a file per page, with `settings.js`, the settings panels PHP and MariaDB share)
  and `database/` (a database's own page, a file per part). They are plain scripts sharing
  one scope, loaded in order by `index.html`, with `core/state.js` first and `core/start.js`,
  which calls into the others, last. The stylesheets are loaded in order too, and the
  cascade depends on it.
- `swiftbar.10s.js` is the SwiftBar menu plugin, which SwiftBar runs through a link in
  `~/Documents/SwiftBar/`. It is the entry; its parts are in `swiftbar/`, which node finds
  through the link.
- `config/` holds the config and its example.

## Commits

- Only commit when the user says to. Finishing a change is not a request to commit
  it; leave it uncommitted and say it is ready. The same for pushing.
- End every message with `Co-Authored-By: Claude <noreply@anthropic.com>` — just
  "Claude", never a model name or version.
- Subjects are imperative and plain, as in the other repos: "Add the…", "Fix the…",
  "Ignore the…".
- Split work into several commits by what changed, when it makes sense.

## Code

- No dependencies: Node's own `http` on the server, plain JavaScript in the page. Do
  not add packages or a build step.
- Match the surrounding code: 4-space indents, double quotes, the colons of object
  literals aligned, `const` first. Files read top down — entry, then what it calls,
  then helpers — under `// ---- section ---` dividers.
- Lines are at most 100 characters, comments too. Requires are not aligned:
  `const fs = require("fs");`.
- A file that grows long (over about 600 lines) is split by what its parts cover, into
  the folder it belongs in. Backend modules never require each other in a circle.
- Comments say why, not what, in full sentences: a `/** */` above each function, and
  a block comment above any rule or step that would otherwise be "tidied away".
- Keep names plain and one word where possible, like the user's other projects
  (Framework, Runner, Diff, JSON).

## How it works — keep these

- It listens on `127.0.0.1:9900` only, answers only a Host of `localhost:9900` or
  `127.0.0.1:9900`, and every action is a POST with the `X-Studio: 1` header.
- Services start with `brew services run`, never `start` or `restart`: those install a
  LaunchAgent and the user wants nothing to come up at login. Redis is the exception,
  started with `start`, as in the SwiftBar plugin.
- The apps come from the SwiftBar plugin (`swiftbar.10s.js json`), so Studio and the
  menu always list the same ones.
- Nothing particular to the user's machine goes in the code: projects, servers, the
  stack's paths, the browser, the editor and the like belong in `config/config.json`,
  which git ignores, with `config/config.example.json` showing the shape with made-up
  values. This repo is public: never commit `config.json` or copy its values anywhere
  else.
- Both scripts start with `#!/usr/bin/env node`; SwiftBar finds node through a link in
  `/usr/local/bin`. Never put an absolute path to node in them. Starting and stopping go through the
  plugin's own actions (`start-app`, `stop-proc`, `start-extra`, `start-extras`).
- Never check sites by requesting them: the requests fill the Apache log with noise
  (folder listings log AH01630, some apps log PHP warnings). Apache sites are listed,
  never checked.
- Changes to `httpd.conf` keep a backup and are checked with `apachectl configtest`,
  and undone when it fails. Apache reloads with `apachectl -k graceful`.
- Logs are cleared by truncating in place, so the services keep writing to them.

## Design

- Colors are Tokyo Night: the Night palette in dark mode, the Day palette in light
  mode, with Tokyo Night Light's darker text. Every change must work in both.
- Titles, the logo's name and section headings use Noto Serif (bundled in
  `desktop/fonts/`, never loaded from Google). Everything else is the system sans.
- The logo follows the Framework one (a dark tile, a fine border, a bold serif
  letter), in Studio's violet.
- Tinted backgrounds mix their color into a solid base (`var(--field)`, `var(--panel)`),
  not into `transparent`, unless it sits on the log's dark field — over the panel it
  turns to mud.
- Radii scale with the element: 18px panels, 14px cards, 10–12px controls.

## Working on it

- The plugin's file name must stay `swiftbar.10s.js`: SwiftBar reads the redraw interval
  from it, and the plugin refreshes itself by that name (`refreshplugin?name=swiftbar`).
  After changing it, `open -g "swiftbar://refreshplugin?name=swiftbar"` redraws the menu.
- Restart the server by its port, not its name:
  `kill $(lsof -t -iTCP:9900 -sTCP:LISTEN); backend/server.js &`
- Check changes in a headless Chrome by measuring (the page's `state`, element sizes)
  rather than by screenshots where a number will do.
- Ask before anything that starts many apps at once, clears a log, or otherwise
  changes the user's running stack beyond what was asked.
