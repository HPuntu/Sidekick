import { readFile, writeFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));

const version = packageJson.version;

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value || "");
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `Obsidian plugin versions must use x.y.z format. Received: ${version}`
  );
}

const packageVersion = parseVersion(version);
const manifestVersion = parseVersion(manifest.version);

if (
  manifestVersion &&
  packageVersion &&
  compareVersions(packageVersion, manifestVersion) < 0 &&
  process.env.ALLOW_VERSION_DOWNGRADE !== "1"
) {
  throw new Error(
    `Refusing to sync package.json version ${version} over newer manifest.json version ${manifest.version}. Update package.json first, or set ALLOW_VERSION_DOWNGRADE=1 if this is intentional.`
  );
}

manifest.version = version;
versions[version] = manifest.minAppVersion;

await writeFile("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(
  `Synced manifest.json and versions.json to ${version} / Obsidian ${manifest.minAppVersion}`
);
