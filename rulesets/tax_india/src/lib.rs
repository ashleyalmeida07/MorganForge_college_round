//! Indian income tax, new regime (Sec. 115BAC), FY 2025-26 / AY 2026-27. Whole rupees.
//!
//! Slabs: 0-4L nil | 4-8L 5% | 8-12L 10% | 12-16L 15% | 16-20L 20% | 20-24L 25% | >24L 30%
//! Standard deduction Rs 75,000 for salaried individuals.
//! Rebate u/s 87A up to Rs 60,000 when taxable income <= Rs 12,00,000, with marginal
//! relief just above the limit (tax cannot exceed income above Rs 12L).
//! Surcharge 10% (>50L), 15% (>1Cr), 25% (>2Cr, new-regime cap) with marginal relief.
//! Health & education cess 4%. Rounding: each component rounded to the nearest rupee.

use serde::{Deserialize, Serialize};
use verity_abi::{checkpoint, div_round, export_ruleset};

const LAKH: u64 = 100_000;
const STANDARD_DEDUCTION: u64 = 75_000;
const REBATE_LIMIT: u64 = 12 * LAKH;
const REBATE_MAX: u64 = 60_000;
const SLABS: [(u64, u64, u32); 7] = [
    (0, 4 * LAKH, 0),
    (4 * LAKH, 8 * LAKH, 500),
    (8 * LAKH, 12 * LAKH, 1000),
    (12 * LAKH, 16 * LAKH, 1500),
    (16 * LAKH, 20 * LAKH, 2000),
    (20 * LAKH, 24 * LAKH, 2500),
    (24 * LAKH, u64::MAX, 3000),
];
const SURCHARGE: [(u64, u32); 3] = [(500 * LAKH, 1000), (1000 * LAKH, 1500), (2000 * LAKH, 2500)];

fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    annual_income_rupees: u64,
    #[serde(default = "default_true")]
    salaried: bool,
}

#[derive(Serialize)]
pub struct Slab {
    from: u64,
    rate_bps: u32,
    tax: u64,
    to: Option<u64>,
}

#[derive(Serialize)]
pub struct Output {
    cess: u64,
    effective_rate_bps: u64,
    gross_income: u64,
    marginal_relief: u64,
    rebate_87a: u64,
    regime: &'static str,
    slab_breakdown: Vec<Slab>,
    standard_deduction: u64,
    surcharge: u64,
    tax_after_rebate: u64,
    tax_before_rebate: u64,
    taxable_income: u64,
    total_tax: u64,
}

fn slab_tax(income: u64, trace: bool) -> (u64, Vec<Slab>) {
    let mut total = 0u64;
    let mut rows = Vec::new();
    for (from, to, rate) in SLABS {
        if income <= from {
            break;
        }
        let portion = income.min(to) - from;
        let tax = div_round(portion as u128 * rate as u128, 10_000) as u64;
        total += tax;
        if trace {
            checkpoint("slab", &serde_json::json!({ "from": from, "rate_bps": rate, "running_tax": total, "tax": tax }));
        }
        rows.push(Slab { from, rate_bps: rate, tax, to: if to == u64::MAX { None } else { Some(to) } });
    }
    (total, rows)
}

fn surcharge_rate(income: u64) -> u32 {
    SURCHARGE.iter().rev().find(|(t, _)| income > *t).map(|(_, r)| *r).unwrap_or(0)
}

fn surcharge_of(tax: u64, rate: u32) -> u64 {
    div_round(tax as u128 * rate as u128, 10_000) as u64
}

pub fn rule(i: Input) -> Result<Output, String> {
    if i.annual_income_rupees > 1_000_000_000_000 {
        return Err("annual_income_rupees must be <= 1e12".into());
    }
    let std_ded = if i.salaried { STANDARD_DEDUCTION.min(i.annual_income_rupees) } else { 0 };
    let taxable = i.annual_income_rupees - std_ded;
    checkpoint("taxable", &serde_json::json!({ "standard_deduction": std_ded, "taxable_income": taxable }));

    let (tax, slab_breakdown) = slab_tax(taxable, true);

    // Sec. 87A rebate + marginal relief at the Rs 12L threshold.
    let (mut rebate, mut relief) = (0u64, 0u64);
    if taxable <= REBATE_LIMIT {
        rebate = tax.min(REBATE_MAX);
    } else if tax > taxable - REBATE_LIMIT {
        relief = tax - (taxable - REBATE_LIMIT);
    }
    let after_rebate = tax - rebate - relief;
    checkpoint("rebate", &serde_json::json!({ "marginal_relief": relief, "rebate_87a": rebate, "tax_after_rebate": after_rebate }));

    // Surcharge with marginal relief at each threshold.
    let rate = surcharge_rate(taxable);
    let mut surcharge = surcharge_of(after_rebate, rate);
    if rate > 0 {
        let threshold = SURCHARGE.iter().rev().find(|(t, _)| taxable > *t).map(|(t, _)| *t).unwrap_or(0);
        let tax_at_threshold = slab_tax(threshold, false).0;
        let cap = tax_at_threshold + surcharge_of(tax_at_threshold, surcharge_rate(threshold)) + (taxable - threshold);
        if after_rebate + surcharge > cap {
            let reduced = cap.saturating_sub(after_rebate);
            relief += surcharge - reduced.min(surcharge);
            surcharge = reduced.min(surcharge);
        }
    }
    checkpoint("surcharge", &serde_json::json!({ "surcharge": surcharge, "surcharge_rate_bps": rate }));

    let cess = div_round((after_rebate + surcharge) as u128 * 400, 10_000) as u64;
    let total_tax = after_rebate + surcharge + cess;
    let effective = if i.annual_income_rupees == 0 {
        0
    } else {
        div_round(total_tax as u128 * 10_000, i.annual_income_rupees as u128) as u64
    };
    checkpoint("total", &serde_json::json!({ "cess": cess, "total_tax": total_tax }));

    Ok(Output {
        cess,
        effective_rate_bps: effective,
        gross_income: i.annual_income_rupees,
        marginal_relief: relief,
        rebate_87a: rebate,
        regime: "new_115BAC_FY2025_26",
        slab_breakdown,
        standard_deduction: std_ded,
        surcharge,
        tax_after_rebate: after_rebate,
        tax_before_rebate: tax,
        taxable_income: taxable,
        total_tax,
    })
}

export_ruleset!(rule);
