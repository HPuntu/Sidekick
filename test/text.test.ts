import { describe, expect, it } from "vitest";

import {
  asPlainRecord,
  escapeHtml,
  getErrorMessage,
  getMaxIdCounter,
  truncatePlainText,
  yamlScalar
} from "../src/util/text";
import { limitContextText, MAX_CONTEXT_CHARS } from "../src/prompt/promptContext";

describe("asPlainRecord", () => {
  it("accepts plain objects only", () => {
    expect(asPlainRecord({ a: 1 })).toEqual({ a: 1 });
    for (const value of [null, undefined, [], "s", 1]) {
      expect(asPlainRecord(value)).toBeUndefined();
    }
  });
});

describe("escapeHtml", () => {
  it("escapes the characters that would break a details block", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      '&lt;a href="x"&gt;&amp;&lt;/a&gt;'
    );
  });
});

describe("yamlScalar", () => {
  it("quotes and escapes so frontmatter stays valid", () => {
    expect(yamlScalar('a: "b"\nc')).toBe('"a: \\"b\\"\\nc"');
  });
});

describe("truncatePlainText", () => {
  it("collapses whitespace and appends an ellipsis when over length", () => {
    expect(truncatePlainText("  a   b  ", 10)).toBe("a b");
    expect(truncatePlainText("abcdefghij", 5)).toBe("ab...");
  });
});

describe("getMaxIdCounter", () => {
  it("finds the highest numeric suffix for a prefix", () => {
    expect(
      getMaxIdCounter(
        [{ id: "agent-event-3" }, { id: "agent-event-11" }, { id: "other-99" }],
        "agent-event-"
      )
    ).toBe(11);
  });

  it("returns zero when nothing matches", () => {
    expect(getMaxIdCounter([{ id: "x-1" }], "agent-event-")).toBe(0);
  });
});

describe("getErrorMessage", () => {
  it("unwraps Error and stringifies anything else", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("boom")).toBe("boom");
  });
});

describe("limitContextText", () => {
  it("passes short text through unchanged", () => {
    expect(limitContextText("short")).toBe("short");
  });

  it("truncates and says so", () => {
    const result = limitContextText("x".repeat(MAX_CONTEXT_CHARS + 100));
    expect(result).toContain("[Context truncated to");
    expect(result.startsWith("x".repeat(MAX_CONTEXT_CHARS))).toBe(true);
  });
});
