// The versions the config allows for each part of the stack, written as npm writes them in a
// package.json: "~8.5" keeps PHP on 8.5 and takes its patches, "^25" keeps Node.js on 25 and
// takes its minor versions too, "*" takes any. A part with none takes its patches only.



/** A range: an operator, or none, then a version with up to three parts, or "*". */
const RANGE = /^(\^|~|>=)?\s*v?(\d+(?:\.\d+){0,2})(?:\.[x*])*$/;



// ---------------------------------------------------------------- versions ---

/**
 * Whether a version is in a range: "^25.2" is 25.2.0 and up, below 26; "~8.5" is 8.5.0 and
 * up, below 8.6; ">=1.4" is 1.4.0 and up; "8.5" and "8.5.x" are any 8.5; "8.5.13" is that one.
 * Homebrew's own rebuild of a version, as 8.5.12_1, and a cask's build, as 2.1.1,20, are left
 * out.
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 */
function satisfies(version, range) {
    const wanted = String(range).trim();
    if (wanted === "*" || wanted === "latest") {
        return true;
    }

    const match = wanted.match(RANGE);
    if (!match) {
        return false;
    }

    const have  = partsOf(version);
    const base  = partsOf(match[2]);
    const fixed = fixedOf(match[1] || "", match[2].split(".").length);

    return have.slice(0, fixed).join(".") === base.slice(0, fixed).join(".")
        && compare(have, base) >= 0;
}

/**
 * How many of a version's parts a range keeps as they are: the major for ^, the major and
 * the minor for ~ (only the major for ~25), none for >=, and those it gives otherwise.
 * @param {string} operator
 * @param {number} given how many parts the range gives
 * @returns {number}
 */
function fixedOf(operator, given) {
    if (operator === "^") {
        return 1;
    }
    if (operator === "~") {
        return Math.min(given, 2);
    }
    if (operator === ">=") {
        return 0;
    }
    return given;
}

/**
 * Whether a text is a range the config can give.
 * @param {*} range
 * @returns {boolean}
 */
function isRange(range) {
    return typeof range === "string"
        && ([ "*", "latest" ].includes(range.trim()) || RANGE.test(range.trim()));
}

/**
 * The range for a part with none in the config: its patches, as ~8.5 for 8.5.12.
 * @param {string} version
 * @returns {string}
 */
function patchesOf(version) {
    return `~${partsOf(version).slice(0, 2).join(".")}`;
}

/**
 * The range that takes a version a range leaves out, written as that one was: ^ keeps its
 * major, so "^25" becomes "^26" for 26.0.0, and any other becomes its patches, "~8.6" for 8.6.0.
 * @param {string} range
 * @param {string} version
 * @returns {string}
 */
function movedTo(range, version) {
    const parts = partsOf(version);
    if (String(range).trim().startsWith("^")) {
        return `^${parts[0]}`;
    }
    return patchesOf(version);
}


// ----------------------------------------------------------------- helpers ---

/**
 * A version's three parts as numbers, with 0 for those it leaves out.
 * @param {string} version
 * @returns {number[]}
 */
function partsOf(version) {
    const parts = String(version).split(/[_,]/)[0].replace(/^v/, "").split(".").map(Number);
    return [ 0, 1, 2 ].map((at) => parts[at] || 0);
}

/**
 * Which of two versions is newer: below 0 for the first, above for the second.
 * @param {number[]} one
 * @param {number[]} other
 * @returns {number}
 */
function compare(one, other) {
    const at = one.findIndex((part, index) => part !== other[index]);
    return at < 0 ? 0 : one[at] - other[at];
}



// The public API
export {
    satisfies,
    isRange,
    patchesOf,
    movedTo,
};
