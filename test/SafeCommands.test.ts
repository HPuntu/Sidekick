import { describe, expect, it } from "vitest";

import {
  parseAllowedCommands,
  parseCommandTokens,
  runAllowedCommand
} from "../src/tools/SafeCommands";

describe("parseAllowedCommands", () => {
  it("collapses whitespace and drops blanks and comments", () => {
    expect(
      parseAllowedCommands(["git   status", "# note", "", "  ls -la  "].join("\n"))
    ).toEqual(["git status", "ls -la"]);
  });
});

describe("parseCommandTokens", () => {
  it("splits a plain command into a binary and arguments", () => {
    expect(parseCommandTokens("git status --short")).toEqual({
      command: "git",
      args: ["status", "--short"]
    });
  });

  it("strips surrounding quotes from tokens", () => {
    expect(parseCommandTokens('echo "hello world"')).toEqual({
      command: "echo",
      args: ["hello world"]
    });
  });

  it.each([";", "&", "|", "<", ">", "`", "$"])(
    "refuses commands containing %s",
    (metacharacter) => {
      expect(parseCommandTokens(`ls ${metacharacter} whoami`)).toBeUndefined();
    }
  );

  it("refuses an empty command", () => {
    expect(parseCommandTokens("")).toBeUndefined();
  });
});

describe("runAllowedCommand", () => {
  it("refuses a command that is not on the allowlist", async () => {
    const result = await runAllowedCommand("whoami", ["git status"], undefined);
    expect(result.success).toBe(false);
    expect(result.output).toContain("not in the safe allowlist");
  });

  it("compares against the allowlist after normalising whitespace", async () => {
    const result = await runAllowedCommand("  git    status  ", ["git status"], undefined);
    // Allowlisted, so it is attempted rather than refused outright.
    expect(result.output).not.toContain("not in the safe allowlist");
    expect(result.command).toBe("git status");
  });

  it("refuses an allowlisted entry that contains shell syntax", async () => {
    const result = await runAllowedCommand(
      "ls; whoami",
      ["ls; whoami"],
      undefined
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("unsupported shell syntax");
  });

  it("runs a real allowlisted command and captures output", async () => {
    const result = await runAllowedCommand("echo hi", ["echo hi"], undefined);
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("hi");
  });
});
