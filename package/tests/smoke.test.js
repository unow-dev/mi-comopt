import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("package contains the browser entrypoint", () => {
  assert.equal(fs.existsSync(new URL("../src/main.jsx", import.meta.url)), true);
});
