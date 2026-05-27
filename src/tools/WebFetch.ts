import { lookup } from "dns/promises";
import { request as requestHttps } from "https";
import { isIP, type LookupFunction } from "net";

export interface WebFetchResult {
  content: string;
  error?: string;
  title?: string;
  url: string;
}

const MAX_FETCH_CHARS = 20000;

export function parseAllowedHosts(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(normalizeAllowedHost)
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export async function fetchUrlText(
  rawUrl: string,
  allowedHosts: string[],
  timeoutMs = 8000
): Promise<WebFetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return {
      content: "",
      error: "Invalid URL.",
      url: rawUrl
    };
  }

  if (url.protocol !== "https:") {
    return {
      content: "",
      error: "Only HTTPS URLs are supported for web fetch.",
      url: url.toString()
    };
  }

  if (!isHostAllowed(url.hostname, allowedHosts)) {
    return {
      content: "",
      error: allowedHosts.length === 0
        ? "Web fetch requires an explicit allowed host."
        : "Host is not allowed for web fetch.",
      url: url.toString()
    };
  }

  const resolvedHost = await resolveFetchHost(url.hostname);
  if (resolvedHost.error || !resolvedHost.address || !resolvedHost.family) {
    return {
      content: "",
      error: resolvedHost.error ?? "Host did not resolve to an address.",
      url: url.toString()
    };
  }

  const pinnedAddress = resolvedHost.address;
  const pinnedFamily = resolvedHost.family;

  return new Promise((resolve) => {
    const request = requestHttps(
      url,
      {
        headers: {
          accept: "text/html,text/plain,application/json;q=0.8,*/*;q=0.5",
          "user-agent": "obsidian-sidekick/0.1"
        },
        lookup: createPinnedLookup(pinnedAddress, pinnedFamily),
        method: "GET"
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (body.length < MAX_FETCH_CHARS * 2) {
            body += chunk;
          }
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            resolve({
              content: "",
              error: `HTTP ${statusCode}`,
              url: url.toString()
            });
            return;
          }

          const content = htmlToText(body).slice(0, MAX_FETCH_CHARS);
          resolve({
            content,
            title: extractTitle(body),
            url: url.toString()
          });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("URL fetch timed out"));
    });
    request.on("error", (error) => {
      resolve({
        content: "",
        error: error.message,
        url: url.toString()
      });
    });
    request.end();
  });
}

function normalizeAllowedHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.startsWith("#")) {
    return trimmed;
  }

  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed.split("/")[0] ?? "";
  }
}

function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  if (allowedHosts.length === 0 || isBlockedHostLiteral(host)) {
    return false;
  }

  return allowedHosts.some(
    (allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`)
  );
}

interface ResolvedFetchHost {
  address?: string;
  error?: string;
  family?: 4 | 6;
}

async function resolveFetchHost(hostname: string): Promise<ResolvedFetchHost> {
  if (isBlockedHostLiteral(hostname)) {
    return { error: "Host resolves to a blocked local/private address." };
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) {
      return { error: "Host did not resolve to an address." };
    }

    const blocked = addresses.find((address) => isBlockedIpAddress(address.address));
    if (blocked) {
      return { error: `Host resolves to blocked address ${blocked.address}.` };
    }

    const selected = addresses[0];
    return {
      address: selected.address,
      family: selected.family === 6 ? 6 : 4
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "DNS lookup failed." };
  }
}

function createPinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, _options, callback) => {
    callback(null, address, family);
  };
}

function isBlockedHostLiteral(host: string): boolean {
  if (host === "localhost") {
    return true;
  }

  return isBlockedIpAddress(host);
}

function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isBlockedIpv4(address);
  }

  if (version === 6) {
    return isBlockedIpv6(address);
  }

  return false;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isBlockedIpv4(mapped);
  }

  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("ff")
  );
}

function extractTitle(value: string): string | undefined {
  return value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
}

function htmlToText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
