import process from "process";

// Pi runs a version check against the network at startup. The result is cached
// for a few days, so an offline vault keeps working until the cache expires and
// the next check fails, surfacing as an "offline error". This plugin is a
// local-only workflow, so we always skip that check: with it disabled and an
// Ollama model selected, Pi only ever talks to the local Ollama host.
export function piChildEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PI_SKIP_VERSION_CHECK: "1" };
}
