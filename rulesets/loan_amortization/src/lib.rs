//! Fixed-rate loan amortization schedule (EMI), integer fixed-point math only.
//!
//! Monthly rate r = annual_rate_bps / 12 / 10_000, held as r * SCALE (SCALE = 1e12).
//! EMI = P * r * (1+r)^n / ((1+r)^n - 1), rounded up to the next cent; the final
//! instalment absorbs rounding so the balance ends at exactly zero.
//! One checkpoint per month -> long traces for first-divergent-step demos.

use serde::{Deserialize, Serialize};
use verity_abi::{checkpoint, div_round, export_ruleset};

const SCALE: u128 = 1_000_000_000_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    principal_cents: u64,
    annual_rate_bps: u32,
    months: u32,
}

#[derive(Serialize)]
pub struct Row {
    balance_cents: u64,
    interest_cents: u64,
    month: u32,
    payment_cents: u64,
    principal_cents: u64,
}

#[derive(Serialize)]
pub struct Output {
    annual_rate_bps: u32,
    monthly_payment_cents: u64,
    months: u32,
    principal_cents: u64,
    schedule: Vec<Row>,
    total_interest_cents: u64,
    total_paid_cents: u64,
}

pub fn rule(i: Input) -> Result<Output, String> {
    if i.principal_cents == 0 || i.principal_cents > 1_000_000_000_000 {
        return Err("principal_cents must be in 1..=1e12".into());
    }
    if i.months == 0 || i.months > 600 {
        return Err("months must be in 1..=600".into());
    }
    if i.annual_rate_bps > 100_000 {
        return Err("annual_rate_bps must be <= 100000 (1000%)".into());
    }
    let p = i.principal_cents as u128;
    let n = i.months;
    let r = i.annual_rate_bps as u128 * SCALE / 120_000; // monthly rate * SCALE

    let emi: u128 = if r == 0 {
        (p + n as u128 - 1) / n as u128
    } else {
        let mut growth = SCALE; // (1+r)^n * SCALE
        for _ in 0..n {
            growth = growth * (SCALE + r) / SCALE;
            if growth > 10u128.pow(25) {
                return Err("rate/term combination too extreme ((1+r)^n > 1e13)".into());
            }
        }
        let num = (p * r / SCALE) * growth + (p * r % SCALE) * growth / SCALE;
        let den = growth - SCALE;
        (num + den - 1) / den
    };
    checkpoint("emi", &serde_json::json!({ "monthly_payment_cents": emi as u64, "monthly_rate_scaled": r as u64 }));

    let mut balance = p;
    let mut schedule = Vec::with_capacity(n as usize);
    let (mut total_interest, mut total_paid) = (0u128, 0u128);
    for month in 1..=n {
        let interest = div_round(balance * r, SCALE);
        let mut payment = emi;
        if month == n || payment > balance + interest {
            payment = balance + interest; // final instalment clears the loan exactly
        }
        let principal = payment - interest.min(payment);
        balance -= principal.min(balance);
        total_interest += interest;
        total_paid += payment;
        checkpoint("month", &serde_json::json!({ "balance_cents": balance as u64, "month": month }));
        schedule.push(Row {
            balance_cents: balance as u64,
            interest_cents: interest as u64,
            month,
            payment_cents: payment as u64,
            principal_cents: principal as u64,
        });
        if balance == 0 {
            break;
        }
    }

    Ok(Output {
        annual_rate_bps: i.annual_rate_bps,
        monthly_payment_cents: emi as u64,
        months: n,
        principal_cents: i.principal_cents,
        schedule,
        total_interest_cents: total_interest as u64,
        total_paid_cents: total_paid as u64,
    })
}

export_ruleset!(rule);
