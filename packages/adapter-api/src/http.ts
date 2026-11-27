import type { ProviderConfig } from "./config.js";
import { record } from "./config.js";

export type Message = Record<string, unknown> & { role: string };
export interface TokenUsage { input: number; cached: number; output: number }
export function parseUsage(value: unknown): TokenUsage {
  if (!record(value)) throw new Error("Provider omitted usage; usage remains unknown");
  const details = record(value.prompt_tokens_details) ? value.prompt_tokens_details : {};
  const input = value.prompt_tokens, output = value.completion_tokens;
  const cached = value.prompt_cache_hit_tokens ?? details.cached_tokens ?? 0;
  if (![input, output, cached].every(n => Number.isSafeInteger(n) && Number(n) >= 0) ||
    Number(cached) > Number(input) || !Number.isSafeInteger(Number(input) + Number(output))) {
    throw new Error("Provider returned invalid token usage");
  }
  return { input: Number(input), cached: Number(cached), output: Number(output) };
}
export async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    // Bodies and headers can contain credentials or echoed project content.
    throw new Error(`Provider HTTP ${response.status}; no automatic retry was made`);
  }
  if (!response.body) throw new Error("Provider returned an empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4_000_000) throw new Error("Provider response exceeds size limit");
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("Provider returned invalid JSON"); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function authorization(config: ProviderConfig, env: NodeJS.ProcessEnv): string {
  const key = env[config.apiKeyEnv];
  if (!key || /[\r\n]/.test(key)) throw new Error(`Set ${config.apiKeyEnv} in the host environment before starting this provider`);
  return `Bearer ${key}`;
}
export async function requestJson(url: string, init: RequestInit, transport: typeof fetch = fetch): Promise<unknown> {
  let response: Response;
  try { response = await transport(url, { ...init, redirect: "error" }); }
  catch { throw new Error("Provider request interrupted or transport failed; usage may be unknown"); }
  return jsonResponse(response);
}
export async function listModels(config: ProviderConfig, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const raw = await requestJson(`${config.baseUrl}/models`, { headers: { Authorization: authorization(config, env) }, signal });
  if (!record(raw) || !Array.isArray(raw.data) || raw.data.some(m => !record(m) || typeof m.id !== "string")) throw new Error("Provider returned an invalid model list");
  return [...new Set(raw.data.map(m => (m as { id: string }).id))].sort();
}
