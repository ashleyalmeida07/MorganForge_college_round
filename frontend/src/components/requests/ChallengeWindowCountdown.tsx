"use client";

import React, { useEffect, useState } from "react";
import { Clock, ShieldCheck } from "lucide-react";

interface Props {
  receiptAt: number; // Unix timestamp in seconds
  windowSecs?: number; // Duration of challenge window in seconds (default 120)
  onExpired?: () => void;
}

export function ChallengeWindowCountdown({ receiptAt, windowSecs = 120, onExpired }: Props) {
  const deadline = receiptAt + windowSecs;
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, deadline - Math.floor(Date.now() / 1000)),
  );

  useEffect(() => {
    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      const rem = Math.max(0, deadline - now);
      setRemaining(rem);
      if (rem <= 0 && onExpired) {
        onExpired();
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline, onExpired]);

  const progressPct = Math.max(0, Math.min(100, ((windowSecs - remaining) / windowSecs) * 100));

  if (remaining <= 0) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-mono font-medium">
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>Challenge window closed &bull; Auto-finalizing&hellip;</span>
      </div>
    );
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timeFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="flex flex-col gap-1.5 p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs font-mono">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
          <span className="font-semibold text-slate-700">Challenge window active:</span>
          <span className="text-amber-700 font-bold">{timeFormatted} remaining</span>
        </div>
        <span className="text-[11px] text-slate-500">Window: {windowSecs}s</span>
      </div>

      <div className="w-full bg-white rounded-full h-1.5 overflow-hidden border border-amber-200">
        <div
          className="bg-gradient-to-r from-amber-500 to-amber-400 h-1.5 rounded-full transition-all duration-1000 ease-linear"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-500 font-sans mt-0.5">
        Any challenger can stake SOL to dispute this computation before the timer expires.
      </p>
    </div>
  );
}

export default ChallengeWindowCountdown;
