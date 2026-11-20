import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  formatCurrency,
  formatCurrencyShort,
  formatInr,
} from "./currency";

describe("formatCurrency", () => {
  it("formats whole amounts with no minor units", () => {
    // Use a non-breaking-space-tolerant check: Intl may insert NBSP.
    const out = formatCurrency(1234, "USD");
    expect(out).toContain("1,234");
    expect(out).not.toContain(".00");
  });

  it("defaults to USD when no currency is given", () => {
    expect(formatCurrency(10)).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it("treats an empty-string currency as the default", () => {
    expect(formatCurrency(10, "")).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it("coerces non-finite values to 0", () => {
    expect(formatCurrency(Number.NaN, "USD")).toContain("0");
  });

  it("renders a well-formed but unknown ISO code without throwing", () => {
    // Intl is lenient here — it uses the code as the symbol.
    const out = formatCurrency(1234, "ZZZ");
    expect(out).toContain("ZZZ");
    expect(out).toContain("1,234");
  });

  it("never throws on a structurally invalid code (no DB CHECK on deals.currency)", () => {
    for (const bad of ["United States", "US", "USDD", "12", "u$d"]) {
      expect(() => formatCurrency(1234, bad)).not.toThrow();
      expect(formatCurrency(1234, bad)).toContain("1,234");
    }
  });

  it("formats every offered currency without throwing", () => {
    for (const c of CURRENCIES) {
      expect(() => formatCurrency(1000, c.code)).not.toThrow();
    }
  });
});

describe("formatCurrencyShort", () => {
  it("abbreviates millions and thousands with the currency symbol", () => {
    expect(formatCurrencyShort(2_500_000, "USD")).toBe("$2.5M");
    expect(formatCurrencyShort(3_400, "USD")).toBe("$3.4k");
    expect(formatCurrencyShort(900, "USD")).toBe("$900");
  });

  it("uses the matching symbol for non-USD currencies", () => {
    expect(formatCurrencyShort(1_000, "EUR")).toBe("€1.0k");
    expect(formatCurrencyShort(1_000, "INR")).toBe("₹1.0k");
  });

  it("falls back to the code prefix for unknown currencies (no throw)", () => {
    expect(formatCurrencyShort(1_000, "ZZZ")).toBe("ZZZ 1.0k");
  });
});

describe("formatInr", () => {
  it("formats whole rupee amounts with Indian numbering system grouping (lakhs)", () => {
    expect(formatInr(1234)).toBe("₹1,234");
    expect(formatInr(100000)).toBe("₹1,00,000");
    expect(formatInr(10000000)).toBe("₹1,00,00,000");
  });

  it("defaults to 0 decimal places", () => {
    expect(formatInr(250)).toBe("₹250");
    expect(formatInr(250.75)).toBe("₹251");
  });

  it("formats with custom decimal places when specified", () => {
    expect(formatInr(250.5, { decimals: 2 })).toBe("₹250.50");
    expect(formatInr(250, { decimals: 2 })).toBe("₹250.00");
  });

  it("supports compact formatting", () => {
    expect(formatInr(1500, { compact: true })).toBe("₹1.5k");
    expect(formatInr(2500000, { compact: true })).toBe("₹2.5M");
    expect(formatInr(900, { compact: true })).toBe("₹900");
  });

  it("handles 0, negative values, and non-finite numbers safely without throwing", () => {
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(-500)).toBe("-₹500");
    expect(formatInr(Number.NaN)).toBe("₹0");
    expect(formatInr(Number.POSITIVE_INFINITY)).toBe("₹0");
  });
});

