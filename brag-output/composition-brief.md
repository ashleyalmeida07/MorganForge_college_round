# Hyperframes Composition Brief: Verity

## Objective
Create a short launch-style brag video for Verity.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21s

## Source Material
- Project root: `D:/Projects/verity`
- Primary files read: `frontend/src/app/page.tsx`, `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`, `frontend/src/app/verify/[pda]/page.tsx`, `frontend/src/components/verify/{StatusStepper,ShareCard,BrowserVerifyPanel,CommitmentsTable}.tsx`, `README.md`
- Product name: Verity
- Tagline / strongest claim: "Prove computation without the risk." / "Don't trust the provider. Check the work."
- Key UI to recreate: the verify page header card + StatusStepper (emerald done / red failed), the "Verify in my browser" button, the red OUTPUT_MISMATCH result, the green "VERIFIED IN YOUR BROWSER" panel, the ShareCard QR
- Copy that must appear verbatim:
  - "Prove computation without the risk."
  - "Blockchain Verified on Solana"
  - "Verify in my browser"
  - "Re-executing the program produced a different output than the provider's signed receipt."
  - "VERIFIED IN YOUR BROWSER"
  - "Anyone can scan and re-verify — no login."
  - "Don't trust the provider. Check the work."

## Creative Direction
- Tone preset: cinematic
- Creative direction: a trust thriller: the one-second "uh oh" when the hashes don't match
- Interpretation: big confident Geist type, restrained motion, a single red drama spike, light product palette (not a dark crypto trailer)
- Angle: a provider fakes a payroll result. Verity re-runs it in the browser, the hashes disagree, the stepper turns red and the provider is slashed. Then the honest path goes green and is shareable by QR.
- Hook: signed receipt card plus "Do you trust it?"
- Outro / punchline: "Don't trust the provider." / "Check the work." → Verity logo, "Live on Solana devnet"
- Avoid: generic SaaS language, abstract filler, a dark neon crypto restyle

## Visual Identity
- Background: #f8faff; hero gradient `linear-gradient(180deg,#edf2f9 0%,#ffffff 18%,#f6f8fc 40%,#dce8f8 60%,#bad3f6 74%,#94bcf4 86%,#76a3f0 100%)`
- Text: #0f172a (slate-900), #475569 (slate-600), #64748b (slate-500)
- Accent: #2563eb; shimmer gradient #2563eb/#0284c7/#38bdf8/#60a5fa/#1d4ed8; success #10b981; fraud #ef4444
- Display/body font: Geist (Google Fonts) with system sans fallback; monospace for hashes
- Visual refs: hero pill + shimmer headline, rounded-2xl white cards with slate-200 borders, StatusStepper circles, logo `assets/img/logo.svg`

## Storyboard
Creative contract: `brag-plan.md`.
1. The receipt — 0–3.0s — receipt card and "Do you trust it?" (on 1.60s)
2. Reveal — 3.0–6.4s — hero: pill, shimmer headline (on 3.70s)
3. The flow — 6.4–10.2s — verify card and stepper filling 4 nodes on beats
4. The catch — 10.2–14.8s — cursor click, then Re-executing…, then the red banner (12.65s), then Disputed/Rejected, then "Provider slashed"
5. Honest path — 14.8–17.9s — green verified panel and QR ShareCard
6. Outro — 17.9–21.0s — two-line CTA, then the logo lockup

## Audio
- Role: cinematic support; vol-11 bed at 0.35, duck around the fraud hit, fade out over the last 1.5s
- Music cue guidance: `<skill-dir>/assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json`. Locks: 1.60, 12.65, 17.91; stepper grid 6.86/7.38/7.91/8.44
- Audio-reactive: subtle. The shimmer glow and the live dot breathe with the bass
- SFX (copied to `assets/sfx/`): impactSoft_medium_001 (hero reveal), drop_001/002 (stepper nodes), mouseclick1 (button), impactSoft_heavy_002 (fraud banner), impactWood_heavy_001 (slashed stamp), impactGlass_light_002 (verified), impactBell_heavy_003 (logo)
- Restraint: the fraud hit is the loudest sound; no whoosh on every cut

## Hyperframes Instructions
Build with hyperframes-core/animation/creative/keyframes/cli conventions. Show real UI, keep text readable, 21s, include music and SFX, and run `hyperframes check` before render.
