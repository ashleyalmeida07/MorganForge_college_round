# Brag Plan: Verity

## What is this app?
Verity lets you hand a computation to an untrusted provider, then re-run it yourself (in the browser), compare hashes against Solana, and slash the provider on-chain if they lied.

## The angle
"Don't trust the provider. Check the work." (the site's own CTA). The video is a short heist that goes wrong: a provider fakes a payroll result, Verity re-executes it in the browser, the hashes don't match, the stepper turns red, and the provider loses their stake. Then we show the honest path: green, verified, shareable by QR. The impressive part is the catch, so the catch is the centrepiece.

## Hook (first 2-3 seconds)
Big black-on-white type, a signed receipt card slides in: `Payroll result · signed by provider`. Then the line **"Do you trust it?"** It sets up a question the rest of the video answers.

## Key moments (the middle)
- The real StatusStepper from `/verify/[pda]` filling in node by node: Created → Claimed → Receipt → Attestations, each turning emerald.
- Cursor clicks **"Verify in my browser"**, the button switches to "Re-executing…", and a red OUTPUT_MISMATCH banner slams in with the app's real copy: "Re-executing the program produced a different output than the provider's signed receipt."
- The stepper adds **Disputed** and then **Rejected** in red. A stamp reads "Provider slashed."
- The honest run gets the app's green "VERIFIED IN YOUR BROWSER" panel next to the ShareCard QR: "Anyone can scan and re-verify — no login."

## Outro / punchline
"Don't trust the provider." (hold) "Check the work." Then the Verity logo with a pulsing emerald dot: "Live on Solana devnet".

## User flow worth showing
Submit computation (commitments on Solana) → provider receipt plus verifier attestations, shown as the stepper filling → "Verify in my browser" re-executes and catches the fraud, or confirms it in green.

## Tone
- Preset: cinematic
- Creative direction: a trust thriller: the one-second "uh oh" when the hashes don't match
- Interpretation: big confident type and restrained motion, with one sharp red moment as the drama spike. The visuals stay clean and light like the product (not a dark crypto trailer).

## Format: landscape — 1920x1080
## Duration: 21s

## Visual identity (from the project)
- Background: #f8faff, with the hero gradient `linear-gradient(180deg,#edf2f9 0%,#ffffff 18%,#f6f8fc 40%,#dce8f8 60%,#bad3f6 74%,#94bcf4 86%,#76a3f0 100%)`
- Accent: #2563eb (blue-600). Shimmer text gradient #2563eb → #0284c7 → #38bdf8 → #60a5fa → #1d4ed8
- Success: emerald-500 #10b981. Fraud: red-500 #ef4444
- Text: slate-900 #0f172a, secondary slate-600 #475569
- Display font: Geist (400 for headline, as in the hero's font-normal)
- Body font: Geist; mono for hashes
- Strongest visual element: the "Prove computation without the risk." hero with the shimmering blue words over the sky gradient, plus the emerald/red StatusStepper
- Logo: `frontend/public/logo.svg`

## Share copy (draft)
Verity: hand your computation to a stranger, re-run it in your browser, and if they lied, Solana slashes them. Don't trust the provider. Check the work.

## Audio direction
- Role: cinematic support
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM)
- Music treatment: start at 0, moderate volume. Duck it briefly under the fraud slam (~10.5s), then bring it back up for the honest path, and fade out over the final 1.5s.
- Music cue guidance: preset read. Strong cues at 1.60s (hook question), 12.65s (fraud banner slam), 17.91s (outro line). Stepper nodes at ~6.86, 7.38, 7.91, 8.44 are fine because each node is an accent plus a 1–2 word label that stays on screen.
- Audio-reactive treatment: subtle. The emerald live dot and the shimmer glow can breathe with the bass.
- SFX posture: moderate and motion-matched. Soft ticks on stepper nodes, a click on the button, one low impact on the fraud banner, a light chime on verified.
- Audio-coupled moments: stepper fill, cursor click, red banner slam, "Provider slashed" stamp, green verified.
- Restraint rule: no whooshes on every cut. The fraud impact is the loudest sound in the video.

## Storyboard

### Scene 1 — The receipt — 3.0s
White/#f8faff. A receipt card slides up: "Payroll result · signed by provider", a mono hash `output 9f3a…c21e`, and "Ed25519 ✓". At ~1.6s the line "Do you trust it?" lands above it in large Geist.
Sequential/interaction: card first, then the question
Audio intent: curious, poised
Audio-coupled idea: question lands on the 1.60s strong cue
Transition mood: clean → Scene 2

### Scene 2 — Reveal — 3.4s
The hero recreation: sky gradient, pill "Blockchain Verified on Solana", headline "Prove **computation** / without the **risk.**" with the shimmering blue words, Verity logo top-left.
Sequential/interaction: pill, then the headline lines rising in
Audio intent: lift, confidence
Audio-coupled idea: headline on 3.70s strong cue
Transition mood: dramatic wipe/scale → Scene 3

### Scene 3 — The flow — 3.8s
The verify page card: "Verify a computation · Payroll", Bounty "0.05 SOL", plus the StatusStepper. Nodes fill one by one: Created → Claimed → Receipt → Attestations 2/2, each turning emerald with the connector line filling.
Sequential/interaction: yes. Four nodes on consecutive beats; the full set holds ≥1s after the last
Audio intent: momentum
Audio-coupled idea: soft tick per node
Transition mood: clean → Scene 4

### Scene 4 — The catch — 4.6s
Same page. "Verify in my browser" button; a cursor clicks it, it switches to "Re-executing…" with a spinner, then a red banner slams in: **OUTPUT_MISMATCH** with the app's copy "Re-executing the program produced a different output than the provider's signed receipt." The stepper adds Disputed and then Rejected in red. A stamp: "Provider slashed."
Sequential/interaction: yes. Simulated cursor click, then the banner, then the stepper going red, then the stamp. The banner sentence holds ≥2.5s
Audio intent: the drama spike
Audio-coupled idea: click sfx; impact on the banner at ~12.65s; stamp thud
Transition mood: hard → Scene 5

### Scene 5 — The honest path — 3.2s
Emerald panel "VERIFIED IN YOUR BROWSER" next to the ShareCard QR: "Public verification page · Anyone can scan and re-verify — no login."
Sequential/interaction: verified panel first, then the QR card
Audio intent: relief, resolution
Audio-coupled idea: light chime on verified
Transition mood: soft → Scene 6

### Scene 6 — Outro — 3.0s
"Don't trust the provider." then "Check the work." (on 17.91s), then the Verity logo plus wordmark and an emerald dot "Live on Solana devnet". Hold.
Sequential/interaction: two lines, then the lockup
Audio intent: confident close
Audio-coupled idea: line 2 on the strong cue, music fades
Transition mood: end

Total: 3.0 + 3.4 + 3.8 + 4.6 + 3.2 + 3.0 = 21.0s

**Music mood for this video:** upbeat-cinematic
**Audio summary:** A steady bed builds through the flow, cuts to a single heavy hit when the fraud is caught, resolves with a chime, and fades out on the logo.
