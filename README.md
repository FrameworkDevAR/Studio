# Studio

A control panel in the browser for the Homebrew stack (Apache, PHP, MariaDB, Redis,
Node.js) and the apps of each project. Everything stays on the machine.

## Setup

```
git clone https://github.com/FrameworkDevAR/Studio.git
cd Studio
./setup.sh
```

It installs the stack, readies Apache, writes the config and links the SwiftBar
plugin, asking before each step. Run it again at any time, or update the stack alone:

```
./setup.sh update        # the updates the config's versions allow
./setup.sh upgrade php   # past its range, as PHP 8.5 to 8.6
```

## Running it

```
backend/main.js
```

Then open [http://localhost:9900](http://localhost:9900), or use **🎛️ Studio** in the
SwiftBar menu. It needs no packages, and its settings are changed from Studio itself.

## What it uses

- **Homebrew** for the stack, started with `brew services run`, so nothing starts at login.
- **SwiftBar** for the menu, whose plugin also lists the apps for Studio.
- **Simple Icons** (CC0) for the logos.
