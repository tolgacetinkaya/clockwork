/**
 * Skill pin validation (CONCEPT.md §5): pinned by commit hash, not version
 * tag — a tag can be moved, a hash cannot. Format: "owner/repo@skill#<40-hex-hash>".
 */

export interface SkillPin {
  owner: string;
  repo: string;
  skill: string;
  commitHash: string;
}

export type ParseSkillPinResult = { ok: true; pin: SkillPin } | { ok: false; error: string };

const PIN_RE = /^([^/\s]+)\/([^@\s]+)@([^#\s]+)#(.+)$/;
const COMMIT_HASH_RE = /^[0-9a-fA-F]{40}$/;

export function parseSkillPin(raw: string): ParseSkillPinResult {
  const trimmed = raw.trim();
  const m = PIN_RE.exec(trimmed);
  if (!m) {
    return {
      ok: false,
      error: `Malformed skill pin: "${raw}" — expected format "owner/repo@skill#<40-hex-commit-hash>"`,
    };
  }
  const [, owner, repo, skill, hash] = m;
  if (!COMMIT_HASH_RE.test(hash!)) {
    return {
      ok: false,
      error: `Invalid pin "${raw}" — "${hash}" is not a 40-character commit hash. Tags and branches are not valid pins (a tag can move, a hash cannot).`,
    };
  }
  return { ok: true, pin: { owner: owner!, repo: repo!, skill: skill!, commitHash: hash!.toLowerCase() } };
}
