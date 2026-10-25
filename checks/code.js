#!/usr/bin/env node

// The code's own rules, checked: every function's JSDoc, no ternary inside a ternary, every
// await on its own, lines of at most 100 characters, and the types, as VS Code checks them.
// It borrows VS Code's TypeScript, so Studio still needs no packages: TYPESCRIPT can point to
// another typescript.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";



const ROOT       = path.join(import.meta.dirname, "..");
const TYPESCRIPT = process.env.TYPESCRIPT || "/Applications/Visual Studio Code.app/Contents"
    + "/Resources/app/extensions/node_modules/typescript/lib/typescript.js";
const MAX_LINE   = 100;



/**
 * A problem found, by its file and line.
 * @typedef {{ file: string, line: number, text: string }} Problem
 */



const ts       = loadTypeScript();
const files    = jsFiles();
const problems = [
    ...files.flatMap(checkFile),
    ...checkTypes(files),
];

for (const problem of problems) {
    console.log(`${problem.file}:${problem.line}  ${problem.text}`);
}
console.log(problems.length ? `${problems.length} problems` : "All good");
process.exitCode = problems.length ? 1 : 0;


// ------------------------------------------------------------------- files ---

/**
 * TypeScript, from VS Code or where TYPESCRIPT says.
 * @returns {*}
 */
function loadTypeScript() {
    if (!fs.existsSync(TYPESCRIPT)) {
        console.error(`No TypeScript at ${TYPESCRIPT}: set TYPESCRIPT to a typescript.js`);
        process.exit(2);
    }

    const require = createRequire(import.meta.url);
    return require(TYPESCRIPT);
}

/**
 * Every JavaScript file of Studio, as jsconfig.json lists them.
 * @returns {string[]}
 */
function jsFiles() {
    const parsed = readConfig();
    return parsed.fileNames.map((file) => path.relative(ROOT, file)).sort();
}

/**
 * jsconfig.json, read as VS Code reads it.
 * @returns {*}
 */
function readConfig() {
    const file = path.join(ROOT, "jsconfig.json");
    const json = ts.readConfigFile(file, ts.sys.readFile).config;
    return ts.parseJsonConfigFileContent(json, ts.sys, ROOT, { noEmit : true }, file);
}


// ------------------------------------------------------------------- rules ---

/**
 * The problems of one file: its lines, its functions' JSDoc, its ternaries and its awaits.
 * @param {string} file
 * @returns {Problem[]}
 */
function checkFile(file) {
    const text     = fs.readFileSync(path.join(ROOT, file), "utf8");
    const source   = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const problems = [];

    /**
     * Keeps a problem found at a node.
     * @param {*} node
     * @param {string} problem
     * @returns {void}
     */
    const report = (node, problem) => {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        problems.push({ file, line, text : problem });
    };

    text.split("\n").forEach((line, index) => {
        if (line.length > MAX_LINE) {
            problems.push({ file, line : index + 1, text : `${line.length} characters` });
        }
    });

    /**
     * Looks at a node and everything in it.
     * @param {*} node
     * @returns {void}
     */
    const visit = (node) => {
        if (ts.isFunctionDeclaration(node) && node.body) {
            checkDoc(node, node, node.name?.text || "a function", report);
        }
        if (ts.isConditionalExpression(node) && !ts.isConditionalExpression(node.parent)
            && holdsTernary(node)) {
            report(node, "a ternary inside a ternary");
        }
        if (ts.isAwaitExpression(node) && !standsAlone(node)) {
            report(node, "an await inside an expression");
        }
        node.forEachChild(visit);
    };
    visit(source);

    // A top-level const holding a function needs its JSDoc too.
    for (const statement of source.statements.filter(ts.isVariableStatement)) {
        for (const declaration of statement.declarationList.declarations) {
            const value = declaration.initializer;
            if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
                checkDoc(statement, value, declaration.name.getText(), report);
            }
        }
    }

    return problems;
}

/**
 * Checks a function's JSDoc: one block right above it, with a description, a typed param tag
 * for each parameter, in order, and a typed returns tag.
 * @param {*} holder the statement the block is on
 * @param {*} fn the function
 * @param {string} name
 * @param {(node: *, problem: string) => void} report
 * @returns {void}
 */
