import { LANGUAGES, PROMPT_VERSION, type Explanation, type Reading } from '../shared';

export const TTL = 7 * 24 * 60 * 60 * 1000;
export const CAPACITY = 300;
const STORAGE_KEY = 'explanationCacheV1';
interface Entry { answer: Explanation; saved: number; used: number }
type Entries = Record<string, Entry>;
type Backend = Pick<chrome.storage.LocalStorageArea, 'get' | 'set'>;

export async function cacheKey(r: Reading, model: string, version = PROMPT_VERSION, languages = LANGUAGES) {
  const bytes = new TextEncoder().encode(JSON.stringify([
    version, languages, model, r.selected, r.start, r.end, r.sentence, r.before, r.after, r.title
  ]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export class ExplanationCache {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: () => Promise<Backend>, private readonly now = Date.now) {}

  // Only the worker owns this table. Serialize its read/modify/write operations across tabs.
  private transact<T>(fn: (entries: Entries, time: number) => T): Promise<T> {
    const job = this.pending.then(async () => {
      const db = await this.store();
      const snapshot = (await db.get(STORAGE_KEY))[STORAGE_KEY];
      const entries: Entries = snapshot && typeof snapshot === 'object' ? snapshot as Entries : {};
      const time = this.now();
      let dirty = false;
      for (const [key, row] of Object.entries(entries)) {
        if (!row?.answer || !Number.isFinite(row.saved) || time - row.saved >= TTL) { delete entries[key]; dirty = true; }
      }
      const result = fn(entries, time);
      const keys = Object.keys(entries);
      if (keys.length > CAPACITY) {
        keys.sort((a, b) => entries[a]!.used - entries[b]!.used);
        for (const key of keys.slice(0, keys.length - CAPACITY)) delete entries[key];
        dirty = true;
      }
      if (dirty || result !== undefined) await db.set({ [STORAGE_KEY]: entries });
      return result;
    });
    this.pending = job.catch(() => undefined);
    return job;
  }
  get(key: string) {
    return this.transact((entries, time) => {
      const row = entries[key];
      if (row) { row.used = time; return row.answer; }
    });
  }
  async put(key: string, answer: Explanation) {
    await this.transact((entries, time) => {
      entries[key] = { saved: time, used: time, answer };
      return true;
    });
  }
}
