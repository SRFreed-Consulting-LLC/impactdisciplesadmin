// Drift guard for the shared functions contract
// (src/common/src/shared/contract/functions-contract.ts, copied into
// src/shared by scripts/sync-shared.js): index.ts must export exactly the
// names the contract declares. Adding, renaming or removing a function
// therefore fails `npm test` / the predeploy build until the contract -
// and with it every client app that reads names from it - is updated.
//
// Reads index.ts as TEXT rather than require()ing it: requiring the
// compiled index would initialize firebase-admin and load every function
// module, which these pure node:test suites deliberately never do.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  HTTP_FUNCTIONS,
  CALLABLE_FUNCTIONS,
  TRIGGER_FUNCTIONS,
  ALL_FUNCTION_NAMES,
} = require("../lib/shared/contract/functions-contract");

/**
 * Names exported from src/index.ts (`exports.<name> = ...`).
 * @return {string[]} Exported function names, in file order.
 */
function exportedNames() {
  const indexPath = path.join(__dirname, "..", "src", "index.ts");
  const src = fs.readFileSync(indexPath, "utf8");
  return [...src.matchAll(/^exports\.([A-Za-z_0-9]+)\s*=/gm)]
    .map((m) => m[1]);
}

test("index.ts exports exactly the contract's function names", () => {
  const exported = new Set(exportedNames());
  const declared = new Set(ALL_FUNCTION_NAMES);
  const undeclared = [...exported].filter((n) => !declared.has(n)).sort();
  const missing = [...declared].filter((n) => !exported.has(n)).sort();
  assert.deepEqual(
    {undeclared, missing},
    {undeclared: [], missing: []},
    "index.ts and shared/contract/functions-contract.ts disagree - " +
      "update the contract (and its consumers) when adding/renaming/" +
      "removing a function"
  );
});

test("contract keys equal their values; no name in two kinds", () => {
  const groups = [HTTP_FUNCTIONS, CALLABLE_FUNCTIONS, TRIGGER_FUNCTIONS];
  for (const group of groups) {
    for (const [key, value] of Object.entries(group)) {
      assert.equal(key, value, `contract key ${key} must equal its value`);
    }
  }
  assert.equal(
    new Set(ALL_FUNCTION_NAMES).size,
    ALL_FUNCTION_NAMES.length,
    "duplicate function name across kinds"
  );
});
