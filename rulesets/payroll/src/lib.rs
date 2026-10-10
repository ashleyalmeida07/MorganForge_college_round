//! Payroll / net pay. Integer cents and basis points only.
//!
//!   tax_cents = floor(salary_cents * tax_bps / 10_000)
//!   net_cents = salary_cents - tax_cents - deductions_cents   (must be >= 0)
//!
//! The same arithmetic is proven in zk/payroll/payroll.circom (Groth16 path).

use serde::{Deserialize, Serialize};
use verity_abi::{checkpoint, export_ruleset};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    salary_cents: u64,
    tax_bps: u32,
    deductions_cents: u64,
}

#[derive(Serialize)]
pub struct Output {
    deductions_cents: u64,
    gross_cents: u64,
    net_cents: u64,
    tax_cents: u64,
}

pub fn rule(i: Input) -> Result<Output, String> {
    if i.tax_bps > 10_000 {
        return Err("tax_bps must be <= 10000".into());
    }
    if i.salary_cents > 1_000_000_000_000 {
        return Err("salary_cents must be <= 1e12".into());
    }
    checkpoint("gross", &serde_json::json!({ "gross_cents": i.salary_cents }));

    let tax_cents = (i.salary_cents as u128 * i.tax_bps as u128 / 10_000) as u64;
    checkpoint("tax", &serde_json::json!({ "tax_bps": i.tax_bps, "tax_cents": tax_cents }));

    let after_tax = i.salary_cents - tax_cents;
    if i.deductions_cents > after_tax {
        return Err("deductions_cents exceed salary after tax".into());
    }
    let net_cents = after_tax - i.deductions_cents;
    checkpoint("net", &serde_json::json!({ "after_tax_cents": after_tax, "net_cents": net_cents }));

    Ok(Output { deductions_cents: i.deductions_cents, gross_cents: i.salary_cents, net_cents, tax_cents })
}

export_ruleset!(rule);
