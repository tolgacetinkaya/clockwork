import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';

// Inspect both tracked files and files a normal `git add` would include.
const paths = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const forbidden = /(?:^|\/)(?:node_modules|runs|\.teamsmith|\.teamsmith-worktrees|\.clockwork|\.clockwork-worktrees|\.claude|\.codex)(?:\/|$)|(?:^|\/)\.env(?:\..*)?$|\.(?:pem|key|p12|pfx)$|(?:^|\/)\.npmrc$/i;
const credentials = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const machinePath = /[A-Z]:[\\/](?:Users|special-repos)[\\/]|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\//i;
const fixtureFiles = new Set([
  'packages/core/test/audit.secrets.test.ts',
  'packages/core/test/audit.report.test.ts',
  'packages/core/test/ledger.store.test.ts',
]);
const fakeToken = /^(?:sk-(?:[abzy]{24}|[12]{22}|abcdefghijklmnopqrstuvwx|abcdefghijklmnop1234)|ghp_abcdefghijklmnopqrs[t]1234|AKIAIOSFODNN7E[X]AMPLE)$/;
const findings = [];
for (const path of paths) {
  if (path !== '.env.example' && forbidden.test(path)) { findings.push(`${path}: private/generated path must not be committed`); continue; }
  const entry = lstatSync(path);
  if (!entry.isFile()) { findings.push(`${path}: only regular source files may be published`); continue; }
  const buffer = readFileSync(path);
  if (buffer.includes(0)) continue;
  const lines = buffer.toString('utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (machinePath.test(line)) findings.push(`${path}:${index + 1}: machine-specific path`);
    for (const match of line.matchAll(credentials)) {
      if (fixtureFiles.has(path) && fakeToken.test(match[0])) continue;
      // Never print the matched credential or source line.
      findings.push(`${path}:${index + 1}: possible credential`);
    }
  }
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Public-file checks passed for ${paths.length} candidate files. Pattern checks do not replace manual review.`);
}
