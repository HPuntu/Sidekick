import { request as requestHttp } from "http";
import { request as requestHttps } from "https";

export type OllamaStatus = "unknown" | "checking" | "running" | "unreachable";

export interface OllamaModel {
  name: string;
  modifiedAt?: string;
  size?: number;
}

export interface OllamaSnapshot {
  status: OllamaStatus;
  host: string;
  checkedAt?: string;
  error?: string;
  models: OllamaModel[];
  selectedModel?: string;
  selectedModelAvailable?: boolean;
  version?: string;
}

interface OllamaTagsResponse {
  models?: Array<{
    modified_at?: string;
    name?: string;
    size?: number;
  }>;
}

interface OllamaVersionResponse {
  version?: string;
}

export function createUnknownOllamaSnapshot(host: string): OllamaSnapshot {
  return {
    status: "unknown",
    host,
    models: []
  };
}

export function createCheckingOllamaSnapshot(host: string): OllamaSnapshot {
  return {
    status: "checking",
    host,
    models: []
  };
}

export async function checkOllama(
  host: string,
  selectedModel: string,
  timeoutMs = 2500
): Promise<OllamaSnapshot> {
  let normalizedHost: string;

  try {
    normalizedHost = normalizeHost(host);
  } catch (error) {
    return {
      status: "unreachable",
      host,
      checkedAt: new Date().toISOString(),
      error: getErrorMessage(error),
      models: [],
      selectedModel: selectedModel.trim() || undefined
    };
  }

  try {
    const [versionResponse, tagsResponse] = await Promise.all([
      requestJson<OllamaVersionResponse>(normalizedHost, "/api/version", timeoutMs),
      requestJson<OllamaTagsResponse>(normalizedHost, "/api/tags", timeoutMs)
    ]);

    const models = (tagsResponse.models ?? [])
      .filter((model) => typeof model.name === "string" && model.name.length > 0)
      .map((model) => ({
        name: model.name ?? "",
        modifiedAt: model.modified_at,
        size: model.size
      }))
      .sort((first, second) => first.name.localeCompare(second.name));

    const selected = selectedModel.trim();

    return {
      status: "running",
      host: normalizedHost,
      checkedAt: new Date().toISOString(),
      models,
      selectedModel: selected || undefined,
      selectedModelAvailable: selected
        ? models.some((model) => model.name === selected)
        : undefined,
      version: versionResponse.version
    };
  } catch (error) {
    return {
      status: "unreachable",
      host: normalizedHost,
      checkedAt: new Date().toISOString(),
      error: getErrorMessage(error),
      models: [],
      selectedModel: selectedModel.trim() || undefined
    };
  }
}

function normalizeHost(host: string): string {
  const trimmed = host.trim() || "http://127.0.0.1:11434";
  const withProtocol = /^https?:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(withProtocol);
  url.pathname = "";
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

function requestJson<T>(
  host: string,
  pathname: string,
  timeoutMs: number
): Promise<T> {
  const url = new URL(pathname, host);
  const requester = url.protocol === "https:" ? requestHttps : requestHttp;

  return new Promise<T>((resolve, reject) => {
    const request = requester(
      url,
      {
        headers: {
          accept: "application/json"
        },
        method: "GET"
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Ollama returned HTTP ${statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Ollama request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
