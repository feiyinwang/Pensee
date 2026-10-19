import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Built by `pnpm run build:app` (cargo tauri build --features e2e).
// `productName` in tauri.conf.json names the .app bundle ("Pensée.app") but
// the binary inside MacOS/ keeps the Cargo crate name ("desktop") — Tauri
// does not rename it.
// `PENSEE_E2E_APP` points at another build, e.g. a debug one
// (`tauri build --debug`), which leaves the release artifacts alone.
const APP_BINARY =
  process.env.PENSEE_E2E_APP ??
  resolve(__dirname, "../src-tauri/target/release/bundle/macos/Pensée.app/Contents/MacOS/desktop");

/** @type {import('node:child_process').ChildProcess | undefined} */
let proxy;

/** @type {import('@wdio/types').Options.Testrunner} */
export const config = {
  runner: "local",
  specs: ["./specs/**/*.spec.js"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: APP_BINARY,
      },
    },
  ],
  hostname: "127.0.0.1",
  port: 4444,
  path: "/",
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 30_000,
  connectionRetryCount: 0,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },

  onPrepare: async function () {
    if (!existsSync(APP_BINARY)) {
      throw new Error(
        `App binary not found at ${APP_BINARY}\n` +
          "Run `pnpm run build:app` first (or use `pnpm run test:e2e`).",
      );
    }

    proxy = spawn("tauri-webdriver", [], { stdio: "inherit" });
    proxy.on("error", (err) => {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
        console.error(
          "tauri-webdriver not found on PATH.\n" +
            "Install once with: cargo install tauri-webdriver --locked",
        );
      }
    });

    // Give the intermediary a moment to bind to localhost:4444 before wdio
    // tries to create a session.
    await new Promise((r) => setTimeout(r, 1500));
  },

  // Journey runs (e2e/qa/run.sh) reseed the QA vault before each spec file's
  // app launch, so every spec starts from the same notes and settings.
  beforeSession: async function (_config, _capabilities, specs) {
    if (!process.env.PENSEE_QA_SEED) return;
    const { seedVault, seedFirstRun, seedWhatsNew } = await import("./qa/seed-vault.mjs");
    // The onboarding journeys start where a new user does: no folder open.
    if (specs.some((spec) => spec.endsWith("/onboarding.spec.js"))) seedFirstRun();
    // The What's new journeys start with a changelog day the writer hasn't seen.
    else if (specs.some((spec) => spec.endsWith("/whats-new.spec.js"))) seedWhatsNew();
    else seedVault();
  },

  onComplete: async function () {
    if (proxy && !proxy.killed) {
      const exited = new Promise((r) => proxy.once("exit", r));
      proxy.kill("SIGTERM");
      // Wait for clean exit so a follow-up run doesn't hit "port in use".
      await exited;
    }
  },
};
