"use client";

import { CheckCircle2, XCircle } from "lucide-react";

import { explorerAddress } from "@/lib/env";
import { shortKey } from "@/lib/solana";

import type { AttestationRow } from "./types";
import { ExtLink, fmtTime, shortHash } from "./ui";

export function AttestationsTable({ rows, required }: { rows: AttestationRow[]; required?: number | null }) {
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
        No verifier attestations yet{required ? ` — ${required} required` : ""}.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Independent verifier attestations</caption>
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2.5">Verifier</th>
            <th scope="col" className="px-4 py-2.5">Result</th>
            <th scope="col" className="px-4 py-2.5">Counted</th>
            <th scope="col" className="px-4 py-2.5">Fuel</th>
            <th scope="col" className="px-4 py-2.5">Output hash</th>
            <th scope="col" className="px-4 py-2.5">Tx</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((a) => (
            <tr key={a.verifier_pubkey}>
              <td className="px-4 py-2.5">
                <ExtLink href={a.verifier_explorer ?? explorerAddress(a.verifier_pubkey)} className="font-mono text-xs">
                  {shortKey(a.verifier_pubkey)}
                </ExtLink>
                <div className="text-[11px] text-slate-400">{fmtTime(a.attested_at)}</div>
              </td>
              <td className="px-4 py-2.5">
                {a.matches ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> matches
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-700">
                    <XCircle className="h-4 w-4" aria-hidden /> mismatch
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-slate-700">{a.counted ? "yes" : "no"}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{a.fuel_used?.toLocaleString() ?? "—"}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-slate-700" title={a.output_hash ?? undefined}>
                {shortHash(a.output_hash)}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {a.explorer ? <ExtLink href={a.explorer}>view</ExtLink> : <span className="text-slate-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
