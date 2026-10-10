"use client";

import { AlertTriangle, CheckCircle2, Clock, HelpCircle, ShieldAlert, XCircle } from "lucide-react";

import { commitmentsOf, type CheckStatus, type RequestDetail, type SignatureStatus } from "./types";
import { ExtLink, HashValue, Pill } from "./ui";

type RowStatus = CheckStatus | SignatureStatus | "committed";

function StatusPill({ status }: { status: RowStatus }) {
  switch (status) {
    case "ok":
    case "valid":
      return (
        <Pill tone="green">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {status === "valid" ? "valid signature" : "matches chain"}
        </Pill>
      );
    case "tampered":
    case "invalid":
    case "drift":
      return (
        <Pill tone="red">
          <XCircle className="h-3.5 w-3.5" aria-hidden /> {status === "invalid" ? "INVALID" : status === "drift" ? "DB ≠ CHAIN" : "TAMPERED"}
        </Pill>
      );
    case "missing":
      return (
        <Pill tone="amber">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> blob missing
        </Pill>
      );
    case "pending":
      return (
        <Pill tone="slate">
          <Clock className="h-3.5 w-3.5" aria-hidden /> pending
        </Pill>
      );
    case "committed":
      return (
        <Pill tone="blue">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> on-chain
        </Pill>
      );
    default:
      return (
        <Pill tone="slate">
          <HelpCircle className="h-3.5 w-3.5" aria-hidden /> unverified
        </Pill>
      );
  }
}

/** Big red banner shown when any stored artifact no longer matches the chain. */
export function TamperBanner({ detail }: { detail: RequestDetail }) {
  const ig = detail.integrity;
  if (!ig || ig.overall !== "tampered") return null;
  const bad = (
    [
      ["program WASM", ig.program.status],
      ["input", ig.input.status],
      ["input URI", ig.input_uri.status],
      ["output", ig.output.status],
      ["receipt signature", ig.receipt_signature.status],
    ] as const
  )
    .filter(([, s]) => s === "tampered" || s === "invalid")
    .map(([n]) => n);
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-red-300 bg-red-50 p-5 text-red-800">
      <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-600" aria-hidden />
      <div>
        <p className="text-base font-bold">Tampering detected</p>
        <p className="mt-1 text-sm">
          Stored artifacts no longer match the commitments anchored on Solana
          {bad.length ? `: ${bad.join(", ")}` : ""}. Do not trust this result — re-execute in your browser below.
        </p>
      </div>
    </div>
  );
}

export function CommitmentsTable({ detail }: { detail: RequestDetail }) {
  const c = commitmentsOf(detail);
  const ig = detail.integrity;
  const hasReceipt = !!(detail.chain_receipt || detail.receipt);
  const traceDrift = ig?.db_vs_chain.mismatches.includes("receipt.trace_root");

  const rows: { name: string; hint: string; value: string | null; status: RowStatus }[] = [
    { name: "Program hash", hint: "sha256(WASM)", value: c.programHash, status: ig?.program.status ?? "unknown" },
    { name: "Input hash", hint: "sha256(canonical input)", value: c.inputHash, status: ig?.input.status ?? "unknown" },
    { name: "Input URI hash", hint: "sha256(storage URI)", value: c.inputUriHash, status: ig?.input_uri.status ?? "unknown" },
    { name: "Output hash", hint: "sha256(output bytes)", value: c.outputHash, status: hasReceipt ? ig?.output.status ?? "unknown" : "pending" },
    {
      name: "Trace root",
      hint: "TRACE_V2 Merkle root",
      value: c.traceRoot,
      status: !hasReceipt ? "pending" : traceDrift ? "drift" : detail.chain_receipt ? "committed" : "unknown",
    },
    {
      name: "Receipt signature",
      hint: "provider Ed25519",
      value: c.signature,
      status: hasReceipt ? ig?.receipt_signature.status ?? "unknown" : "pending",
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <caption className="sr-only">On-chain commitments and integrity checks</caption>
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2.5">Commitment</th>
            <th scope="col" className="px-4 py-2.5">Value</th>
            <th scope="col" className="px-4 py-2.5 text-right">Check</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.name} className={r.status === "tampered" || r.status === "invalid" ? "bg-red-50/60" : undefined}>
              <th scope="row" className="px-4 py-3 text-left align-top font-medium text-slate-800">
                {r.name}
                <div className="text-[11px] font-normal text-slate-400">{r.hint}</div>
              </th>
              <td className="max-w-0 px-4 py-3 align-top">
                <HashValue value={r.value} label={r.name} />
              </td>
              <td className="px-4 py-3 text-right align-top">
                <StatusPill status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ig?.db_vs_chain.status === "drift" && ig.db_vs_chain.mismatches.length > 0 && (
        <p className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Database differs from chain: {ig.db_vs_chain.mismatches.join(", ")}. The chain is authoritative.
        </p>
      )}
    </div>
  );
}

/** Links to the raw content-addressed artifacts behind the commitments. */
export function ArtifactLinks({ detail }: { detail: RequestDetail }) {
  const a = detail.artifacts;
  const links: [string, string | null | undefined][] = [
    ["Program WASM", a.wasm.url],
    ["WASM on IPFS", a.wasm.ipfs_url],
    ["Source", a.source.url],
    ["Input", a.input.url],
    ["Input on IPFS", a.input.ipfs_url],
    ["Trace (TRACE_V2)", a.trace.url],
  ];
  const shown = links.filter(([, u]) => !!u);
  if (!shown.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {shown.map(([label, url]) => (
        <ExtLink key={label} href={url}>
          {label}
        </ExtLink>
      ))}
    </div>
  );
}
