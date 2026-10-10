pragma circom 2.1.6;

// Verity payroll rule set as a Groth16 circuit. Same arithmetic as
// rulesets/payroll/src/lib.rs:
//   tax_cents = floor(salary_cents * tax_bps / 10000)
//   net_cents = salary_cents - tax_cents - deductions_cents   (>= 0)
//
// Public signals (snarkjs order: outputs, then public inputs):
//   [tax_cents, net_cents, salary_cents, tax_bps, deductions_cents, request_hi, request_lo]
// request_hi/lo are the request PDA's 32 bytes split into two 128-bit big-endian
// halves, so a proof is bound to one request and cannot be replayed on another.
// The on-chain verifier additionally re-derives the canonical input/output JSON
// from these integers and checks them against the request's input_hash and the
// provider receipt's output_hash.

include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template Payroll() {
    signal input salary_cents;
    signal input tax_bps;
    signal input deductions_cents;
    signal input request_hi;
    signal input request_lo;

    signal output tax_cents;
    signal output net_cents;

    // Range checks: no value may wrap around the field.
    component salaryBits = Num2Bits(40);
    salaryBits.in <== salary_cents;
    component deductionBits = Num2Bits(40);
    deductionBits.in <== deductions_cents;
    component bpsBits = Num2Bits(14);
    bpsBits.in <== tax_bps;
    component bpsMax = LessEqThan(14);
    bpsMax.in[0] <== tax_bps;
    bpsMax.in[1] <== 10000;
    bpsMax.out === 1;

    // Integer division: salary * bps = tax * 10000 + rem, 0 <= rem < 10000.
    signal product;
    product <== salary_cents * tax_bps;
    signal rem;
    tax_cents <-- product \ 10000;
    rem <-- product % 10000;
    product === tax_cents * 10000 + rem;
    component remBits = Num2Bits(14);
    remBits.in <== rem;
    component remMax = LessThan(14);
    remMax.in[0] <== rem;
    remMax.in[1] <== 10000;
    remMax.out === 1;
    component taxBits = Num2Bits(40);
    taxBits.in <== tax_cents;

    // Net pay must be non-negative (a wrapped field element fails the 40-bit check).
    net_cents <== salary_cents - tax_cents - deductions_cents;
    component netBits = Num2Bits(40);
    netBits.in <== net_cents;

    // Bind the otherwise-unconstrained request public inputs into the R1CS.
    signal hiSq;
    hiSq <== request_hi * request_hi;
    signal loSq;
    loSq <== request_lo * request_lo;
}

component main { public [salary_cents, tax_bps, deductions_cents, request_hi, request_lo] } = Payroll();
