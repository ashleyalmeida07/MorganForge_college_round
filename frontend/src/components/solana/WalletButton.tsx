"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { Check, Copy, ExternalLink, Link2, Loader2, LogOut, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiGet, apiPost, type Me } from "@/lib/api";
import { explorerAddress } from "@/lib/env";
import { shortKey } from "@/lib/utils";



const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

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
        className="h-9 rounded-full px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 gap-2"
      >
        {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4 text-slate-500" />}
        {connected && address ? shortKey(address) : "Connect Wallet"}
        {connected && linked && <Check className="h-3.5 w-3.5 text-emerald-600" />}
      </Button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg z-50 text-sm">
          {!connected ? (
            <>
              <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Select wallet</div>
              {detected.length === 0 && (
                <p className="px-2 py-2 text-xs text-slate-500">
                  No Solana wallet detected. Install{" "}
                  <a href="https://phantom.app" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    Phantom
                  </a>{" "}
                  and switch it to Devnet.
                </p>
              )}
              {detected.map((w) => (
                <button
                  key={w.adapter.name}
                  onClick={() => {
                    setMsg(null);
                    select(w.adapter.name);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-slate-700 hover:bg-slate-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" className="h-5 w-5" />
                  {w.adapter.name}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="px-2 py-1.5 font-mono text-xs text-slate-600 break-all">{address}</div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(address ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-slate-700 hover:bg-slate-100"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-slate-400" />}
                {copied ? "Copied" : "Copy address"}
              </button>
              <a
                href={explorerAddress(address) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-slate-700 hover:bg-slate-100"
              >
                <ExternalLink className="h-4 w-4 text-slate-400" />
                View on Explorer
              </a>
              {user && linked === false && (
                <button
                  onClick={linkWallet}
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Link to my account
                </button>
              )}
              <button
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Disconnect
              </button>
            </>
          )}
          {msg && <p className="px-2 pt-2 text-xs text-slate-500">{msg}</p>}
        </div>
      )}
    </div>
  );
}
