#!/bin/bash

# Whether setup.sh reads the config's ranges of versions as Studio does: each case goes through
# setup.sh's in_range and moved_to, and through versions.js, and the two must agree. Prints
# "All good", or each case where they differ. Nothing is installed or changed.

set -u
cd "$(dirname "$0")/.." || exit 1

# setup.sh's own helpers, taken out of it, since sourcing it would run the setup
eval "$(awk '/^(minor_of|in_range|moved_to)\(\) \{/,/^\}/' setup.sh)"

# A version, a range, and whether the version is in it, as every case below reads
CASES="
8.5.12      ~8.5
8.5.12_1    ~8.5
8.6.0       ~8.5
8.5.0       ~8.5.3
8.5.4       ~8.5.3
26.1.0      ^25
25.9.1      ^25
25.2.0      ^25.2
25.1.9      ^25.2
2.0.1       ~2
3.0.0       ~2
1.4.0       >=1.4
1.3.9       >=1.4
9.0.0       >=1.4
8.5.13      8.5
8.6.0       8.5
8.5.13      8.5.x
8.5.13      8.5.13
8.5.14      8.5.13
2.1.1,20    ~2.1
2.2.0,1     ~2.1
12.1.2      *
12.1.2      latest
12.1.2      v12.1
12.1.2      banana
13.0.0      ^ 12
"

shell=""
while read -r version range; do
    [ -n "$version" ] || continue
    if in_range "$version" "$range"; then in=yes; else in=no; fi
    shell+="$version $range $in $(moved_to "$range" "$version")"$'\n'
done <<<"$CASES"

node=$(CASES="$CASES" node --input-type=module -e '
    import { satisfies, movedTo } from "./backend/core/versions.js";
    for (const line of process.env.CASES.split("\n")) {
        const [ version, ...rest ] = line.trim().split(/\s+/);
        if (!version) {
            continue;
        }
        const range = rest.join(" ");
        const inIt  = satisfies(version, range) ? "yes" : "no";
        console.log(`${version} ${range} ${inIt} ${movedTo(range, version)}`);
    }
')

if differ=$(diff <(printf '%s' "$shell") <(printf '%s\n' "$node")); then
    echo "All good"
else
    echo "setup.sh (<) and versions.js (>) read these ranges differently:"
    echo "$differ"
    exit 1
fi
