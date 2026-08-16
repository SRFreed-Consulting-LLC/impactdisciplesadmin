// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = defineConfig([
  {
    // src/common is a git submodule shared verbatim with the reader app and
    // impact-discipleship-library-manager-new - it isn't this repo's code to
    // lint or autofix; changes there belong in the submodule's own repo. Same
    // exclusion those two apps' own eslint configs already carry.
    ignores: ["src/common/**"],
  },
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
      // Turns off ESLint stylistic rules that would otherwise conflict
      // with Prettier -- Prettier owns formatting, ESLint owns everything
      // else (correctness, Angular conventions).
      eslintConfigPrettier,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
      // This codebase is 100% NgModule-based with constructor injection
      // throughout (a deliberate, still-fully-supported style -- adopting
      // standalone components/inject() is a separate, large migration, not
      // something a starter lint config should hard-error on in every file).
      "@angular-eslint/prefer-standalone": "off",
      "@angular-eslint/prefer-inject": "off",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
  }
]);
