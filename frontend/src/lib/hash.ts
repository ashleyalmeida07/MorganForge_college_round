// Canonical JSON + SHA-256, byte-identical to the backend's
// json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).

function canonicalValue(v: unknown): string {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite number in JSON");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalValue).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalValue(obj[k])}`).join(",")}}`;
}

export function canonicalJson(v: unknown): string {
  return canonicalValue(v);
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(h: string): Uint8Array {
  const s = h.replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  return toHex(await sha256(data));
}
