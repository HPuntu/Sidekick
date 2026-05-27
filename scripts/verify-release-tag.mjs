import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || "";

if (!tag) {
  throw new Error("Release tag is required.");
}

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Version mismatch: manifest.json has ${manifest.version}, package.json has ${packageJson.version}`
  );
}

if (tag !== manifest.version) {
  throw new Error(
    `Release tag ${tag} must exactly match manifest.json version ${manifest.version}`
  );
}

console.log(`Release tag ${tag} matches manifest/package version.`);
