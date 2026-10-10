"use client";

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Loader2,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Zap,
  Code2,
  Coins,
  Clock,
  Fingerprint,
  RotateCcw,
  ShieldCheck,
  Layers,
  Sparkles
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { AppShell } from '@/components/ui/efferd-dashboard-2-utils/app-shell';

import { useApi } from '@/lib/hooks';
import { apiPost, ApiError, type PrepareOut, type Program } from '@/lib/api';
import { canonicalJson, concatBytes, fromHex, sha256Hex, toBase64 } from '@/lib/hash';
import { createRequest, predictRequestPda, LAMPORTS_PER_SOL, useVerityProgram } from '@/lib/solana';
import { shortKey } from '@/lib/utils';
import { explorerAddress, explorerTx } from '@/lib/env';

const INPUT_COMMITMENT_DOMAIN = new TextEncoder().encode('VERITY_INPUT_V1');

const SELECT_CLASS =
  'w-full appearance-none rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all font-mono';
const FIELD_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all font-mono';
const LABEL_CLASS = 'text-xs font-mono font-bold uppercase tracking-wider text-slate-600';

const DEADLINE_OPTIONS = [10, 30, 60, 240];

const normHex = (h?: string | null) => (h ?? '').toLowerCase().replace(/^0x/, '');
const shortHash = (h?: string | null) => {
  const s = normHex(h);
  return s ? `${s.slice(0, 8)}…${s.slice(-4)}` : '—';
};
const exampleText = (p?: Program) =>
  p && p.example_input !== undefined && p.example_input !== null ? JSON.stringify(p.example_input, null, 2) : '{}';

function Chevron() {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-400">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
    </div>
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return 'Transaction was rejected in the wallet.';
  return msg || 'Something went wrong.';
}

interface Success {
  requestPda: string;
  signature: string;
  confirmWarning?: string;
}

export default function CreateJobPage() {
  return (
    <Suspense fallback={null}>
      <CreateJobForm />
    </Suspense>
  );
}

