// A study's results kept in this browser, by the key of the model and the study, so that
// reopening a model shows its last results. Without IndexedDB nothing is kept.
import type { RunResult, StudyPlan } from "@mekasim/fit";

/** What is kept of a study's runs. */
export interface KeptResults {
  key: string;
  study: string;
  plan: StudyPlan;
  results: RunResult[];
  /** Whether every run was done, or the study was stopped. */
  complete: boolean;
  /** How long the runs took, in milliseconds. */
  ms: number;
  /** When they finished. */
  at: number;
}

const NAME = "mekafit";
const STORE = "studies";
/** Kept results beyond this many are dropped, the oldest first. */
const MOST = 50;

let opened: Promise<IDBDatabase | undefined> | undefined;

function open(): Promise<IDBDatabase | undefined> {
  opened ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("at", "at");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return opened;
}

/** The results kept under a key, if any. */
export async function savedResults(key: string): Promise<KeptResults | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as KeptResults | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Keep a study's results, dropping the oldest beyond the most kept. */
export async function saveResults(kept: KeptResults): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    store.put(kept);
    const count = store.count();
    count.onsuccess = () => {
      let extra = count.result - MOST;
      if (extra <= 0) return;
      const cursor = store.index("at").openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at || extra <= 0) return;
        at.delete();
        extra--;
        at.continue();
      };
    };
  } catch {
    // Kept for this visit only.
  }
}
