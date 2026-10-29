import { readFile } from 'node:fs/promises';

const token = process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!token || repository !== 'tolgacetinkaya/clockwork') throw new Error('Expected a trusted repository workflow');
const labels = JSON.parse(await readFile(new URL('../labels.json', import.meta.url), 'utf8'));
async function request(method, path, body) {
  return fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
for (const label of labels) {
  const path = `labels/${encodeURIComponent(label.name)}`;
  const current = await request('GET', path);
  if (current.status !== 404 && !current.ok) throw new Error(`Cannot inspect label: ${current.status}`);
  const result = current.status === 404
    ? await request('POST', 'labels', label)
    : await request('PATCH', path, { new_name: label.name, color: label.color, description: label.description });
  if (!result.ok) throw new Error(`Cannot sync ${label.name}: HTTP ${result.status}`);
  console.log(`Synced ${label.name}`);
}
