import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const bump = process.argv[2];
const validBumps = new Set(["major", "minor", "patch"]);

if (!validBumps.has(bump)) {
  throw new Error(`Expected release bump to be one of major, minor, patch. Received: ${bump || "<empty>"}`);
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value || "");
  if (!match) {
    return null;
  }
  return match.slice(1).map(Number);
}

function formatVersion(version) {
  return version.join(".");
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

function incrementVersion(version, type) {
  const next = [...version];
  if (type === "major") {
    return [next[0] + 1, 0, 0];
  }
  if (type === "minor") {
    return [next[0], next[1] + 1, 0];
  }
  return [next[0], next[1], next[2] + 1];
}

function gitTags() {
  try {
    return execFileSync("git", ["tag", "--list"], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const tags = gitTags();
const tagSet = new Set(tags);
const candidates = [packageJson.version, manifest.version, ...tags]
  .map(parseVersion)
  .filter(Boolean);

if (candidates.length === 0) {
  throw new Error("Could not find any x.y.z version in package.json, manifest.json, or git tags.");
}

const base = candidates.reduce((highest, version) =>
  compareVersions(version, highest) > 0 ? version : highest
);

let next = incrementVersion(base, bump);
while (tagSet.has(formatVersion(next))) {
  next = incrementVersion(next, "patch");
}

console.error(`Base release version: ${formatVersion(base)}`);
console.error(`Next ${bump} release version: ${formatVersion(next)}`);
console.log(formatVersion(next));
