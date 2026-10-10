"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Copy, Loader2, ExternalLink } from 'lucide-react';
import { AppShell } from '@/components/ui/efferd-dashboard-2-utils/app-shell';
import { useApi } from '@/lib/hooks';
import type { Health, Provider } from '@/lib/api';
import {
  fetchConfig,
  LAMPORTS_PER_SOL,
  providerPda,
  registerAndStakeProvider,
  useVerityProgram,
} from '@/lib/solana';
import { shortKey, lamportsToSol } from '@/lib/utils';
import { env, explorerAddress, explorerTx } from '@/lib/env';

interface ProviderAccountView {
  stake: number;
  completed: number;
  slashed: number;
  activeJobs: number;
  active: boolean;
}

const fmtSol = (sol: number) => sol.toLocaleString(undefined, { maximumFractionDigits: 4 });

const GUIDE_STEPS: { id: string; title: string; note?: React.ReactNode; code: string }[] = [
  {
    id: 'install',
    title: '1. Clone & Install',
    code: 'git clone https://github.com/ashleyalmeida07/MorganForge_college_round.git\ncd MorganForge_college_round/backend\npip install -r requirements.txt',
  },
  {
    id: 'keys',
    title: '2. Generate Keypairs',
    note: <>Writes <code>backend/keys/*.json</code> (gitignored) and prints the env lines. Fund the provider key with devnet SOL.</>,
    code: 'python scripts/gen_keypairs.py\nsolana airdrop 2 <PROVIDER_PUBKEY> --url devnet',
  },
  {
    id: 'env',
    title: '3. Configure Environment',
    note: <>Create <code>backend/.env</code> and paste the printed keypair lines. Never commit it.</>,
    code: `SOLANA_RPC_URL=https://api.devnet.solana.com\nPROGRAM_ID=${env.programId}\nCLUSTER=devnet\nPROVIDER_KEYPAIR_JSON=[...64 bytes...]\nVERIFIER_KEYPAIRS_JSON=[[...],[...],[...]]\nWORKERS_ENABLED=true`,
  },
  {
    id: 'run',
    title: '4. Run the Worker',
    note: <>Runs the API plus the provider, verifier, finalizer and indexer jobs in-process. Keep a single uvicorn worker.</>,
    code: 'uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1',
  },
];

export default function ConnectProviderPage() {
  const { publicKey, connected } = useWallet();
  const program = useVerityProgram();

  const providers = useApi<Provider[]>('/providers', 15000);
  const health = useApi<Health>('/health', 10000);

  const [copied, setCopied] = useState<string | null>(null);
  const [stakeSol, setStakeSol] = useState('');
  const [minStake, setMinStake] = useState<number | null>(null);
  const [account, setAccount] = useState<ProviderAccountView | null | undefined>(undefined);
  const [isRegistering, setIsRegistering] = useState(false);
  const [txSigs, setTxSigs] = useState<string[]>([]);
  const [txError, setTxError] = useState<string | null>(null);

  const copyToClipboard = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  // On-chain config: minimum provider stake (used as default + hint).
  useEffect(() => {
    if (!program) return;
    let cancelled = false;
    fetchConfig(program)
      .then((cfg) => {
        if (cancelled || !cfg) return;
        const min = lamportsToSol(Number(cfg.minProviderStake.toString()));
        setMinStake(min);
        setStakeSol((s) => (s === '' ? String(min) : s));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [program]);

  // Connected wallet's provider account.
  const loadAccount = useCallback(async () => {
    if (!program || !publicKey) {
      setAccount(undefined);
      return;
    }
    try {
      const acc = await program.account.provider.fetchNullable(providerPda(publicKey));
      setAccount(
        acc
          ? {
              stake: Number(acc.stake.toString()),
              completed: acc.completed,
              slashed: acc.slashed,
              activeJobs: acc.activeJobs,
              active: acc.active,
            }
          : null,
      );
    } catch {
      setAccount(null);
    }
  }, [program, publicKey]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const stakeNum = Number(stakeSol);
  const stakeValid = stakeSol.trim() !== '' && Number.isFinite(stakeNum) && stakeNum >= 0;

  const handleRegister = async () => {
    if (!program || !stakeValid) return;
    setIsRegistering(true);
    setTxError(null);
    setTxSigs([]);
    try {
      const lamports = BigInt(Math.round(stakeNum * LAMPORTS_PER_SOL));
      const sigs = await registerAndStakeProvider(program, lamports);
      setTxSigs(sigs);
      await loadAccount();
      providers.reload();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRegistering(false);
    }
  };

  const providerList = providers.data ?? [];

  return (
    <AppShell>
      <div className="container mx-auto py-10 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Connect External Provider</h1>
          <p className="text-slate-500 mt-1 text-sm">Run a Verity provider worker against the verity_core program on Solana {env.cluster} and earn bounties.</p>
        </div>

        <div className="space-y-10 divide-y divide-slate-200">

          {/* Run Guide Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 first:pt-0">
            <div className="md:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">{GUIDE_STEPS.length}-Step Run Guide</h2>
              <p className="text-sm text-slate-500 mt-1">Run the Verity FastAPI backend with its provider/verifier workers on your own machine.</p>
            </div>
            <div className="md:col-span-2 space-y-6">
              {GUIDE_STEPS.map((step) => (
                <div key={step.id} className="space-y-2">
                  <Label className="font-semibold text-sm text-slate-700">{step.title}</Label>
                  {step.note && <p className="text-xs text-slate-500">{step.note}</p>}
                  <div className="flex relative">
                    <pre className="bg-slate-50 border border-slate-200 p-3 pr-20 rounded-md text-xs overflow-x-auto w-full text-slate-800">{step.code}</pre>
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                      {copied === step.id && <span className="text-[11px] font-medium text-emerald-600">Copied</span>}
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-slate-400 hover:text-slate-900" onClick={() => copyToClipboard(step.id, step.code)}>
                        {copied === step.id ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Registration Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
            <div className="md:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">Register / Stake as Provider</h2>
              <p className="text-sm text-slate-500 mt-1">Create your on-chain provider account and stake SOL with your connected wallet to start accepting jobs.</p>
            </div>
            <div className="md:col-span-2 space-y-6">
              {!connected || !publicKey ? (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600">
                  Connect your wallet (top right) to register.
                </div>
              ) : (
                <>
                  {/* Current on-chain provider account */}
                  <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-sm text-slate-900">Your provider account</span>
                        {account === undefined ? (
                          <span className="flex items-center text-[11px] font-medium bg-slate-100 px-2 py-0.5 rounded-full text-slate-600"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Loading</span>
                        ) : account ? (
                          account.active ? (
                            <span className="flex items-center text-[11px] font-medium bg-emerald-50 px-2 py-0.5 rounded-full text-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1"/> Active</span>
                          ) : (
                            <span className="flex items-center text-[11px] font-medium bg-rose-50 px-2 py-0.5 rounded-full text-rose-600"><XCircle className="w-3 h-3 mr-1"/> Inactive</span>
                          )
                        ) : (
                          <span className="flex items-center text-[11px] font-medium bg-slate-100 px-2 py-0.5 rounded-full text-slate-600">Not registered</span>
                        )}
                      </div>
                      <a
                        href={explorerAddress(providerPda(publicKey).toBase58()) ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center text-xs font-mono text-slate-500 hover:text-slate-900"
                      >
                        {shortKey(providerPda(publicKey).toBase58())}<ExternalLink className="w-3 h-3 ml-1"/>
                      </a>
                    </div>
                    {account && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                        <div>
                          <div className="text-[11px] text-slate-500">Stake</div>
                          <div className="text-sm font-semibold text-slate-900">{fmtSol(lamportsToSol(account.stake))} SOL</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">Completed</div>
                          <div className="text-sm font-semibold text-slate-900">{account.completed}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">Slashed</div>
                          <div className="text-sm font-semibold text-rose-600">{account.slashed}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">Active jobs</div>
                          <div className="text-sm font-semibold text-slate-900">{account.activeJobs}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-700">Stake amount (SOL)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={minStake !== null ? String(minStake) : '0.1'}
                      value={stakeSol}
                      onChange={(e) => setStakeSol(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      {minStake !== null
                        ? <>Minimum provider stake on-chain: {fmtSol(minStake)} SOL.</>
                        : <>Loading on-chain minimum stake…</>}
                      {account ? ' You are already registered; this tops up your stake.' : ' Registers your wallet first if needed.'}
                    </p>
                  </div>

                  {txError && (
                    <div className="flex items-start text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md p-3 break-all">
                      <XCircle className="w-3.5 h-3.5 mr-2 mt-0.5 shrink-0"/>{txError}
                    </div>
                  )}

                  {txSigs.length > 0 && (
                    <div className="space-y-1 text-xs bg-emerald-50 border border-emerald-100 rounded-md p-3">
                      <div className="flex items-center font-medium text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5 mr-1.5"/> Transaction{txSigs.length > 1 ? 's' : ''} confirmed</div>
                      {txSigs.map((sig) => (
                        <a key={sig} href={explorerTx(sig) ?? '#'} target="_blank" rel="noreferrer" className="flex items-center font-mono text-emerald-700 hover:underline">
                          {shortKey(sig, 8)}<ExternalLink className="w-3 h-3 ml-1"/>
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button onClick={handleRegister} disabled={!program || !stakeValid || isRegistering} className="bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-6 h-auto rounded-lg shadow-sm transition-colors">
                      {isRegistering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {account ? 'Stake More' : 'Register & Stake'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Network List Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
            <div className="md:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">Network Status</h2>
              <p className="text-sm text-slate-500 mt-1">Provider leaderboard from the verity_core program, indexed by the backend.</p>
              <div className="mt-3">
                {health.loading && !health.data ? (
                  <span className="inline-flex items-center text-[11px] font-medium bg-slate-100 px-2 py-0.5 rounded-full text-slate-600"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Pinging backend</span>
                ) : health.data?.ok && !health.error ? (
                  <span className="inline-flex items-center text-[11px] font-medium bg-emerald-50 px-2 py-0.5 rounded-full text-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1"/> Backend online · {health.data.cluster}</span>
                ) : (
                  <span className="inline-flex items-center text-[11px] font-medium bg-rose-50 px-2 py-0.5 rounded-full text-rose-600"><XCircle className="w-3 h-3 mr-1"/> Backend offline</span>
                )}
              </div>
            </div>
            <div className="md:col-span-2">
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                {providers.loading && !providers.data ? (
                  <div className="p-4 flex items-center text-sm text-slate-500"><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Loading providers…</div>
                ) : providers.error && !providers.data ? (
                  <div className="p-4 flex items-center text-sm text-rose-600"><XCircle className="w-4 h-4 mr-2"/> {providers.error.message}</div>
                ) : providerList.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">No providers registered yet.</div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {[...providerList]
                      .sort((a, b) => b.completed - a.completed || b.stake_lamports - a.stake_lamports)
                      .map((p, i) => (
                        <li key={p.pubkey} className="p-4 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-semibold text-slate-400 w-5">#{i + 1}</span>
                                <a
                                  href={explorerAddress(p.pubkey) ?? '#'}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center font-semibold text-sm text-slate-900 hover:underline"
                                >
                                  {p.name || shortKey(p.pubkey)}<ExternalLink className="w-3 h-3 ml-1 text-slate-400"/>
                                </a>
                                {p.active ? (
                                  <span className="flex items-center text-[11px] font-medium bg-emerald-50 px-2 py-0.5 rounded-full text-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1"/> Active</span>
                                ) : (
                                  <span className="flex items-center text-[11px] font-medium bg-rose-50 px-2 py-0.5 rounded-full text-rose-600"><XCircle className="w-3 h-3 mr-1"/> Inactive</span>
                                )}
                                {publicKey && p.pubkey === publicKey.toBase58() && (
                                  <span className="text-[11px] font-medium bg-blue-50 px-2 py-0.5 rounded-full text-blue-600">You</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 mt-1.5 font-mono bg-slate-100 inline-block px-1.5 py-0.5 rounded">
                                {fmtSol(lamportsToSol(p.stake_lamports))} SOL staked
                                {p.active_jobs ? ` · ${p.active_jobs} active job${p.active_jobs > 1 ? 's' : ''}` : ''}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-semibold text-slate-700">{p.completed} <span className="font-normal text-slate-500">Jobs</span></div>
                              <div className="text-xs font-semibold text-rose-600 mt-1">{p.slashed} <span className="font-normal text-rose-400">Slashes</span></div>
                              <div className="text-xs font-semibold text-emerald-600 mt-1">
                                {p.success_rate != null ? `${(p.success_rate * 100).toFixed(1)}%` : '—'} <span className="font-normal text-emerald-500">Success</span>
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
