"use client";

import Link from "next/link";
import { Boxes, FileCode2, Loader2, Play, Sigma } from "lucide-react";

import { AppShell } from "@/components/ui/efferd-dashboard-2-utils/app-shell";
import type { ProgramInfo } from "@/components/verify/types";
import { ExtLink, HashValue, Pill } from "@/components/verify/ui";
import { useApi } from "@/lib/hooks";

function fmtBytes(n?: number | null) {
  if (!n) return null;
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Field names (with titles/types) from a JSON-schema `properties` object. */
function schemaFields(schema: unknown): { key: string; title: string; type?: string }[] {
  if (!schema || typeof schema !== "object") return [];
  const props = (schema as { properties?: unknown }).properties;
  if (!props || typeof props !== "object") return [];
  return Object.entries(props as Record<string, unknown>).map(([key, v]) => {
    const o = v && typeof v === "object" ? (v as { title?: unknown; type?: unknown }) : {};
    return {
      key,
      title: typeof o.title === "string" ? o.title : key,
      type: typeof o.type === "string" ? o.type : undefined,
    };
  });
}

function RuleSetCard({ p }: { p: ProgramInfo }) {
  const fields = schemaFields(p.input_schema);
  const size = fmtBytes(p.wasm_size);
  const ipfs = p.ipfs_url ?? (p.ipfs_cid ? `https://ipfs.io/ipfs/${p.ipfs_cid}` : null);
  const zk = /payroll/i.test(p.name);
  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900">{p.name}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {[p.language, p.version ? `v${p.version}` : null, size].filter(Boolean).join(" · ") || "WASM rule set"}
          </p>
        </div>
        {zk && (
          <Pill tone="blue">
            <Sigma className="h-3 w-3" aria-hidden /> zk circuit available
          </Pill>
        )}
      </div>
      {p.description && <p className="mt-3 line-clamp-3 text-sm text-slate-600">{p.description}</p>}

      <div className="mt-3 text-xs">
        <span className="text-slate-500">Program hash</span>
        <div>
          <HashValue value={p.program_hash} label="program hash" />
        </div>
      </div>

      {fields.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-slate-500">Input fields</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <li key={f.key} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700" title={f.key}>
                {f.title}
                {f.type && <span className="text-slate-400"> · {f.type}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 text-xs">
        <ExtLink href={p.wasm_url}>
          <FileCode2 className="h-3.5 w-3.5" aria-hidden /> View WASM
        </ExtLink>
        <ExtLink href={ipfs}>IPFS</ExtLink>
        <ExtLink href={p.source_url}>Source</ExtLink>
        <Link
          href={`/create-job?program=${encodeURIComponent(p.program_hash)}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          <Play className="h-3.5 w-3.5" aria-hidden /> Use
        </Link>
      </div>
    </article>
  );
}

export default function RuleSetsPage() {
  const { data, error, loading } = useApi<ProgramInfo[]>("/programs");
  return (
    <AppShell>
      <div className="pb-10">
        <div className="mb-8">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Boxes className="h-6 w-6 text-blue-600" aria-hidden /> Rule Sets
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Deterministic WASM programs, each identified by the SHA-256 of its bytecode. Anyone can download one and re-execute any request
            that used it.
          </p>
        </div>
        {loading && !data ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading rule sets…
          </p>
        ) : error && !data ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">Failed to load rule sets: {error.message}</p>
        ) : !data?.length ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            No rule sets registered yet.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {data.map((p) => (
              <RuleSetCard key={p.program_hash} p={p} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
