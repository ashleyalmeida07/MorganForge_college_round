"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileCode2, Loader2, Play, Upload, XCircle } from "lucide-react";

import { isFormSchema, validateSchema } from "@/components/forms/SchemaForm";
import { AppShell } from "@/components/ui/efferd-dashboard-2-utils/app-shell";
import { ApiError, apiPost, type Program } from "@/lib/api";
import { canonicalJson, sha256Hex } from "@/lib/hash";
import { executeWasm } from "@/lib/verify";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const LABEL = "text-sm font-semibold text-slate-700";
const REQUIRED_EXPORTS = ["memory", "alloc", "compute"] as const;

interface WasmInfo {
  name: string;
  size: number;
  hash: string;
  bytes: Uint8Array;
  imports: string[];
  exports: string[];
  abiOk: boolean;
  problems: string[];
}

interface RegisterOut extends Program {
  already_registered?: boolean;
}

interface TryRun {
  ok: boolean;
  output?: string;
  outputHash?: string;
  checkpoints?: number;
  error?: string;
}

/** Inspect a module the way the backend's validate_module does: no imports, the Verity ABI exports. */
async function inspectWasm(file: File): Promise<WasmInfo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(bytes);
  const problems: string[] = [];
  let imports: string[] = [];
  let exports: string[] = [];
  try {
    const mod = await WebAssembly.compile(bytes as BufferSource);
    imports = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`);
    exports = WebAssembly.Module.exports(mod).map((e) => e.name);
    if (imports.length) problems.push(`has imports (${imports.join(", ")}); rule sets must be import-free to stay deterministic`);
    for (const e of REQUIRED_EXPORTS) if (!exports.includes(e)) problems.push(`missing export “${e}”`);
  } catch (e) {
    problems.push(`not a valid WebAssembly module: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { name: file.name, size: bytes.length, hash, bytes, imports, exports, abiOk: problems.length === 0, problems };
}

function parseJsonField(label: string, text: string): { value?: unknown; error?: string } {
  if (!text.trim()) return {};
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: `${label}: ${e instanceof Error ? e.message : "invalid JSON"}` };
  }
}

const pretty = (v: unknown) => (v === undefined || v === null ? "" : JSON.stringify(v, null, 2));

