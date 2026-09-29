# Round 3 review: story and Prometheus' shade

Narrative director, 2026-09-29. Review only. Durations use `estimateSeconds`. Line ids are in `src/game/voice-lines.ts`.

## 1. Scores

| Area | R2 | R3 | Why |
| --- | --- | --- | --- |
| Clarity and hook | 8 | **9** | The first task is spoken ~3.4 s in, and the myth waits for the first success. |
| Lore coherence | 7 | **8** | The round-2 contradictions are gone. Small leaks: `spear` quotes page 4, and the canon omits the shade. |
| The shade | 6 | **8** | The motive is fixed, he speaks at the story beats and goes free. His name lands mid-cooking. |
| Guidance | 6 | **8** | Covers, hints, stale checks and the threat gate work. The first mechanic is taught with the wrong verb. |
| Pacing of reveals | 7 | **8** | Page lines wait for the page to go down. The first 90 s still hold ~47 s of speech. |
| Ending | 7 | **8** | Silent presence, a farewell with no toasts, rising embers. "Look south" can't be followed, and the hold is mostly silent. |

## 2. Resolution check

| Round-2 item | Status |
| --- | --- |
| 1. Toast duplication | **Fixed.** Covers are on the first-time lines, and the opening toast is title-only, covered by `intro`. `respawn` now adds to its toast rather than repeating it. New gap: the dusk stage toast (issue 2). |
| 2. Motive | **Fixed** in `myth`, word for word. **Open:** the canon in `design/GAME_SPEC.md` has no shade entry. |
| 3. Silent at the beats | **Fixed:** `page-2`, `page-5`, `page-7` and `beacon-cold` exist. But `beacon-cold` keys on the literal toast text (`TOAST_TRIGGERS`), so a copy edit at story-system.ts:229 silently kills it. Emit a real event. |
| 4. Ending | **Fixed.** No smoke toast, the line on `smoke+6`, embers rising to the Spire, no `welcome` after the ending. |
| 5. Monologue | **Mostly fixed.** The how-to intro, the gated `grab` and `page` on `page:1` are in. `myth` and `note` still stack (issue 3). |
| 6. Sentry | **Fixed.** It reads `SENTRY_STARTER_BOLTS` (three), matching combat-system.ts:162. |
| 7. Wolf and 8. Respawn | **Fixed**, word for word. |
| Contradictions | **All five fixed.** |

The shots confirm: the intro subtitle at the cold fire (opening-01), no words while bitten (night-10), the shade waiting silently beside the theme toast (finale-13).

## 3. Top remaining issues

**1. `lighter` teaches the wrong verb.**
- The flame lives only while the trigger is held (campfire-system.ts:221–223), but the line says "Press it". A single press leaves the lighter dead at the tinder; only the hint is right.
- Also drop "It answers only you": that is Ilse's discovery on page 7.

> `lighter`: "Press it and keep pressing: its flame lives only while you do. Hold that flame in the tinder under the logs." (108 ch, 9.7 s)

**2. The first dusk says "stay in the light" three times in ~30 s.**
- The stage toast (toast-system.ts:124, not covered), then `dusk`, then `wolf`.
- **Fix:** `dusk` covers `['key:dusk', 'key:stage']`, and `wolf` carries the toast's news. `wolves-stirring` needs stage ≥ 1, meaning a torch was made, so the claim holds.

> `wolf`: "The Hollow. I knew them as wolves, before the first fire. Your carried flame called them. If one comes close, thrust your torch at it." (134 ch, 11.5 s)

**3. His name competes with the pot.**
- `fire` ends "Now eat…". Then `myth` (10.6 s) and `note` ("Read it, keeper") follow within ~25 s, while the player's hands are on the pot.
- **Fix:** keep `myth` on `done:fire+1.5`, since it asks nothing. Move `note` to `on: ['done:eat+2']`: page 1 teaches the torch, the next objective. The first 90 s drop to ~39 s of speech.

**4. The farewell points to a compass the player doesn't have.** At the Spire the player faces the beacon; camp, "the way you came", lies south.

> `ending`: "Look back the way you came: smoke. Someone made it out. The fire is everyone's again, and I am free. Go home, keeper. Yours is burning." (135 ch, 11.9 s)

**5. The hold lasts 24 s; he speaks for 6.**
- Letting go costs 0.08 progress/s (rules.ts:82), and nothing says so.
- **Fix:** emit a `beacon-slipping` trigger when progress falls after passing 0.25. Add a priority-9 line on it, which gets past the threat gate:

> `beacon-slip`: "It cools without you, keeper, but slowly. Drive them back, then give the stone its flame again." (95 ch, 8.0 s)

**6. `weak` is gated out of the fight that causes it.** At priority 8, below `THREAT.priority`, it speaks after the danger or not at all. Make it priority 9 and short:

> `weak`: "You are close to falling, keeper. Get to the fire, now." (55 ch, 5.4 s)

**7. Small echoes.**
- `spear` quotes Rennick's page 4 before it is found:

> `spear`: "A spear: thrust it, or throw it and let go. Deer graze in the meadow east of camp. Go slowly; haste is what they flee." (118 ch, 11.5 s)

- `sentry-kit` and `sentry` both say "stands loaded", seconds apart:

> `sentry-kit`: "Set the kit down low, on open ground near the fire. It will stand and keep watch while you sleep." (97 ch, 9.3 s)

- Add item 7 to the canon: "Prometheus' shade is bound to every stolen flame. He guides the keeper, and goes free when the Spire's fire is given back."

All of these are text and trigger edits except issue 5, which needs one new bus trigger. No architecture changes are needed.