function checkDoc(holder, fn, name, report) {
    const docs = (holder.jsDoc || []).filter((doc) => !(doc.tags || []).some((tag) =>
        ts.isJSDocTypedefTag(tag) || ts.isJSDocCallbackTag(tag) || tag.tagName.text === "import"));
    if (docs.length !== 1) {
        report(holder, `${name}: ${docs.length ? `${docs.length} doc blocks` : "no doc block"}`);
        return;
    }

    const doc  = docs[0];
    const tags = doc.tags || [];
    if (!ts.getTextOfJSDocComment(doc.comment)?.trim()) {
        report(holder, `${name}: no description`);
    }

    const params = tags.filter((tag) => ts.isJSDocParameterTag(tag)
        && !tag.name.getText().includes("."));
    const names  = fn.parameters.map((one) => (ts.isIdentifier(one.name) ? one.name.text : null));
    if (params.length !== names.length) {
        report(holder, `${name}: ${params.length} @param for ${names.length} parameters`);
    } else {
        names.forEach((one, index) => {
            if (one && params[index].name.getText() !== one) {
                report(holder, `${name}: @param ${params[index].name.getText()} is not ${one}`);
            }
        });
    }
    for (const param of params.filter((tag) => !tag.typeExpression)) {
        report(holder, `${name}: @param ${param.name.getText()} has no type`);
    }

    const returns = tags.filter(ts.isJSDocReturnTag);
    if (returns.length !== 1 || !returns[0].typeExpression) {
        report(holder, `${name}: no @returns with a type`);
    }
}

/**
 * Whether a ternary holds another, in its test or its branches; one in a function inside it
 * is that function's own.
 * @param {*} node
 * @returns {boolean}
 */
function holdsTernary(node) {
    let found = false;

    /**
     * Looks for a ternary below a node, not inside a function.
     * @param {*} child
     * @returns {void}
     */
    const look = (child) => {
        if (found || ts.isFunctionLike(child)) {
            return;
        }
        if (ts.isConditionalExpression(child)) {
            found = true;
            return;
        }
        child.forEachChild(look);
    };
    node.forEachChild(look);

    return found;
}

/**
 * Whether an await stands on its own: as a statement, a const's or a variable's value, a
 * return, or a property of an object literal.
 * @param {*} node
 * @returns {boolean}
 */
function standsAlone(node) {
    const parent = node.parent;
    if (ts.isExpressionStatement(parent) || ts.isReturnStatement(parent)) {
        return true;
    }
    if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
        return parent.initializer === node;
    }

    return ts.isBinaryExpression(parent) && parent.right === node
        && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isExpressionStatement(parent.parent);
}


// ------------------------------------------------------------------- types ---

/**
 * The type errors, as VS Code shows them, with the types of Node that VS Code fetches.
 * @param {string[]} list
 * @returns {Problem[]}
 */
function checkTypes(list) {
    const parsed  = readConfig();
    const options = { ...parsed.options, typeRoots : nodeTypes() };
    const program = ts.createProgram(list.map((file) => path.join(ROOT, file)), options);

    return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
        const where = diagnostic.file
            ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
            : 0;
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
        return {
            file : diagnostic.file ? path.relative(ROOT, diagnostic.file.fileName) : "",
            line : where,
            text : `TS${diagnostic.code} ${message}`,
        };
    });
}

/**
 * Where VS Code keeps the types it fetched, Node's among them; the newest TypeScript's.
 * @returns {string[]}
 */
function nodeTypes() {
    const cache = path.join(os.homedir(), "Library", "Caches", "typescript");
    if (!fs.existsSync(cache)) {
        return [];
    }

    const versions = fs.readdirSync(cache)
        .filter((one) => fs.existsSync(path.join(cache, one, "node_modules", "@types")))
        .sort((a, b) => a.localeCompare(b, "en", { numeric : true }));
    if (!versions.length) {
        return [];
    }

    return [ path.join(cache, versions.at(-1), "node_modules", "@types") ];
}
