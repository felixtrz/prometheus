# Round 4: progression and intuitiveness

Judge: VR UX (progression), 2026-09-29.

**Method:** code, the round-4 tour, and four headless Quest 3 probes (`judges4/progress/probe-{a,b,c,d}.ts`). 0 of 41 voice clips exist, so the voice is **pending** (Drawcall sign-in) and judged on subtitles.

## 1. The nine complaints

| # | Complaint | R3 | R4 | Evidence |
|---|---|---|---|---|
| 1 | Snap to hand; pass between hands | Resolved | **Resolved** | Unchanged; not re-tested. |
| 2 | Getting sticks; the axe can't chop trees | Resolved | **Resolved** | `chop` now also plays when the axe is taken up. |
| 3 | Too much at the start | Resolved | **Resolved** | Probe A: the intro at 1.4 s, the grab nudge at 17.2 s. The lighter beckons from the pack 7 times in 15 s. |
| 4 | Look-alikes | Resolved | **Resolved** | The cord lies in front of the reeds (`expedition-06`). |
| 5 | Backpack flips on drop | Resolved (code) | **Resolved (code)** | Unchanged. |
| 6 | Sentry doesn't shoot | Resolved, stronger | **Resolved** | The wrist names the whole recipe: "Bench: trigger, spring, plank. Spring: crate; trigger: lookout." (63 characters). |
| 7 | Guide audio; damage and hunger cues | Cues resolved; voice pending | **Cues resolved; voice pending** | After the stew the wrist reads "Well fed 1:28" (probe A). |
| 8 | Items fall into the crate | Resolved | **Resolved** | Unchanged. |
| 9 | New journey / refresh | Resolved | **Resolved, stronger** | The end card shows a tally and "Wake again? Tap New journey below". |

## 2. Scores

| Area | R3 | R4 | Why |
|---|---|---|---|
| Onboarding | 7 | **8** | The lighter beckons. Its line was cut 0.1 s after the fire lit. The shade first appears at the edge of view (issue 2). |
| Discoverability | 7 | **8** | The landmark directions hold: up the trail from camp (probe B), the grove fork goes left, the meadow fork right, and the lookout and the Spire stand ahead. Recipes read "Page 4, on a rock by the brook". |
| Objective clarity | 8 | **9** | Wrist hints are 51–63 characters and keep the verb, the parts and the place. |
| Interaction affordances | 8 | **9** | Task items beckon from the pack, and the glints are bigger. After the fire, three beckon at once (issue 3). |
| Feedback | 8 | **9** | `grab`, `lighter`, `stir` and `bowl` were each cut within 0.2 s of their task being done. |
| Progression curve | 8 | **8** | Same 0/1/3/5 ramp. Sleep is now offered beside a cold fire too. |
| UI legibility | 7 | **8** | The subtitle stayed ≥ 16° from the fire's centre in every sample. It can cover the board, and the comfort labels are small (issue 4). |
| **OVERALL** | 7.6\* | **8.4** | \*Round 3 gave no overall. Both are the mean of the seven areas. |

## 3. Remaining issues, ranked

**1. The note line waits for its fallback timer.**
- Evidence (probe D): `done:myth+59` queued `note` for 100.7 s. The meal was done at 54.6 s and `eat` ended at 69.7 s, but `note` spoke at 101.4 s, not 2 s after `eat`. `request()` ignores a trigger for a line already queued, so the earlier one was lost.
- Fix: when the line is already queued, keep the earlier due time (`pending.at = min(pending.at, now + delay)`).

**2. The shade speaks from the edge of view.**
- Evidence (probes A and D): `intro` stood at 57–62°, `fire` at 63° and 3.4 m, and `eat` and `note` at 58°. Quest 3 shows about ±55°, so the first meeting is a glimpse (`opening-01`), with no voice yet to turn the head.
- Fix, either:
  - For lines of priority 7 or higher, try 35–45° first, accepting a spot whose only conflict is the board's sightline.
  - Add a small chevron on the subtitle's edge while the shade stands beyond 50°.

**3. Three beckons compete after the fire.**
- Evidence (probe A): in about 6 s after the fire lit, the page beckoned 4 times and the meat and mushroom 3 times each, while NOW read "Cook a meal".
- Fix: let page 1 beckon only once `eat-meal` is done, or once `note` has started.

**4. The subtitle covers the journal.**
- Evidence: in `opening-04` and probe C, the subtitle is drawn without depth, 15° under the gaze, and covers the board's vitals and buttons. At 1.3 m the comfort chip labels are 0.57° tall (1.62 units at 0.8 scale), and the recipe teasers 0.76°.
- Fix: while the gaze is on a panel within 2.5 m, move the subtitle below or above that panel. Raise the chip labels to 2.2 units and the recipe teasers to 2.5.

**5. Subtitles Off makes the shade silent.**
- Evidence: `speak()` returns whenever `settings.subtitles` is false. With no clips, one tap on the comfort card mutes every how-to line.
- Fix: show the subtitle whenever the line is not `voiced`.

**Also:**
- The fork signpost's boards are blank. Carve a pine (grove) on the left and a deer (meadow) on the right.
- The epilogue arrives at the Spire, 55 m from the board; only the wrist's "Go home" leads back to it. Add a toast on `epilogue`: "Your journal at camp holds the tally."

**Pending:** 0 of 41 voice clips. Once they exist, re-check the pacing (subtitles assume 2.3 words per second) and whether positional audio settles issue 2.
