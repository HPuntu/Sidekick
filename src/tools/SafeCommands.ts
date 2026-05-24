import { execFile } from "child_process";

export interface SafeCommandResult {
  command: string;
  exitCode?: number;
  output: string;
  success: boolean;
}

const MAX_COMMAND_OUTPUT_CHARS = 12000;

export function parseAllowedCommands(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(normalizeCommandText)
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export async function runAllowedCommand(
  command: string,
  allowedCommands: string[],
  cwd: string | undefined,
  timeoutMs = 20000
): Promise<SafeCommandResult> {
  const normalizedCommand = normalizeCommandText(command);
  if (!allowedCommands.includes(normalizedCommand)) {
    return {
      command: normalizedCommand,
      output: "Command is not in the safe allowlist.",
      success: false
    };
  }

  const parsed = parseCommandTokens(normalizedCommand);
  if (!parsed) {
    return {
      command: normalizedCommand,
      output: "Command contains unsupported shell syntax.",
      success: false
    };
  }

  return new Promise((resolve) => {
    const child = execFile(
      parsed.command,
      parsed.args,
      {
        cwd,
        shell: false,
        timeout: timeoutMs
      },
      (error, stdout, stderr) => {
        const output = limitCommandOutput([stdout, stderr].filter(Boolean).join("\n"));
        if (error) {
          resolve({
            command: normalizedCommand,
            exitCode: "code" in error && typeof error.code === "number"
              ? error.code
              : undefined,
            output: output || error.message,
            success: false
          });
          return;
        }

        resolve({
          command: normalizedCommand,
          output: output || "(no output)",
          success: true
        });
      }
    );

    child.stdin?.end();
  });
}

function normalizeCommandText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseCommandTokens(
  command: string
): { args: string[]; command: string } | undefined {
  if (/[;&|<>`$]/.test(command)) {
    return undefined;
  }

  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) =>
    token.replace(/^["']|["']$/g, "")
  );
  if (!tokens || tokens.length === 0) {
    return undefined;
  }

  return {
    args: tokens.slice(1),
    command: tokens[0]
  };
}

function limitCommandOutput(value: string): string {
  if (value.length <= MAX_COMMAND_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_COMMAND_OUTPUT_CHARS)}\n[Output truncated to ${MAX_COMMAND_OUTPUT_CHARS.toLocaleString()} characters.]`;
}
