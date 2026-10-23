# Studio

A control panel for the local development stack, that runs in the browser: Apache,
MariaDB, PHP, Node.js and Redis from Homebrew, and the apps and servers of each
project. It shows what is running, starts and stops it, changes the PHP settings and
the Apache modules, lists the databases and Node's global packages, and reads the
logs, and everything stays on the machine.

## Running it

```
backend/server.js
```

It answers on [http://localhost:9900](http://localhost:9900), and only there. It needs
no packages: the code in `backend/` runs on Node's own http server, and the page is in
`desktop/`.

The **🎛️ Studio** entry of the SwiftBar menu starts it when it is not running and
opens its page.

## The SwiftBar menu

`swiftbar.10s.js` is the menu bar plugin: the stack, the apps and the Framework servers,
started and stopped from the menu bar. SwiftBar runs it from its plugin folder, through
a link to this file; the `10s` in its name is how often it redraws.

SwiftBar runs plugins with a short PATH that has `/usr/local/bin` but not the folders
node usually lives in, and both files start with `#!/usr/bin/env node`. So node is
linked there too, once:

```
ln -s ~/GitHub/Studio/swiftbar.10s.js ~/Documents/SwiftBar/swiftbar.10s.js
ln -s "$(command -v node)" /usr/local/bin/node
```

## The config

What is particular to a machine lives in `config/config.json` (or in the file
`STUDIO_CONFIG` names). git ignores it, so it never leaves the machine. Copy
`config/config.example.json`, which shows its shape, to start one:

```
cp config/config.example.json config/config.json
```

It holds `paths`, where the stack's files are, the apps Studio opens things with, and
`projects`.

`paths` are Homebrew's own unless set, so it only needs the ones that differ:

- `homebrew`: Homebrew's folder, where `brew`, `httpd` and `apachectl` are found.
- `httpdConf`, `vhosts`: Apache's config and its virtual hosts.
- `phpIni`: the file holding the PHP settings Studio changes. `{php}` stands for the
  PHP version linked, like `8.5`.
- `mysqlData`: MariaDB's data folder, where its log is found.
- `apacheLog`, `accessLog`, `redisLog`: the other logs.

Then what opens what, each optional:

- `browser`: the browser for the pages, like `"Google Chrome"`. One built on Chrome
  (Chrome, Brave, Edge, Vivaldi) shows the tab already on a page instead of opening
  another. Without it, the Mac's default browser.
- `editor`: the app for the config files, like `"Visual Studio Code"`. Without it, the
  Mac's default text editor.
- `phpMyAdmin`: where phpMyAdmin answers, `http://localhost/phpmyadmin` unless set.

`projects` are the projects, in the order the menu and Studio list them. Each is an
object with its own settings:

- `name`: the project's title. Without one, it is made from the folder's name.
- `dir`: the project's folder. Its apps are the folders in it with a `package.json`
  holding a `start` script, each called by its folder's name.
- `worktrees`: `true` when every subfolder of `dir` is a project of its own, the
  worktrees of one repository, each titled from its folder. `name` then names their
  desktop apps in the menu.
- `mainApp`, `nestedApp`: the app listed first, and the folder holding a web app
  inside another app's folder. They are `desktop` and `web` unless set.
- `servers`: instead of a `dir`, servers of the project's own: an id, a name, its
  folder and the command that starts it. The port is the server's own: it is found
  by what listens from that folder. The project's `name` titles their section.

Folders may start with `~`.

## What it uses

- **Homebrew** for Apache (`httpd`), PHP, MariaDB and Redis, started with
  `brew services run`, so none of them comes up at login, and for Node.js (`node`),
  whose npm lists the global packages.
- **Simple Icons** for the logos on the Services page, which are CC0.
- **The SwiftBar plugin** for the apps: Studio asks it with `swiftbar.10s.js json`, so
  both list the same apps, found the same way, by their processes.
- **MariaDB** as the user running Studio, which Homebrew's MariaDB lets in through its
  socket. A `~/.my.cnf` can name another user.

## Rotating the logs

Homebrew's Apache never rotates its logs, and the access log grows quickly. Studio
shows their sizes and can clear them, and macOS's newsyslog can rotate them on its
own. Save this as `/etc/newsyslog.d/homebrew-httpd.conf`, with your user and group,
and the paths changed if Homebrew lives elsewhere:

```
# logfilename                           owner:group  mode count size(KB) when flags pid_file                              sig
/opt/homebrew/var/log/httpd/error_log   you:staff    644  3     10240    *    Z     /opt/homebrew/var/run/httpd/httpd.pid 30
/opt/homebrew/var/log/httpd/access_log  you:staff    644  3     10240    *    Z     /opt/homebrew/var/run/httpd/httpd.pid 30
```

At 10 MB a log is gzipped to `<log>.0.gz`, keeping the last 3, and Apache gets signal
30 (SIGUSR1, a graceful restart) to reopen its logs. Studio counts the rotated copies
in a log's size and deletes them when it clears the log.
