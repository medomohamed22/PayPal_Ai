import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Tiny KV layer for price watches. Uses Upstash Redis when configured
 * (Vercel Marketplace sets KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN);
 * otherwise an in-memory map (fine for local dev, NOT persistent on Vercel).
 */
interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  /** Atomic counter that expires ttlSec after its first increment. */
  incr(key: string, ttlSec: number): Promise<number>;
}

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const storePersistent = !!(url && token);

function redisKV(): KV {
  const r = new Redis({ url: url!, token: token! });
  return {
    get: async <T,>(k: string) => (await r.get<T>(k)) ?? null,
    set: async (k, v) => {
      await r.set(k, v);
    },
    del: async (k) => {
      await r.del(k);
    },
    sadd: async (k, m) => {
      await r.sadd(k, m);
    },
    srem: async (k, m) => {
      await r.srem(k, m);
    },
    smembers: async (k) => (await r.smembers(k)) as string[],
    incr: async (k, ttl) => {
      const n = await r.incr(k);
      if (n === 1) await r.expire(k, ttl);
      return n;
    },
  };
}

function memoryKV(): KV {
  const g = globalThis as unknown as { __dalilKV?: Map<string, unknown> };
  const m = (g.__dalilKV ??= new Map());
  const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    get: async <T,>(k: string) => (m.has(k) ? clone(m.get(k) as T) : null),
    set: async (k, v) => void m.set(k, clone(v)),
    del: async (k) => void m.delete(k),
    sadd: async (k, v) => {
      const s = new Set((m.get(k) as string[]) ?? []);
      s.add(v);
      m.set(k, [...s]);
    },
    srem: async (k, v) => {
      m.set(k, ((m.get(k) as string[]) ?? []).filter((x) => x !== v));
    },
    smembers: async (k) => [...((m.get(k) as string[]) ?? [])],
    incr: async (k) => {
      const n = ((m.get(k) as number) ?? 0) + 1;
      m.set(k, n);
      return n;
    },
  };
}

export const kv: KV = storePersistent ? redisKV() : memoryKV();
