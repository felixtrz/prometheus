# Round 4 review: story and Prometheus' shade

Narrative director, 2026-09-29. Durations use `estimateSeconds`; ids are in `src/game/voice-lines.ts`.

## 1. Scores

| Area | R3 | R4 | Why |
| --- | --- | --- | --- |
| Clarity and hook | 9 | **9** | Unchanged: the task comes first, the myth after the first fire. |
| Lore coherence | 8 | **9** | No early page quotes, the shade is canon, directions are landmarks. Only the spec lags (issue 5). |
| The shade | 8 | **9** | He marks pages 1, 2, 5 and 7, tells of the eagle, and rises away free after a followable farewell. |
| Guidance | 8 | **9** | Right verb on the lighter, `weak` in the fight, a real `beacon-cold`, journal teasers. The defence rule is swallowed (issue 2). |
| Pacing of reveals | 8 | **8** | `note` follows the meal; dusk speaks once. But the stale cut eats the torch's warning (issue 1), and a brisk player hears ~50 s of speech in the first 90 s. |
| Ending | 8 | **9** | A defended hold, a slip line, the farewell alone on screen; "Go home" leads to the tally at camp. |
| **Overall** | 8 | **9** | Every round-3 issue landed. Four text edits and one trigger remain. |

Round 3's overall (8) is the mean of its areas.

## 2. Resolution check

| Round-3 item | Status |
| --- | --- |
| 1. `lighter` verb | **Fixed**, and "answers only you" is gone. Spoken, "it" has no antecedent (issue 4). |
| 2. Dusk said it three times | **Fixed.** `dusk` covers `key:dusk` and `key:stage`, and `wolf` carries the news word for word. |
| 3. Name vs the pot | **Fixed.** `note` is on `done:eat+2`, with two fallbacks. |
| 4. Farewell compass | **Fixed** word for word. From the Spire, the smoke (scene position 6, 14, 34) rises behind camp. |
| 5. Silent hold | **Fixed, and better than asked:** `beacon-slip` also fires on `beacon-pressed`. The wording needs work (issue 3). |
| 6. `weak` | **Fixed** word for word, at priority 9. |
| 7. Echoes | **Fixed.** `spear` names the fork, `sentry-kit` is word for word, and canon item 7 is in. |
| `beacon-cold` on toast text | **Fixed.** It polls for a lit torch tip at the beacon before page 5 (guide-system.ts:766). |

In the shots, finale-12 shows `beacon` with no toast, and finale-13 the shade silent under "A flame carried." opening-04 shows `torch` still speaking after its objective is ticked, which is issue 1.

## 3. Top remaining issues

**1. Lighting the torch cuts its warning.**
- `torch` has `unless: 'torch-lit'`, and lighting the torch completes the objective at once (story-system.ts:123).
- The fire is 2.4 m from the bench, and ignition takes 0.65 s. A player who read page 1 lights the torch 3–5 s into an 11.5 s line.
- `cutStale` fades it before "the dark sees it too", the only advance warning that fire lures.
- **Fix:** split it; add a `torch-lit` case to `triggersOf` (the bus event exists).

> `torch` (keep the `unless`): "A torch. Hold its head in the fire until it catches." (5.4 s)
>
> `torch-lit` (new, `on: ['torch-lit+1']`, priority 6): "Carried flame holds back the dark, keeper. But know this: the dark sees it too." (7.1 s)

**2. The hold's defence rule is never shown.**
- `beacon` covers the "Hold the flame steady" toast, and a covered toast is dropped once its line speaks (toast-system.ts:678).
- The toast's body, "Keep your other hand free: the Hollow will try to smother it", is the only place the rule lives.
- The player learns it from `beacon-slip`, after losing progress.

> `beacon`: "Hold it there, keeper. They will try to smother it: keep your other hand free to drive them off." (8.9 s)

**3. `beacon-slip` opens with an order it doesn't mean.** Mid-fight, "Let go and it cools" is heard as "Let go". Lead with the fix, covering both causes:

> `beacon-slip`: "It is cooling, keeper. Keep your flame in the stone, and drive them from it." (7.1 s)

**4. `lighter` has no spoken antecedent.** Voice-only, "Hold it down" sounds like "lower the lighter". The crossbow line already names the finger:

> `lighter`: "Keep your finger pressed: its flame lives only while you do. Hold that flame in the tinder under the logs." (9.3 s)

**5. The spec has drifted (docs only).**
- Canon 7 says he speaks "never while the Hollow are near", yet `weak`, `respawn`, `beacon` and `beacon-slip` do by design. Write "only to keep the keeper alive, or at the beacon".
- M21 and canon 5 still say "south".
- `ENDING.body` (story.ts) is shown nowhere now. Delete it.

Issues 1–4 are text edits plus one `triggersOf` case. Every rewritten line needs its clip regenerated.
