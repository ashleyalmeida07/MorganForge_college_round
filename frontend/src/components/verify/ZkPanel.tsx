"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CheckCircle2, Loader2, Sigma, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { explorerTx } from "@/lib/env";
import { sha256Hex } from "@/lib/hash";
import { buildVerifyTx, parsePayrollInput, payrollOutputJson, provePayroll, type PayrollInput, type ZkProof } from "@/lib/zk";

import type { ZkInfo } from "./types";
import { errorMessage, ExtLink, fmtTime, HashValue, normHex, Panel, Pill, shortHash } from "./ui";

const usd = (cents: number | bigint) =>
  (Number(cents) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

function receiptNet(output: unknown): number | null {
  if (output && typeof output === "object" && "net_cents" in output) {
    const v = (output as { net_cents: unknown }).net_cents;
    return typeof v === "number" ? v : null;
  }
  return null;
}

function RecordView({ zk, receiptOutput }: { zk: ZkInfo; receiptOutput?: unknown }) {
  const r = zk.record;
  if (!r) return null;
  const net = receiptNet(receiptOutput);
  return r.matches_receipt ? (
    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 text-emerald-800">
      <p className="flex items-center gap-2 font-bold">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden /> zk-verified on Solana
      </p>
      <p className="mt-1 text-sm">
        Receipt proven correct by a Groth16 proof: tax {usd(r.tax_cents)}, net {usd(r.net_cents)}.
      </p>
      <RecordMeta zk={zk} />
    </div>
  ) : (
    <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-800">
      <p className="flex items-center gap-2 font-bold">
        <XCircle className="h-5 w-5 text-red-600" aria-hidden /> Receipt PROVEN WRONG (zk fraud proof)
      </p>
      <p className="mt-1 text-sm">
        Proven net {usd(r.net_cents)}
        {net !== null ? ` vs receipt net ${usd(net)}` : ""} — proven output {shortHash(r.proven_output_hash)} vs receipt{" "}
        {shortHash(r.receipt_output_hash)}.
      </p>
      <RecordMeta zk={zk} />
    </div>
  );
}

function RecordMeta({ zk }: { zk: ZkInfo }) {
  const r = zk.record;
  if (!r) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span>
        Prover <HashValue value={r.prover} label="prover" />
      </span>
      <span>Verified {fmtTime(r.verified_at_iso)}</span>
      <ExtLink href={r.explorer}>Proof record on explorer</ExtLink>
    </div>
  );
}

/** Groth16 payroll proof: show the on-chain record, or prove in-browser and verify on Solana. */
export function ZkPanel({
  pda,
  zk,
  inputUrl,
  receiptOutputHash,
  receiptOutput,
  allowSubmit = true,
  onVerified,
}: {
  pda: string;
  zk: ZkInfo | null;
  inputUrl?: string | null;
  receiptOutputHash?: string | null;
  receiptOutput?: unknown;
  allowSubmit?: boolean;
  onVerified?: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const [input, setInput] = useState<PayrollInput | null>(null);
  const [proof, setProof] = useState<ZkProof | null>(null);
  const [proofMatches, setProofMatches] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"prove" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);

  if (!zk?.eligible) return null;

  const prove = async () => {
    if (!inputUrl) return;
    setBusy("prove");
    setError(null);
    setSig(null);
    try {
      const res = await fetch(inputUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not fetch input (HTTP ${res.status})`);
      const parsed = parsePayrollInput((await res.json()) as unknown);
      if (!parsed) throw new Error("Input is not a payroll input (salary_cents, tax_bps, deductions_cents).");
      const p = await provePayroll(parsed, new PublicKey(pda));
      setInput(parsed);
      setProof(p);
      if (receiptOutputHash) {
        const proven = await sha256Hex(payrollOutputJson(parsed, p.tax, p.net));
        setProofMatches(proven === normHex(receiptOutputHash));
      }
    } catch (e) {
      setError(`Proving failed: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!publicKey || !input || !proof) return;
    setBusy("submit");
    setError(null);
    try {
      const tx = await buildVerifyTx(connection, publicKey, new PublicKey(pda), input, proof);
      const signature = await sendTransaction(tx, connection);
      const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const conf = await connection.confirmTransaction(
        { signature, blockhash: tx.recentBlockhash ?? "", lastValidBlockHeight },
        "confirmed",
      );
      if (conf.value.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(conf.value.err)}`);
      setSig(signature);
      onVerified?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Zero-knowledge proof"
      icon={<Sigma className="h-4 w-4 text-violet-600" aria-hidden />}
      description={`Groth16 circuit "${zk.circuit ?? "payroll"}" re-derives this payroll result; a Solana program checks the proof against the receipt.`}
      actions={
        zk.verified_count !== undefined ? (
          <Pill tone="slate">
            {zk.verified_count} verified · {zk.fraud_count ?? 0} fraud proofs
          </Pill>
        ) : undefined
      }
    >
      {zk.record ? (
        <RecordView zk={zk} receiptOutput={receiptOutput} />
      ) : !receiptOutputHash ? (
        <p className="text-sm text-slate-500">A zk proof can be generated once the provider has submitted a receipt.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={prove}
              disabled={!!busy || !inputUrl}
              className="h-auto rounded-lg bg-violet-600 px-5 py-2.5 font-semibold text-white hover:bg-violet-700"
            >
              {busy === "prove" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy === "prove" ? "Proving…" : proof ? "Prove again" : "Generate zk proof in browser"}
            </Button>
            {proof && allowSubmit && (
              <Button
                onClick={submit}
                disabled={!!busy || !connected || !publicKey || !proof.offchainValid}
                className="h-auto rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-800"
              >
                {busy === "submit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy === "submit" ? "Verifying on Solana…" : "Verify on Solana"}
              </Button>
            )}
          </div>
          {proof && allowSubmit && !connected && <p className="text-sm text-amber-700">Connect your wallet to submit the proof on-chain.</p>}

          {proof && (
            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">Tax</dt>
                <dd className="font-semibold text-slate-900">{usd(proof.tax)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Net</dt>
                <dd className="font-semibold text-slate-900">{usd(proof.net)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Prove time</dt>
                <dd className="font-semibold text-slate-900">{proof.proveMs} ms</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Off-chain check</dt>
                <dd>{proof.offchainValid ? <Pill tone="green">valid</Pill> : <Pill tone="red">invalid</Pill>}</dd>
              </div>
              {proofMatches !== null && (
                <div className="col-span-2 sm:col-span-4">
                  {proofMatches ? (
                    <Pill tone="green">Proven output matches the receipt</Pill>
                  ) : (
                    <Pill tone="red">Proven output differs from the receipt — submitting records a fraud proof</Pill>
                  )}
                </div>
              )}
            </dl>
          )}
          {sig && (
            <p className="text-sm text-emerald-700">
              Proof verified on Solana. <ExtLink href={explorerTx(sig)}>View transaction</ExtLink>
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-3 break-words text-sm text-red-600">{error}</p>}
      {zk.error && !zk.record && <p className="mt-3 text-xs text-slate-400">zk status: {zk.error}</p>}
    </Panel>
  );
}
