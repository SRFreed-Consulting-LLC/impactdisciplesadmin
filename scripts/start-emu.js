// `npm run emu` entry point.
//
// Starts the fake vendor server (scripts/fake-vendors.js) and then the
// Firebase Emulator Suite, and makes sure the fake dies with the emulator.
// It has to be a supervisor script rather than two npm scripts joined by
// `&`: firebase.json cannot start a sidecar process, and `&` is not portable
// to the Windows shell this repo is developed on.
//
// Order matters. functions/.env.local (written a step earlier) points the
// vendor base URLs at the fake, and a function that cold-starts before the
// fake is listening would get ECONNREFUSED - which surfaces as a confusing
// "Unable to start checkout" rather than "the fake is not up". So the fake is
// started first and health-checked before the emulator is spawned at all.

const { spawn } = require("child_process");
const path = require("path");

const PORT = Number(process.env.FAKE_VENDORS_PORT || 5055);
const HEALTH_URL = "http://127.0.0.1:" + PORT + "/__health";
const HEALTH_TIMEOUT_MS = 10_000;

const repoRoot = path.join(__dirname, "..");
const children = [];

function spawnChild(label, command, args, opts = {}) {
  // shell defaults to FALSE and each caller opts in. It matters: npx/npm on
  // Windows are .cmd shims that only resolve through a shell, but node itself
  // lives at "C:\Program Files\nodejs\node.exe", and a shell spawn does not
  // quote the command - so shell:true turns that path into the command
  // "C:\Program" and fails with a message that names no part of this script.
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  child.on("error", (err) => {
    console.error("[start-emu] " + label + " failed to start:", err.message);
    shutdown(1);
  });
  children.push({ label, child });
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        // Already gone - nothing to do.
      }
    }
  }
  process.exit(code);
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error(
        "fake-vendors did not become healthy on port " + PORT + " within " +
        HEALTH_TIMEOUT_MS + "ms. Is something else already on that port?"
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  spawnChild("fake-vendors", process.execPath, [
    path.join(__dirname, "fake-vendors.js"),
  ]);

  await waitForHealth();
  console.log("[start-emu] fake-vendors healthy on port " + PORT);

  const emulator = spawnChild("emulators", "npx", [
    "-y",
    "firebase-tools@15.28.1",
    "emulators:start",
    "--project",
    "demo-impact",
    "--only",
    "auth,firestore,functions,storage",
  ], {shell: process.platform === "win32"});

  emulator.on("exit", (code) => shutdown(code === null ? 0 : code));
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => shutdown(0));
}

main().catch((err) => {
  console.error("[start-emu]", err.message);
  shutdown(1);
});
