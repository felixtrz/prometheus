# Round 4: gameplay and fun

Date: 2026-09-29. **Method:** 20 emulated-Quest probes (`judges4/gameplay/`), plus the scenario and balance logs. Quick players react in 0.45 s, slow players in 0.75 s.

## 1. Scores

| Axis | R3 | R4 | Why |
| --- | --- | --- | --- |
| Overall fun | 7 | **8** | The finale is a fight won with your off hand. |
| Core loop | 7 | **8** | Kit, wood and stew each change an outcome. |
| Pacing | 6 | **7** | The epilogue closes the arc; a death costs 60 s of fire-tending. |
| Challenge and tension | 7 | **8** | Passive holds die. Stage 3 nights bite even quick players. |
| Agency and variety | 6 | **7** | Seven loadouts, four outcomes. The crossbow dominates. |
| Physical feel | 8 | **8** | Torch in the beacon, defence in the other hand: the best moment. The instinctive jab loses. |
| Reward and payoff | 7 | **8** | An earned win, a tally, a fire that keeps burning. |

## 2. Re-measured

**Finale** (stage 3, arriving at 100 HP unless noted; the walk is 22 s):

| Loadout | Result | Bites | Lowest HP |
| --- | --- | --- | --- |
| Passive (twice, and at stage 1) | died at 25.9 s, 59% progress | 5 | 0 |
| Passive, arriving at 60 HP | died at 16.5 s, 50% | 3 | 0 |
| Second torch held still | died at 24.6 s, 61% | 5 | 0 |
| One torch, quick pokes | died at 52.8 s, peak 77% (12 scares) | 5 | 0 |
| Sentry, 3 starter bolts | died at 30.5 s, 86% | 5 | 0 |
| Second torch, quick / slow | won in 28.5 / 25.3 s | 3 / 2 | 40 / 60 |
| Second torch, 60 HP | won in 26.4 s | 2 | 20 |
| Crossbow, slow | won in 25.0 s, 6 kills | 1 | 80 |
| Sentry and crossbow | won in 23.7 s, 8 of 8 killed | 0 | 100 |

- **After a win** (clock forced to night, 30 s): 0 wolves, fire lit at 100 fuel, epilogue tally shown.
- **After a failed hold:** you wake at camp, 53 m away. The torch stays lit in the brazier; progress is 0 in 10 s.

**Torch nights** (60 s, 10 m out):

| Stage | Passive | Slow | Quick |
| --- | --- | --- | --- |
| 1 | – | – | 0 bites (R3: 0) |
| 2 | – | 2 bites (R3: 3) | 0 (R3: 0) |
| 3 | dead at 46 s (R3: 33 s) | 3 bites (R3: 2) | 3 bites (R3: 0) |

Paired crouches: 2–3 a minute, mostly 149–179° apart.

**Dead fire** (stage 3, fuel 20 at dusk):

- **Standing still:** the fire dies at 39 s, you at 62 s. The relit fire (fuel 29) dies 42 s after the respawn, inside the 60 s "Too shaken". Second death at 121 s; 9 bites, no sleep.
- **Feeding one log after the respawn:** 1 death, sleep at 79% of the night, 100 HP.

**Sentry night:** 3 shots, 2 kills, dry at 13 s; slept at 35% with 0 bites.

## 3. Round-3 issues

| # | Issue | Status |
| --- | --- | --- |
| 1 | Standing still wins the finale | **Resolved.** Passive holds die at 59%. |
| 2 | Death is a free ticket to sleep | **Resolved, overshoots.** Without wood, you die twice (issue 2). |
| 3 | Vigilance beats any pack | **Resolved at stage 3.** Stage 2 is unchanged. |
| 4 | Stew buff invisible | **Resolved** (code; the progression judge saw "Well fed 1:28"). |
| 5 | Ending is a dead end | **Resolved differently.** An epilogue and New journey replace the post-game. |
| 6 | Sentry never misses | **Resolved.** 2 of 3 here; 77% over 66 shots. |

## 4. Top remaining issues

### 1. The instinctive one-torch defence loses, untaught

- **Evidence:**
  - 14 jabs with the beacon torch: dead at 77%.
  - The hint and page 7 still say "Hold anyway".
  - "Drive them off with your other hand" appears only mid-attempt.
- **Fix:**
  - Hint: "Hold it in the beacon. Bring something for your other hand."
  - Out of the brazier for ≤ 1 s pauses progress, not drains it.
  - Target: a quick one-torch player wins at about 20 HP.

### 2. The respawn fire dies before you may sleep

- **Evidence:** 29 fuel against 5 smothering wolves lasts 42 s, less than the 60 s shaken window. Without wood a second death is certain (the balance log agrees).
- **Fix:**
  - Relight at 60 fuel from stage 2 (about 66 s idle).
  - Or pause smothering until the shaken window ends.

### 3. A full crossbow ends the finale

- **Evidence:**
  - The crossbow holds 8 bolts and there are 8 guardians.
  - The scenario killed 8 of 8 with 0 bites; sentry and crossbow: 100 HP.
  - The objectives give every player the crossbow first.
- **Fix:**
  - Third wave 3 → 5 guardians. A one-handed player can't reload.
  - Target: a quick armed player ends at 60–80 HP.

### 4. Pincers flatten skill at stage 3

- **Evidence:** Quick and slow players both took 3 bites; the balance run gave 2 and 5.
- **Fix:**
  - The second wolf crouches 0.35 s later, after a growl from its side.
  - Target: quick players take 1 bite a minute, slow players 3.

### 5. Guardians trail you home

- **Evidence:** After the failed hold, "The Hollow are smothering the fire" fired at camp in daylight; guardians linger 30 s.
- **Fix:** Dissolve the guardians when the player dies.
