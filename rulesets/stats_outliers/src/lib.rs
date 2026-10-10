//! Descriptive statistics + IQR outlier detection over an integer dataset.
//!
//! All fractional results are fixed-point "milli" values (x1000, rounded half away
//! from zero). Quartiles use linear interpolation between closest ranks (numpy's
//! default): q(p) at position (n-1)*p of the sorted data. Variance is the
//! population variance. Outliers lie outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR].
//! Running-sum checkpoints every 64 elements make the trace bisectable.

use serde::{Deserialize, Serialize};
use verity_abi::{checkpoint, div_round_i, export_ruleset, isqrt};

const MAX_VALUES: usize = 20_000;
const MAX_ABS: i64 = 1_000_000_000;
const CHUNK: usize = 64;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    values: Vec<i64>,
}

#[derive(Serialize)]
pub struct Output {
    count: u64,
    iqr_milli: i64,
    lower_fence_milli: i64,
    max: i64,
    mean_milli: i64,
    median_milli: i64,
    min: i64,
    outlier_count: u64,
    outliers: Vec<i64>,
    q1_milli: i64,
    q3_milli: i64,
    stddev_milli: i64,
    sum: i64,
    upper_fence_milli: i64,
    variance_milli: i64,
}

/// Quantile k/4 (k = 1, 2, 3) of sorted data, in milli units, exact.
fn quartile_milli(sorted: &[i64], k: usize) -> i64 {
    let n = sorted.len();
    let pos4 = (n - 1) * k; // position * 4
    let lo = pos4 / 4;
    let frac = (pos4 % 4) as i128; // quarters
    let a = sorted[lo] as i128;
    let b = sorted[(lo + 1).min(n - 1)] as i128;
    (a * 1000 + (b - a) * frac * 250) as i64
}

pub fn rule(i: Input) -> Result<Output, String> {
    let v = i.values;
    if v.is_empty() {
        return Err("values must not be empty".into());
    }
    if v.len() > MAX_VALUES {
        return Err(format!("at most {MAX_VALUES} values"));
    }
    if v.iter().any(|x| x.abs() > MAX_ABS) {
        return Err("each value must satisfy |x| <= 1e9".into());
    }
    let n = v.len() as i128;

    // Pass 1: running sums (checkpointed per chunk).
    let (mut sum, mut sum_sq) = (0i128, 0i128);
    for (idx, x) in v.iter().enumerate() {
        sum += *x as i128;
        sum_sq += (*x as i128) * (*x as i128);
        if (idx + 1) % CHUNK == 0 || idx + 1 == v.len() {
            checkpoint("running_sum", &serde_json::json!({ "i": idx + 1, "sum": sum.to_string(), "sum_sq": sum_sq.to_string() }));
        }
    }
    let mean_milli = div_round_i(sum * 1000, n);
    // population variance = E[x^2] - E[x]^2, computed exactly as (n*sum_sq - sum^2) / n^2
    let var_num = n * sum_sq - sum * sum;
    let variance_milli = i64::try_from(div_round_i(var_num * 1000, n * n))
        .map_err(|_| "variance too large for i64 milli units; scale the values down".to_string())?;
    // stddev in milli = sqrt(variance * 1e6 / 1000) = sqrt(var_num * 1e6 / n^2)
    let stddev_milli = isqrt((var_num.max(0) as u128) * 1_000_000 / (n * n) as u128) as i64;
    checkpoint("moments", &serde_json::json!({ "mean_milli": mean_milli as i64, "variance_milli": variance_milli }));

    // Pass 2: order statistics.
    let mut sorted = v.clone();
    sorted.sort_unstable();
    let q1 = quartile_milli(&sorted, 1);
    let median = quartile_milli(&sorted, 2);
    let q3 = quartile_milli(&sorted, 3);
    let iqr = q3 - q1;
    let lower = q1 - iqr * 3 / 2;
    let upper = q3 + iqr * 3 / 2;
    checkpoint("quartiles", &serde_json::json!({ "median_milli": median, "q1_milli": q1, "q3_milli": q3 }));

    // Pass 3: outliers, in input order.
    let outliers: Vec<i64> = v
        .iter()
        .copied()
        .filter(|x| (*x as i128) * 1000 < lower as i128 || (*x as i128) * 1000 > upper as i128)
        .collect();
    checkpoint("outliers", &serde_json::json!({ "lower_fence_milli": lower, "outlier_count": outliers.len(), "upper_fence_milli": upper }));

    Ok(Output {
        count: v.len() as u64,
        iqr_milli: iqr,
        lower_fence_milli: lower,
        max: *sorted.last().unwrap(),
        mean_milli: mean_milli as i64,
        median_milli: median,
        min: sorted[0],
        outlier_count: outliers.len() as u64,
        outliers,
        q1_milli: q1,
        q3_milli: q3,
        stddev_milli,
        sum: sum as i64,
        upper_fence_milli: upper,
        variance_milli,
    })
}

export_ruleset!(rule);
