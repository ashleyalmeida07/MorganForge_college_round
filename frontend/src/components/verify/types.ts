// Response shapes of GET /requests/{pda} and GET /requests/{pda}/trace (backend/app/routes/common.py).
import type { Program, RequestRow, RequestStatus } from "@/lib/api";
import type { TraceStep } from "@/lib/trace";

export type CheckStatus = "ok" | "tampered" | "missing" | "unknown" | "pending" | "drift";
export type SignatureStatus = "valid" | "invalid" | "pending" | "unknown";

export interface HashCheck {
  status: CheckStatus;
  expected?: string | null;
  actual?: string | null;
  uri?: string | null;
  error?: string | null;
}

export interface Integrity {
  overall: "ok" | "tampered" | "incomplete";
  program: HashCheck;
  input: HashCheck;
  input_uri: HashCheck;
  output: HashCheck;
  receipt_signature: { status: SignatureStatus; signer?: string | null; error?: string | null };
  db_vs_chain: { status: CheckStatus; mismatches: string[] };
  checked_at?: string;
}

export interface ChainRequest {
  id: number;
  requester: string;
  program_hash: string;
  input_hash: string;
  input_uri_hash: string;
  bounty: number;
  deadline: number;
  status: RequestStatus;
  provider: string | null;
  created_at: number;
  receipt_at: number;
  attest_count_match: number;
  attest_count_mismatch: number;
  attest_count_total: number;
  settled: boolean;
}

export interface ChainReceipt {
  output_hash: string;
  trace_root: string;
  fuel_used: number;
  signature: string;
  provider: string;
  submitted_at: number;
}

export interface ChainDispute {
  challenger: string;
  stake: number;
  claimed_output_hash: string;
  status: string;
  opened_at: number;
  resolved_at: number;
}

export interface ReceiptRow {
  output_hash: string;
  trace_root: string;
  fuel_used: number | null;
  signature: string | null;
  provider_pubkey?: string | null;
  output_uri?: string | null;
  output_url?: string | null;
  output_ipfs_cid?: string | null;
  tx_sig?: string | null;
  explorer?: string | null;
  submitted_at?: string | null;
}

export interface AttestationRow {
  verifier_pubkey: string;
  output_hash: string | null;
  trace_root?: string | null;
  fuel_used: number | null;
  matches: boolean;
  counted: boolean;
  tx_sig?: string | null;
  explorer?: string | null;
  verifier_explorer?: string | null;
  attested_at?: string | null;
}

export interface DisputeRow {
  challenger_pubkey: string;
  stake_lamports: number | null;
  claimed_output_hash: string | null;
  status: string;
  opened_at?: string | null;
  resolved_at?: string | null;
  open_explorer?: string | null;
  resolve_explorer?: string | null;
  ai_explanation?: string | null;
}

export interface ArtifactRef {
  url?: string | null;
  expected_hash?: string | null;
  ipfs_url?: string | null;
}

export interface Artifacts {
  wasm: ArtifactRef & { size?: number | null };
  source: { url?: string | null };
  input: ArtifactRef;
  output: ArtifactRef;
  trace: { url?: string | null; expected_root?: string | null; version?: string };
}

export interface TimelineItem {
  event_type: string;
  at: string | number | null;
  tx_sig?: string | null;
  slot?: number | null;
  explorer?: string | null;
  actor?: string | null;
  payload?: unknown;
  source?: string;
}

export interface ZkRecordInfo {
  matches_receipt: boolean;
  proven_output_hash: string;
  receipt_output_hash: string;
  tax_cents: number;
  net_cents: number;
  prover: string;
  verified_at_iso?: string | null;
  explorer?: string | null;
}

export interface ZkInfo {
  circuit?: string;
  zk_program_id?: string;
  eligible: boolean;
  record: ZkRecordInfo | null;
  verified_count?: number;
  fraud_count?: number;
  error?: string | null;
}

export interface ChallengeInfo {
  window_secs: number;
  ends_at: string;
  seconds_remaining: number;
  required_attestations: number | null;
  min_dispute_stake: number | null;
}

export type ProgramInfo = Program & {
  wasm_size?: number | null;
  source_uri?: string | null;
  source_url?: string | null;
  ipfs_url?: string | null;
};

export interface RequestDetail {
  request_pda: string;
  status: RequestStatus | null;
  is_terminal: boolean;
  request: (RequestRow & { input_uri_hash?: string | null; explorer?: string | null }) | null;
  chain: ChainRequest | null;
  chain_receipt: ChainReceipt | null;
  chain_dispute: ChainDispute | null;
  receipt: ReceiptRow | null;
  attestations: AttestationRow[];
  dispute: DisputeRow | null;
  program: ProgramInfo | null;
  artifacts: Artifacts;
  timeline: TimelineItem[];
  integrity: Integrity | null;
  zk: ZkInfo | null;
  challenge: ChallengeInfo | null;
  links: { request?: string | null; requester?: string | null; provider?: string | null; program?: string | null };
  cluster: string;
  program_id: string;
}

export interface TraceReport {
  onchain_trace_root: string | null;
  published: { leaf_count?: number; trace_root?: string; steps?: TraceStep[] } | null;
  published_check: { ok: boolean; errors?: string[] } | null;
  published_matches_chain: boolean | null;
  recomputed: { trace_root: string; leaf_count: number; output_hash: string } | null;
  recomputed_matches_chain: boolean | null;
  first_divergence: {
    index: number;
    of: number;
    kind?: string | null;
    label?: string | null;
    provider_step?: TraceStep | null;
    independent_step?: TraceStep | null;
    independent_proof?: { side: string; hash: string }[] | null;
    agreed_prefix: number;
  } | null;
  error: string | null;
}

export interface ReverifyReport {
  matches: boolean;
  output_hash: string | null;
  receipt_output_hash?: string | null;
  trace_matches: boolean | null;
  fuel_matches: boolean | null;
  program_ok?: boolean | null;
  input_ok?: boolean | null;
  error?: string | null;
  verifier_agreement?: { verifier: string; attested_output_hash: string | null; agrees_with_server: boolean; matches_receipt: boolean | null }[];
}

/** Commitments resolved chain-first (DB as fallback). */
export function commitmentsOf(d: RequestDetail) {
  return {
    programHash: d.chain?.program_hash ?? d.request?.program_hash ?? null,
    inputHash: d.chain?.input_hash ?? d.request?.input_hash ?? null,
    inputUriHash: d.chain?.input_uri_hash ?? d.request?.input_uri_hash ?? null,
    outputHash: d.chain_receipt?.output_hash ?? d.receipt?.output_hash ?? null,
    traceRoot: d.chain_receipt?.trace_root ?? d.receipt?.trace_root ?? null,
    signature: d.chain_receipt?.signature ?? d.receipt?.signature ?? null,
    provider: d.chain_receipt?.provider ?? d.receipt?.provider_pubkey ?? d.chain?.provider ?? d.request?.provider_pubkey ?? null,
    fuelUsed: d.chain_receipt?.fuel_used ?? d.receipt?.fuel_used ?? null,
    bounty: d.chain?.bounty ?? d.request?.bounty_lamports ?? null,
  };
}
