import type { SidekickProfile } from "./SidekickProfile";
import { yamlScalar } from "../util/text";
import { slugifyFileName } from "../util/vaultPath";

/** Exports a Sidekick profile as a Pi prompt template (`.pi/prompts/*.md`). */
export function buildPiPromptTemplate(profile: SidekickProfile): string {
  const lines = [
    "---",
    "description: " +
      yamlScalar(profile.description || `Local Sidekick profile ${profile.name}`),
    profile.modelLabels[0] ? "model: " + yamlScalar(profile.modelLabels[0]) : "",
    "---",
    "",
    "# " + profile.name,
    "",
    profile.prompt,
    ""
  ].filter(Boolean);

  if (profile.includePaths.length > 0) {
    lines.push(
      "## Local Sidekick Memory Includes",
      "",
      "When running through Local Sidekick these files are injected automatically. When running Pi directly, add or read them explicitly as needed.",
      "",
      ...profile.includePaths.map((includePath) => "- " + includePath),
      ""
    );
  }

  return lines.join("\n") + "\n";
}

export function buildPiSkillResource(
  name: string,
  description: string,
  instructions: string[]
): string {
  return [
    "---",
    "name: " + yamlScalar(name),
    "description: " + yamlScalar(description),
    "---",
    "",
    "# " + name,
    "",
    ...instructions.map((instruction) => "- " + instruction),
    ""
  ].join("\n");
}

export function sanitizePiResourceName(value: string): string {
  return slugifyFileName(value).replace(/\.md$/i, "") || "sidekick-profile";
}

/** Appends `entry` to a string-array setting, preserving existing values. */
export function mergeStringSetting(value: unknown, entry: string): string[] {
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  if (!values.includes(entry)) {
    values.push(entry);
  }

  return values;
}
