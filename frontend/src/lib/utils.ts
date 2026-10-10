import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const shortKey = (k?: string | null, n = 4) => (k ? `${k.slice(0, n)}…${k.slice(-n)}` : "—");
export const lamportsToSol = (l?: number | null) => (l ?? 0) / 1_000_000_000;

