#!/bin/bash
# Sets up this Mac for Studio, asking before each part that changes it:
#   ./setup.sh               installs what is missing, readies Apache, makes the config and
#                            links the menu, and offers the updates
#   ./setup.sh update        updates what the config's "versions" allow, and nothing else
#   ./setup.sh upgrade php   updates PHP past its range, as to a new minor version, moving the
#                            range in the config to take it
# It installs Homebrew's Apache, PHP, MariaDB, Redis, Node.js and mkcert, turns on what the
# vhosts need in Apache's config, which is kept and checked first, and links the SwiftBar
# plugin. It can be run again, and skips what is already there.

# It is written for bash, and a shell that is not, like zsh, hands it to bash, where it starts
# again from here. It is a bash script rather than a node one, as node may not be installed yet
if [ -z "$BASH_VERSION" ]; then
    exec bash "$0" "$@"
fi
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
ROOT=$(pwd)

if [ "$(uname -s)" != Darwin ]; then
    echo "Studio runs on a Mac only"
    exit 1
fi

# What Studio runs, from Homebrew, with how the setup names each
FORMULAS=(httpd php mariadb redis node mkcert)
LABELS=(Apache PHP MariaDB Redis Node.js mkcert)

# The services, which a restart after an update stops and starts again as Studio does: with
# brew services run, so none comes up at login, but for Redis, which Studio starts with start
SERVICES=(httpd mariadb redis)

# The newsyslog file that rotates Apache's logs, which nothing else rotates
NEWSYSLOG=/etc/newsyslog.d/homebrew-httpd.conf

# The SwiftBar plugin, and where SwiftBar keeps its plugins unless it was told another folder
PLUGIN=swiftbar.10s.js
PLUGINS_DEFAULT=~/Documents/SwiftBar
STUDIO_URL=http://localhost:9900

TMP=$(mktemp -d)
LOG=$TMP/log
STATUS=$TMP/status
DETAIL=$TMP/detail
RUN_PID=""
STOPPED="The setup stopped, it can be run again once that is fixed"



# The look of the wizard
R=$'\e[0m'
BOLD=$'\e[1m'
DIM=$'\e[2m'
RED=$'\e[31m'
GREEN=$'\e[32m'
YELLOW=$'\e[33m'
MAGENTA=$'\e[35m'
CYAN=$'\e[36m'
GRAY=$'\e[90m'
BAR="${GRAY}│${R}"

# Prints the title of the wizard, from Studio's violet to its blue, left to right, as Tokyo
# Night has them, and what it does
banner() {
    local lines=(
        "▄▀▀ ▀█▀ █ █ █▀▄ █ ▄▀▄"
        "▄▄▀  █  █▄█ █▄▀ █ ▀▄▀"
    )
    local line out i n
    echo
    for line in "${lines[@]}"; do
        n=${#line}
        out=""
        for ((i = 0; i < n; i++)); do
            printf -v out '%s\e[38;2;%d;%d;%dm%s' "$out" $((187 - 65 * i / n)) \
                $((154 + 8 * i / n)) 247 "${line:$i:1}"
        done
        printf '  %s%s\n' "$out" "$R"
    done
    printf '\n  %s%s%s\n\n' "$DIM" "$1" "$R"
}

# Prints the start of the wizard
intro() {
    printf '%s┌%s  %s%s%s\n%s\n' "$GRAY" "$R" "$BOLD" "$1" "$R" "$BAR"
}

# Prints the title of a part of the wizard
section() {
    printf '%s◆%s  %s%s%s\n%s\n' "$CYAN" "$R" "$BOLD" "$1" "$R" "$BAR"
}

# Prints the end of the wizard
outro() {
    printf '%s└%s  %s\n\n' "$GRAY" "$R" "$1"
}

# Prints a question that was answered, with its answer
answered() {
    printf '%s◇%s  %s\n%s  %s%s%s\n%s\n' "$GREEN" "$R" "$1" "$BAR" "$DIM" "$2" "$R" "$BAR"
}

# Prints a note with the lines under it, as what a question is about to change
note() {
    local line
    printf '%s◇%s  %s\n' "$YELLOW" "$R" "$1"
    shift
    for line in "$@"; do
        printf '%s  %s·  %s%s\n' "$BAR" "$DIM" "$line" "$R"
    done
    printf '%s\n' "$BAR"
}

# Prints a step that has nothing to do, as one that ran, with what is there
already() {
    printf '%s  %s✓%s %s%s\n' "$BAR" "$GREEN" "$R" "$1" "${2:+  ${DIM}·  $2$R}"
}

# Prints a step that is left out, with the reason
passed() {
    printf '%s  %s– %s  ·  %s%s\n' "$BAR" "$GRAY" "$1" "$2" "$R"
}

# Asks to choose one of the options with the arrows and leaves its index in CHOICE. An option
# can have a hint after a |, which is shown dimmed next to it
choose() {
    local question=$1 selected=$2 key i label hint
    shift 2
    local options=("$@")
    local count=$#
    tput civis 2>/dev/null
    printf '%s◆%s  %s\n' "$CYAN" "$R" "$question"
    while true; do
        for ((i = 0; i < count; i++)); do
            label=${options[$i]%%|*}
            hint=""
            [[ "${options[$i]}" == *"|"* ]] && hint=${options[$i]#*|}
            if [ "$i" -eq "$selected" ]; then
                printf '\e[2K%s│%s  %s●%s %s%s\n' "$CYAN" "$R" "$GREEN" "$R" "$label" \
                    "${hint:+  $DIM$hint$R}"
            else
                printf '\e[2K%s│%s  %s○ %s%s\n' "$CYAN" "$R" "$DIM" "$label" "$R"
            fi
        done
        printf '\e[2K%s└%s\n' "$CYAN" "$R"
        IFS= read -rsn1 key </dev/tty
        if [ "$key" = $'\e' ]; then
            read -rsn2 key </dev/tty
        fi
        case "$key" in
            "[A"|k) selected=$(((selected - 1 + count) % count)) ;;
            "[B"|j) selected=$(((selected + 1) % count)) ;;
            "") break ;;
        esac
        printf '\e[%dA' $((count + 1))
    done
    printf '\e[%dA\e[J' $((count + 2))
    tput cnorm 2>/dev/null
    CHOICE=$selected
    answered "$question" "${options[$selected]%%|*}"
}

