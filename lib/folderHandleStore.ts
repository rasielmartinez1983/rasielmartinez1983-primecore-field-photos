// Remembers the folder the user picked for "Save to folder" (e.g. their
// "Primecore Field Photos" folder) across visits, using a tiny IndexedDB
// store -- File System Access API directory handles are structured-clone-able
// and can be persisted this way, unlike a plain path string. Everything here
// is typed loosely (any) since the File System Access API isn't in
// TypeScript's default DOM lib yet.

const DB_NAME = "pcfp-fs-access";
const STORE_NAME = "handles";
const KEY = "baseFolder";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(handle: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Not fatal -- just means we'll ask the user to pick the folder again
    // next time instead of remembering it.
  }
}

export async function loadDirHandle(): Promise<any | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
