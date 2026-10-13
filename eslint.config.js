// ESLint flat config: the recommended JavaScript and TypeScript rules, with browser
// globals for the client and Node globals for the server, tests and tooling.
// (tsc does the type checking; ESLint catches the rest.)

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
    { ignores: ["dist/", "node_modules/"] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ["src/client/**/*.ts"],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ["src/server/**/*.ts", "test/**/*.ts", "eslint.config.js"],
        languageOptions: { globals: globals.node },
    },
);
