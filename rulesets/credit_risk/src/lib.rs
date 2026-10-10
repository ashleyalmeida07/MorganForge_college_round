//! Rule-based credit risk score (300-850). Integer-only.
//!
//!   start 650
//!   - DTI penalty: 100 if DTI > 50%, 50 if DTI > 36%
//!   - delinquency penalty: 60 each, max 200
//!   + history bonus: 10 per full year of history, max 100
//!   clamp to [300, 850]; tier LOW_RISK >= 740, MEDIUM_RISK >= 670, else HIGH_RISK
//!
//! Used in the adversarial demo ("provider inflated the score").

use serde::{Deserialize, Serialize};
use verity_abi::{checkpoint, export_ruleset};

const BASE: i64 = 650;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    annual_income_cents: u64,
    total_debt_cents: u64,
    credit_history_months: u32,
    delinquencies: u32,
}

#[derive(Serialize)]
pub struct Output {
    base_score: u32,
    delinquency_penalty: u32,
    dti_bps: u64,
    dti_penalty: u32,
    final_score: u32,
    history_bonus: u32,
    risk_tier: &'static str,
}

pub fn rule(i: Input) -> Result<Output, String> {
    let dti_bps: u64 = if i.annual_income_cents > 0 {
        (i.total_debt_cents as u128 * 10_000 / i.annual_income_cents as u128).min(u64::MAX as u128) as u64
    } else {
        10_000
    };
    let dti_penalty: u32 = if dti_bps > 5_000 {
        100
    } else if dti_bps > 3_600 {
        50
    } else {
        0
    };
    checkpoint("dti", &serde_json::json!({ "dti_bps": dti_bps, "dti_penalty": dti_penalty }));

    let delinquency_penalty = (i.delinquencies.min(1_000) * 60).min(200);
    checkpoint("delinquency", &serde_json::json!({ "delinquency_penalty": delinquency_penalty }));

    let history_bonus = (i.credit_history_months / 12).saturating_mul(10).min(100);
    checkpoint("history", &serde_json::json!({ "history_bonus": history_bonus }));

    let score = (BASE - dti_penalty as i64 - delinquency_penalty as i64 + history_bonus as i64).clamp(300, 850) as u32;
    let risk_tier = match score {
        740..=850 => "LOW_RISK",
        670..=739 => "MEDIUM_RISK",
        _ => "HIGH_RISK",
    };
    checkpoint("score", &serde_json::json!({ "final_score": score, "risk_tier": risk_tier }));

    Ok(Output {
        base_score: BASE as u32,
        delinquency_penalty,
        dti_bps,
        dti_penalty,
        final_score: score,
        history_bonus,
        risk_tier,
    })
}

export_ruleset!(rule);