# Asks to pick any of the options, all picked at first: the arrows move, space picks one or
# leaves it, a picks all or none, and Enter goes on. Leaves the indexes picked in PICKED. An
# option can have a hint after a |, which is shown dimmed next to it
pick() {
    local question=$1 at=0 key i label hint mark count any
    shift
    local options=("$@") on=() labels=() ticked=${PICK_ON:-$#}
    count=$#
    for ((i = 0; i < count; i++)); do
        on[$i]=$((i < ticked ? 1 : 0))
    done

    tput civis 2>/dev/null
    printf '%s◆%s  %s  %s↑↓ move · space picks · a all · enter goes on%s\n' "$CYAN" "$R" \
        "$question" "$DIM" "$R"
    while true; do
        for ((i = 0; i < count; i++)); do
            label=${options[$i]%%|*}
            hint=""
            [[ "${options[$i]}" == *"|"* ]] && hint=${options[$i]#*|}
            # Braced, as bash 3 reads a character like ◻ after a name as part of it
            mark="${DIM}◻${R}"
            [ "${on[$i]}" -eq 1 ] && mark="${GREEN}◼${R}"
            if [ "$i" -eq "$at" ]; then
                printf '\e[2K%s│%s  %s %s%s\n' "$CYAN" "$R" "$mark" "$label" \
                    "${hint:+  $DIM$hint$R}"
            else
                printf '\e[2K%s│%s  %s %s%s%s%s\n' "$CYAN" "$R" "$mark" "$DIM" "$label" \
                    "${hint:+  $hint}" "$R"
            fi
        done
        printf '\e[2K%s└%s\n' "$CYAN" "$R"
        IFS= read -rsn1 key </dev/tty
        if [ "$key" = $'\e' ]; then
            read -rsn2 key </dev/tty
        fi
        case "$key" in
            "[A"|k) at=$(((at - 1 + count) % count)) ;;
            "[B"|j) at=$(((at + 1) % count)) ;;
            " ") on[$at]=$((1 - on[$at])) ;;
            a)
                # All, unless all are picked already, which leaves none
                any=0
                for ((i = 0; i < count; i++)); do
                    [ "${on[$i]}" -eq 0 ] && any=1
                done
                for ((i = 0; i < count; i++)); do
                    on[$i]=$any
                done
                ;;
            "") break ;;
        esac
        printf '\e[%dA' $((count + 1))
    done
    printf '\e[%dA\e[J' $((count + 2))
    tput cnorm 2>/dev/null

    PICKED=()
    for ((i = 0; i < count; i++)); do
        if [ "${on[$i]}" -eq 1 ]; then
            PICKED+=("$i")
            labels+=("${options[$i]%%|*}")
        fi
    done
    if [ ${#labels[@]} -gt 0 ]; then
        answered "$question" "$(joined "${labels[@]}")"
    else
        answered "$question" "none"
    fi
}

# Asks for the password of this Mac once, for the steps that need sudo, which then run with it
sudo_once() {
    sudo -n true 2>/dev/null && return 0
    printf '%s◆%s  %s\n' "$CYAN" "$R" "$1"
    if ! sudo -v -p "${CYAN}│${R}  Password: " </dev/tty; then
        outro "${RED}No password${R}, $STOPPED"
        exit 1
    fi
    printf '\e[2A\e[J'
    answered "$1" "given"
}

# Shows what a running step is doing next to its title
status() {
    echo "$1" >"$STATUS"
}

# Gives the text shown next to the title of a step once it ends
detail() {
    echo "$1" >"$DETAIL"
}

# Ends a step that could not be done, with the reason, and the setup goes on
skip() {
    detail "$1"
    exit 3
}

# Runs a step with a spinner, and stops the setup with what it printed when it fails. The step
# runs apart with its errors stopping it, and takes no input. Next to the title goes what the
# step says it is doing, or else the last line it printed, as brew's
run() {
    local title=$1 frame=0 code=0 text width
    local frames=("◒" "◐" "◓" "◑")
    shift
    : >"$STATUS"
    : >"$DETAIL"
    (set -e; "$@") >"$LOG" 2>&1 </dev/null &
    RUN_PID=$!
    tput civis 2>/dev/null
    while kill -0 "$RUN_PID" 2>/dev/null; do
        text=$(cat "$STATUS")
        if [ -z "$text" ]; then
            text=$(tail -n 1 "$LOG" 2>/dev/null)
            text=${text##*$'\r'}
            text=$(printf '%s' "$text" | sed $'s/\e\\[[0-9;]*[A-Za-z]//g')
        fi
        width=$(($(tput cols) - ${#title} - 12))
        [ $width -gt 1 ] && [ ${#text} -gt $width ] && text="${text:0:$((width - 1))}…"
        printf '\r\e[2K%s%s%s  %s%s' "$MAGENTA" "${frames[$((frame % 4))]}" "$R" "$title" \
            "${text:+  ${DIM}·  $text$R}"
        frame=$((frame + 1))
        sleep 0.12
    done
    wait "$RUN_PID" || code=$?
    RUN_PID=""
    tput cnorm 2>/dev/null
    text=$(cat "$DETAIL")

    if [ $code -eq 0 ]; then
        printf '\r\e[2K%s  %s✓%s %s%s\n' "$BAR" "$GREEN" "$R" "$title" \
            "${text:+  ${DIM}·  $text$R}"
        return 0
    fi

    # A step that could not be done, but that the setup goes on without, ends with skip
    if [ $code -eq 3 ]; then
        printf '\r\e[2K'
        passed "$title" "$text"
        return 0
    fi

    printf '\r\e[2K%s  %s■%s %s\n' "$BAR" "$RED" "$R" "$title"
    grep -v '^\s*$' "$LOG" | tail -n 8 | while IFS= read -r line; do
        printf '%s  %s%s%s\n' "$BAR" "$DIM" "$line" "$R"
    done
    printf '%s\n' "$BAR"
    outro "$RED${STOPPED%%,*}$R,${STOPPED#*,}"
    exit 1
}

# Ends the setup at something it was asked that cannot be done, saying what
stop() {
    outro "${RED}$1${R}"
    exit 1
}

cleanup() {
    tput cnorm 2>/dev/null
    rm -rf "$TMP"
}

cancel() {
    if [ -n "$RUN_PID" ]; then
        pkill -P "$RUN_PID" 2>/dev/null
        kill "$RUN_PID" 2>/dev/null
    fi
    printf '\r\e[2K\n'
    outro "${GRAY}Cancelled$R"
    exit 130
}

trap cleanup EXIT
trap cancel INT



# ---------------------------------------------------------------- homebrew ---

# Finds brew, on the PATH or where its installer puts it, which a new install is not on yet
find_brew() {
    local one
    BREW=$(command -v brew || true)
    for one in /opt/homebrew/bin/brew /usr/local/bin/brew; do
        [ -z "$BREW" ] && [ -x "$one" ] && BREW=$one
    done
    [ -n "$BREW" ] && PREFIX=$("$BREW" --prefix)
}

# Installs Homebrew with its own installer, which runs on its own with the password given
install_brew() {
    NONINTERACTIVE=1 /bin/bash -c \
        "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

# The version of a formula that is installed, from the folder its link points at
version_of() {
    basename "$(readlink "$PREFIX/opt/$1")"
}

# Installs a formula, or a cask with --cask
brew_install() {
    "$BREW" install "$@"
}

# Finds which of what is installed has a newer version, each as a line of its kind, name, the
# version installed and the new one, in the outdated file. Homebrew is updated first, so it
# knows the new ones; when it cannot be reached, what it knew is used
check_updates() {
    local formulas=() name
    for name in "${FORMULAS[@]}" phpmyadmin; do
        [ -d "$PREFIX/opt/$name" ] && formulas+=("$name")
    done

    status "brew update"
    "$BREW" update --quiet || detail "Homebrew could not be reached, from what it knew"

    # brew says it as "php (8.5.12) < 8.5.13", or "swiftbar (2.1.1) != 2.1.2" for a cask,
    # among its own lines, and a pinned one stays as it is. Two versions installed read as
    # (8.5.11, 8.5.12), kept as one word
    status "brew outdated"
    {
        [ ${#formulas[@]} -gt 0 ] && "$BREW" outdated --formula --verbose "${formulas[@]}" \
            | sed 's/, /,/g' | sed -n 's/^\([^ ]*\) (\([^)]*\)) < \([^ ]*\)$/formula \1 \2 \3/p'
        "$BREW" list --cask swiftbar >/dev/null 2>&1 && "$BREW" outdated --cask --verbose \
            swiftbar | sed -n 's/^\([^ ]*\) (\([^)]*\)) != \([^ ]*\)$/cask \1 \2 \3/p'
        true
    } >"$TMP/outdated"

    if [ ! -s "$TMP/outdated" ] && [ ! -s "$DETAIL" ]; then
        detail "up to date"
    fi
}

# Upgrades a formula, or a cask with --cask
brew_upgrade() {
    "$BREW" upgrade "$@"
}

# The label of a formula, or of a cask
label_of() {
    local i
    for i in "${!FORMULAS[@]}"; do
        [ "${FORMULAS[$i]}" = "$1" ] && printf '%s' "${LABELS[$i]}" && return
    done
    case $1 in
        phpmyadmin) printf 'phpMyAdmin' ;;
        swiftbar) printf 'SwiftBar' ;;
        *) printf '%s' "$1" ;;
    esac
}

# Offers the newer versions of what is installed, each with the versions it goes from and to,
# to pick which to update, then a restart of the running services they change, so they run
# the new ones. Those the config's "versions" hold come last, unpicked: picking one moves its
# range to take it. UPDATE is how it picks instead: "all" takes every one the ranges allow,
# and a list of names takes those, moving the ranges of the held ones
update_brew() {
    local kind name old new range i line options=() kinds=() names=() news=() nexts=()
    local picked=() moved=() held=0 pass
    run "Checking for updates" check_updates
    if [ ! -s "$TMP/outdated" ]; then
        printf '%s\n' "$BAR"
        if [ -n "${UPDATE:-}" ] && [ "$UPDATE" != all ]; then
            stop "Nothing to update: $UPDATE is up to date"
        fi
        return 0
    fi

    # Those in their range first, then the held ones, each with the range that would take it
    PHP_FROM=""
    PHP_TO=""
    PHP_EXTENSIONS=()
    for pass in allowed held; do
        while read -r kind name old new; do
            old=${old##*,}
            range=$(range_of "$name" "$old")
            if in_range "$new" "$range"; then
                [ $pass = allowed ] || continue
                nexts+=("")
                line="$(label_of "$name")|$old → $new"
            else
                [ $pass = held ] || continue
                nexts+=("$(moved_to "$range" "$new")")
                line="$(label_of "$name")|$old → $new  ·  held by $range"
                line+=", sets it to $(moved_to "$range" "$new")"
                held=$((held + 1))
            fi
            php_hint "$name" "$old" "$new"
            options+=("$line$HINT")
            kinds+=("$kind")
            names+=("$name")
            news+=("$new")
        done <"$TMP/outdated"
    done
    printf '%s\n' "$BAR"

    # Who picks: the checklist, the ranges, or the names given
    PICKED=()
    case ${UPDATE:-} in
        "")
            if [ ${#names[@]} -eq 1 ]; then
                PICK_ON=$((1 - held)) pick "An update is out, update it?" "${options[@]}"
            else
                PICK_ON=$((${#names[@]} - held)) pick \
                    "${#names[@]} updates are out, which should it update?" "${options[@]}"
            fi
            ;;
        all)
            for i in "${!names[@]}"; do
                if [ -z "${nexts[$i]}" ]; then
                    PICKED+=("$i")
                else
                    passed "$(label_of "${names[$i]}") ${news[$i]} is out" \
                        "held by its range, ./setup.sh upgrade ${names[$i]} moves it"
                fi
            done
            ;;
        *)
            for name in $UPDATE; do
                for i in "${!names[@]}"; do
                    [ "${names[$i]}" = "$name" ] && PICKED+=("$i") && continue 2
                done
                stop "Nothing to update: $name is up to date, or not installed"
            done
            ;;
    esac
    [ ${#PICKED[@]} -gt 0 ] || return 0

    # The held ones picked take their new ranges first, so the config says what is installed
    for i in "${PICKED[@]}"; do
        [ -n "${nexts[$i]}" ] && moved+=("${names[$i]} ${nexts[$i]}")
    done
    if [ ${#moved[@]} -gt 0 ]; then
        RANGES=("${moved[@]}")
        if [ -f config/config.json ]; then
            run "Moving the ranges in the config" write_ranges
        fi
    fi

    # PHP's settings and extensions only move with PHP
    PHP_TO_PICKED=""
    for i in "${PICKED[@]}"; do
        picked+=("${names[$i]}")
        [ "${names[$i]}" = php ] && PHP_TO_PICKED=$PHP_TO
        if [ "${kinds[$i]}" = cask ]; then
            run "Updating $(label_of "${names[$i]}")" brew_upgrade --cask "${names[$i]}"
        else
            run "Updating $(label_of "${names[$i]}")" brew_upgrade "${names[$i]}"
        fi
    done
    PHP_TO=$PHP_TO_PICKED

    if [ -n "$PHP_TO" ]; then
        run "Moving PHP's settings to $PHP_TO" move_settings
        for name in "${PHP_EXTENSIONS[@]}"; do
            run "Building $name for PHP $PHP_TO" build_extension "$name"
        done
    fi
    printf '%s\n' "$BAR"

    restart_services "${picked[@]}"
}

# What else an update of PHP to a new minor version does, as 8.5 to 8.6, in HINT for its
# option: the new one cannot load the extensions pecl built for the last, and reads its
# settings from a folder of its own, so both are moved over after it. Nothing for any other
php_hint() {
    HINT=""
    [ "$1" = php ] && [ "$(minor_of "$2")" != "$(minor_of "$3")" ] || return 0
    PHP_FROM=$(minor_of "$2")
    PHP_TO=$(minor_of "$3")
    read_extensions
    HINT="  ·  its settings move to $PHP_TO"
    if [ ${#PHP_EXTENSIONS[@]} -gt 0 ]; then
        HINT+=", and $(joined "${PHP_EXTENSIONS[@]}") are built again"
    fi
}

# The extensions pecl installed, by name, read before PHP is updated: the new PHP's pecl
# would not know them
read_extensions() {
    local name version state
    PHP_EXTENSIONS=()
    [ -x "$PREFIX/bin/pecl" ] || return 0
    while read -r name version state; do
        case $state in
            stable|beta|alpha|devel|snapshot) PHP_EXTENSIONS+=("$(lower "$name")") ;;
        esac
    done < <("$PREFIX/bin/pecl" list -c pecl 2>/dev/null)
}

# Copies the file of Studio's PHP settings to the new version's folder, where PHP now reads
# them, unless it has one already. A config that names one file for every version keeps it
move_settings() {
    local pattern from to
    pattern=$(sed -n 's/.*"phpIni"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        config/config.json 2>/dev/null || true)
    pattern=${pattern:-$PREFIX/etc/php/\{php\}/conf.d/99-local-dev.ini}
    pattern=${pattern/#\~/$HOME}
    if [[ "$pattern" != *"{php}"* ]]; then
        skip "the config names one file for every version"
    fi

    from=${pattern//\{php\}/$PHP_FROM}
    to=${pattern//\{php\}/$PHP_TO}
    [ -f "$from" ] || skip "there are none"
    [ -f "$to" ] && skip "$(tilde "$to") is there already"

    mkdir -p "$(dirname "$to")"
    cp "$from" "$to"
    detail "$(tilde "$to")"
}

# Builds an extension again, for the new PHP, answering pecl's questions with their defaults
# as Studio does, then makes the new php.ini load it, when pecl did not. One that does not
# build is left for Studio's PHP page, and the setup goes on
build_extension() {
    local ini=$PREFIX/etc/php/$PHP_TO/php.ini kind=extension
    local loads="^[[:space:]]*(zend_)?extension[[:space:]]*=[[:space:]]*\"?([^\"]*/)?$1(\\.so)?\"?"
    yes "" | PATH="$PREFIX/bin:$PREFIX/sbin:$PATH" "$PREFIX/bin/pecl" install -f "$1" \
        | tee "$TMP/pecl"
    grep -q '^install ok:' "$TMP/pecl" || skip "did not build, try it from Studio's PHP page"

    [ -f "$ini" ] || return 0
    if ! grep -Eq "$loads" "$ini"; then
        case $1 in
            xdebug|opcache|ioncube|blackfire) kind=zend_extension ;;
        esac
        cp "$ini" "$ini.bak"
        { printf '%s="%s.so"\n' "$kind" "$1"; cat "$ini.bak"; } >"$ini"
    fi
}

# Offers to restart the running services that the updates changed: Apache for itself and for
# PHP, which it loads, MariaDB and Redis. One that is not running starts on the new version
restart_services() {
    local service name updated wanted=() labels=()
    for service in "${SERVICES[@]}"; do
        updated=0
        for name in "$@"; do
            if [ "$name" = "$service" ] || { [ "$service" = httpd ] && [ "$name" = php ]; }; then
                updated=1
            fi
        done
        if [ $updated -eq 1 ] && is_running "$service"; then
            wanted+=("$service")
            labels+=("$(label_of "$service")")
        fi
    done
    [ ${#wanted[@]} -gt 0 ] || return 0

    choose "Restart $(joined "${labels[@]}")?" 0 "Yes|so they run the new versions" \
        "No|they run the new ones once started again"
    if [ "$CHOICE" -eq 0 ]; then
        for service in "${wanted[@]}"; do
            run "Restarting $(label_of "$service")" restart_service "$service"
        done
        printf '%s\n' "$BAR"
    fi
}

# Whether a service is running, found by its process as Studio finds it
is_running() {
    case $1 in
        httpd) pgrep -f "$PREFIX/opt/httpd/bin/httpd" ;;
        mariadb) pgrep -x mariadbd ;;
        redis) pgrep -x redis-server ;;
    esac >/dev/null
}

# Stops a service and starts it again, as Studio's restart does
restart_service() {
    local start=run
    [ "$1" = redis ] && start=start
    "$BREW" services stop "$1"
    "$BREW" services "$start" "$1"
}

# Homebrew, then what Studio runs from it, then SwiftBar, which only the menu needs, and
# phpMyAdmin, which only its button does
setup_brew() {
    local i missing=() names=()
    section "Homebrew"

    find_brew
    if [ -z "$BREW" ]; then
        choose "Homebrew is not installed, install it?" 0 \
            "Yes|from brew.sh, it asks for the password of this Mac" "No|stops the setup"
        if [ "$CHOICE" -ne 0 ]; then
            outro "${GRAY}Studio runs its stack from Homebrew, so the setup stopped$R"
            exit 0
        fi
        sudo_once "Password of this Mac, for Homebrew's installer"
        run "Installing Homebrew" install_brew
        find_brew
    else
        already "Homebrew" "$("$BREW" --version | head -n 1 | sed 's/Homebrew //')"
    fi

    for i in "${!FORMULAS[@]}"; do
        if [ -d "$PREFIX/opt/${FORMULAS[$i]}" ]; then
            already "${LABELS[$i]}" "$(version_of "${FORMULAS[$i]}")"
        else
            missing+=("$i")
            names+=("${LABELS[$i]}")
        fi
    done
    if [ -d /Applications/SwiftBar.app ]; then
        already "SwiftBar" "$(defaults read /Applications/SwiftBar.app/Contents/Info \
            CFBundleShortVersionString 2>/dev/null)"
    fi
    if [ -d "$PREFIX/opt/phpmyadmin" ]; then
        already "phpMyAdmin" "$(version_of phpmyadmin)"
    fi
    printf '%s\n' "$BAR"

    update_brew

    if [ ${#missing[@]} -gt 0 ]; then
        choose "Install $(joined "${names[@]}")?" 0 "Yes|with Homebrew" \
            "No|leaves them out, and what needs them"
        if [ "$CHOICE" -eq 0 ]; then
            for i in "${missing[@]}"; do
                run "Installing ${LABELS[$i]}" brew_install "${FORMULAS[$i]}"
            done
            printf '%s\n' "$BAR"
        fi
    fi

    if [ ! -d /Applications/SwiftBar.app ]; then
        choose "Install SwiftBar?" 0 "Yes|the menu bar app Studio's menu runs in" \
            "No|Studio runs without it"
        if [ "$CHOICE" -eq 0 ]; then
            run "Installing SwiftBar" brew_install --cask swiftbar
            printf '%s\n' "$BAR"
        fi
    fi

    if [ ! -d "$PREFIX/opt/phpmyadmin" ]; then
        choose "Install phpMyAdmin?" 0 "Yes|Studio's phpMyAdmin button opens it" \
            "No|Studio's own database pages do without it"
        if [ "$CHOICE" -eq 0 ]; then
            run "Installing phpMyAdmin" brew_install phpmyadmin
            printf '%s\n' "$BAR"
        fi
    fi
}

# ------------------------------------------------------------------ apache ---

# What httpd.conf lacks for the vhosts Studio writes, each as a key and what it is, in CHANGES.
# A part it already has, or that has no formula to need it, is left out
apache_changes() {
    CHANGES=()
    grep -q '^Listen 80$' "$CONF" || CHANGES+=("listen80|Listen on port 80, for http")
    grep -q '^Listen 443$' "$CONF" || CHANGES+=("listen443|Listen on port 443, for https")
    grep -q '^ServerName ' "$CONF" || CHANGES+=("name|Call the server localhost")

    local module
    for module in rewrite ssl socache_shmcb; do
        if grep -q "^#LoadModule ${module}_module " "$CONF"; then
            CHANGES+=("module:$module|Turn on mod_$module")
        fi
    done

    if [ -f "$LIBPHP" ] && ! grep -q '^LoadModule php_module ' "$CONF"; then
        CHANGES+=("php|Load PHP $(version_of php)")
    fi
    if [ -f "$LIBPHP" ] && grep -Eq '^[[:space:]]*DirectoryIndex index\.html$' "$CONF"; then
        CHANGES+=("index|Open index.php before index.html")
    fi
    if ! grep -qxF "Include $VHOSTS" "$CONF"; then
        CHANGES+=("include|Include the vhosts file")
    fi
    if grep -q "dummy-host" "$VHOSTS" 2>/dev/null; then
        CHANGES+=("vhosts|Replace Homebrew's sample vhosts with localhost")
    fi
    if [ -d "$PREFIX/opt/phpmyadmin" ] \
        && ! grep -qs '^[[:space:]]*Alias /phpmyadmin ' "$CONF" "$VHOSTS"; then
        CHANGES+=("phpmyadmin|Serve phpMyAdmin at /phpmyadmin")
    fi
}

# Makes one change of apache_changes to httpd.conf, or to the vhosts file
apache_change() {
    case $1 in
        listen80)
            if grep -q '^Listen 8080$' "$CONF"; then
                perl -pi -e 's/^Listen 8080$/Listen 80/' "$CONF"
            else
                perl -0pi -e 's/^(Listen .*)$/Listen 80\n$1/m' "$CONF"
            fi
            ;;
        listen443)
            perl -0pi -e 's/^(Listen 80)$/$1\nListen 443/m' "$CONF"
            ;;
        name)
            if grep -q '^#ServerName ' "$CONF"; then
                perl -0pi -e 's/^#ServerName .*$/ServerName localhost/m' "$CONF"
            else
                printf '\nServerName localhost\n' >>"$CONF"
            fi
            ;;
        module:*)
            MODULE=${1#module:} perl -pi -e 's/^#(LoadModule \Q$ENV{MODULE}\E_module )/$1/' \
                "$CONF"
            ;;
        php)
            # It goes after the last module, with the handler that sends .php files to it
            BLOCK="LoadModule php_module $LIBPHP"$'\n<FilesMatch \\.php$>\n'
            BLOCK+=$'    SetHandler application/x-httpd-php\n</FilesMatch>\n'
            BLOCK=$BLOCK perl -0pi -e 's/(.*^LoadModule [^\n]*\n)/$1$ENV{BLOCK}/ms' "$CONF"
            ;;
        index)
            perl -pi -e 's/^(\s*DirectoryIndex )index\.html$/$1index.php index.html/' "$CONF"
            ;;
        include)
            if grep -qxF "#Include $VHOSTS" "$CONF"; then
                FILE=$VHOSTS perl -pi -e 's/^#(Include \Q$ENV{FILE}\E)$/$1/' "$CONF"
            else
                printf '\nInclude %s\n' "$VHOSTS" >>"$CONF"
            fi
            ;;
        vhosts)
            write_vhosts
            ;;
        phpmyadmin)
            cat >>"$VHOSTS" <<EOT

# phpMyAdmin at http://localhost/phpmyadmin, for this Mac only: it signs in by itself
Alias /phpmyadmin $PREFIX/share/phpmyadmin
<Directory "$PREFIX/share/phpmyadmin">
    Options Indexes FollowSymLinks MultiViews
    AllowOverride All
    Require local
</Directory>
EOT
            ;;
    esac
}

# Writes the vhosts file anew, with localhost serving Apache's own folder: once a vhost is
# there, a name without one is served by the first, which this keeps localhost
write_vhosts() {
    local root
    root=$(sed -n 's/^DocumentRoot "\(.*\)"$/\1/p' "$CONF" | head -n 1)
    cat >"$VHOSTS" <<EOF
# The virtual hosts. Studio adds, changes and removes them, from a project's dialog and from
# the Sites page. The first answers for any name that has no vhost of its own.

<VirtualHost *:80>
    ServerName localhost
    DocumentRoot "${root:-$PREFIX/var/www}"
</VirtualHost>
EOF
}

# Makes the changes, with copies of both files kept as Studio keeps them, and checks them with
# configtest, which undoes them all when it fails. A running Apache reloads
change_apache() {
    local change
    cp "$CONF" "$CONF.bak-studio"
    [ -f "$VHOSTS" ] && cp "$VHOSTS" "$VHOSTS.bak-studio"

    for change in "${CHANGES[@]}"; do
        status "${change#*|}"
        apache_change "${change%%|*}"
    done

    status "Checking it with configtest"
    if ! "$APACHECTL" configtest; then
        cp "$CONF.bak-studio" "$CONF"
        [ -f "$VHOSTS.bak-studio" ] && cp "$VHOSTS.bak-studio" "$VHOSTS"
        echo "configtest failed, so httpd.conf is as it was"
        return 1
    fi

    if pgrep -f "$PREFIX/opt/httpd/bin/httpd" >/dev/null; then
        status "Reloading Apache"
        "$APACHECTL" -k graceful
        detail "reloaded"
    fi
}

# Apache's config, mkcert's authority, which the browsers trust the certificates of, and the
# hosts file, where Studio adds the vhosts' names
setup_apache() {
    section "Apache"

    CONF=$PREFIX/etc/httpd/httpd.conf
    VHOSTS=$PREFIX/etc/httpd/extra/httpd-vhosts.conf
    APACHECTL=$PREFIX/opt/httpd/bin/apachectl
    LIBPHP=$PREFIX/opt/php/lib/httpd/modules/libphp.so

    if [ ! -f "$CONF" ]; then
        passed "httpd.conf" "needs Apache"
    else
        apache_changes
        if [ ${#CHANGES[@]} -eq 0 ]; then
            already "httpd.conf" "has what the vhosts need"
        else
            printf '%s\n' "$BAR"
            local lines=() change
            for change in "${CHANGES[@]}"; do
                lines+=("${change#*|}")
            done
            note "httpd.conf needs a few changes for the vhosts" "${lines[@]}"
            choose "Change it?" 0 "Yes|kept as httpd.conf.bak-studio, undone if configtest fails" \
                "No|leaves it as it is"
            if [ "$CHOICE" -eq 0 ]; then
                run "Changing httpd.conf" change_apache
            fi
        fi
    fi

    if [ ! -d "$PREFIX/opt/mkcert" ]; then
        passed "mkcert's authority" "needs mkcert"
    elif security find-certificate -c mkcert /Library/Keychains/System.keychain \
        >/dev/null 2>&1; then
        already "mkcert's authority" "trusted"
    else
        printf '%s\n' "$BAR"
        choose "Trust mkcert's certificates?" 0 \
            "Yes|the browsers then open the https vhosts without a warning" "No"
        if [ "$CHOICE" -eq 0 ]; then
            sudo_once "Password of this Mac, for the keychain"
            status "the Mac may ask to confirm it"
            run "Trusting mkcert's authority" "$PREFIX/bin/mkcert" -install
        fi
    fi

    if [ -w /etc/hosts ]; then
        already "The hosts file" "Studio can write it"
    else
        printf '%s\n' "$BAR"
        choose "Let Studio write the hosts file?" 0 \
            "Yes|it becomes yours, so the vhosts' names are added there" \
            "No|they are added to it by hand"
        if [ "$CHOICE" -eq 0 ]; then
            sudo_once "Password of this Mac, for the hosts file"
            run "Making the hosts file yours" sudo chown "$USER" /etc/hosts
        fi
    fi

    PMA_CONF=$PREFIX/etc/phpmyadmin.config.inc.php
    if [ ! -f "$PMA_CONF" ]; then
        passed "phpMyAdmin's sign-in" "needs phpMyAdmin"
    elif grep -q "^\$cfg\['Servers'\]\[\$i\]\['auth_type'\] = 'cookie';" "$PMA_CONF"; then
        printf '%s\n' "$BAR"
        choose "Let phpMyAdmin sign in by itself?" 0 \
            "Yes|as $USER, whom MariaDB lets in through its socket, as it does Studio" \
            "No|it asks for a user and a password"
        if [ "$CHOICE" -eq 0 ]; then
            run "Signing phpMyAdmin in as $USER" sign_in_pma
        fi
    else
        already "phpMyAdmin's sign-in" "as its config says"
    fi

    if [ ! -d "$PREFIX/opt/httpd" ]; then
        passed "Apache's log rotation" "needs Apache"
    elif [ -f "$NEWSYSLOG" ]; then
        already "Apache's log rotation" "$NEWSYSLOG"
    else
        printf '%s\n' "$BAR"
        choose "Rotate Apache's logs?" 0 "Yes|at 10 MB, keeping 3, with the Mac's newsyslog" \
            "No|they grow until they are cleared from Studio"
        if [ "$CHOICE" -eq 0 ]; then
            sudo_once "Password of this Mac, for newsyslog"
            run "Rotating Apache's logs" write_newsyslog
        fi
    fi
    printf '%s\n' "$BAR"
}

# Makes phpMyAdmin sign in by itself as this Mac's user, with no password, which MariaDB
# takes through its socket, as Homebrew's MariaDB makes that user. Its config is kept, and
# it gets the secret its cookies need
sign_in_pma() {
    cp "$PMA_CONF" "$PMA_CONF.bak-studio"
    # The user's line goes in under the sign-in's, as the sample has none
    USER_LINE="\$cfg['Servers'][\$i]['user'] = '$USER';"
    SECRET=$(openssl rand -hex 16)
    USER_LINE=$USER_LINE SECRET=$SECRET perl -pi -e '
        s/^(.*\[.auth_type.\] = ).cookie.;$/$1\x27config\x27;\n$ENV{USER_LINE}/;
        s/^(.*\[.AllowNoPassword.\] = )false;$/$1true;/;
        s/^(\$cfg\[.blowfish_secret.\] = )\x27\x27;/$1\x27$ENV{SECRET}\x27;/;
    ' "$PMA_CONF"
    detail "kept as $(basename "$PMA_CONF").bak-studio"
}

# Has newsyslog rotate Apache's two logs at 10 MB, gzipped and keeping 3, then send Apache
# signal 30, a graceful restart, so it opens them again. The logs stay this Mac's user's
write_newsyslog() {
    local logs=$PREFIX/var/log/httpd pid=$PREFIX/var/run/httpd/httpd.pid
    local owner
    owner="$USER:$(id -gn)"
    {
        echo "# Rotates the logs of the Homebrew Apache, which nothing else rotates. At 10 MB a"
        echo "# log is gzipped to <log>.0.gz and a new one started, keeping the last 3. Apache"
        echo "# is then sent signal 30, a graceful restart, so it reopens its logs. Written by"
        echo "# Studio's setup."
        echo "#"
        printf '# %-38s %-12s %-4s %-5s %-8s %-4s %-5s %-37s %s\n' logfilename owner:group \
            mode count "size(KB)" when flags pid_file sig
        for log in error_log access_log; do
            printf '%-40s %-12s %-4s %-5s %-8s %-4s %-5s %-37s %s\n' "$logs/$log" "$owner" \
                644 3 10240 "*" Z "$pid" 30
        done
    } >"$TMP/newsyslog"
    sudo install -m 644 -o root -g wheel "$TMP/newsyslog" "$NEWSYSLOG"
    detail "$NEWSYSLOG"
}


# ------------------------------------------------------------------ studio ---

# The first of the apps given that is installed, then the others that are, as options with
# the Mac's default first, for choose
apps_of() {
    OPTIONS=("The default one|of this Mac")
    APPS=("")
    local app
    for app in "$@"; do
        if [ -d "/Applications/$app.app" ]; then
            OPTIONS+=("$app")
            APPS+=("$app")
        fi
    done
}

# Writes the config, with the paths only when Homebrew is not where Studio looks by default,
# and no projects yet: they are added from Studio's Projects
write_config() {
    local file=config/config.json key i
    {
        echo "{"
        if [ "$PREFIX" != /opt/homebrew ]; then
            echo '    "paths" : {'
            printf '        "%s"%*s: "%s",\n' homebrew 2 "" "$PREFIX"
            printf '        "%s"%*s: "%s",\n' httpdConf 1 "" "$PREFIX/etc/httpd/httpd.conf"
            printf '        "%s"%*s: "%s",\n' vhosts 4 "" "$VHOSTS"
            printf '        "%s"%*s: "%s",\n' phpIni 4 "" \
                "$PREFIX/etc/php/{php}/conf.d/99-local-dev.ini"
            printf '        "%s"%*s: "%s",\n' mysqlData 1 "" "$PREFIX/var/mysql"
            printf '        "%s"%*s: "%s",\n' mysqlCnf 2 "" "$PREFIX/etc/my.cnf.d/local-dev.cnf"
            printf '        "%s"%*s: "%s",\n' apacheLog 1 "" "$PREFIX/var/log/httpd/error_log"
            printf '        "%s"%*s: "%s",\n' accessLog 1 "" "$PREFIX/var/log/httpd/access_log"
            printf '        "%s"%*s: "%s"\n' redisLog 2 "" "$PREFIX/var/log/redis.log"
            echo '    },'
            echo
        fi
        [ -n "$BROWSER" ] && printf '    "browser" : "%s",\n' "$BROWSER"
        [ -n "$EDITOR_APP" ] && printf '    "editor"  : "%s",\n' "$EDITOR_APP"
        [ -n "$BROWSER$EDITOR_APP" ] && echo
        if [ ${#RANGES[@]} -gt 0 ]; then
            echo '    "versions" : {'
            for i in "${!RANGES[@]}"; do
                key="\"${RANGES[$i]%% *}\""
                printf '        %-12s : "%s"%s\n' "$key" "${RANGES[$i]#* }" \
                    "$([ "$i" -lt $((${#RANGES[@]} - 1)) ] && printf ,)"
            done
            echo '    },'
            echo
        fi
        echo '    "projects" : []'
        echo "}"
    } >"$file"
    detail "$file"
}

# The range of versions each installed part of the stack may update to, in RANGES as its name
# and range: its patches, as ~8.5 for PHP 8.5.12, unless the config gives one already
read_ranges() {
    local name version
    RANGES=()
    for name in "${FORMULAS[@]}" phpmyadmin swiftbar; do
        if [ "$name" = swiftbar ]; then
            version=$("$BREW" list --cask --versions swiftbar 2>/dev/null | awk '{print $2}')
        elif [ -d "$PREFIX/opt/$name" ]; then
            version=$(version_of "$name")
        else
            version=""
        fi
        [ -n "$version" ] && RANGES+=("$name $(range_of "$name" "$version")")
    done
    true
}

# Writes the ranges in RANGES into the config's versions, through Studio's own code, which
# keeps the file laid out as the example is, with the versions before the projects, and the
# last one as config.json.bak
write_ranges() {
    local i json=""
    for i in "${!RANGES[@]}"; do
        json+="${json:+,}\"${RANGES[$i]%% *}\":\"${RANGES[$i]#* }\""
    done
    [ -x "$PREFIX/bin/node" ] || skip "needs Node.js"

    STUDIO_VERSIONS="{$json}" "$PREFIX/bin/node" --input-type=module -e '
        import { readConfig, writeConfig } from "./backend/core/config.js";
        const { projects, ...rest } = readConfig();
        const versions = { ...rest.versions, ...JSON.parse(process.env.STUDIO_VERSIONS) };
        await writeConfig(projects === undefined
            ? { ...rest, versions }
            : { ...rest, versions, projects });
    '
    detail "config/config.json"
}

# Links node where SwiftBar's short PATH finds it, as the plugin starts with env node
link_node() {
    sudo mkdir -p /usr/local/bin
    sudo ln -sf "$NODE" /usr/local/bin/node
    detail "/usr/local/bin/node"
}

# Links the plugin into SwiftBar's folder, telling SwiftBar the folder when it has none yet,
# then has SwiftBar draw it, opening SwiftBar when it is not running
link_plugin() {
    mkdir -p "$PLUGINS"
    ln -s "$ROOT/$PLUGIN" "$PLUGINS/$PLUGIN"
    if ! defaults read com.ameba.SwiftBar PluginDirectory >/dev/null 2>&1; then
        defaults write com.ameba.SwiftBar PluginDirectory "$PLUGINS"
    fi

    if pgrep -x SwiftBar >/dev/null; then
        open -g "swiftbar://refreshplugin?name=swiftbar"
    else
        open -g -a SwiftBar
    fi
    detail "$(tilde "$PLUGINS")"
}

# The config, node where SwiftBar finds it, and the plugin in SwiftBar's folder
setup_studio() {
    local target
    section "Studio"

    read_ranges
    if [ -f config/config.json ] && grep -q '"versions"' config/config.json; then
        already "The config" "config/config.json"
    elif [ -f config/config.json ] && [ ! -x "$PREFIX/bin/node" ]; then
        passed "The versions in the config" "needs Node.js"
    elif [ -f config/config.json ]; then
        run "Adding the versions to the config" write_ranges
    else
        printf '%s\n' "$BAR"
        apps_of "Google Chrome" "Brave Browser" "Arc" "Microsoft Edge" "Vivaldi" "Firefox" \
            "Safari"
        choose "Which browser should Studio open the pages in?" 0 "${OPTIONS[@]}"
        BROWSER=${APPS[$CHOICE]}
        apps_of "Visual Studio Code" "Cursor" "Zed" "Sublime Text" "Nova" "BBEdit"
        choose "Which editor should it open the config files in?" 0 "${OPTIONS[@]}"
        EDITOR_APP=${APPS[$CHOICE]}
        run "Making the config" write_config
    fi

    NODE=$PREFIX/bin/node
    if [ -x /usr/local/bin/node ]; then
        already "node for SwiftBar" "/usr/local/bin/node"
    elif [ ! -x "$NODE" ]; then
        passed "node for SwiftBar" "needs Node.js"
    else
        printf '%s\n' "$BAR"
        sudo_once "Password of this Mac, to link node where SwiftBar finds it"
        run "Linking node for SwiftBar" link_node
    fi

    PLUGINS=$(defaults read com.ameba.SwiftBar PluginDirectory 2>/dev/null || true)
    PLUGINS=${PLUGINS:-$PLUGINS_DEFAULT}
    target=$(readlink "$PLUGINS/$PLUGIN" 2>/dev/null || true)
    if [ ! -d /Applications/SwiftBar.app ]; then
        passed "The SwiftBar plugin" "needs SwiftBar"
    elif [ "$target" = "$ROOT/$PLUGIN" ]; then
        already "The SwiftBar plugin" "$(tilde "$PLUGINS")"
    elif [ -e "$PLUGINS/$PLUGIN" ] || [ -L "$PLUGINS/$PLUGIN" ]; then
        passed "The SwiftBar plugin" "another $PLUGIN is in $(tilde "$PLUGINS")"
    else
        run "Linking the SwiftBar plugin" link_plugin
    fi
    printf '%s\n' "$BAR"
}

# Starts Studio and opens its page, the way the menu's entry does
open_studio() {
    PATH="$PREFIX/bin:$PATH" "./$PLUGIN" open-studio
    detail "$STUDIO_URL"
}


# ----------------------------------------------------------------- helpers ---

# Names joined with commas and an and, as Apache, PHP and Redis
joined() {
    local out="" i
    for ((i = 1; i <= $#; i++)); do
        if [ "$i" -eq 1 ]; then
            out=${!i}
        elif [ "$i" -eq $# ]; then
            out+=" and ${!i}"
        else
            out+=", ${!i}"
        fi
    done
    printf '%s' "$out"
}

# A version's major and minor, as 8.5 for 8.5.12_1
minor_of() {
    printf '%s' "$1" | cut -d. -f1,2
}

# The range of versions the config gives a package, as npm writes them, or its patches when it
# gives none, as ~8.5 for 8.5.12. plutil reads JSON as well
range_of() {
    local range
    range=$(plutil -extract "versions.$1" raw -o - config/config.json 2>/dev/null || true)
    printf '%s' "${range:-~$(minor_of "$2")}"
}

# Whether a version is in a range, as Studio reads one: "^25.2" is 25.2.0 and up below 26,
# "~8.5" is 8.5.0 and up below 8.6, ">=1.4" is 1.4.0 and up, "8.5" or "8.5.x" any 8.5, and
# "*" any. Homebrew's own rebuild, as 8.5.12_1, and a cask's build, as 2.1.1,20, are left out
in_range() {
    local range=${2// /} op="" base given fixed i have=() want=()
    case $range in
        '*' | latest) return 0 ;;
        '^'*) op='^' ;;
        '~'*) op='~' ;;
        '>='*) op='>=' ;;
    esac
    base=${range#"$op"}
    base=${base#v}
    while [[ "$base" == *.x || "$base" == *.\* ]]; do base=${base%.*}; done
    [[ "$base" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || return 1

    given=$(printf '%s' "$base" | tr -cd . | wc -c)
    given=$((given + 1))
    case $op in
        '^') fixed=1 ;;
        '~') fixed=$((given < 2 ? given : 2)) ;;
        '>=') fixed=0 ;;
        *) fixed=$given ;;
    esac

    IFS=. read -r -a have <<<"${1%%[_,]*}"
    IFS=. read -r -a want <<<"$base"
    for i in 0 1 2; do
        have[$i]=${have[$i]:-0}
        want[$i]=${want[$i]:-0}
        [ "$i" -lt "$fixed" ] && [ "${have[$i]}" -ne "${want[$i]}" ] && return 1
    done
    for i in 0 1 2; do
        [ "${have[$i]}" -gt "${want[$i]}" ] && return 0
        [ "${have[$i]}" -lt "${want[$i]}" ] && return 1
    done
    return 0
}

# The range that takes a version a range holds back, written as that one was: ^ keeps its
# major, so ^25 becomes ^26 for 26.0.0, and any other becomes its patches, ~8.6 for 8.6.0
moved_to() {
    case $1 in
        '^'*) printf '^%s' "${2%%.*}" ;;
        *) printf '~%s' "$(minor_of "${2%%[_,]*}")" ;;
    esac
}

# A text in lower case, which bash 3 has no expansion for
lower() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# A path with the home as ~, as the texts show them
tilde() {
    case $1 in
        "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;;
        *) printf '%s' "$1" ;;
    esac
}



# Updates the stack only, without the rest of the setup: what the config's ranges allow, or
# the packages named, whose ranges move to take their new versions
update_stack() {
    local command=$1
    shift
    if [ "$command" = upgrade ] && [ $# -eq 0 ]; then
        sed -n '2,10p' "$0"
        exit 1
    fi

    banner "Updates Studio's stack"
    intro "Updating the stack"
    section "Homebrew"
    find_brew
    [ -n "$BREW" ] || stop "Homebrew is not installed: ./setup.sh installs it"

    UPDATE=all
    [ "$command" = upgrade ] && UPDATE="$*"
    update_brew
    outro "${GREEN}The stack is up to date$R"
}

main() {
    case "${1:-}" in
        "") ;;
        update | upgrade)
            update_stack "$@"
            exit 0
            ;;
        -h | --help)
            sed -n '2,10p' "$0"
            exit 0
            ;;
        *)
            sed -n '2,10p' "$0"
            exit 1
            ;;
    esac

    banner "Sets up this Mac for Studio"
    intro "Setting up Studio"
    setup_brew
    setup_apache
    setup_studio

    # The stack is not started: Studio's Services page starts each part when it is needed
    if [ -x "$PREFIX/bin/node" ] || command -v node >/dev/null; then
        choose "Open Studio?" 0 "Yes|starts it, then opens $STUDIO_URL" "No"
        if [ "$CHOICE" -eq 0 ]; then
            run "Opening Studio" open_studio
            printf '%s\n' "$BAR"
        fi
        outro "${GREEN}Studio is ready$R  ${DIM}·  its Services page starts the stack$R"
    else
        outro "${YELLOW}Studio needs Node.js$R, the setup can be run again to install it"
    fi
}

main "$@"
