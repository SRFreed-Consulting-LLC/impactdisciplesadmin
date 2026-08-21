// The book-import block model lives ONCE in the shared submodule
// (src/common/src/shared/contract/book-import.types.ts - Stage 2e-ii,
// 2026-08-20), copied into src/common by scripts/sync-shared.js on every
// build; the admin app's library-book-import.model.ts re-exports the same
// file. This module only re-exports so importer.ts / prompts.ts /
// book-import.functions.ts keep their imports unchanged.
export * from "../common/shared/contract/book-import.types";
