//! Tiny ML inference: a 4-4-1 MLP estimating probability of default, with
//! fixed-point weights baked into the WASM. "Prove the model ran": the program
//! hash commits to the exact weights, and every layer is a trace checkpoint.
//!
//! Units: "milli" fixed point (1000 = 1.0). Hidden layer ReLU; output sigmoid via a
//! 33-point lookup table over [-8, 8] with linear interpolation (result in bps).

use serde::{Deserialize, Serialize};
use verity_abi::{checkpoint, div_round_i, export_ruleset};

const MODEL_ID: &str = "verity-credit-mlp-v1";

// rows = hidden units, cols = [income, dti, history, inquiries]
const W1: [[i64; 4]; 4] = [
    [-600, 1200, 0, 800],  // h0 "stress"
    [1000, 0, 900, 0],     // h1 "stability"
    [0, 2000, 0, 0],       // h2 "high leverage"
    [0, 400, -500, 500],   // h3 "thin / active file"
];
const B1: [i64; 4] = [-200, -300, -1000, 0];
const W2: [i64; 4] = [2200, -1800, 3000, 1500];
const B2: i64 = -1000;

// sigmoid(x) * 10_000 for x = -8.0, -7.5, ..., 8.0
const SIGMOID_LUT: [i64; 33] = [
    3, 6, 9, 15, 25, 41, 67, 110, 180, 293, 474, 759, 1192, 1824, 2689, 3775, 5000, 6225, 7311, 8176,
    8808, 9241, 9526, 9707, 9820, 9890, 9933, 9959, 9975, 9985, 9991, 9994, 9997,
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    annual_income_thousands: u64,
    debt_to_income_bps: u64,
    credit_history_months: u64,
    recent_inquiries: u64,
}

#[derive(Serialize)]
pub struct Output {
    decision: &'static str,
    features_milli: [i64; 4],
    hidden_milli: [i64; 4],
    logit_milli: i64,
    model_id: &'static str,
    probability_default_bps: i64,
}

fn sigmoid_bps(x_milli: i64) -> i64 {
    if x_milli <= -8000 {
        return SIGMOID_LUT[0];
    }
    if x_milli >= 8000 {
        return SIGMOID_LUT[32];
    }
    let shifted = x_milli + 8000;
    let idx = (shifted / 500) as usize;
    let frac = shifted % 500;
    let (a, b) = (SIGMOID_LUT[idx], SIGMOID_LUT[idx + 1]);
    a + div_round_i(((b - a) * frac) as i128, 500) as i64
}

pub fn rule(i: Input) -> Result<Output, String> {
    let x: [i64; 4] = [
        (i.annual_income_thousands.min(500) * 10) as i64,
        (i.debt_to_income_bps.min(20_000) / 10) as i64,
        (i.credit_history_months.min(600) * 1000 / 120) as i64,
        (i.recent_inquiries.min(20) * 250) as i64,
    ];
    checkpoint("features", &x);

    let mut h = [0i64; 4];
    for (j, row) in W1.iter().enumerate() {
        let acc: i128 = row.iter().zip(x.iter()).map(|(w, v)| (*w as i128) * (*v as i128)).sum();
        h[j] = (div_round_i(acc, 1000) as i64 + B1[j]).max(0);
    }
    checkpoint("hidden", &h);

    let acc: i128 = W2.iter().zip(h.iter()).map(|(w, v)| (*w as i128) * (*v as i128)).sum();
    let logit = div_round_i(acc, 1000) as i64 + B2;
    checkpoint("logit", &logit);

    let p = sigmoid_bps(logit);
    let decision = if p < 1_500 {
        "APPROVE"
    } else if p < 4_000 {
        "REVIEW"
    } else {
        "DECLINE"
    };
    checkpoint("probability", &serde_json::json!({ "decision": decision, "probability_default_bps": p }));

    Ok(Output {
        decision,
        features_milli: x,
        hidden_milli: h,
        logit_milli: logit,
        model_id: MODEL_ID,
        probability_default_bps: p,
    })
}

export_ruleset!(rule);
