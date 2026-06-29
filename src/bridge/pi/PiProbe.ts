import { execFile } from "child_process";
import path from "path";

import { piChildEnv } from "./piEnv";

export type PiStatus = "available" | "checking" | "unavailable" | "unknown";

export interface PiSnapshot {
  checkedAt?: string;
  executablePath: string;
  error?: string;
  probe?: string;
  status: PiStatus;
  version?: string;
}

interface ProbeResult {
  output: string;
  probe: string;
}

export function createUnknownPiSnapshot(executablePath: string): PiSnapshot {
  return {
    executablePath,
    status: "unknown"
  };
}

export function createCheckingPiSnapshot(executablePath: string): PiSnapshot {
  return {
    executablePath,
    status: "checking"
  };
}

export async function probePiExecutable(
  executablePath: string,
  timeoutMs = 2500
): Promise<PiSnapshot> {
  const normalizedPath = executablePath.trim() || "pi";
  const validationError = validateExecutablePath(normalizedPath);

  if (validationError) {
    return {
      checkedAt: new Date().toISOString(),
      executablePath: normalizedPath,
      error: validationError,
      status: "unavailable"
    };
  }

  try {
    const result = await runFirstSuccessfulProbe(normalizedPath, timeoutMs);

    return {
      checkedAt: new Date().toISOString(),
      executablePath: normalizedPath,
      probe: result.probe,
      status: "available",
      version: firstUsefulLine(result.output) || "available"
    };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      executablePath: normalizedPath,
      error: getErrorMessage(error),
      status: "unavailable"
    };
  }
}

async function runFirstSuccessfulProbe(
  executablePath: string,
  timeoutMs: number
): Promise<ProbeResult> {
  const probes: Array<{ args: string[]; label: string }> = [
    { args: ["--version"], label: "--version" },
    { args: ["--help"], label: "--help" }
  ];

  const errors: string[] = [];

  for (const probe of probes) {
    try {
      const output = await execFileText(executablePath, probe.args, timeoutMs);
      return {
        output,
        probe: probe.label
      };
    } catch (error) {
      errors.push(`${probe.label}: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(errors.join("; "));
}

function execFileText(
  executablePath: string,
  args: string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executablePath,
      args,
      {
        env: piChildEnv(),
        maxBuffer: 64 * 1024,
        shell: false,
        timeout: timeoutMs
      },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
        if (error) {
          reject(new Error(output || error.message));
          return;
        }

        resolve(output);
      }
    );
  });
}

function firstUsefulLine(output: string): string {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function validateExecutablePath(executablePath: string): string | undefined {
  if (!executablePath) {
    return "Pi executable path is empty.";
  }

  if (!path.isAbsolute(executablePath) && /\s/.test(executablePath)) {
    return "Command names cannot include arguments or whitespace. Use only the executable path.";
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
