import type { Server } from "bun";
import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { IngestGroup } from "./ingest";
import type { Logger } from "./logger";
import {
  LatestQuerySchema,
  MeasurementQuerySchema,
  type MeasurementDto,
} from "./schemas";
import type { MeasurementRow, MeasurementStore } from "./store";
import type { SseHub } from "./sse";
import { INDEX_HTML } from "./index-page";

export type ControlHandler = (
  request: Request,
  url: URL
) => Promise<Response | null> | Response | null;

export interface HttpServerOptions {
  host: string;
  port: number;
  corsOrigin: string;
  store: MeasurementStore;
  sse: SseHub;
  ingests: IngestGroup;
  logger: Logger;
  control?: ControlHandler;
}

const UI_DIST = fileURLToPath(new URL("../../ui/dist", import.meta.url));

function corsHeaders(corsOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  corsOrigin: string
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(corsOrigin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  corsOrigin: string
): Response {
  return jsonResponse({ error: { code, message } }, status, corsOrigin);
}

function toDto(row: MeasurementRow): MeasurementDto {
  return {
    id: row.id,
    deviceId: row.deviceId,
    scaleDate: new Date(row.scaleDate * 1000).toISOString(),
    receivedAt: row.receivedAt,
    userId: row.userId,
    weightKg: row.weightX100 / 100,
    resistance: row.resistance,
    fatPercentage: row.fatPercentage,
    historical: row.historical,
    firmwareVersion: row.firmwareVersion,
  };
}

function uiFile(pathname: string): string | null {
  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const withIndex = relative.endsWith("/") ? `${relative}index.html` : relative;
  const target = normalize(join(UI_DIST, withIndex));
  if (!target.startsWith(UI_DIST + sep)) return null;
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

function queryObject(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

function validationMessage(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export function startHttpServer(options: HttpServerOptions): Server<undefined> {
  const { store, sse, ingests, logger, corsOrigin } = options;

  async function handle(
    request: Request,
    server: Server<undefined>
  ): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(corsOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (options.control) {
      const controlled = await options.control(request, url);
      if (controlled) {
        for (const [name, value] of Object.entries(cors)) {
          if (!controlled.headers.has(name)) controlled.headers.set(name, value);
        }
        return controlled;
      }
    }

    if (request.method !== "GET") {
      return errorResponse(405, "method_not_allowed", "Only GET is supported", corsOrigin);
    }

    if (url.pathname === "/") {
      const index = uiFile("/");
      if (index) {
        return new Response(Bun.file(index), {
          headers: { ...cors, "Cache-Control": "no-store" },
        });
      }

      return new Response(INDEX_HTML, {
        headers: {
          ...cors,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.pathname === "/simulator" && uiFile("/simulator/")) {
      return new Response(null, {
        status: 308,
        headers: { ...cors, Location: "/simulator/" },
      });
    }

    if (url.pathname === "/health") {
      const databaseOk = store.ping();
      const upstreams = ingests.statuses().map(({ id, url, status }) => ({
        id,
        url,
        ...status,
      }));
      const upstream = ingests.aggregate();
      const upstreamOk = !upstream.configured || upstream.connected;
      const ok = databaseOk && upstreamOk;

      return jsonResponse(
        {
          status: ok ? "ok" : "degraded",
          database: { ok: databaseOk },
          upstream,
          upstreams,
        },
        ok ? 200 : 503,
        corsOrigin
      );
    }

    if (url.pathname === "/api/measurements") {
      const parsed = MeasurementQuerySchema.safeParse(queryObject(url));
      if (!parsed.success) {
        return errorResponse(
          400,
          "invalid_query",
          validationMessage(parsed.error),
          corsOrigin
        );
      }

      const rows = store.list({
        from: parsed.data.from,
        to: parsed.data.to,
        userId: parsed.data.userId,
        limit: parsed.data.limit,
        before: parsed.data.before,
      });
      const measurements = rows.map(toDto);
      const next =
        rows.length === parsed.data.limit && measurements.length > 0
          ? measurements[measurements.length - 1].scaleDate
          : null;

      return jsonResponse({ measurements, next }, 200, corsOrigin);
    }

    if (url.pathname === "/api/measurements/latest") {
      const parsed = LatestQuerySchema.safeParse(queryObject(url));
      if (!parsed.success) {
        return errorResponse(
          400,
          "invalid_query",
          validationMessage(parsed.error),
          corsOrigin
        );
      }

      const row = store.latest(parsed.data.userId);
      if (!row) {
        return errorResponse(404, "not_found", "No measurements found", corsOrigin);
      }
      return jsonResponse(toDto(row), 200, corsOrigin);
    }

    if (url.pathname === "/api/devices") {
      const devices = store.devices().map((device) => ({
        id: device.id,
        lastSeenAt: device.lastSeenAt,
        firmwareVersion: device.firmwareVersion,
      }));
      return jsonResponse({ devices }, 200, corsOrigin);
    }

    if (url.pathname === "/api/events") {
      // SSE streams are quiet between measurements and would otherwise hit
      // Bun's default 10 s request idle timeout.
      server.timeout(request, 0);
      return new Response(sse.subscribe(), {
        headers: {
          ...cors,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const asset = uiFile(url.pathname);
    if (asset) {
      return new Response(Bun.file(asset), {
        headers: { ...cors, "Cache-Control": "public, max-age=31536000, immutable" },
      });
    }

    return errorResponse(404, "not_found", "Not found", corsOrigin);
  }

  return Bun.serve({
    hostname: options.host,
    port: options.port,
    async fetch(request, server) {
      try {
        return await handle(request, server);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`historian: request failed: ${message}`);
        return errorResponse(500, "internal_error", "Internal server error", corsOrigin);
      }
    },
    error(error) {
      logger.error(`historian: server error: ${error.message}`);
      return errorResponse(500, "internal_error", "Internal server error", corsOrigin);
    },
  });
}
