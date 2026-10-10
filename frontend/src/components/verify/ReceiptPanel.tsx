"use client";

import { FileCheck2, Loader2 } from "lucide-react";

import { explorerAddress } from "@/lib/env";
import { shortKey } from "@/lib/solana";

import { commitmentsOf, type RequestDetail } from "./types";
import { ExtLink, fmtTime, JsonBlock, Panel, Pill } from "./ui";

export function ReceiptPanel({
  detail,
  output,
  outputLoading,
  outputError,
}: {
  detail: RequestDetail;
  output: unknown;
  outputLoading: boolean;
  outputError: string | null;
}) {
  const c = commitmentsOf(detail);
  const rc = detail.receipt;
  const hasReceipt = !!(detail.chain_receipt || rc);
  const sigStatus = detail.integrity?.receipt_signature.status;
  const outUrl = rc?.output_url ?? detail.artifacts.output.url;

  return (
    <Panel title="Provider receipt" icon={<FileCheck2 className="h-4 w-4 text-blue-600" aria-hidden />}>
      {!hasReceipt ? (
        <p className="text-sm text-slate-500">Waiting for the provider to execute the program and submit a signed receipt.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Output</h3>
            {outputLoading && output === undefined ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading output…
              </p>
            ) : outputError ? (
              <p className="text-sm text-red-600">Could not load output: {outputError}</p>
            ) : output !== undefined ? (
              <JsonBlock value={output} />
            ) : (
              <p className="text-sm text-slate-500">Output blob not available.</p>
            )}
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Fuel used</dt>
              <dd className="font-mono text-slate-800">{c.fuelUsed?.toLocaleString() ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Provider</dt>
              <dd>
                <ExtLink href={explorerAddress(c.provider)} className="font-mono text-xs">
                  {shortKey(c.provider, 6)}
                </ExtLink>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Ed25519 signature</dt>
              <dd>
                {sigStatus === "valid" ? (
                  <Pill tone="green">valid</Pill>
                ) : sigStatus === "invalid" ? (
                  <Pill tone="red">INVALID</Pill>
                ) : (
                  <Pill tone="slate">{sigStatus ?? "unknown"}</Pill>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Submitted</dt>
              <dd className="text-slate-800">{fmtTime(rc?.submitted_at ?? detail.chain_receipt?.submitted_at)}</dd>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <ExtLink href={rc?.explorer}>Receipt transaction</ExtLink>
              <ExtLink href={outUrl}>Raw output blob</ExtLink>
              {detail.artifacts.output.ipfs_url && <ExtLink href={detail.artifacts.output.ipfs_url}>Output on IPFS</ExtLink>}
            </div>
          </dl>
        </div>
      )}
    </Panel>
  );
}
