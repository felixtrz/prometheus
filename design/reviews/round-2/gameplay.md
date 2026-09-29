# Round 2: gameplay and fun

Date: 2026-09-28.

**Method:** read the code, the round-1 review and the tour evidence, then ran five emulated-Quest probes (`judges/gameplay/` in the session scratchpad). Fixtures set only the situation; every outcome was measured.

## 1. Scores

| Axis | Score | Why |
| --- | --- | --- |
| Overall fun | **6/10** (was 5) | The systems now connect. But nights are either risk-free or a death spiral, and the climax is a 12 s hold. |
| Core loop (gather → craft → use) | **7/10** | Trees and loose sticks ended the grind. Every product has a job. Wolf flint closes the bolt loop. |
| Pacing (20–30 min) | **5/10** | A player who knows the route needs about 8 min. There are two nights, about 105 s of dead waiting, and nothing after the ending. |
| Challenge and tension | **4/10** | A lit torch means 0 bites. Stage 3 without a sentry means 5 deaths. The finale is a 2.5 s damage burst the player can't answer. |
| Agency and variety | **5/10** | The best route skips the crossbow and sentry. Stews are flavour only. |
| Feel of physical interactions | **7/10** | Hold poses, hand-over, stowing over the shoulder, chop, sparks, stir and the lighter dwell all land. The torch "poke" never happens. |
| Reward and payoff | **7/10** | The staged ending and the craft and ash bursts land. The build-up to the ending is thin. |

## 2. Top 8 issues, ranked by impact on fun

### 1. A lit torch still makes you immune to wolves, from any side

- **Evidence:**
  - 0 bites in 135 s outside the ring (`night-flank`, `night-torch`): stage 1 and 2, passive or attentive, wolves in front or behind.
  - `night-trace`: every lunge ends 1.49–1.61 m from the head, but a bite needs 1.2 m, because the endpoint is pushed out of the 1.6 m torch disc (`creature-system.ts:979` → `:816`). Without a torch: 3 bites in 25 s.
- **Fix:**
  - Constrain the lunge endpoint by the fire's disc only.
  - Change `threatened` (`:942`) to a frontal cone: within 1.85 m of the torch **and** within ±60° of where it points.
  - A threatened stalker circles to the side without the torch instead of backing straight off.

### 2. A dead fire at stage 3 is a death spiral

- **Evidence:** `night-s3-spiral`, with 60 fuel at dusk:
  - Five wolves drain about 1.0 fuel/s. The fire went out at 66 s, before sleep is allowed.
  - Then came **5 deaths in 75 s**. Respawn gives 60 health, which is 3 bites, and wolves scatter for only 4 s.
  - Sleep was refused: "Too cold and dark".
- **Fix:**
  - Respawn relights the fire at 30 fuel. The voice line already says "The fire kept you".
  - `W.scatterSeconds` 4 → **15**.
  - At stage 2 and above, give the low-fuel warning below 35 fuel instead of below 15.

### 3. Bites chain together

- **Evidence:**
  - `finale-s3`: 4 bites in about 2.5 s, taking health from 100 to 20.
  - The attack slot frees the moment a wolf retreats (`:715`).
- **Problem:** The damage outpaces the 0.8 s warning crouch before a bite.
- **Fix:** A 1.5 s cooldown between bites on the player. A wolf starts its warning crouch only when the last bite was more than 1.2 s ago.

### 4. The finale's tension lasts about 3 seconds

- **Evidence:**
  - The hold is 12 s (`rules.ts:40`). The first guardian gets within 3 m at 6.6 s.
  - Wave 2 spawns at 6 s, 15–19 m out, and arrives after the beacon is lit.
  - The player's only action is to hold still.
- **Fix:**
  - `holdSeconds` → **24**, waves at **[.02, .35, .65]**.
  - `guardianRing` → **[10, 13]**.
  - Page 7 hints to set the sentry by the beacon, so one hand holds the torch and the other fires the crossbow.

### 5. Making more tools makes the ending harder

- **Evidence:**
  - Guardians per wave = `1 + stage` (`:287`).
  - At stage 1, health went from 100 to 60 (tour log). At stage 3, from 100 to 20.
  - Only page 5 is required. The shortest route took 88 s from a new journey.
- **Problem:** The best route skips half the content.
- **Fix:** Fixed waves of **2, 3 and 3**, sized for a player with a crossbow and sentry.

### 6. The sentry empties the night

- **Evidence:**
  - Its 6 starter bolts fired "5 shots, 5 wolf hits" (night log). Its 12 m range covers the whole ring.
  - Each night has a fixed wolf budget (`:404`), so the player then waits about 80 s to sleep.
- **Fix:**
  - Spawn the night's wolves at 0%, 35% and 70% of the night (2, 2 and 1).
  - Starter bolts → **3**, so the sentry needs reloading mid-night.

### 7. Pacing: dead waits and an empty end

- **Evidence:**
  - Dusk comes at 4:20. Sleep is locked until clock 405 (`rules.ts:43`).
  - The stage-1 wolf never came within 9.3 m of the ring.
  - Camp to Spire is 18.6 s.
  - No wolves after the ending (`:403`).
- **Fix:**
  - The beacon catches only after dusk. That schedules a third night and earns the dawn.
  - After the ending, keep stage-1 nights and add a "relight every brazier" goal.

### 8. The close-combat verbs never fire

- **Evidence:**
  - 0 torch scares across all probes. Wolves hover at 2.1–2.5 m, just beyond a spear thrust (about 2.25 m).
  - Bolts vanish after 3 s (`combat-system.ts:336`).
  - Cooking has no purpose after the first meal.
- **Fix:**
  - Threatened wolves feint in to 1.4 m and hop back.
  - Landed bolts can be picked up for 20 s.
  - Stew grants "Warm" for 90 s: faster healing, and wolves hesitate.

## 3. What clearly improved since round 1

- **The soft-lock is gone.** Cloth doesn't burn (`catalog.ts:31`), and the canvas at the outpost regrows.
- **The grind is gone.** There are 7 loose sticks, any tree gives 2 sticks for 3 blows, and items stow over the shoulder.
- **The systems interlock:** smothering (about 1.0 fuel/s measured), wolf flint, a second trigger that keeps the crossbow, and a sentry that deploys loaded anywhere.
- **Sleep must be earned.**
- **The finale is gated on page 5,** and its ending delivers: dawn, braziers, the campfire, smoke in the south.
- **Transformations now show:** sparks, chips, steam and ash.
- **Hunting is reliable.** The deer's panic radius is 1.7 m, and the scripted thrust killed.
- **Onboarding and readability.** The start screen and the shade guide you; wolves howl within 3 s of rising; bites read clearly (`night-10-bitten.png`).
