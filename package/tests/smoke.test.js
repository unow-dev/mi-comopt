import test from "node:test";
import assert from "node:assert/strict";
import { hello } from "../dist/index.js";

test("hello", () => {
  assert.equal(hello("world"), "hello, world");
});
