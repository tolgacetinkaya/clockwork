import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

/** Endpoints are host configuration, never model- or browser-controlled. */
export const PROVIDERS = {
  zai: { name: "Z.ai / GLM", baseUrl: "https://api.z.ai/api/paas/v4", apiKeyEnv: "ZAI_API_KEY" },
  qwen: { name: "Qwen / Alibaba Model Studio", apiKeyEnv: "DASHSCOPE_API_KEY" },
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" },
  kimi: { name: "Kimi / Moonshot", baseUrl: "https://api.moonshot.ai/v1", apiKeyEnv: "MOONSHOT_API_KEY" },
} as const;

export interface ProviderConfig {
  baseUrl: string;
  apiKeyEnv: string;
  maxOutputTokens: number;
  /** Host-selected, provider-specific generation options. No transport overrides. */
  options: Record<string, unknown>;
}
export interface ApiConfig {
  sandboxImage: string;
  dockerExecutable?: string;
  maxRounds: number;
  maxInputBytes: number;
  providers: Record<string, ProviderConfig>;
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown, fallback: number, min: number, max: number, key: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || Number(n) < min || Number(n) > max) throw new Error(`Invalid ${key}`);
  return Number(n);
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error("Unknown provider configuration field");
}
export function validateApiConfig(raw: unknown): ApiConfig {
  if (!record(raw) || !record(raw.providers)) throw new Error("Provider configuration must contain providers");
  keys(raw, ["sandboxImage", "dockerExecutable", "maxRounds", "maxInputBytes", "providers"]);
  if (typeof raw.sandboxImage !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,240}$/.test(raw.sandboxImage)) {
    throw new Error("sandboxImage must name a trusted, locally available Linux image with /bin/sh");
  }
  if (raw.dockerExecutable !== undefined && (typeof raw.dockerExecutable !== "string" || !isAbsolute(raw.dockerExecutable) || /[\r\n\0]/.test(raw.dockerExecutable))) {
    throw new Error("dockerExecutable must be an absolute trusted host executable path");
  }
  const providers: Record<string, ProviderConfig> = Object.create(null);
  for (const [id, entry] of Object.entries(raw.providers)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(id) || ["codex", "constructor", "prototype"].includes(id) || !record(entry)) {
      throw new Error("Invalid provider ID or configuration");
    }
    keys(entry, ["baseUrl", "apiKeyEnv", "maxOutputTokens", "options"]);
    const preset = Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id as keyof typeof PROVIDERS] : undefined;
    const base = entry.baseUrl ?? (preset && "baseUrl" in preset ? preset.baseUrl : undefined);
    if (typeof base !== "string") throw new Error(`${id}: baseUrl is required (use your account's regional endpoint)`);
    let url: URL;
    try { url = new URL(base); } catch { throw new Error(`${id}: invalid baseUrl`); }
    if (url.username || url.password || url.search || url.hash || /[\s,]/.test(base) ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
      throw new Error(`${id}: use HTTPS, or an explicit loopback HTTP endpoint without credentials or query parameters`);
    }
    const apiKeyEnv = entry.apiKeyEnv ?? preset?.apiKeyEnv;
    if (typeof apiKeyEnv !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(apiKeyEnv)) throw new Error(`${id}: invalid apiKeyEnv`);
    const options = entry.options ?? {};
    if (!record(options)) throw new Error(`${id}: invalid options`);
    keys(options, ["thinking", "enable_thinking", "reasoning_effort", "temperature", "top_p"]);
    if (JSON.stringify(options).length > 2000) throw new Error(`${id}: options exceed size limit`);
    providers[id] = {
      baseUrl: url.href.replace(/\/+$/, ""), apiKeyEnv,
      maxOutputTokens: integer(entry.maxOutputTokens, 8192, 128, 131072, "maxOutputTokens"), options,
    };
  }
  if (!Object.keys(providers).length) throw new Error("Configure at least one provider");
  return {
    sandboxImage: raw.sandboxImage,
    ...(typeof raw.dockerExecutable === "string" ? { dockerExecutable: raw.dockerExecutable } : {}),
    maxRounds: integer(raw.maxRounds, 24, 1, 100, "maxRounds"),
    maxInputBytes: integer(raw.maxInputBytes, 2_000_000, 1000, 8_000_000, "maxInputBytes"), providers,
  };
}
export async function loadApiConfig(path: string): Promise<ApiConfig> {
  if (!isAbsolute(path)) throw new Error("providers-config must be an absolute host configuration path");
  const contents = await readFile(path, "utf8");
  if (contents.length > 65536) throw new Error("Provider configuration exceeds size limit");
  let raw: unknown;
  try { raw = JSON.parse(contents); } catch { throw new Error("Invalid provider configuration JSON"); }
  return validateApiConfig(raw);
}
export function modelRoute(value: string | undefined): { provider: string; model?: string } {
  if (!value?.includes("::")) return { provider: "codex", model: value };
  const at = value.indexOf("::");
  const provider = value.slice(0, at), model = value.slice(at + 2);
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(provider) || !model || model.startsWith("-") || /[\s\x00-\x1f\x7f-\x9f]/u.test(model) || value.length > 200) {
    throw new Error("Use provider::model with a non-empty model ID");
  }
  return { provider, model };
}
