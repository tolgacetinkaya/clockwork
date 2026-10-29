import { describe, expect, it } from "vitest";
import { formatBudget, parseBudget } from "../src/spec/budget.js";

describe("parseBudget", () => {
  it("parses plain numbers", () => {
    expect(parseBudget(500)).toBe(500);
    expect(parseBudget(1234.5)).toBe(1234.5);
  });

  it("parses k/m suffixes, case-insensitive", () => {
    expect(parseBudget("40k")).toBe(40_000);
    expect(parseBudget("40K")).toBe(40_000);
    expect(parseBudget("1.5m")).toBe(1_500_000);
    expect(parseBudget("2M")).toBe(2_000_000);
    expect(parseBudget("500")).toBe(500);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseBudget(" 40k ")).toBe(40_000);
  });

  it("throws on invalid input", () => {
    expect(() => parseBudget("40x")).toThrow(RangeError);
    expect(() => parseBudget("k40")).toThrow(RangeError);
    expect(() => parseBudget("")).toThrow(RangeError);
    expect(() => parseBudget(-5)).toThrow(RangeError);
    expect(() => parseBudget(0)).toThrow(RangeError);
    expect(() => parseBudget(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatBudget", () => {
  it("formats round thousands and millions", () => {
    expect(formatBudget(40_000)).toBe("40k");
    expect(formatBudget(1_500_000)).toBe("1.5m");
    expect(formatBudget(500)).toBe("500");
  });

  it("falls back to plain digits for awkward values", () => {
    expect(formatBudget(1234)).toBe("1234");
  });

  it("round-trips through parseBudget", () => {
    for (const value of [500, 40_000, 120_500, 1_500_000]) {
      expect(parseBudget(formatBudget(value))).toBe(value);
    }
  });

  it("throws on invalid input", () => {
    expect(() => formatBudget(0)).toThrow(RangeError);
    expect(() => formatBudget(-1)).toThrow(RangeError);
  });
});
