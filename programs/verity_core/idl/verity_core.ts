/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/verity_core.json`.
 */
export type VerityCore = {
  "address": "ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1",
  "metadata": {
    "name": "verityCore",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Verity: verifiable computation receipts, attestations and disputes on Solana"
  },
  "instructions": [
    {
      "name": "anchorAuditRoot",
      "discriminator": [
        48,
        53,
        192,
        240,
        38,
        102,
        169,
        64
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "root",
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
      "name": "attest",
      "docs": [
        "Anyone may attest; only active registered verifiers count toward quorum."
      ],
      "discriminator": [
        83,
        148,
        120,
        119,
        144,
        139,
        117,
        160
      ],
      "accounts": [
        {
          "name": "request",
          "writable": true
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
            ]
          }
        },
        {
          "name": "attestation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  116,
                  101,
                  115,
                  116,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "request"
              },
              {
                "kind": "account",
                "path": "verifier"
              }
            ]
          }
        },
        {
          "name": "verifierRecord",
          "docs": [
            "Optional: pass the verifier's registry record to have the attestation count."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  105,
                  102,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "verifier"
              }
            ]
          }
        },
        {
          "name": "verifier",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
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
        }
      ]
    },
    {
      "name": "claimRequest",
      "discriminator": [
        83,
        18,
        38,
        149,
        130,
        72,
        123,
        221
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "request",
          "writable": true
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "providerOwner"
              }
            ]
          }
        },
        {
          "name": "providerOwner",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "createRequest",
      "discriminator": [
        219,
        191,
        93,
        237,
        18,
        44,
        42,
        84
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "requester"
              },
              {
                "kind": "account",
                "path": "config.request_count",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "requester",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
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
        }
      ]
    },
    {
      "name": "expireRequest",
      "docs": [
        "Refunds the bounty to the requester when (a) an Open/Claimed request",
        "passed its deadline without a receipt, or (b) the request was Rejected",
        "through a dispute. Permissionless."
      ],
      "discriminator": [
        219,
        189,
        105,
        97,
        227,
        47,
        124,
        23
      ],
      "accounts": [
        {
          "name": "request",
          "writable": true
        },
        {
          "name": "requester",
          "writable": true
        },
        {
          "name": "provider",
          "docs": [
            "Required only if the request is in `Claimed` status."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "request.provider",
                "account": "request"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "finalize",
      "discriminator": [
        171,
        61,
        218,
        56,
        127,
        115,
        12,
        217
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "request",
          "writable": true
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "request.provider",
                "account": "request"
              }
            ]
          }
        },
        {
          "name": "providerOwner",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
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
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "openDispute",
      "discriminator": [
        137,
        25,
        99,
        119,
        23,
        223,
        161,
        42
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "request",
          "writable": true
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
            ]
          }
        },
        {
          "name": "dispute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101
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
          "name": "challenger",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "claimedOutputHash",
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
      "name": "registerProvider",
      "discriminator": [
        254,
        209,
        54,
        184,
        46,
        197,
        109,
        78
      ],
      "accounts": [
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "registerVerifier",
      "discriminator": [
        67,
        234,
        172,
        169,
        184,
        188,
        145,
        156
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "verifierRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  105,
                  102,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "verifier"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "verifier",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "resolveDispute",
      "docs": [
        "Permissionless. `remaining_accounts` = pairs of",
        "(attestation PDA, verifier wallet [writable]) supporting the challenger.",
        "Challenger wins if >= quorum counted mismatch attestations agree with",
        "the claimed output hash: provider is slashed (half to challenger, half",
        "split among supporting verifiers), challenger stake returned, request",
        "Rejected (bounty refundable via `expire_request`).",
        "Otherwise, once the challenge window since the dispute opened has",
        "elapsed, the provider wins and receives the challenger's stake."
      ],
      "discriminator": [
        231,
        6,
        202,
        6,
        96,
        103,
        12,
        230
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "request",
          "writable": true
        },
        {
          "name": "dispute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101
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
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "request.provider",
                "account": "request"
              }
            ]
          }
        },
        {
          "name": "providerOwner",
          "writable": true
        },
        {
          "name": "challenger",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "setVerifierActive",
      "discriminator": [
        110,
        160,
        142,
        137,
        87,
        162,
        141,
        124
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "verifierRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  105,
                  102,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "verifier_record.verifier",
                "account": "verifierRecord"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "stakeProvider",
      "discriminator": [
        18,
        199,
        109,
        78,
        14,
        224,
        5,
        119
      ],
      "accounts": [
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "submitReceipt",
      "docs": [
        "Must be preceded (immediately) by an Ed25519Program instruction that",
        "verifies `signature` by the provider over the canonical receipt bytes."
      ],
      "discriminator": [
        172,
        84,
        119,
        35,
        195,
        154,
        214,
        176
      ],
      "accounts": [
        {
          "name": "request",
          "writable": true
        },
        {
          "name": "receipt",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "providerOwner",
          "writable": true,
          "signer": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
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
        }
      ]
    },
    {
      "name": "transferAuthority",
      "discriminator": [
        48,
        169,
        76,
        72,
        229,
        180,
        55,
        161
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "unstakeProvider",
      "discriminator": [
        3,
        113,
        230,
        51,
        82,
        247,
        160,
        38
      ],
      "accounts": [
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "attestation",
      "discriminator": [
        152,
        125,
        183,
        86,
        36,
        146,
        121,
        73
      ]
    },
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
      "name": "dispute",
      "discriminator": [
        36,
        49,
        241,
        67,
        40,
        36,
        241,
        74
      ]
    },
    {
      "name": "provider",
      "discriminator": [
        164,
        180,
        71,
        17,
        75,
        216,
        80,
        195
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
      "name": "verifierRecord",
      "discriminator": [
        122,
        137,
        61,
        52,
        254,
        80,
        137,
        229
      ]
    }
  ],
  "events": [
    {
      "name": "attested",
      "discriminator": [
        184,
        102,
        113,
        199,
        220,
        197,
        96,
        50
      ]
    },
    {
      "name": "auditRootAnchored",
      "discriminator": [
        38,
        243,
        224,
        27,
        210,
        108,
        174,
        45
      ]
    },
    {
      "name": "configUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "disputeOpened",
      "discriminator": [
        239,
        222,
        102,
        235,
        193,
        85,
        1,
        214
      ]
    },
    {
      "name": "disputeResolved",
      "discriminator": [
        121,
        64,
        249,
        153,
        139,
        128,
        236,
        187
      ]
    },
    {
      "name": "expired",
      "discriminator": [
        197,
        227,
        104,
        103,
        133,
        50,
        207,
        161
      ]
    },
    {
      "name": "finalized",
      "discriminator": [
        4,
        77,
        242,
        80,
        20,
        152,
        247,
        252
      ]
    },
    {
      "name": "initialized",
      "discriminator": [
        208,
        213,
        115,
        98,
        115,
        82,
        201,
        209
      ]
    },
    {
      "name": "providerRegistered",
      "discriminator": [
        38,
        209,
        137,
        78,
        185,
        19,
        147,
        14
      ]
    },
    {
      "name": "providerStaked",
      "discriminator": [
        151,
        129,
        128,
        209,
        68,
        84,
        31,
        248
      ]
    },
    {
      "name": "providerUnstaked",
      "discriminator": [
        118,
        159,
        47,
        86,
        193,
        154,
        153,
        190
      ]
    },
    {
      "name": "receiptSubmitted",
      "discriminator": [
        31,
        197,
        41,
        7,
        67,
        165,
        35,
        15
      ]
    },
    {
      "name": "requestClaimed",
      "discriminator": [
        48,
        120,
        100,
        163,
        242,
        237,
        68,
        230
      ]
    },
    {
      "name": "requestCreated",
      "discriminator": [
        102,
        44,
        0,
        225,
        163,
        110,
        167,
        187
      ]
    },
    {
      "name": "verifierRegistered",
      "discriminator": [
        203,
        97,
        26,
        57,
        161,
        104,
        177,
        144
      ]
    },
    {
      "name": "verifierStatusChanged",
      "discriminator": [
        45,
        149,
        48,
        91,
        23,
        125,
        24,
        223
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidParams",
      "msg": "Invalid configuration parameters"
    },
    {
      "code": 6001,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6002,
      "name": "invalidStatus",
      "msg": "Request is not in the required status for this action"
    },
    {
      "code": 6003,
      "name": "deadlineInPast",
      "msg": "Deadline must be in the future"
    },
    {
      "code": 6004,
      "name": "deadlinePassed",
      "msg": "Request deadline has passed"
    },
    {
      "code": 6005,
      "name": "deadlineNotReached",
      "msg": "Request deadline has not passed yet"
    },
    {
      "code": 6006,
      "name": "zeroBounty",
      "msg": "Bounty must be greater than zero"
    },
    {
      "code": 6007,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6008,
      "name": "insufficientStake",
      "msg": "Provider stake is below the minimum"
    },
    {
      "code": 6009,
      "name": "providerInactive",
      "msg": "Provider is not active"
    },
    {
      "code": 6010,
      "name": "providerHasActiveJobs",
      "msg": "Provider has active jobs and cannot unstake"
    },
    {
      "code": 6011,
      "name": "notAssignedProvider",
      "msg": "Signer is not the provider assigned to this request"
    },
    {
      "code": 6012,
      "name": "accountMismatch",
      "msg": "Account does not match the request"
    },
    {
      "code": 6013,
      "name": "invalidSignatureInstruction",
      "msg": "Missing or malformed Ed25519 signature-verification instruction"
    },
    {
      "code": 6014,
      "name": "signatureMismatch",
      "msg": "Ed25519 instruction does not match provider key, signature or receipt message"
    },
    {
      "code": 6015,
      "name": "providerCannotAttest",
      "msg": "The provider cannot attest to its own receipt"
    },
    {
      "code": 6016,
      "name": "providerCannotDispute",
      "msg": "The provider cannot dispute its own receipt"
    },
    {
      "code": 6017,
      "name": "claimMatchesReceipt",
      "msg": "Claimed output hash equals the receipt output hash"
    },
    {
      "code": 6018,
      "name": "challengeWindowOpen",
      "msg": "Challenge window has not elapsed"
    },
    {
      "code": 6019,
      "name": "quorumNotReached",
      "msg": "Not enough matching attestations to finalize"
    },
    {
      "code": 6020,
      "name": "invalidEvidence",
      "msg": "Invalid evidence accounts supplied to resolve_dispute"
    },
    {
      "code": 6021,
      "name": "duplicateVerifier",
      "msg": "Duplicate verifier in evidence"
    },
    {
      "code": 6022,
      "name": "providerAccountRequired",
      "msg": "Provider account required for a claimed request"
    }
  ],
  "types": [
    {
      "name": "attestation",
      "docs": [
        "seeds: [\"attestation\", request, verifier]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "verifier",
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
            "name": "matches",
            "type": "bool"
          },
          {
            "name": "counted",
            "docs": [
              "true if the verifier was an active registered verifier (counts toward quorum)."
            ],
            "type": "bool"
          },
          {
            "name": "attestedAt",
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
      "name": "attested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "matches",
            "type": "bool"
          },
          {
            "name": "counted",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "auditRootAnchored",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
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
      "name": "configParams",
      "type": {
        "kind": "struct",
        "fields": [
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
          }
        ]
      }
    },
    {
      "name": "configUpdated",
      "type": {
        "kind": "struct",
        "fields": [
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
          }
        ]
      }
    },
    {
      "name": "dispute",
      "docs": [
        "seeds: [\"dispute\", request]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "challenger",
            "type": "pubkey"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "claimedOutputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "disputeStatus"
              }
            }
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "resolvedAt",
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
      "name": "disputeOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "challenger",
            "type": "pubkey"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "claimedOutputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "disputeResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "challengerWon",
            "type": "bool"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "slashed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "disputeStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "challengerWon"
          },
          {
            "name": "providerWon"
          }
        ]
      }
    },
    {
      "name": "expired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "refunded",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "finalized",
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
            "name": "bounty",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initialized",
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
          }
        ]
      }
    },
    {
      "name": "provider",
      "docs": [
        "seeds: [\"provider\", owner]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "completed",
            "type": "u32"
          },
          {
            "name": "slashed",
            "type": "u32"
          },
          {
            "name": "activeJobs",
            "type": "u32"
          },
          {
            "name": "active",
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
      "name": "providerRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "provider",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "providerStaked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalStake",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "providerUnstaked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalStake",
            "type": "u64"
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
      "name": "receiptSubmitted",
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
      "name": "requestClaimed",
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
          }
        ]
      }
    },
    {
      "name": "requestCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
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
            "name": "bounty",
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
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
      "name": "verifierRecord",
      "docs": [
        "seeds: [\"verifier\", verifier]. Only attestations from active registered",
        "verifiers count toward the quorum (Sybil resistance)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "attestations",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "verifierRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "verifierStatusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
