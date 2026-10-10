"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Boxes, FileCode2, Loader2, Play, Sigma, Copy, Check, Globe } from "lucide-react";

import { AppShell } from "@/components/ui/efferd-dashboard-2-utils/app-shell";
import type { ProgramInfo } from "@/components/verify/types";
import { shortKey } from "@/lib/utils";
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
  const [copied, setCopied] = useState(false);
  const fields = schemaFields(p.input_schema);
  const size = fmtBytes(p.wasm_size);
  const ipfs = p.ipfs_url ?? (p.ipfs_cid ? `https://ipfs.io/ipfs/${p.ipfs_cid}` : null);
  const zk = /payroll/i.test(p.name);

  const copyHash = () => {
    navigator.clipboard.writeText(p.program_hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs transition-all duration-200 hover:border-blue-300 hover:shadow-md group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              {p.name}
            </h2>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              WASM
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 font-mono">
            {[p.language, p.version ? `v${p.version}` : null, size].filter(Boolean).join(" · ") || "WASM rule set"}
          </p>
        </div>
        {zk && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Sigma className="h-3 w-3 text-purple-600" aria-hidden /> ZK Groth16
          </span>
        )}
      </div>

      {p.description && (
        <p className="mt-3 line-clamp-3 text-xs text-slate-600 leading-relaxed">
          {p.description}
        </p>
      )}

      {/* Program Hash Box (Crisp Light Style) */}
      <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs">
        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
          <span className="font-semibold uppercase tracking-wider">SHA-256 Bytecode Commitment</span>
          <button
            type="button"
            onClick={copyHash}
            className="hover:text-blue-600 transition-colors flex items-center gap-1 text-slate-600"
            title="Copy 64-char Hash"
          >
            {copied ? (
              <span className="text-emerald-700 flex items-center gap-1 font-bold"><Check className="w-3 h-3" /> Copied</span>
            ) : (
              <span className="flex items-center gap-1"><Copy className="w-3 h-3" /> Copy</span>
            )}
          </button>
        </div>
        <div className="truncate text-blue-700 font-bold text-[11px]" title={p.program_hash}>
          {p.program_hash}
        </div>
      </div>

      {/* Input Schema Fields */}
      {fields.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-1.5">
            Accepted Schema Fields ({fields.length})
          </p>
          <ul className="flex flex-wrap gap-1.5 font-mono">
            {fields.map((f) => (
              <li
                key={f.key}
                className="rounded-lg bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700"
                title={f.key}
              >
                <span className="font-medium">{f.title}</span>
                {f.type && <span className="text-slate-400 font-normal"> : {f.type}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer Links & Launch CTA */}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 border-t border-slate-100 text-xs font-mono">
        {p.wasm_url && (
          <a
            href={p.wasm_url}
            target="_blank"
            rel="noreferrer"
            className="text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
          >
            <FileCode2 className="h-3.5 w-3.5" aria-hidden /> WASM Binary
          </a>
        )}
        {ipfs && (
          <a
            href={ipfs}
            target="_blank"
            rel="noreferrer"
            className="text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
          >
            <Globe className="h-3.5 w-3.5" /> IPFS
          </a>
        )}
        {p.source_url && (
          <a
            href={p.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
          >
            Rust Source
          </a>
        )}
        <Link
          href={`/create-job?program=${encodeURIComponent(p.program_hash)}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-3.5 py-2 text-xs font-bold text-white transition shadow-sm shadow-blue-500/20"
        >
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden /> Launch Job
        </Link>
      </div>
    </article>
  );
}

export default function RuleSetsPage() {
  const { data, error, loading } = useApi<ProgramInfo[]>("/programs");
  return (
    <AppShell>
      <div className="pb-10 space-y-6">
        <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 w-fit mb-2">
            <Boxes className="w-3.5 h-3.5 text-blue-600" /> DETERMINISTIC PROGRAM REPOSITORY
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            WASM Rule Sets Marketplace
          </h1>
          <p className="mt-1 text-xs text-slate-500 max-w-2xl leading-relaxed">
            Deterministic WebAssembly modules executed with fixed fuel limits and no host I/O. Every program is content-addressed on Solana by its SHA-256 bytecode hash and pinned to decentralized IPFS.
          </p>
        </div>

        {loading && !data ? (
          <div className="flex min-h-[30vh] items-center justify-center gap-2 text-xs font-mono text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" /> Querying registered programs…
          </div>
        ) : error && !data ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-mono text-rose-700">
            Failed to load rule sets: {error.message}
          </div>
        ) : !data?.length ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-xs font-mono text-slate-500">
            No rule sets registered yet.
          </div>
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
