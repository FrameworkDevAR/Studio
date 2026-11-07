# Studio

A control panel for the local development stack, in the browser: Apache, MariaDB, PHP,
Node.js and Redis from Homebrew, and the apps and servers of each project. It starts
and stops them, changes PHP's settings and Apache's modules, installs pecl extensions
and npm packages, works with the databases, and reads the logs. Everything stays on
the machine.

## Setting it up

```
./setup.sh
```

It asks before each step, and skips what is already there, so it can be run again
to update:

- **Homebrew**: Apache, PHP, MariaDB, Redis, Node.js, mkcert, SwiftBar and phpMyAdmin.
  It offers their updates and restarts the services they change. When PHP moves to a
  new minor version, it moves Studio's PHP settings and rebuilds the pecl extensions.
- **Apache**: what the vhosts need in `httpd.conf`, checked with `configtest` and
  undone if it fails; mkcert's authority; the hosts file, made yours so Studio can
  write it; phpMyAdmin, signing in by itself for this Mac only; and the log rotation.
- **Studio**: the config, node in `/usr/local/bin` for SwiftBar, and the plugin in
  SwiftBar's folder.

It starts none of the stack: Studio's Services page does.

## Running it

```
backend/main.js
```

It answers on [http://localhost:9900](http://localhost:9900), and only there. The
**🎛️ Studio** entry of the SwiftBar menu starts it and opens the page. It needs no
packages: see `CLAUDE.md` for how the code is laid out.

`swiftbar.10s.js` is the menu bar plugin, for the stack, the apps and the servers. The
`10s` in its name is how often it redraws.

## The config

What is particular to a machine lives in `config/config.json` (or the file
`STUDIO_CONFIG` names), which git ignores. The setup makes it, and
`config/config.example.json` shows its shape.

It holds `paths`, where the stack's files are, the apps Studio opens things with, and
`projects`.

`paths` are Homebrew's own unless set, so it only needs the ones that differ:

- `homebrew`: Homebrew's folder, where `brew`, `httpd` and `apachectl` are found.
- `httpdConf`, `vhosts`: Apache's config and its virtual hosts.
- `phpIni`: the file holding the PHP settings Studio changes. `{php}` stands for the
  PHP version linked, like `8.5`.
- `mysqlData`: MariaDB's data folder, where its log is found.
- `mysqlCnf`: the file holding the MariaDB options Studio changes, read after `my.cnf`.
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
- `host`: the host Apache serves the project's folder at, as `shop.local`, with
  `"https" : true` when it is served over https. The project's dialog writes its vhost.
- `worktrees`: `true` when every subfolder of `dir` is a project of its own, the
  worktrees of one repository, each titled from its folder. `name` then names their
  desktop apps in the menu.
- `mainApp`, `nestedApp`: the app listed first, and the folder holding a web app
  inside another app's folder. They are `desktop` and `web` unless set.
- `menu`: `false` leaves the project out of the SwiftBar menu; Studio still lists it.
  The project's dialog sets it.
- `sites`: what the project serves, each with a `name`. One with a `command` is a server
  the menu starts: an `id`, its folder, and the command, with its arguments, as typed in
  a shell (`npm run dev --port=3000`). The port is the server's own: it is found by what
  listens from that folder. A `host`, as `docs.shop.local`, opens it there rather than
  at localhost; the project's dialog adds it to the hosts file. One without a `command`
  is Apache's: the `host` it is served at, with `"https" : true` when over https. Its
  folder is its vhost's, and with no vhost it is only a link. Apache's sites are only
  listed, never checked. The project's `name` titles them.

A project's vhost and those of its sites are found by their host in the vhosts file:
the project's dialog writes them there, with their line in the hosts file and their
certificate. The Sites page's Virtual hosts tab adds, changes and removes the vhosts
that are no project's the same way; a project's open its dialog, and those on localhost
the file.

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

## The logs

Homebrew's Apache never rotates its logs. The setup has the Mac's newsyslog do it, in
`/etc/newsyslog.d/homebrew-httpd.conf`: at 10 MB a log is gzipped, keeping the last 3,
and Apache reopens it. Studio counts the rotated copies in a log's size, and deletes
them when it clears the log.
