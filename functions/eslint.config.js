// ESLint flat config for functions/ (2026-08-20, replaced the legacy
// .eslintrc.js + cross-env ESLINT_USE_FLAT_CONFIG=false workaround when the
// package moved to ESLint 9 / typescript-eslint 8). Same intent as before:
// eslint recommended + typescript-eslint recommended + the Google style
// rules (80-col max-len, 2-space indent, double quotes, JSDoc) minus the two
// Google rules ESLint 9 removed from core (require-jsdoc / valid-jsdoc).
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const google = require("eslint-config-google");
const globals = require("globals");

// eslint-config-google 0.14 is an eslintrc-era config; lift its rules and
// drop the ones that no longer exist in ESLint 9.
const googleRules = {...google.rules};
delete googleRules["require-jsdoc"];
delete googleRules["valid-jsdoc"];

module.exports = tseslint.config(
  {
    ignores: [
      "lib/**", // built output
      "generated/**",
      // Copied from the shared submodule by scripts/sync-shared.js - not this
      // package's code to lint (the submodule is lint-ignored in the apps too).
      "src/common/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      ...googleRules,
      "quotes": ["error", "double"],
      "indent": ["error", 2],
      // typescript-eslint's no-unused-vars replaces the core rule (which the
      // Google preset re-enables on TS files).
      "no-unused-vars": "off",
      // Google's "always-multiline" also applied to function-call argument
      // lists once ESLint 9 defaulted ecmaVersion to latest - this codebase
      // never wrote those; keep trailing commas for arrays/objects/imports.
      "comma-dangle": ["error", {
        arrays: "always-multiline",
        objects: "always-multiline",
        imports: "always-multiline",
        exports: "always-multiline",
        functions: "ignore",
      }],
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["tsconfig.json"],
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // index.ts wires its exports with require(), and several handlers
      // lazy-require heavy SDKs (stripe/shipengine/mailchimp-style) inside
      // the handler for cold-start reasons - deliberate, see their comments.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // node:test suites and the build helper are plain CommonJS run straight
    // by node - require() IS the import statement there.
    files: ["test/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: {
      globals: {...globals.node},
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  }
);
