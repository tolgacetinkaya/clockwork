/**
 * Private library (CONCEPT.md §5): agent definitions accumulated from past
 * work. On the third use the system pulls from history instead of
 * producing again. Entries are the markdown+frontmatter format
 * `buildAgentDefinition` (packages/adapter-claude) emits: YAML frontmatter
 * followed by a free-form body.
 *
 * No semantic search (CONCEPT.md §6.2 decision): `findInLibrary` is plain
 * case-insensitive matching on name/description/tags.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

export interface LibraryEntryInput {
  name: string;
  content: string;
  tags?: string[];
}

export interface SaveToLibraryOptions {
  /** Refuse overwrite by default — entries are immutable unless explicitly overwritten. */
  overwrite?: boolean;
  /** Injectable clock for deterministic tests. */
  clock?: () => Date;
}

export interface LibraryListing {
  name: string;
  description?: string;
  model_tier?: string;
  provenance?: string;
  tags?: string[];
  saved_at?: string;
  filePath: string;
}

export interface FindInLibraryQuery {
  /** Case-insensitive substring match against name/description/tags. */
  query?: string;
  /** Entry must carry every listed tag (case-insensitive). */
  tags?: string[];
}

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;
  const parsed: unknown = YAML.parse(m[1] ?? "") ?? {};
  const frontmatter = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { frontmatter, body: m[2] ?? "" };
}

function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned || "unnamed";
}

function libraryFilePath(dir: string, name: string): string {
  return join(dir, `${sanitizeFileName(name)}.md`);
}

/**
 * Saves an agent definition to the library. Immutable by default: refuses
 * to overwrite an existing entry unless `overwrite: true`. Stamps
 * `saved_at` and `provenance` in the frontmatter when absent.
 */
export async function saveToLibrary(dir: string, entry: LibraryEntryInput, options: SaveToLibraryOptions = {}): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = libraryFilePath(dir, entry.name);

  const parsed = parseFrontmatter(entry.content) ?? { frontmatter: {}, body: entry.content };
  const frontmatter: Record<string, unknown> = { ...parsed.frontmatter };
  if (frontmatter.name === undefined) frontmatter.name = entry.name;
  if (frontmatter.saved_at === undefined) {
    frontmatter.saved_at = (options.clock ?? (() => new Date()))().toISOString();
  }
  if (frontmatter.provenance === undefined) frontmatter.provenance = "library";
  if (entry.tags !== undefined && frontmatter.tags === undefined) frontmatter.tags = entry.tags;

  const finalContent = serializeFrontmatter(frontmatter, parsed.body);

  try {
    await writeFile(filePath, finalContent, { encoding: "utf8", flag: options.overwrite ? "w" : "wx" });
  } catch (err) {
    if (!options.overwrite && (err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Library entry "${entry.name}" already exists — pass { overwrite: true } to replace it`);
    }
    throw err;
  }
  return filePath;
}

function toListing(filePath: string, fallbackName: string, frontmatter: Record<string, unknown>): LibraryListing {
  const str = (key: string): string | undefined => (typeof frontmatter[key] === "string" ? (frontmatter[key] as string) : undefined);
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((t): t is string => typeof t === "string") : undefined;

  return {
    name: str("name") ?? fallbackName,
    description: str("description"),
    model_tier: str("model_tier"),
    provenance: str("provenance"),
    tags,
    saved_at: str("saved_at"),
    filePath,
  };
}

/** Lists every entry in the library directory. Returns `[]` if the directory does not exist. */
export async function listLibrary(dir: string): Promise<LibraryListing[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const listings: LibraryListing[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(dir, entry);
    const content = await readFile(filePath, "utf8");
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;
    listings.push(toListing(filePath, entry.replace(/\.md$/, ""), parsed.frontmatter));
  }
  return listings;
}

/** Plain, no-embeddings search over the library (CONCEPT.md §6.2). */
export async function findInLibrary(dir: string, query: FindInLibraryQuery): Promise<LibraryListing[]> {
  const all = await listLibrary(dir);
  const q = query.query?.trim().toLowerCase();
  const wantedTags = query.tags?.map((t) => t.toLowerCase()).filter((t) => t.length > 0);

  return all.filter((entry) => {
    if (wantedTags && wantedTags.length > 0) {
      const entryTags = (entry.tags ?? []).map((t) => t.toLowerCase());
      if (!wantedTags.every((t) => entryTags.includes(t))) return false;
    }
    if (q) {
      const haystack = [entry.name, entry.description ?? "", ...(entry.tags ?? [])].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
