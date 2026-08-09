// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = defineConfig([
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
    rules: {
      // Same reasoning as prefer-standalone/prefer-inject above -- adopting
      // @if/@for over *ngIf/*ngFor is a codebase-wide migration, not a
      // per-file lint fix.
      "@angular-eslint/template/prefer-control-flow": "off",
    },
  }
]);
