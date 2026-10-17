import { describe, expect, it } from "vitest";
import type { DiffLine } from "../../lib/bindings";
import { intralineRanges, markPieces, wordRanges } from "./wordDiff";

const line = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, text, oldNo: null, newNo: null });
const cut = (text: string, ranges: Array<[number, number]>) => ranges.map(([a, b]) => text.slice(a, b));

describe("wordRanges", () => {
  it("marks only the word that changed", () => {
    const oldText = "const total = price * qty;";
    const newText = "const total = price * quantity;";
    const ranges = wordRanges(oldText, newText);
    expect(ranges && cut(oldText, ranges.old)).toEqual(["qty"]);
    expect(ranges && cut(newText, ranges.new)).toEqual(["quantity"]);
  });

  it("marks an insertion on one side only", () => {
    const ranges = wordRanges("foo(a)", "foo(a, b)");
    expect(ranges?.old).toEqual([]);
    expect(ranges && cut("foo(a, b)", ranges.new)).toEqual([", b"]);
  });

  it("joins changes separated only by whitespace", () => {
    const newText = "let x = new value here;";
    const ranges = wordRanges("let x = old thing here;", newText);
    expect(ranges && cut(newText, ranges.new)).toEqual(["new value"]);
  });

  it("leaves equal, unrelated or very long lines alone", () => {
    expect(wordRanges("same", "same")).toBeNull();
    expect(wordRanges("import React from 'react';", "}")).toBeNull();
    const long = Array.from({ length: 500 }, (_, i) => `w${i}`).join(" ");
    expect(wordRanges(long, `${long} x`)).toBeNull();
  });

  it("marks a change in indentation", () => {
    const ranges = wordRanges("  return x;", "    return x;");
    expect(ranges?.new).toEqual([[0, 4]]);
  });
});

describe("intralineRanges", () => {
  it("pairs each deletion with the addition at the same place in the run", () => {
    const lines = [
      line("Context", "a"),
      line("Del", "one = 1"),
      line("Del", "two = 2"),
      line("Add", "one = 10"),
      line("Add", "two = 20"),
      line("Add", "three = 3"),
    ];
    const ranges = intralineRanges(lines);
    expect(ranges[0]).toBeUndefined();
    expect(ranges[1] && cut("one = 1", ranges[1])).toEqual(["1"]);
    expect(ranges[3] && cut("one = 10", ranges[3])).toEqual(["10"]);
    expect(ranges[4] && cut("two = 20", ranges[4])).toEqual(["20"]);
    expect(ranges[5]).toBeUndefined();
  });

  it("does not pair additions that are not after a deletion", () => {
    expect(intralineRanges([line("Add", "x = 1"), line("Del", "x = 2")])).toEqual([undefined, undefined]);
  });
});

describe("markPieces", () => {
  it("cuts tokens at range boundaries", () => {
    expect(markPieces(["const ", "qty", ";"], [[8, 9]])).toEqual([
      { token: 0, text: "const ", marked: false },
      { token: 1, text: "qt", marked: false },
      { token: 1, text: "y", marked: true },
      { token: 2, text: ";", marked: false },
    ]);
  });

  it("spans a range over several tokens", () => {
    const pieces = markPieces(["ab", "cd", "ef"], [[1, 5]]);
    expect(pieces.map((p) => [p.text, p.marked])).toEqual([
      ["a", false],
      ["b", true],
      ["cd", true],
      ["e", true],
      ["f", false],
    ]);
  });

  it("keeps the tokens whole without ranges", () => {
    expect(markPieces(["a", "b"], []).map((p) => p.text)).toEqual(["a", "b"]);
  });
});