export default function NewRuleSetPage() {
  const [wasm, setWasm] = useState<WasmInfo | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [language, setLanguage] = useState("rust");
  const [description, setDescription] = useState("");
  const [inputSchema, setInputSchema] = useState("");
  const [outputSchema, setOutputSchema] = useState("");
  const [example, setExample] = useState("");

  const [tryRun, setTryRun] = useState<TryRun | null>(null);
  const [busy, setBusy] = useState<null | "inspect" | "try" | "submit">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterOut | null>(null);

  const inSchema = parseJsonField("Input schema", inputSchema);
  const outSchema = parseJsonField("Output schema", outputSchema);
  const ex = parseJsonField("Example input", example);
  const exampleErrors =
    ex.value !== undefined && isFormSchema(inSchema.value) ? validateSchema(inSchema.value, ex.value, "example") : [];
  const jsonErrors = [inSchema.error, outSchema.error, ex.error].filter(Boolean) as string[];
  const canSubmit = !!wasm?.abiOk && name.trim().length > 0 && jsonErrors.length === 0 && exampleErrors.length === 0 && !busy;

  async function onWasm(file?: File | null) {
    setResult(null);
    setTryRun(null);
    setError(null);
    if (!file) return setWasm(null);
    setBusy("inspect");
    try {
      const info = await inspectWasm(file);
      setWasm(info);
      if (!name) setName(file.name.replace(/\.wasm$/i, "").replace(/[_-]+/g, " "));
    } finally {
      setBusy(null);
    }
  }

  /** Prefill from a rule set's meta.json (rulesets/<name>/meta.json). */
  async function onMeta(file?: File | null) {
    if (!file) return;
    try {
      const meta = JSON.parse(await file.text()) as Record<string, unknown>;
      if (typeof meta.name === "string") setName(meta.name);
      if (typeof meta.version === "string") setVersion(meta.version);
      if (typeof meta.language === "string") setLanguage(meta.language);
      if (typeof meta.description === "string") setDescription(meta.description);
      setInputSchema(pretty(meta.input_schema));
      setOutputSchema(pretty(meta.output_schema));
      setExample(pretty(meta.example_input));
      setError(null);
    } catch (e) {
      setError(`meta.json: ${e instanceof Error ? e.message : "invalid JSON"}`);
    }
  }

  async function onTry() {
    if (!wasm) return;
    setBusy("try");
    try {
      const input = new TextEncoder().encode(canonicalJson(ex.value ?? {}));
      const { output, checkpoints } = await executeWasm(wasm.bytes, input);
      const text = new TextDecoder().decode(output);
      let shown = text;
      try {
        shown = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* keep raw */
      }
      setTryRun({ ok: true, output: shown, outputHash: await sha256Hex(output), checkpoints: checkpoints.length });
    } catch (e) {
      setTryRun({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit() {
    if (!wasm || !canSubmit) return;
    setBusy("submit");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("wasm", new Blob([wasm.bytes as BlobPart], { type: "application/wasm" }), wasm.name);
      if (source) fd.append("source", source, source.name);
      fd.append("name", name.trim());
      if (description.trim()) fd.append("description", description.trim());
      if (version.trim()) fd.append("version", version.trim());
      if (language.trim()) fd.append("language", language.trim());
      if (inputSchema.trim()) fd.append("input_schema", inputSchema);
      if (outputSchema.trim()) fd.append("output_schema", outputSchema);
      if (example.trim()) fd.append("example_input", example);
      // The backend recomputes the hash and refuses the upload if it differs from ours.
      fd.append("expected_hash", wasm.hash);
      setResult(await apiPost<RegisterOut>("/programs", fd));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl pb-12">
        <Link href="/rulesets" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Rule sets
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Upload className="h-6 w-6 text-blue-600" aria-hidden /> Register a rule set
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload a deterministic WebAssembly module (no imports; exports <code>memory</code>, <code>alloc</code>,{" "}
          <code>compute</code>). Its SHA-256 is computed here and again by the backend; the two must match. That hash is the
          program&apos;s identity on-chain.
        </p>

        {result ? (
          <div className="mt-8 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="flex items-center gap-2 font-semibold text-slate-900">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              {result.already_registered ? "Rule set updated (same bytes were already registered)" : "Rule set registered"}
            </p>
            <p className="break-all text-sm text-slate-700">
              Program hash <span className="font-mono">{result.program_hash}</span>
              {result.program_hash === wasm?.hash ? " · matches the hash computed in your browser" : ""}
            </p>
            <div className="flex flex-wrap gap-3 pt-2 text-sm">
              <Link
                href={`/create-job?program=${encodeURIComponent(result.program_hash)}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
              >
                <Play className="h-4 w-4" /> Create a job with it
              </Link>
              <Link href="/rulesets" className="inline-flex items-center px-2 text-blue-700 hover:underline">
                Back to the marketplace
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">1. Module</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className={LABEL}>WASM binary *</span>
                  <input type="file" accept=".wasm,application/wasm" onChange={(e) => onWasm(e.target.files?.[0])} className={FIELD} />
                </label>
                <label className="space-y-1.5">
                  <span className={LABEL}>Source code (optional)</span>
                  <input type="file" onChange={(e) => setSource(e.target.files?.[0] ?? null)} className={FIELD} />
                </label>
              </div>
              {busy === "inspect" && (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Hashing and inspecting…
                </p>
              )}
              {wasm && (
                <div className={`rounded-lg border p-3 text-sm ${wasm.abiOk ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                  <p className="flex items-center gap-2 font-medium text-slate-800">
                    {wasm.abiOk ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                    <FileCode2 className="h-4 w-4 text-slate-400" /> {wasm.name} · {(wasm.size / 1024).toFixed(1)} KB
                  </p>
                  <p className="mt-1 break-all text-xs text-slate-600">
                    SHA-256 (program hash): <span className="font-mono">{wasm.hash}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-600">Exports: {wasm.exports.join(", ") || "none"}</p>
                  {wasm.problems.map((p) => (
                    <p key={p} className="mt-1 text-xs text-red-700">
                      {p}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">2. Metadata &amp; schemas</h2>
                <label className="cursor-pointer text-xs font-semibold text-blue-700 hover:underline">
                  Load from meta.json
                  <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => onMeta(e.target.files?.[0])} />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1.5 sm:col-span-3">
                  <span className={LABEL}>Name *</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={FIELD} />
                </label>
                <label className="space-y-1.5">
                  <span className={LABEL}>Version</span>
                  <input value={version} onChange={(e) => setVersion(e.target.value)} className={FIELD} />
                </label>
                <label className="space-y-1.5">
                  <span className={LABEL}>Language</span>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} className={FIELD}>
                    {["rust", "assemblyscript", "c", "zig", "other"].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 sm:col-span-3">
                  <span className={LABEL}>Description</span>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={FIELD} />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className={LABEL}>Input schema (JSON Schema)</span>
                  <textarea
                    value={inputSchema}
                    onChange={(e) => setInputSchema(e.target.value)}
                    rows={10}
                    spellCheck={false}
                    placeholder='{"type": "object", "properties": {...}, "required": [...]}'
                    className={`${FIELD} font-mono text-xs`}
                  />
                  <span className="text-[11px] text-slate-500">
                    {inSchema.value !== undefined && !isFormSchema(inSchema.value)
                      ? "Not an object schema with properties: requesters will get a raw JSON editor."
                      : "Drives the auto-generated input form on Create Job."}
                  </span>
                </label>
                <label className="space-y-1.5">
                  <span className={LABEL}>Output schema (JSON Schema)</span>
                  <textarea
                    value={outputSchema}
                    onChange={(e) => setOutputSchema(e.target.value)}
                    rows={10}
                    spellCheck={false}
                    className={`${FIELD} font-mono text-xs`}
                  />
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className={LABEL}>Example input</span>
                  <textarea
                    value={example}
                    onChange={(e) => setExample(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    className={`${FIELD} font-mono text-xs`}
                  />
                </label>
              </div>
              {[...jsonErrors, ...exampleErrors].map((e) => (
                <p key={e} className="text-xs text-red-600">
                  {e}
                </p>
              ))}
            </section>

            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">3. Try it in this browser</h2>
                <button
                  type="button"
                  onClick={onTry}
                  disabled={!wasm?.abiOk || !!ex.error || !!busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {busy === "try" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run example input
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Same call sequence the requester&apos;s browser and the verifiers use. A module that traps or emits non-JSON here
                will fail for providers too.
              </p>
              {tryRun &&
                (tryRun.ok ? (
                  <div className="space-y-1">
                    <pre className="max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">{tryRun.output}</pre>
                    <p className="break-all text-xs text-slate-500">
                      Output hash <span className="font-mono">{tryRun.outputHash}</span> · {tryRun.checkpoints} trace checkpoints
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-red-600">Execution failed: {tryRun.error}</p>
                ))}
            </section>

            {error && <p className="break-words text-sm text-red-600">{error}</p>}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {busy === "submit" && <Loader2 className="h-4 w-4 animate-spin" />}
                Register rule set
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
