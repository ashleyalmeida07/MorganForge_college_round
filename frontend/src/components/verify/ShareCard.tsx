"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Download, Globe } from "lucide-react";

import { env } from "@/lib/env";

import { useCopy, useOrigin } from "./ui";

/** QR code + public link to /verify/{pda} and the evidence bundle download. */
export function ShareCard({ pda, showPageLink = true }: { pda: string; showPageLink?: boolean }) {
  const origin = useOrigin();
  const url = origin ? `${origin}/verify/${pda}` : "";
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white p-1">
        {url ? <QRCodeSVG value={url} size={96} level="M" aria-label="QR code for the public verification page" /> : null}
      </div>
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-semibold text-slate-900">Public verification page</p>
        <p className="text-xs text-slate-500">Anyone can scan and re-verify — no login.</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {showPageLink && (
            <Link href={`/verify/${pda}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
              <Globe className="h-3.5 w-3.5" aria-hidden /> Open
            </Link>
          )}
          <button
            type="button"
            onClick={() => url && copy(url)}
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <a
            href={`${env.apiUrl}/requests/${pda}/evidence.zip`}
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            download
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> Evidence bundle
          </a>
        </div>
      </div>
    </div>
  );
}
