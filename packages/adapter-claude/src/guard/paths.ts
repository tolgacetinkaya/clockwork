import { isAbsolute, normalize as nativeNormalize, win32 } from "node:path";
/** Reject ambiguous names before normalization; never resolve relative caller input. */
export function normalize(value: string): string {
    const windows = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
    if (!value || /[\x00-\x1f]/.test(value) || (!windows && !isAbsolute(value)))
        throw new Error("absolute path required");
    const parts = value.replaceAll("\\", "/").split("/");
    if (parts.includes("..") || (windows && (value.startsWith("\\\\") || parts.some((p, i) => i > 0 && (/[.: ]$/.test(p) || p.includes(":") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))))))
        throw new Error("ambiguous or traversing path");
    const result = (windows ? win32.normalize(value) : nativeNormalize(value)).replaceAll("\\", "/").replace(/(.)\/$/, "$1");
    return windows || process.platform === "win32" ? result.toLowerCase() : result;
}
export function isUnder(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}/`);
}
