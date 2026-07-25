import { mkdir, access, constants } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { redis } from "./redis";
import { env } from "./env";
import { UPLOAD_ROOT } from "./image-storage";

/**
 * Platform health probes for the admin dashboard. Each probe is a real
 * round-trip with a short timeout — "the process is up" is not the same
 * as "it answers". Failures return the reason instead of throwing so
 * one dead service never breaks the page reporting on it.
 */

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const TIMEOUT_MS = 1_500;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    ),
  ]);
}

async function probe(name: string, fn: () => Promise<string>): Promise<HealthCheck> {
  try {
    return { name, ok: true, detail: await withTimeout(fn()) };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : "failed" };
  }
}

export async function platformHealth(): Promise<HealthCheck[]> {
  return Promise.all([
    probe("Database", async () => {
      await (prisma as PrismaClient).$queryRaw`SELECT 1`;
      return "query ok";
    }),
    probe("Redis", async () => {
      const pong = await redis.ping();
      return String(pong).toLowerCase() === "pong" ? "ping ok" : `unexpected: ${pong}`;
    }),
    probe("Image storage", async () => {
      // Images live on local disk now — confirm the upload root exists
      // and is writable (the single most common prod misconfig is a
      // missing/unwritable volume mount).
      await mkdir(UPLOAD_ROOT, { recursive: true });
      await access(UPLOAD_ROOT, constants.W_OK);
      return `${UPLOAD_ROOT} writable`;
    }),
    probe("Email", async () => {
      // Config-level check: a live SMTP/API round-trip would send real
      // traffic; transport presence + mode is the honest signal here.
      return `transport: ${env.EMAIL_TRANSPORT}`;
    }),
  ]);
}
