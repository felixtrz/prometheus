# Round 3: progression and intuitiveness

Judge: VR UX (progression), 2026-09-29.

**Method:** code, tour screenshots, and four headless Quest 3 probes (`judges3/progress/probe-{a,b,c,d}.ts`). The voice is judged on subtitles; audio is **pending** (Drawcall sign-in), not a regression.

## 1. The nine complaints

| # | Complaint | R2 | R3 | Evidence |
|---|---|---|---|---|
| 1 | Snap to hand; pass between hands | Resolved | **Resolved** | Hold code unchanged; not re-tested. |
| 2 | Getting sticks; the axe can't chop trees | Partial | **Resolved** | Probe A: a waist swing at the nearest small pine gave 3 chops and 2 sticks, and a knee swing chops too. An overhead swing (tip at 2.49 m) and a slow tap each knock (thud and buzz). The `chop` line states the rule. |
| 3 | Too much at the start | Partial | **Resolved** | The opening toast is folded into the intro: one subtitle with the task at t = 1.4 s, a grab nudge at 17 s, and lore only after the fire. |
| 4 | Look-alikes | Partial | **Resolved** | Probe B: each of the 17 forage nodes is one source mesh plus one waiting item. The item glints within 14 m and rims on hover. |
| 5 | Backpack flips on drop | Resolved (code) | **Resolved (code)** | Unchanged. |
| 6 | Sentry doesn't shoot | Resolved | **Resolved, stronger** | 3 starter bolts, a positional dry click and an empty line. Sleeping by a cold fire is allowed with a penalty, which removes a soft-lock. |
| 7 | Guide audio; damage and hunger cues | Partial | **Cues resolved; voice pending** | 0 of 40 clips are ready. Subtitles carry every line. |
| 8 | Items fall into the crate | Resolved | **Resolved** | Unchanged. |
| 9 | New journey / refresh | Resolved | **Resolved** | Unchanged. |

## 2. Scores

| Area | R2 | R3 | Why |
|---|---|---|---|
| Onboarding | 5 | **7** | Task at 1.4 s, the lighter how-to on grab, lore after the fire. The lighter itself never sparkles (issue 1). |
| Discoverability | 5 | **7** | Every source is named, and forage glints. Directions are compass words with no compass, and recipes still read "???". |
| Objective clarity | 7 | **8** | Wrist hints run 47–60 characters and keep their verbs and sources. NOW, Tonight and Next are correct. |
| Interaction affordances | 6 | **8** | The forage copies are gone, the rim is constant-width, loose items sparkle, and the tree band runs 0.1–2.3 m. Packed items never sparkle. |
| Feedback | 7 | **8** | Every trunk contact answers, the sentry clicks dry, and the cold-sleep toast explains the penalty. |
| Progression curve | 7 | **8** | The same 0/1/3/5 wolf ramp. A 3-bolt sentry raises the stakes, and the cold-sleep rule removes the last dead end. |
| UI legibility | 5 | **7** | At 1.4 m the toast body is 0.95° (was 0.61°) and the subtitle 1.05°. When you look down, the subtitle lands on the fire or the pot (`opening-02`, `opening-04`). |

## 3. Remaining issues, ranked

**1. The first task's object never sparkles.**
- Evidence: probe D spent 15 s at spawn. The pack, a stick and the hammer sparkled 4 times each. The lighter, 2.6 m away in `pack-4`, never did: `sparkle()` skips any slot other than `''` (`fx-system.ts:507`).
- Fix: let a packed item sparkle when it is the current objective's key item: the lighter for `light-fire`, meat and mushroom for `eat-meal`, the page while `note` waits.

**2. Compass words, no compass.**
- Evidence: hints, wrist lines and the `spear` and `hungry` lines say "west", "east" and "north". Facing east from camp (probe C), the board and trees fill the view, and neither the brook nor the meadow shows. Only the Spire (north) is visible.
- Fix, either:
  - Anchor directions to the Spire ("Brook: right of the Spire trail").
  - Add a wrist needle toward `OBJECTIVE_TARGET`, which `guide-system.ts` already defines.

**3. Unlearned recipes are a dead end.**
- Evidence: the board still reads "??? / not yet learned" (`journal-system.ts:493`, `opening-04`). This round-2 fix was not applied.
- Fix: show where the page lies ("Page 4, by the brook").

**4. How-to lines outlive the task.**
- Evidence (probe A): the 9.3 s lighter line started at 46.1 s and the fire lit at 50.5 s. About 5 s of "hold the flame in the tinder" played over a burning fire, and the `fire` instruction slipped to 57.7 s. `purgeStale` checks only queued lines.
- Fix: when the speaking line's `unless` comes true, fade its subtitle within about 1 s and start the next line.

**5. The cord hides in the reeds.**
- Evidence: it spawns inside the stems, at the clump's centre. From 2 m it is barely visible (probe B screenshot). Grabbing the stems does nothing.
- Fix: spawn it 0.3 m in front of the stems, on the bank side.

**6. The sentry wrist line drops the recipe.**
- Evidence: "Spring: outpost crate. Trigger: lookout. Set it by the fire." has no plank and no bench.
- Fix: "Bench: trigger, spring, plank. Spring: crate; trigger: lookout."

**7. The shade stays in view through the camp lore.**
- Evidence: `fire`, `myth` and `note` (31 s together) each placed it at exactly 35°, 2.6 m away. The preferred 42° and 50° spots were refused. Minor: it crosses no sightline.
- Fix: for lines of priority 5 or lower, try the 55–64° spots first.

**Also:**
- Nothing teaches that trees give sticks before your first swing. A `grab:axe` line would.
- `sleep-ready` needs a lit fire, so after a cold-fire night the shade never offers sleep.

**Pending:** 0 of 40 voice clips. Once they exist, re-check the pacing against the 2.3 words-per-second estimate the subtitles use now.
