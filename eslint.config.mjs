import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone Node CLI scripts — CommonJS, run via `node backend/...`,
    // never bundled by Next.
    "backend/ingest.js",
    "backend/watcher.js",
  ]),
]);

export default eslintConfig;
