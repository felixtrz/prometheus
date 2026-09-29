# Round 3: gameplay and fun

Date: 2026-09-29. **Method:** 18 emulated-Quest probes (`judges3/gameplay/` in the session scratchpad). Fixtures set only the situation. "Quick" players react to a growl in 0.45 s and turn in 0.2 s. "Slow" players take 0.75 s and 0.35 s.

## 1. Scores

| Axis | R2 | R3 | Why |
| --- | --- | --- | --- |
| Overall fun | 6 | **7** | Nights reward vigilance. A dead fire costs one death, not five. The finale is still won by standing still. |
| Core loop | 7 | **7** | Bolt pickup and stew close loops. The stew buff is invisible. |
| Pacing | 5 | **6** | Dusk to sleep takes 82 s (was 105), and wolf waves fill it. The ending is empty. |
| Challenge and tension | 4 | **7** | Outcomes scale with skill, not with stage. |
| Agency and variety | 5 | **6** | Kit changes the finale: 60 HP lost passive, 20 poking, 0 armed. |
| Physical feel | 7 | **8** | 4–10 torch pokes a minute. The feint reads well. |
| Reward and payoff | 7 | **7** | The dark sky helps. The hold is a metronome. |

## 2. Re-measured

**Torch nights:** 60 s spent 10 m outside the ring.

| Stage | Passive | Slow | Quick |
| --- | --- | --- | --- |
| 1 | dead at 52 s (5 bites) | – | 0 bites, 4 scares |
| 2 | dead at 41 s | 3 bites | 0 bites, 10 scares |
| 3 | dead at 33 s | 2 bites | 0 bites, 8 scares |

Round 2 measured 0 bites whatever the player did.

**Dead fire, stage 3:**

- **Fuel 60 at dusk:** slept at 35% of the night, no bites. Round 2 had 5 deaths.
- **Fuel 20:**
  - The fire dies at 38 s, then 5 bites in 19 s, and death at 61 s.
  - The fire is relit to 29, and the player slept at 67 s, waking at 86 HP.
  - With a torch the player also died once, then slept.
  - Cold sleep was always refused: wolves were within 2–3 m.
- **Sentry:** 3 shots, 3 kills in 38 s, then dry.

**Finale** (22 s walk from camp):

| Mode | Hold | Bites | Lowest HP |
| --- | --- | --- | --- |
| Passive | 23.8 s | 3 (6.7, 13.0, 19.4 s) | 40 |
| Passive, arriving at 60 HP | died at 80% | 3 | 0 |
| Quick poke | 30.9 s | 1 | 80 |
| Sentry + crossbow | 23.8 s | 0 (8 of 8 killed) | 100 |

A stage-1 passive hold is identical: bites at 6.8, 13.1 and 19.5 s, ending at 40 HP.

## 3. Round-2 top 8

| # | Issue | Status |
| --- | --- | --- |
| 1 | Torch makes you immune | **Resolved.** Passive players die; quick players take 0 bites. |
| 2 | Dead-fire spiral | **Overcorrected.** One death, then sleep. |
| 3 | Bites chain | **Resolved.** At least 3.2 s apart. |
| 4 | Finale lasts 3 s | **Partly resolved.** About 20 s of pressure, but a passive player always wins. |
| 5 | Tools make the ending harder | **Resolved.** Fixed waves, and the stage no longer matters. |
| 6 | Sentry empties the night | **Partly resolved.** Still kills 3 of 5 wolves, then needs a reload. |
| 7 | Dead waits, empty ending | **Partly resolved.** Waits are shorter; nothing after the ending. |
| 8 | Close-combat verbs never fire | **Resolved.** Pokes, bolt pickup and the stew buff all work. |

## 4. Top remaining issues

### 1. Standing still wins the finale

- **Evidence:**
  - Bite times and the final 40 HP are identical in every passive hold.
  - Only 3 of the 8 guardians ever attack.
  - With arms, all 8 die without a bite.
  - The toast and page 7 both say "Hold anyway".
- **Fix:**
  - Guardians that are circling within 6 m smother the beacon at 0.01 progress/s each.
  - Each bite costs 0.05 progress.
  - Wave-3 gap 4 s → 2.5 s.
  - Target a passive hold ending at about 20 HP.
  - Toast: "Hold. Keep a hand free."

### 2. Death is a free ticket to sleep

- **Evidence:** Sleep comes 2–7 s after the respawn, waking at 86 HP.
- **Fix:** After a death, that night's sleep counts as cold (−15 HP, −25 hunger).

### 3. More wolves don't threaten a vigilant player

- **Evidence:** Quick players took 0 bites at every stage. Slow players took 3 bites at stage 2 but only 2 at stage 3. The second stage-3 attack slot never produced two attacks at once.
- **Fix:**
  - At stage 3, a second wolf may crouch behind the player while one feints in front.
  - Crouch 0.8 s → 0.65 s.

### 4. The stew buff is invisible

- **Evidence:**
  - Nothing displays the `'well-fed'` event.
  - Yet the buff is what keeps a 60-HP arrival alive at the finale: it adds about 8 HP of margin.
- **Fix:**
  - A wrist pip with a countdown.
  - A toast: "Well fed: you mend."

### 5. The ending is a dead end

- **Evidence:** No wolves or goals after `ended` (`creature-system.ts:509`).
- **Fix:** Stage-1 nights resume, plus a "Relight the valley (n/4)" brazier tally.

### 6. The sentry never misses

- **Evidence:** 3 shots and 3 kills in this run; 4 shots and 4 hits in the scenario run.
- **Fix:** 70% hit chance beyond 8 m. Missed bolts can be picked up, so the night becomes collecting and reloading.
