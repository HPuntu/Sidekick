import { describe, expect, it } from "vitest";

import {
  createUnexpectedToolEvent,
  createPiToolEvent,
  describePiToolMode,
  formatPiUserConfigFlag,
  formatPiToolFlag,
  getOllamaModelName,
  isPiRunPhaseNoise,
  isPiToolSupportErrorStatus,
  isReadOnlyPiToolEvent,
  READ_ONLY_PI_TOOL_NAMES
} from "../src/bridge/pi/piFlags";
import type { PiToolEvent } from "../src/bridge/pi/PiReadOnlyPrompt";

function toolEvent(overrides: Partial<PiToolEvent> = {}): PiToolEvent {
  return {
    eventType: "tool_call",
    raw: {},
    status: "call",
    title: "read call",
    ...overrides
  };
}

describe("formatPiToolFlag", () => {
  it("only ever emits the read-only allowlist or --no-tools", () => {
    expect(formatPiToolFlag("read-only")).toBe("--tools read,grep,find,ls");
    expect(formatPiToolFlag("disabled")).toBe("--no-tools");
  });

  it("names exactly the tools in the read-only set", () => {
    const flagged = formatPiToolFlag("read-only")
      .replace("--tools ", "")
      .split(",");
    expect(new Set(flagged)).toEqual(READ_ONLY_PI_TOOL_NAMES);
  });
});

describe("formatPiUserConfigFlag", () => {
  it("disables extensions, skills, templates, and context files by default", () => {
    expect(formatPiUserConfigFlag(false)).toBe(
      "--no-extensions --no-skills --no-prompt-templates --no-context-files"
    );
  });

  it("renders as empty when enabled, because no flag is added", () => {
    // The audit log must not record a flag that never reaches Pi.
    expect(formatPiUserConfigFlag(true)).toBe("");
  });
});

describe("describePiToolMode", () => {
  it("describes both modes", () => {
    expect(describePiToolMode("read-only")).toContain("read-only tools");
    expect(describePiToolMode("disabled")).toBe("tools disabled");
  });
});

describe("isReadOnlyPiToolEvent", () => {
  it.each(["read", "grep", "ls", "find", "READ", " read "])(
    "accepts %s",
    (name) => {
      expect(isReadOnlyPiToolEvent(toolEvent({ name }))).toBe(true);
    }
  );

  it.each(["write", "edit", "bash", "delete", ""])("rejects %s", (name) => {
    expect(isReadOnlyPiToolEvent(toolEvent({ name }))).toBe(false);
  });

  it("rejects an event with no tool name", () => {
    expect(isReadOnlyPiToolEvent(toolEvent({ name: undefined }))).toBe(false);
  });
});

describe("tool event mapping", () => {
  it("preserves the status for an allowed event", () => {
    expect(createPiToolEvent(toolEvent({ status: "result" })).status).toBe("result");
  });

  it("labels an out-of-allowlist tool as having already run", () => {
    const unexpected = createUnexpectedToolEvent(toolEvent({ title: "bash call" }));
    expect(unexpected.status).toBe("blocked");
    // Must not read as prevention: Pi already ran it.
    expect(unexpected.title).toBe("Ran outside allowlist: bash call");
    expect(unexpected.title).not.toContain("Blocked");
  });
});

describe("getOllamaModelName", () => {
  it("strips the provider prefix", () => {
    expect(getOllamaModelName("ollama/gemma4:31b")).toBe("gemma4:31b");
  });

  it("splits on the first slash so namespaced ids survive", () => {
    expect(getOllamaModelName("ollama/library/llama3:8b")).toBe(
      "library/llama3:8b"
    );
  });

  it("passes through a bare model name", () => {
    expect(getOllamaModelName("gemma4:31b")).toBe("gemma4:31b");
  });

  it("handles empty and malformed labels without throwing", () => {
    expect(getOllamaModelName("")).toBe("");
    expect(getOllamaModelName("  ollama/  ")).toBe("ollama/");
    expect(getOllamaModelName("/leading")).toBe("/leading");
  });
});

describe("isPiRunPhaseNoise", () => {
  const noise = [
    "Pi accepted the prompt.",
    "Pi run started.",
    "Pi run complete.",
    "Pi turn started.",
    "Model response started.",
    "Pi is reasoning."
  ];

  it.each(noise)("hides %s", (message) => {
    expect(isPiRunPhaseNoise(message)).toBe(true);
  });

  const shown = [
    "Pi will retry after a transient failure.",
    "Pi completed without assistant text.",
    "Pi auto-retry 2/3: connection reset",
    "Pi extension error: bad config",
    "Pi run stopped.",
    "llama3 does not support Pi/Ollama tool calls."
  ];

  it.each(shown)("keeps %s", (message) => {
    expect(isPiRunPhaseNoise(message)).toBe(false);
  });
});

describe("isPiToolSupportErrorStatus", () => {
  it("recognises the unsupported-tools message", () => {
    expect(
      isPiToolSupportErrorStatus("llama3 does not support Pi/Ollama tool calls.")
    ).toBe(true);
    expect(isPiToolSupportErrorStatus("Pi run started.")).toBe(false);
  });
});
