import js from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["main.js", "dist/**", "node_modules/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Catches the Obsidian API misuse that plugin review flags: detaching leaves
  // on unload, rendering markdown without a component, inline styles, and so on.
  ...obsidianmd.configs.recommended,
  {
    // Type-aware linting needs a TS project, so it only covers TypeScript.
    // The .mjs build and release scripts are handled separately below.
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        // tsconfig.json is the build input (src only); this one adds the tests
        // so the type-aware rules can see them too.
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      // Pi and Obsidian both hand back untyped JSON; the code narrows it by hand.
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "error",
      // Obsidian's design guidelines want sentence case for UI text. The rule
      // needs to be told which capitalised words are proper nouns, and which
      // literals (paths, model tags, hostnames) are not prose at all.
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: [
            "Local Sidekick",
            "Sidekick",
            "Pi",
            "Ollama",
            "Obsidian",
            "GitHub",
            "Markdown"
          ],
          acronyms: ["RPC", "URL", "PDF", "HTTPS", "DNS", "IP", "UI", "MB"],
          // Strings that are literal syntax rather than prose. The rule forbids
          // inline disable comments for its own rules, so exclusions live here.
          ignoreRegex: [
            "^/", // filesystem path placeholders
            "^[a-z0-9.-]+:[a-z]+$", // Ollama model tags, e.g. qwen2.5-coder:latest
            "^[a-z-]+$", // bare executable names, e.g. pi
            "^git ", // safe-command allowlist examples
            "\\n", // multi-line placeholder blocks
            "Sidekick/Agents", // a real vault path, not a capitalised word
            "@url\\(", // literal prompt directive syntax
            "Examples: arxiv" // hostname examples, which are lowercase
          ]
        }
      ]
    }
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Test fixtures are minimal object literals, not real vault files.
      "obsidianmd/no-tfile-tfolder-cast": "off"
    }
  },
  {
    // Node scripts: plain ESM, no TS project, and printing to stdout is the point.
    files: ["**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly"
      },
      sourceType: "module"
    },
    rules: {
      "no-console": "off",
      // The plugin re-reports core rules with Obsidian-specific messages. Its
      // console guidance is about plugin runtime code, not release tooling.
      "obsidianmd/rule-custom-message": "off"
    }
  }
);
