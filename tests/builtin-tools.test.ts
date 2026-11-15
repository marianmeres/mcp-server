import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatches } from "../src/lib/builtin-tools.ts";

test("findMatches - returns empty array when no match", () => {
	const result = findMatches("alpha\nbeta\ngamma", "delta", false);
	assert.deepEqual(result, []);
});

test("findMatches - case-insensitive by default param", () => {
	const result = findMatches("Alpha\nBETA\ngamma", "alpha", false);
	assert.equal(result.length, 1);
});

test("findMatches - case-sensitive when requested", () => {
	const result = findMatches("Alpha\nalpha\nALPHA", "alpha", true);
	assert.equal(result.length, 1);
	// The matching line is line 2; context covers lines 1-3 with line 2 marked.
	assert.equal(result[0], "  1: Alpha\n> 2: alpha\n  3: ALPHA");
});

test("findMatches - context shows ±2 lines, marker on hit line", () => {
	const lines = ["L1", "L2", "L3", "needle", "L5", "L6", "L7"];
	const result = findMatches(lines.join("\n"), "needle", false);
	assert.equal(result.length, 1);
	assert.equal(result[0], "  2: L2\n  3: L3\n> 4: needle\n  5: L5\n  6: L6");
});

test("findMatches - clamps context at start of file", () => {
	const result = findMatches("hit\nB\nC", "hit", false);
	// Hit on line 1; only lines 1-3 in context.
	assert.equal(result[0], "> 1: hit\n  2: B\n  3: C");
});

test("findMatches - clamps context at end of file", () => {
	const result = findMatches("A\nB\nhit", "hit", false);
	// Hit on line 3; context is lines 1-3.
	assert.equal(result[0], "  1: A\n  2: B\n> 3: hit");
});

test("findMatches - returns one entry per matching line", () => {
	const result = findMatches("hit\nmiss\nhit\nhit", "hit", false);
	assert.equal(result.length, 3);
});
