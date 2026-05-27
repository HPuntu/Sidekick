import { request as requestHttp } from "http";
import { request as requestHttps } from "https";

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
    .map((line) => line.trim().toLowerCase())
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

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      content: "",
      error: "Only HTTP and HTTPS URLs are supported.",
      url: url.toString()
    };
  }

  if (!isHostAllowed(url.hostname, allowedHosts)) {
    return {
      content: "",
      error: "Host is not allowed for web fetch.",
      url: url.toString()
    };
  }

  const requester = url.protocol === "https:" ? requestHttps : requestHttp;
  return new Promise((resolve) => {
    const request = requester(
      url,
      {
        headers: {
          accept: "text/html,text/plain,application/json;q=0.8,*/*;q=0.5",
          "user-agent": "obsidian-sidekick/0.1"
        },
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

function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  if (isBlockedLocalHost(host)) {
    return false;
  }

  if (allowedHosts.length === 0) {
    return true;
  }

  return allowedHosts.some(
    (allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`)
  );
}

function isBlockedLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
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
