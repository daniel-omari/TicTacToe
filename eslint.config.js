"use strict";
// ESLint flat config: the recommended rules, with the right globals for each kind of file.

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
    { ignores: ["node_modules/"] },
    js.configs.recommended,
    {
        // Shared rules: a plain browser script that is also require()d by Node
        files: ["game.js"],
        languageOptions: {
            sourceType: "script",
            globals: { ...globals.browser, module: "readonly" },
        },
    },
    {
        // Browser client: loaded after game.js, which provides TicTacToeGame
        files: ["ticTacToe.js"],
        languageOptions: {
            sourceType: "script",
            globals: { ...globals.browser, TicTacToeGame: "readonly" },
        },
    },
    {
        files: ["server.js", "eslint.config.js", "test/**/*.js"],
        languageOptions: {
            sourceType: "commonjs",
            globals: { ...globals.node },
        },
    },
];
