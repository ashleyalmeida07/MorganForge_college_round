/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/verity_zk_verifier.json`.
 */
export type VerityZkVerifier = {
  "address": "A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv",
  "metadata": {
    "name": "verityZkVerifier",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Verity: on-chain Groth16 verification of the payroll rule set, bound to verity_core requests and receipts"
  },
  "instructions": [
    {
      "name": "initialize",
      "docs": [
        "One-time setup by the verity_core config authority."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "coreConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                162,
                247,
                207,
                11,
                211,
                191,
                152,
                212,
                24,
                53,
                142,
                191,
                201,
                226,
                105,
                238,
                72,
                196,
                193,
                197,
                202,
                87,
                134,
                209,
                90,
                5,
                23,
                141,
                158,
                190,
                105,
                42
              ]
            }
          }
        },
        {
          "name": "zkConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  122,
                  107,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payrollProgramHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setPayrollProgramHash",
      "docs": [
        "Point the payroll circuit at a rebuilt payroll WASM (new program hash)."
      ],
      "discriminator": [
        204,
        99,
        252,
        196,
        232,
        249,
        210,
        84
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "zkConfig"
          ]
        },
        {
          "name": "zkConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  122,
                  107,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "payrollProgramHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "verifyPayroll",
      "discriminator": [
        215,
        121,
        7,
        44,
        187,
        165,
        133,
        242
      ],
      "accounts": [
        {
          "name": "prover",
          "writable": true,
          "signer": true
        },
        {
          "name": "zkConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  122,
                  107,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "request",
          "docs": [
            "verity_core Request (owner + discriminator checked by Account<>)."
          ]
        },
        {
          "name": "receipt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "request"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                162,
                247,
                207,
                11,
                211,
                191,
                152,
                212,
                24,
                53,
                142,
                191,
                201,
                226,
                105,
                238,
                72,
                196,
                193,
                197,
                202,
                87,
                134,
                209,
                90,
                5,
                23,
                141,
                158,
                190,
                105,
                42
              ]
            }
          }
        },
        {
          "name": "record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  122,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "request"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "proofA",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "proofB",
          "type": {
            "array": [
              "u8",
              128
            ]
          }
        },
        {
          "name": "proofC",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "salaryCents",
          "type": "u64"
        },
        {
          "name": "taxBps",
          "type": "u64"
        },
        {
          "name": "deductionsCents",
          "type": "u64"
        },
        {
          "name": "taxCents",
          "type": "u64"
        },
        {
          "name": "netCents",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "receipt",
      "discriminator": [
        39,
        154,
        73,
        106,
        80,
        102,
        145,
        153
      ]
    },
    {
      "name": "request",
      "discriminator": [
        125,
        172,
        150,
        161,
        162,
        115,
        39,
        71
      ]
    },
    {
      "name": "zkConfig",
      "discriminator": [
        181,
        176,
        242,
        167,
        108,
        219,
        13,
        202
      ]
    },
    {
      "name": "zkProofRecord",
      "discriminator": [
        204,
        146,
        135,
        64,
        250,
        227,
        31,
        5
      ]
    }
  ],
  "events": [
    {
      "name": "zkVerified",
      "discriminator": [
        89,
        6,
        25,
        43,
        28,
        190,
        172,
        177
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "signer is not the verity_core / zk config authority"
    },
    {
      "code": 6001,
      "name": "wrongProgram",
      "msg": "request is not for the registered payroll program"
    },
    {
      "code": 6002,
      "name": "inputMismatch",
      "msg": "proven input does not hash to the request's input_hash"
    },
    {
      "code": 6003,
      "name": "receiptMismatch",
      "msg": "receipt does not belong to this request"
    },
    {
      "code": 6004,
      "name": "invalidProof",
      "msg": "Groth16 proof verification failed"
    }
  ],
  "types": [
    {
      "name": "config",
      "docs": [
        "seeds: [\"config\"]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "minProviderStake",
            "type": "u64"
          },
          {
            "name": "minDisputeStake",
            "type": "u64"
          },
          {
            "name": "challengeWindowSecs",
            "type": "i64"
          },
          {
            "name": "requiredAttestations",
            "type": "u8"
          },
          {
            "name": "requestCount",
            "type": "u64"
          },
          {
            "name": "verifierCount",
            "type": "u32"
          },
          {
            "name": "latestAuditRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "auditRootCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "receipt",
      "docs": [
        "seeds: [\"receipt\", request]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "outputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "traceRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "fuelUsed",
            "type": "u64"
          },
          {
            "name": "signature",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "submittedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "request",
      "docs": [
        "seeds: [\"request\", requester, id (u64 LE)] where id = config.request_count at creation."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "requester",
            "type": "pubkey"
          },
          {
            "name": "programHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "inputUriHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bounty",
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "requestStatus"
              }
            }
          },
          {
            "name": "provider",
            "docs": [
              "Pubkey::default() until claimed."
            ],
            "type": "pubkey"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "receiptAt",
            "type": "i64"
          },
          {
            "name": "attestCountMatch",
            "type": "u8"
          },
          {
            "name": "attestCountMismatch",
            "type": "u8"
          },
          {
            "name": "attestCountTotal",
            "type": "u8"
          },
          {
            "name": "settled",
            "docs": [
              "true once the bounty has left the escrow (paid, refunded)."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "requestStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "claimed"
          },
          {
            "name": "awaitingVerification"
          },
          {
            "name": "disputed"
          },
          {
            "name": "verified"
          },
          {
            "name": "rejected"
          },
          {
            "name": "expired"
          }
        ]
      }
    },
    {
      "name": "zkConfig",
      "docs": [
        "seeds: [\"zk_config\"]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "payrollProgramHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "verifiedCount",
            "type": "u64"
          },
          {
            "name": "fraudCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "zkProofRecord",
      "docs": [
        "seeds: [\"zk\", request]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "prover",
            "type": "pubkey"
          },
          {
            "name": "circuit",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "programHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "receiptOutputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "provenOutputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "matchesReceipt",
            "type": "bool"
          },
          {
            "name": "taxCents",
            "type": "u64"
          },
          {
            "name": "netCents",
            "type": "u64"
          },
          {
            "name": "verifiedAt",
            "type": "i64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "zkVerified",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "prover",
            "type": "pubkey"
          },
          {
            "name": "circuit",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "provenOutputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "receiptOutputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "matchesReceipt",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
