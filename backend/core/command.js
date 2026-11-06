// A server's command, a line as typed in a shell, split into the command and its arguments
// without a shell. Shared by the server, which checks it, and the SwiftBar plugin, which runs
// it.



/**
 * A command line split as a shell would: on spaces, except inside quotes, with a backslash
 * keeping the next character as it is. `npm run dev --title "My shop"` is five words.
 * @param {string} line
 * @returns {string[]}
 */
function splitCommand(line) {
    const args = [];
    let word   = null;
    let quote  = "";

    for (let at = 0; at < line.length; at++) {
        const char = line[at];

        if (char === "\\" && quote !== "'" && at + 1 < line.length) {
            word = (word || "") + line[++at];
        } else if (char === quote) {
            quote = "";
        } else if (quote) {
            word += char;
        } else if (char === "\"" || char === "'") {
            quote = char;
            word  = word || "";
        } else if (/\s/.test(char)) {
            if (word !== null) {
                args.push(word);
            }
            word = null;
        } else {
            word = (word || "") + char;
        }
    }

    if (quote) {
        throw new Error("The command has a quote that is not closed");
    }
    if (word !== null) {
        args.push(word);
    }

    return args;
}



// The public API
export {
    splitCommand,
};
