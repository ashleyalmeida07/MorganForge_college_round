"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Loader2, CheckCircle2, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { AppShell } from '@/components/ui/efferd-dashboard-2-utils/app-shell';

import { useApi } from '@/lib/hooks';
import { apiPost, ApiError, type PrepareOut, type Program } from '@/lib/api';
import { canonicalJson, sha256Hex } from '@/lib/hash';
import { createRequest, LAMPORTS_PER_SOL, useVerityProgram } from '@/lib/solana';
import { shortKey } from '@/lib/utils';
import { explorerAddress, explorerTx } from '@/lib/env';

const SELECT_CLASS =
  'w-full appearance-none rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow';
const FIELD_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow';
const LABEL_CLASS = 'text-sm font-semibold text-slate-700';

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
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
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
  const { data: programs, error: programsError, loading: programsLoading } = useApi<Program[]>('/programs');
  const { publicKey, connected } = useWallet();
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

  // Auto-select the first rule set once the list loads.
  useEffect(() => {
    if (!programHash && programs && programs.length > 0) {
      setProgramHash(programs[0].program_hash);
      setInputText(exampleText(programs[0]));
    }
  }, [programs, programHash]);

  // Live canonical-JSON hash preview.
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
      setError('Connect your wallet (top right)');
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
      // 1. Prepare: backend canonicalizes, stores and hashes the input.
      setStep('Preparing request (uploading input)…');
      const prep = await apiPost<PrepareOut>('/requests/prepare', {
        program_hash: selected.program_hash,
        input,
        requester: publicKey.toBase58(),
      });

      // 2. Integrity check: our own canonical hash must match the server's.
      setStep('Verifying input hash locally…');
      const localHash = await sha256Hex(canonicalJson(input));
      if (normHex(localHash) !== normHex(prep.input_hash)) {
        throw new Error(
          `Integrity check failed: local input hash ${shortHash(localHash)} does not match server hash ${shortHash(prep.input_hash)}. Aborted.`,
        );
      }

      // 3. Sign + send create_request with the connected wallet.
      setStep('Waiting for wallet signature…');
      const { requestPda, signature } = await createRequest(verity, {
        programHash: prep.program_hash_bytes32,
        inputHash: prep.input_hash_bytes32,
        inputUriHash: prep.input_uri_hash_bytes32,
        bountyLamports: Math.round(bountyNum * LAMPORTS_PER_SOL),
        deadlineUnix: Math.floor(Date.now() / 1000) + deadlineMin * 60,
      });

      // 4. Confirm with the backend so it indexes and links the request.
      setStep('Confirming with Verity backend…');
      let confirmWarning: string | undefined;
      try {
        await apiPost('/requests/confirm', {
          request_pda: requestPda,
          tx_sig: signature,
          title: title.trim() || null,
          input_ipfs_cid: prep.ipfs_cid ?? null,
        });
      } catch (e) {
        confirmWarning = `Request is on-chain, but backend confirmation failed: ${errorMessage(e)}. It will be picked up by the indexer.`;
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
      <div className="container mx-auto py-10 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Create Computation Job</h1>
          <p className="text-slate-500 mt-1 text-sm">Request a verifiable computation on the network.</p>
        </div>

        {success ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h2 className="text-base font-semibold text-slate-900">Request created</h2>
            </div>
            <p className="text-sm text-slate-600">
              Your computation request is live on-chain. A staked provider will claim and execute it, then 3 independent
              verifiers re-execute and attest to the result.
            </p>
            <div className="text-sm text-slate-700 space-y-1">
              <div>
                Request PDA: <span className="font-mono">{shortKey(success.requestPda, 6)}</span>
              </div>
              <div>
                Transaction: <span className="font-mono">{shortKey(success.signature, 8)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {pdaUrl && (
                <a href={pdaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                  View request account <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {txUrl && (
                <a href={txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                  View transaction <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            {success.confirmWarning && <p className="text-xs text-amber-700">{success.confirmWarning}</p>}
            <div className="flex justify-end pt-2">
              <Button
                onClick={reset}
                className="bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-6 h-auto rounded-lg shadow-sm transition-colors"
              >
                Create another
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-10 divide-y divide-slate-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 first:pt-0">
              <div className="md:col-span-1">
                <h2 className="text-base font-semibold text-slate-900">Job Parameters</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Choose a registered rule set (a deterministic WASM program identified by its hash) and provide the JSON
                  input it should run on. The input is canonicalized and hashed so anyone can re-check it later.
                </p>
              </div>
              <div className="md:col-span-2 space-y-6">
                <div className="space-y-2">
                  <Label className={LABEL_CLASS}>Rule Set</Label>
                  {programsLoading && !programs ? (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-500 shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading rule sets…
                    </div>
                  ) : programsError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
                      Failed to load rule sets: {programsError.message}
                    </div>
                  ) : !programs || programs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-500">
                      No rule sets registered yet
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={programHash}
                        onChange={(e) => onSelectProgram(e.target.value)}
                        disabled={running}
                        className={SELECT_CLASS}
                      >
                        {programs.map((p) => (
                          <option key={p.program_hash} value={p.program_hash}>
                            {p.name}
                            {p.version ? ` v${p.version}` : ''} ({shortHash(p.program_hash)})
                          </option>
                        ))}
                      </select>
                      <Chevron />
                    </div>
                  )}
                  {selected?.description && <p className="text-xs text-slate-500 mt-2">{selected.description}</p>}
                </div>

                <div className="space-y-2">
                  <Label className={LABEL_CLASS}>Input (JSON)</Label>
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    disabled={running || !selected}
                    rows={10}
                    spellCheck={false}
                    className={`${FIELD_CLASS} font-mono text-sm`}
                  />
                  {parseError ? (
                    <p className="text-xs text-red-600">Invalid JSON: {parseError}</p>
                  ) : (
                    <p className="text-xs text-slate-500 break-all">
                      Input hash: <span className="font-mono">{inputHash ?? '…'}</span>
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className={LABEL_CLASS}>Title (optional)</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={running}
                    placeholder="e.g. Loan eligibility check #42"
                    className="rounded-lg border-slate-300 h-auto px-4 py-2.5 shadow-sm"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
              <div className="md:col-span-1">
                <h2 className="text-base font-semibold text-slate-900">Execution Settings</h2>
                <p className="text-sm text-slate-500 mt-1">
                  The staked Verity provider network picks up and executes your request off-chain, then 3 independent
                  verifiers re-execute it and attest on-chain. The bounty is escrowed and paid only for a verified result.
                </p>
              </div>
              <div className="md:col-span-2 space-y-6">
                <div className="space-y-2">
                  <Label className={LABEL_CLASS}>Bounty (SOL)</Label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={bountySol}
                    onChange={(e) => setBountySol(e.target.value)}
                    disabled={running}
                    className={FIELD_CLASS}
                  />
                  {!bountyValid && <p className="text-xs text-red-600">Enter a bounty greater than 0.</p>}
                </div>

                <div className="space-y-2">
                  <Label className={LABEL_CLASS}>Deadline</Label>
                  <div className="relative">
                    <select
                      value={deadlineMin}
                      onChange={(e) => setDeadlineMin(Number(e.target.value))}
                      disabled={running}
                      className={SELECT_CLASS}
                    >
                      {DEADLINE_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}
                        </option>
                      ))}
                    </select>
                    <Chevron />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">If no verified result is delivered before the deadline, the request expires and the bounty can be reclaimed.</p>
                </div>

                {!walletReady && <p className="text-sm text-amber-700">Connect your wallet (top right)</p>}
                {step && (
                  <p className="flex items-center gap-2 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" /> {step}
                  </p>
                )}
                {error && <p className="text-sm text-red-600 break-words">{error}</p>}

                <div className="flex justify-end pt-4">
                  <Button
                    onClick={onCreate}
                    disabled={!canSubmit}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-6 h-auto rounded-lg shadow-sm transition-colors"
                  >
                    {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {running ? 'Creating…' : 'Create Job'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
