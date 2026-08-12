import { describe, expect, it } from "vitest";

import {
  isBlockedHostLiteral,
  isBlockedIpAddress,
  isHostAllowed,
  parseAllowedHosts
} from "../src/tools/WebFetch";

describe("parseAllowedHosts", () => {
  it("reduces entries to bare hostnames", () => {
    expect(
      parseAllowedHosts(
        ["https://Example.COM/path", "docs.rs", "", "# note", "http://a.b/c"].join("\n")
      )
    ).toEqual(["example.com", "docs.rs", "a.b"]);
  });
});

describe("isHostAllowed", () => {
  it("denies everything when the allowlist is empty", () => {
    expect(isHostAllowed("example.com", [])).toBe(false);
  });

  it("matches the host itself and its subdomains", () => {
    expect(isHostAllowed("example.com", ["example.com"])).toBe(true);
    expect(isHostAllowed("docs.example.com", ["example.com"])).toBe(true);
  });

  it("does not match a suffix that is not a subdomain", () => {
    expect(isHostAllowed("notexample.com", ["example.com"])).toBe(false);
    expect(isHostAllowed("example.com.evil.test", ["example.com"])).toBe(false);
  });

  it("refuses local literals even if allowlisted", () => {
    expect(isHostAllowed("localhost", ["localhost"])).toBe(false);
    expect(isHostAllowed("127.0.0.1", ["127.0.0.1"])).toBe(false);
  });
});

describe("isBlockedIpAddress", () => {
  const blocked = [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1"
  ];

  it.each(blocked)("blocks %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  const allowed = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700::1"];

  it.each(allowed)("allows %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(false);
  });

  it("does not classify non-addresses as blocked", () => {
    expect(isBlockedIpAddress("example.com")).toBe(false);
  });
});

describe("isBlockedHostLiteral", () => {
  it("blocks localhost and raw private addresses", () => {
    expect(isBlockedHostLiteral("localhost")).toBe(true);
    expect(isBlockedHostLiteral("169.254.169.254")).toBe(true);
    expect(isBlockedHostLiteral("example.com")).toBe(false);
  });
});
