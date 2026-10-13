import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

const tauriConfPath = fileURLToPath(
  new URL("../desktop/src-tauri/tauri.conf.json", import.meta.url),
);
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8")) as {
  version: string;
};

const RELEASE_REPO = "joelbqz/writer-computer";
const VERSION = tauriConf.version;
const DMG_URL = `https://github.com/${RELEASE_REPO}/releases/download/v${VERSION}/Writer_${VERSION}_aarch64.dmg`;
const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases/tag/v${VERSION}`;
const REPO_URL = "https://github.com/joelbqz/writer-computer";

export default defineConfig({
  plugins: [
    devtools(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
      },
    }),
    react(),
  ],
  server: {
    port: 5173,
  },
  define: {
    __WRITER_VERSION__: JSON.stringify(VERSION),
    __WRITER_DMG_URL__: JSON.stringify(DMG_URL),
    __WRITER_RELEASES_URL__: JSON.stringify(RELEASES_URL),
    __WRITER_REPO_URL__: JSON.stringify(REPO_URL),
  },
});
