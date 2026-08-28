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
      // Both OFF on purpose, and for two different reasons (corrected
      // 2026-08-28 - this comment used to claim the codebase was "100%
      // NgModule-based with constructor injection throughout", which stopped
      // being true and was being read as a prohibition).
      //
      // prefer-inject: inject() IS the direction for new and refactored code
      // (see CLAUDE.md). It is off because most of the codebase has not been
      // converted yet, so erroring would flag hundreds of files nobody is
      // touching - not because constructor DI is preferred. Do not read this
      // as licence to keep writing constructor DI in new code.
      //
      // prefer-standalone: standalone components genuinely are a separate,
      // large migration that has not been decided on. This one IS a "not
      // now".
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
