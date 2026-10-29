import { lstat, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** Final-file aliases cannot share the path-based lock and are unsupported. */
export async function assertStorageFile(file: string): Promise<void> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.nlink > 1) {
      throw new Error(`Refusing aliased or nonregular storage file: ${file}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Exclusive across processes. Never steals a lock: PID reuse and suspended owners
 * make age-based reclamation unsafe. Abandoned locks fail with recovery guidance. */
export async function withStorageLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 5000;
  let handle;
  while (!handle) {
    try {
      handle = await open(lock, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows can report access denied while another process finishes unlinking.
      const pendingWindowsDelete = process.platform === "win32" && (code === "EPERM" || code === "EACCES");
      if (code !== "EEXIST" && !pendingWindowsDelete) throw error;
      // Never read lock contents: an existing path may link to a private file.
      await assertStorageFile(lock);
      if (Date.now() >= deadline) {
        throw new Error(`Storage lock timeout: ${lock}. If its owner has exited, remove this lock file and retry.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20));
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() }));
    await assertStorageFile(file);
    return await action();
  } finally {
    await handle.close();
    await unlink(lock);
  }
}

/** Call under the storage lock for this file (or its owning queue). */
export async function atomicWrite(file: string, contents: string): Promise<void> {
  await assertStorageFile(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
