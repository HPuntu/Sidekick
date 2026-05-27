import { randomUUID } from "crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import type { AddressInfo } from "net";

import { checkOllama } from "./ollama/OllamaClient";
import type { OllamaSnapshot } from "./ollama/OllamaClient";
import { probePiExecutable } from "./pi/PiProbe";
import type { PiSnapshot } from "./pi/PiProbe";
import { discoverPiRpc } from "./pi/PiRpcDiscovery";
import type { PiRpcDiscoverySnapshot } from "./pi/PiRpcDiscovery";

export type BridgeStatus = "stopped" | "starting" | "running" | "error";

export interface BridgeSnapshot {
  status: BridgeStatus;
  port?: number;
  url?: string;
  startedAt?: string;
  error?: string;
  tokenPreview?: string;
}

interface BridgeHealthPayload {
  ok: boolean;
  service: "local-sidekick-bridge";
  version: string;
  status: BridgeStatus;
  uptimeMs: number;
  startedAt?: string;
}

export class BridgeService {
  private error?: string;
  private port?: number;
  private server?: Server;
  private startedAt?: Date;
  private status: BridgeStatus = "stopped";
  private token = randomUUID();
  private version: string;

  constructor(version: string) {
    this.version = version;
  }

  async start(): Promise<BridgeSnapshot> {
    if (this.status === "running" || this.status === "starting") {
      return this.getSnapshot();
    }

    this.status = "starting";
    this.error = undefined;
    this.token = randomUUID();

    const server = createServer((request, response) => {
      this.handleRequest(request, response);
    });

    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };

        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(0, "127.0.0.1");
      });

      const address = server.address();
      if (!isAddressInfo(address)) {
        throw new Error("Bridge did not return a TCP port");
      }

      this.port = address.port;
      this.startedAt = new Date();
      this.status = "running";

      server.on("error", (error) => {
        this.status = "error";
        this.error = error.message;
      });
    } catch (error) {
      this.status = "error";
      this.error = getErrorMessage(error);
      this.server = undefined;
      this.port = undefined;
      this.startedAt = undefined;
    }

    return this.getSnapshot();
  }

  async stop(): Promise<BridgeSnapshot> {
    const server = this.server;
    if (!server) {
      this.status = "stopped";
      this.port = undefined;
      this.startedAt = undefined;
      return this.getSnapshot();
    }

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    this.server = undefined;
    this.port = undefined;
    this.startedAt = undefined;
    this.status = "stopped";
    return this.getSnapshot();
  }

  async restart(): Promise<BridgeSnapshot> {
    await this.stop();
    return this.start();
  }

  getSnapshot(): BridgeSnapshot {
    const url = this.port ? `http://127.0.0.1:${this.port}` : undefined;

    return {
      status: this.status,
      port: this.port,
      url,
      startedAt: this.startedAt?.toISOString(),
      error: this.error,
      tokenPreview: this.token.slice(0, 8)
    };
  }

  getToken(): string {
    return this.token;
  }

  checkOllama(host: string, selectedModel: string): Promise<OllamaSnapshot> {
    return checkOllama(host, selectedModel);
  }

  probePiExecutable(executablePath: string): Promise<PiSnapshot> {
    return probePiExecutable(executablePath);
  }

  discoverPiRpc(
    executablePath: string,
    allowExperimentalPiFeatures = false
  ): Promise<PiRpcDiscoverySnapshot> {
    return discoverPiRpc(executablePath, 4000, allowExperimentalPiFeatures);
  }

  private handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): void {
    if (!this.isAuthorized(request)) {
      writeJson(response, 401, {
        ok: false,
        error: "Unauthorized"
      });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, this.getHealthPayload());
      return;
    }

    writeJson(response, 404, {
      ok: false,
      error: "Not found"
    });
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const headerToken = request.headers["x-local-sidekick-token"];
    const authHeader = request.headers.authorization;

    if (headerToken === this.token) {
      return true;
    }

    return authHeader === `Bearer ${this.token}`;
  }

  private getHealthPayload(): BridgeHealthPayload {
    const startedAtMs = this.startedAt?.getTime();

    return {
      ok: this.status === "running",
      service: "local-sidekick-bridge",
      version: this.version,
      status: this.status,
      uptimeMs: startedAtMs ? Date.now() - startedAtMs : 0,
      startedAt: this.startedAt?.toISOString()
    };
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return typeof address === "object" && address !== null && "port" in address;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
