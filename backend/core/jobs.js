"use strict";

const { spawn } = require("child_process");

// The long changes the page follows as they go: npm and pecl installs.



/**
 * Runs some steps as a job the page follows: it gets the job's id at once,
 * then asks how it goes until it is done, so the page is free meanwhile. A
 * step is a package each, run in turn, each waiting, running, done or failed.
 * The jobs of one queue wait for each other too, since two runs changing one
 * folder at once can break it.
 *
 * Each step is run by runStep, which gives an error or "". Once all are run,
 * after() runs, then done() says what worked.
 */
const jobs   = new Map();
const queues = new Map();
let jobCount = 0;
function runJob(queue, steps, { runStep, after = async () => {}, done }) {
    const job = {
        id      : String(++jobCount),
        items   : steps.map((step) => ({ name : step.name, state : "waiting", error : "" })),
        state   : "waiting",
        message : "",
    };
    jobs.set(job.id, job);
    // The last few are kept, for a page that asks after they finished.
    for (const id of [ ...jobs.keys() ].slice(0, -20)) {
        jobs.delete(id);
    }
    const last = queues.get(queue) || Promise.resolve();
    queues.set(queue, last.then(async () => {
        job.state = "running";
        for (const [ index, step ] of steps.entries()) {
            const item = job.items[index];
            item.state = "running";
            item.error = await runStep(step).catch((error) => error.message || "failed");
            item.state = item.error ? "failed" : "done";
        }
        const worked = job.items.filter((item) => item.state === "done").map((item) => item.name);
        const failed = job.items.filter((item) => item.state === "failed");
        let   note   = "";
        try {
            note = (await after(worked)) || "";
        } catch (error) {
            note = error.message;
        }
        job.state   = failed.length ? "failed" : "done";
        job.message = [
            worked.length ? done(worked) : "",
            failed.length === 1 ? `${failed[0].name} failed: ${failed[0].error}`
                : failed.length ? `${failed.length} failed`
                    : "",
            note,
        ].filter(Boolean).join(". ");
    }));
    return { job : job.id };
}

function readJob(id) {
    const job = jobs.get(String(id));
    if (!job) {
        throw new Error("No such job");
    }
    return job;
}

/**
 * Runs a command and hands on each line it writes, as it writes it, for the
 * error when it fails. Gives its exit code. Input, when given, is written to
 * it at once, for a tool that asks questions as it goes.
 */
function spawnLines(command, args, {
    env = process.env, input = "", timeout = 10 * 60_000, onLine
}) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { env });
        const timer = setTimeout(() => child.kill(), timeout);
        let rest = "";
        const take = (chunk) => {
            const lines = (rest + chunk).split(/\r?\n/);
            rest = lines.pop();
            lines.filter((line) => line.trim()).forEach(onLine);
        };
        child.stdout.on("data", take);
        child.stderr.on("data", take);
        child.stdin.on("error", () => {});
        child.stdin.end(input);
        child.on("error", (error) => onLine(error.message));
        child.on("close", (code) => {
            clearTimeout(timer);
            if (rest.trim()) {
                onLine(rest);
            }
            resolve(code);
        });
    });
}

module.exports = {
    runJob,
    readJob,
    spawnLines,
};
