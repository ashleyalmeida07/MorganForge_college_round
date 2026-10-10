// Typed client for the Verity FastAPI backend. Attaches the Supabase access token when signed in.
import { env } from "@/lib/env";
import { getSupabase } from "@/lib/supabase/client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(await authHeader()),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body && !(init.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${env.apiUrl}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = body as { detail?: unknown; error?: string } | undefined;
    const detail = typeof b?.detail === "string" ? b.detail : b?.error ?? JSON.stringify(b?.detail ?? body ?? res.statusText);
    throw new ApiError(res.status, detail, body);
  }
  return body as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: "POST", body: data instanceof FormData ? data : JSON.stringify(data ?? {}) });

// ------------------------------------------------------------------ types

export type RequestStatus =
  | "Open"
  | "Claimed"
  | "AwaitingVerification"
  | "Disputed"
  | "Verified"
  | "Rejected"
  | "Expired";

export interface Stats {
  total_requests: number;
  by_status: Record<RequestStatus, number>;
  verified: number;
  verified_pct: number | null;
  verified_pct_of_total: number | null;
  in_flight: number;
  disputes_total: number;
  disputes_by_status: Record<string, number>;
  disputes_caught: number;
  frivolous_disputes: number;
  rejected: number;
  programs: number;
  providers: number;
  attestations: number;
  audit_events: number;
}

export interface Program {
  program_hash: string;
  name: string;
  description?: string | null;
  version?: string | null;
  language?: string | null;
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  example_input?: unknown;
  wasm_uri: string;
  wasm_url?: string | null;
  ipfs_cid?: string | null;
  created_at?: string;
}

export interface RequestRow {
  request_pda: string;
  onchain_id: number | null;
  requester_pubkey: string;
  title?: string | null;
  program_hash: string | null;
  input_hash: string;
  input_uri?: string | null;
  bounty_lamports: number | null;
  deadline: string | null;
  status: RequestStatus;
  provider_pubkey?: string | null;
  attest_count_match: number;
  attest_count_mismatch: number;
  attest_count_total: number;
  create_tx?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  pubkey: string;
  name?: string | null;
  stake_lamports: number;
  completed: number;
  slashed: number;
  active_jobs?: number;
  active: boolean;
  success_rate?: number | null;
}

export interface PrepareOut {
  program_hash: string;
  input_hash: string;
  input_uri: string;
  input_uri_hash: string;
  canonical_input: string;
  input_url?: string | null;
  ipfs_cid?: string | null;
  program_hash_bytes32: number[];
  input_hash_bytes32: number[];
  input_uri_hash_bytes32: number[];
  program_id: string;
  cluster: string;
  config_pda?: string | null;
  predicted_request_id?: number | null;
  predicted_request_pda?: string | null;
}

export interface Me {
  profile: { id: string; email: string | null; display_name: string | null; avatar_url: string | null; role: string } | null;
  wallets: { pubkey: string; verified_at: string }[];
  is_admin: boolean;
}

export interface AuditLogRow {
  seq: number;
  event_type: string;
  request_pda: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
  tx_sig: string | null;
  slot: number | null;
  prev_hash: string;
  row_hash: string;
  anchored_tx: string | null;
  created_at: string;
  explorer?: string | null;
  request_explorer?: string | null;
  anchored_explorer?: string | null;
}


export interface AuditVerifyOut {
  ok: boolean;
  checked: number;
  first_bad_seq: number | null;
  head: string | null;
  onchain: { latest_audit_root: string | null; audit_root_count: number | null; available: boolean };
  anchored_row: { seq: number; row_hash: string; anchored_tx: string; created_at: string; explorer?: string | null } | null;
  root_row: { seq: number; row_hash: string; anchored_tx: string; created_at: string; explorer?: string | null } | null;
  anchor_matches: boolean | null;
  anchor_status: "not_anchored" | "root_not_found_in_db" | "ok";
  ok_overall: boolean;
}

export interface TimelineItem {
  seq: number | null;
  event_type: string;
  at: string | null;
  tx_sig: string | null;
  slot: number | null;
  explorer: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
  source: string;
}

export interface RequestDetail {
  request_pda: string;
  status: RequestStatus;
  is_terminal: boolean;
  request: (RequestRow & { explorer?: string | null; create_tx_explorer?: string | null }) | null;
  program: Program | null;
  receipt: Record<string, unknown> | null;
  attestations: Record<string, unknown>[];
  dispute: Record<string, unknown> | null;
  timeline: TimelineItem[];
  integrity: { overall: string; [k: string]: unknown } | null;
  challenge: { window_secs: number; ends_at: string; seconds_remaining: number } | null;
  links: { request?: string | null; requester?: string | null; provider?: string | null; program?: string | null };
  cluster: string;
  program_id: string;
}

export interface Health {
  ok: boolean;
  time: string;
  program_id: string;
  cluster: string;
  worker_status?: unknown;
}
