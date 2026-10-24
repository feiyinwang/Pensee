import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "apps/website/src/routeTree.gen.ts",
      ".wrangler/**",
      // Vendored Arc registry files (`shadcn add @uiarc/...`); keep them byte-identical to upstream.
      "apps/desktop/src/components/arc/**",
      // Throwaway design prototypes; nothing in the app or website build loads them.
      "apps/desktop/proto/**",
    ],
  },
  lint: {
    ignorePatterns: [
      "apps/website/src/routeTree.gen.ts",
      ".wrangler/**",
      // Vendored Arc registry files (`shadcn add @uiarc/...`); keep them byte-identical to upstream.
      "apps/desktop/src/components/arc/**",
    ],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    projects: ["apps/*", "packages/*"],
  },
});
