import assert from "node:assert/strict";
import test from "node:test";
import { isNewCandidate } from "../src/ui/new-badge.js";

const introducedAt = new Date("2026-09-01T00:00:00Z");
const displayEnd = new Date("2026-09-15T00:00:00Z");

test("NEW badge has no value without a known introduction time", () => {
  assert.equal(isNewCandidate(null, introducedAt), false);
});

test("NEW badge is visible at introduction", () => {
  assert.equal(isNewCandidate(introducedAt.toISOString(), introducedAt), true);
});

test("NEW badge is visible one millisecond before the display boundary", () => {
  assert.equal(isNewCandidate(introducedAt.toISOString(), new Date(displayEnd.getTime() - 1)), true);
});

test("NEW badge is hidden at the display boundary", () => {
  assert.equal(isNewCandidate(introducedAt.toISOString(), displayEnd), false);
});

test("NEW badge is hidden after the display boundary", () => {
  assert.equal(isNewCandidate(introducedAt.toISOString(), new Date(displayEnd.getTime() + 1)), false);
});
