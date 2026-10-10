"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { Check, Copy, ExternalLink, Link2, Loader2, LogOut, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiGet, apiPost, type Me } from "@/lib/api";
import { explorerAddress } from "@/lib/env";
import { toBase64 } from "@/lib/hash";
import { shortKey } from "@/lib/utils";

/** Compact wallet connect/link control for the app top bar. */
export function WalletButton() {
  const { wallets, publicKey, connected, connecting, select, disconnect, signMessage } = useWallet();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const address = publicKey?.toBase58() ?? null;
  const detected = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  // Selecting a wallet connects it automatically (WalletProvider autoConnect).

  // Is the connected wallet linked to the signed-in Verity account?
  useEffect(() => {
    if (!address || !user) {
      setLinked(null);
      return;
    }
    apiGet<Me>("/me")
      .then((me) => setLinked(me.wallets.some((w) => w.pubkey === address)))
      .catch(() => setLinked(null));
  }, [address, user]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function linkWallet() {
    if (!address || !signMessage) {
      setMsg("This wallet cannot sign messages");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { nonce, message } = await apiPost<{ nonce: string; message: string }>("/auth/wallet/nonce", { wallet: address });
      const sig = await signMessage(new TextEncoder().encode(message));
      await apiPost("/auth/wallet/link", { wallet: address, signature: toBase64(sig), nonce });
      setLinked(true);
      setMsg("Wallet linked to your account");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Linking failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        className="h-9 rounded-xl px-3 text-xs font-mono font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 hover:border-blue-400 gap-2 shadow-xs transition-all"
      >
        {connecting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
        ) : (
          <Wallet className="h-3.5 w-3.5 text-blue-600" />
        )}
        {connected && address ? (
          <span className="text-slate-900 font-semibold">{shortKey(address)}</span>
        ) : (
          <span>Connect Wallet</span>
        )}
        {connected && linked && (
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" title="Linked to account" />
        )}
      </Button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xl shadow-slate-200/50 z-50 text-xs text-slate-700">
          {!connected ? (
            <>
              <div className="px-2 py-1.5 text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                Select Solana Wallet
              </div>
              {detected.length === 0 && (
                <p className="px-2 py-2 text-xs text-slate-500 leading-relaxed">
                  No Solana wallet detected. Install{" "}
                  <a href="https://phantom.app" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    Phantom
                  </a>{" "}
                  and toggle to Devnet mode.
                </p>
              )}
              {detected.map((w) => (
                <button
                  key={w.adapter.name}
                  onClick={() => {
                    setMsg(null);
                    select(w.adapter.name);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" className="h-4 w-4" />
                  <span className="font-medium text-slate-900">{w.adapter.name}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="px-2 py-1 text-[10px] font-mono font-bold text-slate-400 uppercase">Connected Address</div>
              <div className="px-2 py-1.5 font-mono text-[11px] text-blue-700 break-all bg-blue-50/60 rounded-lg border border-blue-100 my-1 font-semibold">
                {address}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(address ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
                {copied ? "Copied" : "Copy Address"}
              </button>
              <a
                href={explorerAddress(address) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                View on Solana Explorer
              </a>
              {user && linked === false && (
                <button
                  onClick={linkWallet}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-60 font-medium"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  Link to User Account
                </button>
              )}
              <div className="h-px bg-slate-100 my-1" />
              <button
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Disconnect Wallet
              </button>
            </>
          )}
          {msg && <p className="px-2 pt-1.5 text-[11px] text-amber-600 font-mono">{msg}</p>}
        </div>
      )}
    </div>
  );
}