function CreateJobForm() {
  const searchParams = useSearchParams();
  const requestedProgram = (searchParams.get('program') ?? '').toLowerCase();
  const { data: programs, error: programsError, loading: programsLoading } = useApi<Program[]>('/programs');
  const { publicKey, connected, signMessage } = useWallet();
  const verity = useVerityProgram();

  const [programHash, setProgramHash] = useState('');
  const [inputText, setInputText] = useState('{}');
  const [title, setTitle] = useState('');
  const [bountySol, setBountySol] = useState('0.01');
  const [deadlineMin, setDeadlineMin] = useState(30);

  const [inputHash, setInputHash] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);

  const selected = useMemo(
    () => programs?.find((p) => p.program_hash === programHash),
    [programs, programHash],
  );

  useEffect(() => {
    if (!programHash && programs && programs.length > 0) {
      const initial = programs.find((p) => p.program_hash.toLowerCase() === requestedProgram) ?? programs[0];
      setProgramHash(initial.program_hash);
      setInputText(exampleText(initial));
    }
  }, [programs, programHash, requestedProgram]);

  useEffect(() => {
    let cancelled = false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(inputText);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON');
      setInputHash(null);
      return;
    }
    let canon: string;
    try {
      canon = canonicalJson(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON');
      setInputHash(null);
      return;
    }
    setParseError(null);
    sha256Hex(canon)
      .then((h) => !cancelled && setInputHash(h))
      .catch(() => !cancelled && setInputHash(null));
    return () => {
      cancelled = true;
    };
  }, [inputText]);

  const onSelectProgram = (hash: string) => {
    setProgramHash(hash);
    setInputText(exampleText(programs?.find((p) => p.program_hash === hash)));
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(inputText);
      setInputText(JSON.stringify(parsed, null, 2));
    } catch {}
  };

  const bountyNum = Number(bountySol);
  const bountyValid = Number.isFinite(bountyNum) && bountyNum > 0;
  const walletReady = connected && !!publicKey && !!verity;
  const canSubmit = !running && !!selected && !parseError && bountyValid;

  const reset = () => {
    setSuccess(null);
    setError(null);
    setStep(null);
    setTitle('');
    setInputText(exampleText(selected));
  };

  const onCreate = async () => {
    setError(null);
    if (!walletReady || !publicKey || !verity) {
      setError('Please connect your Solana wallet in the top right header.');
      return;
    }
    if (!selected) return;

    let input: unknown;
    try {
      input = JSON.parse(inputText);
    } catch {
      setError('Input is not valid JSON.');
      return;
    }

    setRunning(true);
    try {
      setStep('Uploading canonical payload & pinning…');
      const prep = await apiPost<PrepareOut>('/requests/prepare', {
        program_hash: selected.program_hash,
        input,
        requester: publicKey.toBase58(),
      });

      setStep('Verifying input hash locally (RFC 8785)…');
      const localHash = await sha256Hex(canonicalJson(input));
      if (normHex(localHash) !== normHex(prep.input_hash)) {
        throw new Error(
          `Integrity mismatch: local hash ${shortHash(localHash)} ≠ server hash ${shortHash(prep.input_hash)}. Aborted.`,
        );
      }

      if (!signMessage) {
        throw new Error('Connected wallet cannot sign Ed25519 messages (required for input commitment).');
      }

      setStep('Predicting request PDA on Solana…');
      const { request: predictedPda } = await predictRequestPda(verity);

      setStep('Sign input commitment in Phantom/wallet…');
      const commitmentMsg = concatBytes(
        INPUT_COMMITMENT_DOMAIN,
        fromHex(prep.program_hash),
        fromHex(prep.input_hash),
        fromHex(prep.input_uri_hash),
      );
      const commitmentSig = await signMessage(commitmentMsg);
      await apiPost('/requests/commit-input', {
        request_pda: predictedPda.toBase58(),
        requester: publicKey.toBase58(),
        program_hash: prep.program_hash,
        input_hash: prep.input_hash,
        input_uri_hash: prep.input_uri_hash,
        signature: toBase64(commitmentSig),
      });

      setStep('Sign & broadcast create_request transaction on Solana…');
      const { requestPda, signature } = await createRequest(
        verity,
        {
          programHash: prep.program_hash_bytes32,
          inputHash: prep.input_hash_bytes32,
          inputUriHash: prep.input_uri_hash_bytes32,
          bountyLamports: Math.round(bountyNum * LAMPORTS_PER_SOL),
          deadlineUnix: Math.floor(Date.now() / 1000) + deadlineMin * 60,
        },
        predictedPda,
      );

      setStep('Confirming with Verity indexer…');
      let confirmWarning: string | undefined;
      try {
        await apiPost('/requests/confirm', {
          request_pda: requestPda,
          tx_sig: signature,
          title: title.trim() || null,
          input_ipfs_cid: prep.ipfs_cid ?? null,
        });
      } catch (e) {
        confirmWarning = `Request is live on Solana, but backend confirmation hit: ${errorMessage(e)}. The indexer will reconcile automatically.`;
      }

      setSuccess({ requestPda, signature, confirmWarning });
      setStep(null);
    } catch (e) {
      setError(errorMessage(e));
      setStep(null);
    } finally {
      setRunning(false);
    }
  };

  const txUrl = success ? explorerTx(success.signature) : null;
  const pdaUrl = success ? explorerAddress(success.requestPda) : null;

  return (
    <AppShell>
      <div className="container mx-auto py-8 max-w-5xl space-y-6">
        {/* Header Banner */}
        <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 w-fit mb-2">
            <Zap className="w-3.5 h-3.5 text-blue-600" /> ON-CHAIN COMPUTATION DISPATCH
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Dispatch Computation Job
          </h1>
          <p className="mt-1 text-xs text-slate-500 max-w-2xl leading-relaxed">
            Commit an agreed rule set and canonical JSON inputs to Solana devnet. Escrow a SOL bounty; autonomous verifiers will re-execute the WASM and attest before settlement.
          </p>
        </div>

        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 space-y-5 shadow-xs font-mono">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">Computation Request Dispatched on Solana</h2>
                <p className="text-xs text-slate-600">Transaction confirmed; account initialized with escrowed bounty.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-white border border-emerald-200 text-xs">
              <div>
                <span className="text-slate-500 block text-[11px]">Request PDA Account:</span>
                <span className="text-blue-700 font-bold break-all">{success.requestPda}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Solana Tx Signature:</span>
                <span className="text-slate-900 font-bold break-all">{shortKey(success.signature, 10)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Link
                href={`/requests/${success.requestPda}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition shadow-sm shadow-blue-500/20"
              >
                Open Execution Audit Console <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              {txUrl && (
                <a
                  href={txUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition"
                >
                  Explorer Tx <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {pdaUrl && (
                <a
                  href={pdaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition"
                >
                  Explorer PDA <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <Button
                onClick={reset}
                variant="outline"
                className="ml-auto text-xs border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
              >
                Create Another Job
              </Button>
            </div>

            {success.confirmWarning && (
              <p className="text-[11px] text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
                {success.confirmWarning}
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Form Parameters */}
            <div className="lg:col-span-2 space-y-6">
              {/* Card 1: Rule Set & Input Payload */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-blue-600" /> 1. Rule Set & Input Payload
                  </h2>
                  <span className="text-[10px] font-mono font-medium text-slate-400">Deterministic WASM</span>
                </div>

                {/* Rule Set Select */}
                <div className="space-y-1.5">
                  <Label className={LABEL_CLASS}>Target WASM Rule Set</Label>
                  {programsLoading && !programs ? (
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-mono text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Querying rule sets…
                    </div>
                  ) : programsError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-mono text-rose-700">
                      Error loading rule sets: {programsError.message}
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={programHash}
                        onChange={(e) => onSelectProgram(e.target.value)}
                        disabled={running}
                        className={SELECT_CLASS}
                      >
                        {programs?.map((p) => (
                          <option key={p.program_hash} value={p.program_hash}>
                            {p.name} {p.version ? `v${p.version}` : ''} — ({shortHash(p.program_hash)})
                          </option>
                        ))}
                      </select>
                      <Chevron />
                    </div>
                  )}
                  {selected?.description && (
                    <p className="text-xs text-slate-500 leading-relaxed pt-1">
                      {selected.description}
                    </p>
                  )}
                </div>

                {/* Input Payload Editor */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className={LABEL_CLASS}>Input JSON Payload</Label>
                    <button
                      type="button"
                      onClick={handleFormatJson}
                      className="text-[11px] font-mono text-blue-600 hover:text-blue-700 font-semibold transition-colors"
                    >
                      Format JSON
                    </button>
                  </div>
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    disabled={running || !selected}
                    rows={8}
                    spellCheck={false}
                    className={`${FIELD_CLASS} text-xs font-mono bg-slate-50/50`}
                  />
                  {parseError ? (
                    <p className="text-xs font-mono text-rose-600 font-semibold">Syntax error: {parseError}</p>
                  ) : (
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] flex items-center justify-between text-slate-600">
                      <span className="font-semibold">Canonical SHA-256:</span>
                      <span className="text-blue-700 truncate max-w-[320px] font-bold">
                        {inputHash ?? 'Computing…'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Optional Title */}
                <div className="space-y-1.5">
                  <Label className={LABEL_CLASS}>Job Title / Label (Optional)</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={running}
                    placeholder="e.g. Credit evaluation audit job #104"
                    className="rounded-xl border-slate-300 bg-white text-slate-900 text-xs px-4 py-2.5"
                  />
                </div>
              </div>

              {/* Card 2: Bounty & Challenge Window */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Coins className="w-4 h-4 text-emerald-600" /> 2. Bounty Escrow & Challenge Window
                  </h2>
                  <span className="text-[10px] font-mono font-medium text-slate-400">On-Chain Guarantees</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono">
                  <div className="space-y-1.5">
                    <Label className={LABEL_CLASS}>Bounty Escrow (SOL)</Label>
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={bountySol}
                      onChange={(e) => setBountySol(e.target.value)}
                      disabled={running}
                      className={FIELD_CLASS}
                    />
                    <p className="text-[10px] text-slate-500">Paid to provider only upon quorum consensus.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className={LABEL_CLASS}>Challenge Window</Label>
                    <div className="relative">
                      <select
                        value={deadlineMin}
                        onChange={(e) => setDeadlineMin(Number(e.target.value))}
                        disabled={running}
                        className={SELECT_CLASS}
                      >
                        {DEADLINE_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m < 60 ? `${m} Minutes` : `${m / 60} Hour${m === 60 ? '' : 's'}`}
                          </option>
                        ))}
                      </select>
                      <Chevron />
                    </div>
                    <p className="text-[10px] text-slate-500">Dispute challenge window enforced on-chain.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right 1 Col: Execution Summary & Action Card */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
                <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase text-slate-700">
                  <ShieldCheck className="w-4 h-4 text-blue-600" /> Pre-Flight Summary
                </div>

                <div className="space-y-3 font-mono text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex justify-between text-slate-500">
                      <span>Execution Model:</span>
                      <span className="text-slate-900 font-semibold">Deterministic WASM</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Fuel Metering:</span>
                      <span className="text-blue-700 font-bold">50,000,000 max</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Independent Verifiers:</span>
                      <span className="text-emerald-700 font-bold">3 Node Quorum</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Wallet Commitment:</span>
                      <span className="text-purple-700 font-bold">Ed25519 Signed</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex justify-between text-slate-500">
                      <span>Escrowed Bounty:</span>
                      <span className="text-slate-900 font-bold">{bountySol} SOL</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Solana Network:</span>
                      <span className="text-emerald-700 font-bold">Devnet</span>
                    </div>
                  </div>
                </div>

                {!walletReady && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-mono">
                    Solana wallet not connected. Please connect Phantom via the top-right header button.
                  </div>
                )}

                {step && (
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-mono flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                    <span>{step}</span>
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-mono break-words">
                    {error}
                  </div>
                )}

                <Button
                  onClick={onCreate}
                  disabled={!canSubmit}
                  className="w-full py-3 h-auto rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider transition shadow-sm shadow-blue-500/20 disabled:opacity-50"
                >
                  {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {running ? 'Broadcasting to Solana…' : 'Dispatch Computation Job'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
