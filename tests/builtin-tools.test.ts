import { assertEquals } from "@std/assert";
import { findMatches } from "../src/lib/builtin-tools.ts";

Deno.test("findMatches - returns empty array when no match", () => {
	const result = findMatches("alpha\nbeta\ngamma", "delta", false);
	assertEquals(result, []);
});

Deno.test("findMatches - case-insensitive by default param", () => {
	const result = findMatches("Alpha\nBETA\ngamma", "alpha", false);
	assertEquals(result.length, 1);
});

Deno.test("findMatches - case-sensitive when requested", () => {
	const result = findMatches("Alpha\nalpha\nALPHA", "alpha", true);
	assertEquals(result.length, 1);
	// The matching line is line 2; context covers lines 1-3 with line 2 marked.
	assertEquals(
		result[0],
		"  1: Alpha\n> 2: alpha\n  3: ALPHA",
	);
});

Deno.test("findMatches - context shows ±2 lines, marker on hit line", () => {
	const lines = ["L1", "L2", "L3", "needle", "L5", "L6", "L7"];
	const result = findMatches(lines.join("\n"), "needle", false);
	assertEquals(result.length, 1);
	assertEquals(
		result[0],
		"  2: L2\n  3: L3\n> 4: needle\n  5: L5\n  6: L6",
	);
});

Deno.test("findMatches - clamps context at start of file", () => {
	const result = findMatches("hit\nB\nC", "hit", false);
	// Hit on line 1; only lines 1-3 in context.
	assertEquals(result[0], "> 1: hit\n  2: B\n  3: C");
});

Deno.test("findMatches - clamps context at end of file", () => {
	const result = findMatches("A\nB\nhit", "hit", false);
	// Hit on line 3; context is lines 1-3.
	assertEquals(result[0], "  1: A\n  2: B\n> 3: hit");
});

Deno.test("findMatches - returns one entry per matching line", () => {
	const result = findMatches("hit\nmiss\nhit\nhit", "hit", false);
	assertEquals(result.length, 3);
});
