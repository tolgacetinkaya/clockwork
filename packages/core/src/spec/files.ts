import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { validateSpec } from "./validate.js";
import type { Spec, ValidationResult } from "./types.js";

const SPEC_FILE_RE = /^spec\.v(\d+)\.yaml$/;

export function specFileName(version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new RangeError(`Invalid spec version: ${version}`);
  }
  return `spec.v${version}.yaml`;
}

export function parseSpecFileName(name: string): number | null {
  const m = SPEC_FILE_RE.exec(name);
  return m?.[1] ? Number(m[1]) : null;
}

/** Dizindeki en yüksek spec sürümü; hiç spec yoksa null. */
export async function latestSpecVersion(dir: string): Promise<number | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const versions = entries
    .map(parseSpecFileName)
    .filter((v): v is number => v !== null);
  return versions.length ? Math.max(...versions) : null;
}

export interface LoadedSpec extends ValidationResult {
  /** Ham YAML dokümanı — spec geçersizken bile teşhis için erişilebilir. */
  doc: unknown;
  filePath: string;
}

export async function loadSpecFile(filePath: string): Promise<LoadedSpec> {
  const raw = await readFile(filePath, "utf8");
  let doc: unknown;
  try {
    doc = YAML.parse(raw);
  } catch (err) {
    return {
      doc: undefined,
      filePath,
      issues: [
        {
          level: "error",
          code: "yaml-parse",
          message: `Cannot parse YAML: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
  return { doc, filePath, ...validateSpec(doc) };
}

export async function loadLatestSpec(dir: string): Promise<LoadedSpec | null> {
  const version = await latestSpecVersion(dir);
  if (version === null) return null;
  return loadSpecFile(join(dir, specFileName(version)));
}

/**
 * Spec'i `spec.v{N}.yaml` olarak yazar. Var olan sürümün üzerine YAZMAZ —
 * sürümler değişmezdir (amendment yeni sürüm üretir).
 */
export async function writeSpecFile(dir: string, spec: Spec): Promise<string> {
  const { spec: valid, issues } = validateSpec(spec);
  if (!valid) {
    const first = issues.find((i) => i.level === "error");
    throw new Error(`Refusing to write invalid spec: ${first?.message ?? "unknown error"}`);
  }
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, specFileName(spec.spec_version));
  try {
    await writeFile(filePath, YAML.stringify(spec), { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Spec version v${spec.spec_version} already exists — versions are immutable`);
    }
    throw err;
  }
  return filePath;
}
