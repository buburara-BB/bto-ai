type Entry = { v: unknown; exp: number };
const g = globalThis as unknown as {
  __store?: Map<string, Entry>;
  __inflight?: Map<string, Promise<unknown>>;
};
const store = (g.__store ??= new Map<string, Entry>());
const inflight = (g.__inflight ??= new Map<string, Promise<unknown>>());
const MAX = 500;

type Fn<T> = () => Promise<{ value: T; cache: boolean }>;

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: Fn<T>
): Promise<{ value: T; hit: boolean }> {
  const e = store.get(key);
  if (e && e.exp > Date.now()) return { value: e.v as T, hit: true };

  const running = inflight.get(key) as Promise<{ value: T; cache: boolean }> | undefined;
  if (running) {
    const r = await running;
    return { value: r.value, hit: true };
  }

  const p = fn();
  inflight.set(key, p);
  try {
    const r = await p;
    if (r.cache) {
      if (store.size >= MAX) {
        const first = store.keys().next().value;
        if (first !== undefined) store.delete(first);
      }
      store.set(key, { v: r.value, exp: Date.now() + ttlMs });
    }
    return { value: r.value, hit: false };
  } finally {
    inflight.delete(key);
  }
}
