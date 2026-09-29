# Review: fun and game feel

Date: 2026-09-28. The question: is Prometheus fun for a 20–30 minute first session?

**How this was reviewed:** by reading the code and data only, without running the game.

- **Read:** `design/source/{vision,world,interaction}.md`, `design/GAME_SPEC.md`, `design/ARCHITECTURE.md`, `src/game/{rules,recipes,story,catalog,terrain,components}.ts`, `src/game/creature-ai.ts`, every mechanics system under `src/game/systems/`, `public/scenes/main.iwsdk.scene.json` (item, node and anchor counts), the `design/verify/v2/*.png` screenshots and `tests/e2e/opening.mjs`.
- **Timing assumptions:**
  - Walking speed is 2 m/s. The IWSDK default cap is 5 m/s (`node_modules/@iwsdk/core/dist/locomotion/locomotion.js:45`), so real trips may be even shorter.
  - The clock starts at 40 s (`components.ts:112`).
  - A day cycle is 300 / 30 / 150 / 30 s (`rules.ts:36`).
- **Distances:**

| Leg | Distance | Time at 2 m/s |
| --- | --- | --- |
| Camp to grove | 19.7 m | 10 s |
| Camp to brook flint | 24.6 m | 12 s |
| Camp to outpost | 32.2 m | 16 s |
| Camp to Spire beacon | 51.4 m, plus a 6.5 m climb | about 30 s |

---

## 1. Score: **5 / 10**

The first five minutes are the best part of the game, and they deliver the GDD's fantasy:

- You flick the lighter into the tinder, make stew from the pack, strike a torch three times on the bench and push its head into the flames.
- Audio covers almost every event, the haptics are well chosen, and the UI is diegetic.

After the torch, the game loses its pressure and its payoff.

- **Night is not dangerous.** You can sleep through every night, even at dusk before any wolf spawns. A lit torch never goes out and keeps every wolf at a distance it can't bite from.
- **The late game has no purpose.** The crossbow, bolts and sentry have nothing to do. The sentry guards a camp that nothing attacks, and building it uses up your crossbow.
- **The finale is flat.** It is a 3-second hold with no risk, and any lit torch can trigger it from about minute 8.
- **The world is small.** The farthest point is about 30 s away, so being far from camp never feels risky.
- **There is a soft-lock.** Only two pieces of cloth exist in the valley and both can be burned. If they are, you can never make a torch and never finish.

The result is a charming 5-minute cooking and crafting toy, followed by roughly 15 minutes of fetching that no system turns into tension or reward. Most of the fixes are tuning and small code changes. The systems already exist (fire ring, torch ward, stage table, sentry, guardians); they just need to push against each other.

---

## 2. Session timeline (first-time player, following the wrist objectives)

**Balance numbers used throughout:**

| System | Numbers | Source |
| --- | --- | --- |
| Hunger | Starts at 70. Drains 1 point every 7 s: 70 to 0 in 8.2 min, 100 to 0 in 11.7 min. | `components.ts:109`, `rules.ts:13` |
| Starving | Drains 0.5 health/s, so 200 s from 100 health to death. | `rules.ts:14` |
| Healing | 0.25 health/s. Only within 6 m of a lit fire, and only while hunger is above 50. | `rules.ts:15` |
| Fire fuel | Burns 1/3 fuel/s: 100 fuel lasts 5 min, the starting 40 fuel lasts 2 min. | `rules.ts:17` |
| Fuel values | Log 35, plank 15, stick 10, resin 8, cloth 5, cord 3. | `catalog.ts` |
| Food | Berries 8, mushroom 6, raw meat 5, roast meat 35. Stew is 1.5 × its ingredients (meat + mushroom 60, meat + meat 75). | `catalog.ts`, `recipes.ts` |
| Regrow | Forage nodes 180 s, deadwood 240 s. | Scene JSON |
| Wolves | 0, 1, 3 or 5 per night by stage. Bite 20 damage, 2 health. Only one attacks at a time. | `story.ts:79`, `creature-system.ts` |

**Session timeline:**

| Real time | Clock / phase | Beat | What happens (numbers) | Feel |
| --- | --- | --- | --- | --- |
| 0:00–0:45 | Day 1 | Wake at camp | Toast "The fire is cold…". The pack is laid out on the trestle. Read page 1 (torch recipe). The Spire is visible up the trail (`01-camp-day.png`). | Strong hook. The scene is clear and inviting. |
| 0:45–1:30 | Day 1 | **Light the fire** | Take the lighter from the pack, pull the trigger and hold the flame in the tinder for 1 s. The fire starts with 40 fuel (2 min). | Signature moment. Very good. |
| 1:30–3:30 | Day 1 | **Stew** | Put meat and mushroom from the pack into the pot, stir 2 turns (~4 s), dip the bowl, eat. Hunger goes from ~55 to 100, so about 15 points are wasted. | Good hands-on flow, but visually thin (no steam or bubbles). |
| ~2:45 | Day 1 | Fire burning low | Toast at fuel below 15, about 75 s after lighting. Feed the 2 camp logs (+70 fuel). | Good first "feed the fire" beat. |
| 3:30–5:30 | Day 1, then dusk at 4:20 | **Torch** | Stick, cloth and resin into the bays, 3 hammer strikes, head into the fire for 0.65 s. Danger stage becomes 1. | Signature moment. The strikes lack sparks or a strike counter. |
| 4:43–5:30 | Dusk and night 1 | First night | One wolf spawns once dusk is 85% dark, **if the torch is already made**. The player stands inside the fire's 6 m safe ring. Sleep is allowed at dusk or night. | 30–60 s of atmosphere, then sleeping skips it. |
| 6:00–9:00 | Day 2 (dusk ~11:00) | Meadow and brook | Walk 12 s. Pick up flint, reeds (cord), berries and herbs, and page 4 (bolt recipe). Walk back. | Calm and pretty (`07-meadow.png`), but nothing is at stake. |
| 9:00–9:45 | Day 2 | Spear | Stick, flint and cord on the bench. | Quick. |
| 9:45–12:30 | Day 2 | **Hunt** | Deer bolt if you are within 2.5 m, or within 6 m while moving faster than 1.2 m/s. So the spear must be thrown: miss, walk to it, wait 6 s for the deer to calm, repeat. A kill gives 2 meat. | Satisfying on a hit, but outcomes vary widely. |
| 11:00–14:00 | Dusk and night 2 | Second night | One wolf. Either sleep again or go out holding the torch, which is completely safe. | No tension. |
| 12:30–15:30 | Day 3 | **Outpost** | Walk 16 s. Pages 5 and 6 (the story reveal, crossbow and sentry recipes). Salvage: trigger, spring, cloth, 2 planks. Five items means 2 in hand plus unrolling the pack, filling cells, rolling and wearing it (~1 min). | Best story beat. The inventory handling is fiddly. |
| 15:30–17:30 | Day 3 | Crossbow | Needs a second cord (another brook trip, or reeds regrowing in 180 s). Danger stage becomes 2. Bolts cost 2 sticks and 1 flint for 4 bolts; flint comes from 2 nodes that regrow in 180 s. | Grind starts. The crossbow has no real target. |
| 17:30–20:30 | Day 3, dusk ~17:15 | Sentry | Crossbow, spring and plank. **Uses up the crossbow.** Danger stage becomes 3 (5 wolves). Place it within 10 m of the fire and load bundles. | Anticlimax: "Guard the camp", but nothing ever attacks the camp. |
| ~17:45–20:15 | Night 3 | Five wolves | They circle 7–9 m out. The sentry, if loaded, kills them one every 1.5 s, or the player sleeps. | Mild spectacle with no stakes. |
| 20:30–23:00 | Day 4 | **Spire finale** | Walk and climb about 30 s. Page 7. Hold the lit torch in the beacon for **3 s**. Two guardians spawn 8–9 m away, get pushed back by the torch, and the ending plays. | Over before it starts. |
| 23:00+ | — | Free play | No wolves spawn after the ending (`creature-system.ts:319`), and there are no new goals. | Empty. |

**Where the time goes:**

- About **8 minutes of strong hands-on verbs**: the opening and the hunt.
- About **10 minutes of hauling and waiting on regrow**: flint, cord, sticks and salvage.
- About **1 minute of real tension**.

A player who knows the route can finish in about 10 minutes. By skipping the crossbow and sentry (the finale only needs a lit torch), a player can finish in about 8.

---

## 3. Findings

### P0: breaks the fun or soft-locks the game

**P0-1: Night danger is optional, and a torch makes you immune to it.**

- **Evidence:**
  - **Sleeping skips the danger entirely.**
    - `DayNightSystem.sleep()` (`daynight-system.ts:83-109`) jumps the clock straight to dawn (`DAWN_CLOCK`), and night wolves dissolve at dawn (`creature-system.ts:579`).
    - Sleep is allowed during dusk, and wolves only spawn once dusk is 85% dark (`creature-system.ts:307`, `W.duskSpawnNightness`), about 23 s in. A player who sleeps early in dusk never sees a wolf.
  - **A lit torch is total protection.**
    - Wolves count as "threatened" within 3.6 m of any lit torch (`DANGER.torchRadius` 3 + `torchMargin` 0.6, `creature-system.ts:817`). They are also pushed out of a 3 m circle around the torch (`creature-system.ts:691`).
    - A wolf only starts an attack from 2.2 m (`attackRange`). A torch held about 0.5 m from your head keeps every wolf at least 2.5 m from you, so no attack can start.
    - The torch never burns out (GAME_SPEC decision "Unlimited"), and it can't be burned as fuel (`campfire-system.ts:96`).
    - So from the moment danger begins (danger stage 1 is triggered by crafting the torch), you already have the item that cancels it.
  - **Escalation doesn't show.** Stages 2 and 3 only add wolves (`story.ts:79`). All of them are held back by the same torch, and only one may attack at a time (`creature-system.ts`, `attacker`).
- **Effect on fun:** The pillar "Fire is life and lure" has no downside. Being far from camp at night carries no risk, and no choice is made under pressure.
- **Change:**
  1. **Gate sleep on a quiet camp.**
     - In `sleep()`, refuse at `phase === 'dusk'` with the toast "Wait for full dark."
     - Also refuse while any wolf with `rig.night` and `mode !== 'dying'` is alive and less than 90 s of the night have passed, with the toast "The Hollow are circling. Drive them off before you sleep."
     - Expose a `liveNightWolves()` count on CreatureSystem for this check.
     - Night then becomes "clear the ring, then rest", which is a job for the crossbow and the sentry.
  2. **Make the torch something you aim, not a force field.**
     - Change `DANGER.torchRadius` from 3 to **1.6** (`rules.ts:29`) and `W.torchMargin` from 0.6 to **0.25** (`creature-system.ts:63`).
     - Keep the torch-contact scare (`combat-system.ts:140-149`).
     - A wolf that comes at the side away from the torch can now reach bite range. "Hold it toward the wolves" (M11) becomes an actual skill.
  3. **Let packs flank from stage 2.** Allow `stage >= 2 ? 2 : 1` wolves to attack at once (replace the single `attacker` slot with a counter).

**P0-2: Soft-lock: the only cloth in the valley can be burned.**

- **Evidence:**
  - The torch needs cloth (`recipes.ts:5`). The scene contains exactly two pieces: `item-cloth` in the camp pack and `item-salvage-cloth` at the outpost. There is no cloth resource node.
  - Cloth has `fuel: 5` (`catalog.ts:27`), so dropping it into the fire ring destroys it (`campfire-system.ts:93-103`).
  - The game invites exactly this. The fuel toast tells the player to "Drop a log or stick in the ring" (`campfire-system.ts:107`), and "Feed it wood" is shown within ~75 s of lighting the fire.
  - If both pieces are burned, the torch objective and the finale are impossible forever, because the save persists.
- **Related, not a hard soft-lock:**
  - Sticks (fuel 10) are the torch and spear inputs. Burning both camp sticks forces a grove chop before the first torch.
  - Only 2 salvage planks exist (fuel 15). The crossbow and the sentry need one each. The renewable source, splitting a log on the stump (`gather-system.ts:133-158`), is mentioned nowhere in any page, objective hint or toast.
- **Change:**
  1. Remove `fuel` from `cloth` in `catalog.ts:27`. Releasing cloth into the ring then falls through to a normal drop. Add a warning toast in `releaseIntoFire` that fires when `kind === 'cloth'`: "Keep the cloth; a torch needs it."
  2. Add a renewable cloth node at the collapsed tent: `ResourceNode {kind:'cloth', yields:'cloth', regrowSeconds:240}` near (-6.5, -31.5).
  3. Change both fuel toasts to "Drop a log in the ring" (`campfire-system.ts:107`, `:128`).
  4. Append to the crossbow objective hint (`story.ts:64`): "Split a log on the stump for planks." Or add the same line to page 6.

**P0-3: The second half has no payoff. The crossbow and sentry have no job, and the sentry uses up the crossbow.**

- **Evidence:**
  - Wolves never threaten the camp. They circle the fire at 7–9 m and can't enter the 6 m ring (`creature-system.ts:689-697`). They don't damage the fire, the food or the items. Sleeping is instant.
  - So the sentry (`combat-system.ts:269-306`) only shoots wolves that pose no danger. The toast "They gather in numbers now. Guard the camp." (`toast-system.ts:64`) promises a threat that doesn't exist.
  - The sentry recipe consumes the crossbow (`recipes.ts:9`). Only one trigger exists (`item-salvage-trigger`), so you can never build another. The player walks to the finale with a spear and a torch.
  - The sentry can only be placed within 10 m of the campfire (`combat-system.ts:60`), so it can't help at the Spire either.
  - Bolts cost 2 sticks and 1 flint for 4 (`recipes.ts:7`, `:13`). They vanish 3 s after landing (`combat-system.ts:221`). Wolves drop nothing (`creature-system.ts:795`).
  - Result: every bolt, and the whole crossbow-to-sentry chain, is effort spent with no reward.
- **Change:** Connect the systems into a loop.
  1. **Wolves attack the fire.** From stage 2, each prowling wolf within `ringRadius + 1` of a lit fire drains **0.4 fuel/s** ("kicking ash into the coals"). Add this in `decideWolf`'s prowl branch; CampfireSystem reads the drain through a shared number. Pair it with a hiss and ember puff.
     - With 3 wolves (stage 2), a full fire lasts 100 / 1.53 ≈ **65 s**.
     - With 5 wolves (stage 3), about **43 s**.
     - The night lasts 150 s, so you must feed the fire or kill wolves. The sentry becomes the fire's guard.
  2. **Wolves drop 1 flint on death** (an "ash shard"). In `onDeath`, emit `spawn-item` for `'flint'` instead of returning. Fighting now pays for more bolts, and a loaded sentry becomes a small flint income.
  3. **Stop the sentry from eating the crossbow.**
     - Place a second trigger ("Rennick's spare") next to page 6 at the lookout, around (-0.3, 1.29, -35.3).
     - Change the sentry recipe to `['trigger', 'spring', 'plank']`, and update page 6 and the objective hint.
     - The player keeps the handheld crossbow for the finale.
  4. **Allow placing the sentry at the Spire.** Accept placement within 10 m of `CAMP.fire` **or** within 8 m of `LANDMARKS.beacon` (`combat-system.ts:60`). This sets up P1-1.

### P1: significant problems

**P1-1: The finale is a 3-second hold with no risk, no gate and no big moment.**

- **Evidence:**
  - The beacon fills over **3 s** (`story-system.ts:165`, `delta / 3`). Guardians spawn 7.7–9.2 m away (the spire-west and spire-east anchors). At stalk speed 2.9 m/s they reach 3.6 m from the torch at about the moment the beacon lights, get pushed back by it, and then dissolve because the game has ended (`creature-system.ts:579`).
  - The toast "Hold the flame steady… the Hollow are coming" (`story-system.ts:171`) promises a fight that never happens.
  - **No gate.** Nothing checks the danger stage or objectives. Page 2 names the Spire, and it is visible from camp (`01-camp-day.png`). A curious player can finish at about minute 8 with 5 of 10 objectives open.
  - **No dawn at the end.** The spec's ending ("…and dawn breaks") isn't implemented: `finale()` (`story-system.ts:177-186`) never changes the clock or the sky.
- **Change:**
  1. **Lengthen the hold.** Fill time 3 s → **20 s** (`delta / 20`). Decay when the torch is removed 0.5/s → **0.08/s**, so a short defence costs about 1.6 s of progress instead of 10 s.
  2. **The torch doesn't protect you while it feeds the beacon.** In `CreatureSystem.sampleHazards`, skip torches whose tip is within 1 m of `LANDMARKS.beacon` while the Spire's `Beacon.progress` is between 0 and 1. That is one hand busy holding the flame and one hand fighting: the climax the crossbow and sentry were built for.
  3. **Guardians arrive in waves.** Three waves at progress 0, 0.35 and 0.7, each with **1 + stage** wolves (stage 1: 2 per wave, stage 3: 4 per wave). Replace the single `guardianArmed` flag with a wave index.
     - This acts as a natural soft gate: at stage 1 with only a spear it is brutal but possible.
     - Optionally add a hard gate: the beacon stays inert until page 5 has been read ("The brazier is cold iron. You don't yet know what was taken.").
  4. **Stage the ending.**
     - On `finale()`, set the clock to `DAWN_CLOCK` and force a sky update (reuse the sleep path).
     - Set the campfire to `lit = true, fuel = 100`.
     - Sweep a 4 s golden sky flare (mix toward the dusk palette, then dawn).
     - Burst every living wolf into ash with a 0.3 s stagger, nearest first.

**P1-2: The "transformation" moments have almost no visual feedback.**

- **Evidence:**
  - `fx-system.ts` only changes flame scale and brightness, broth and bowl tint, beacon glow and the lost-pack beam. There are no particles anywhere.
  - At the bench, the ingredients vanish and the product appears at the pad (`crafting-system.ts:147-168`) with no transition.
  - Strikes 1, 2 and 3 all play the same clank at the same pitch (`audio-map.ts:150`), and nothing shows the strike count.
  - The pot has no steam or bubbles. The broth colour jumps straight from the ingredient tint to the finished stew tint.
  - Chopping shows no chips and no damage stages on the deadwood (`gather-system.ts:113-130`).
  - Wolf death is a squash-scale and a sound only.
  - The GDD's core fantasy is "physically transforming materials", and the moment of transformation is exactly where the feedback is missing.
- **Change** (one small pooled particle helper, allocated in `init()`, with no runtime lights):
  - **Bench strikes:** a spark burst of 10 additive quads over 0.3 s. Three pips on the pad light up as you strike. Clank pitch rises 1.00 → 1.12 → 1.26 by `event.count`.
  - **Craft:** the three inputs slide to the pad and shrink over 0.2 s before they're consumed. The product scale-pops 0.6 → 1.1 → 1.0 over 0.25 s with a dust puff.
  - **Pot:** steam wisps whenever the fire is lit and something is in the pot. The broth colour moves smoothly from the ingredient tint to the stew tint as you stir. A soft bubbling loop plays while stew waits.
  - **Fuel added:** flames flare ×1.4 for 0.4 s and embers burst.
  - **Chop:** 6 wood chips per hit. The deadwood tilts 4° and sinks 2 cm per hit.
  - **Wolf death:** an ash puff plus an upward ember drift.

**P1-3: Gathering for bolts is a grind with no reward.**

- **Evidence:**
  - Filling the sentry (12 bolts) and the crossbow (8) takes 5 bundles: 10 sticks and 5 flint.
  - Flint comes from **2 nodes that regrow every 180 s**. Sticks come from 3 deadwood that give 2 each and regrow every **240 s**.
  - Counting the spear's flint, fully arming yourself needs at least 2 flint regrow cycles (6 min) and a deadwood regrow wait (4 min).
  - Bolts disappear after landing, and your hands and the 9-cell pack are the only carrying capacity. So in practice you walk back and forth to the brook.
- **Change:**
  - `BOLTS_PER_BUNDLE` 4 → **6** (`recipes.ts:13`).
  - Brook flint `regrowSeconds` 180 → **90**. Grove deadwood 240 → **150**.
  - Bolts that land stay pickable for 20 s: raise `BOLT_LIFETIME` to 20 and let a landed bolt touched to the crossbow add 1 charge.
  - Together with wolves dropping flint (P0-3), the loop starts paying for itself.

**P1-4: Hunting outcomes swing too much.**

- **Evidence:**
  - Deer bolt within **2.5 m** whatever your speed (`creature-system.ts:55`).
  - A spear thrust reaches about 1.6 m from your head (arm plus the spear tip at 0.97 m), and a deer's hit sphere is 0.85 m up with a 0.45 m radius. So a thrust **can never hit a calm deer**. Hunting a deer means throwing.
  - A thrown spear's hit only allows 0.1 m of slack beyond the creature's body sphere (`combat-system.ts:210`), and there is no aim assist.
  - Rabbits have a 0.18 m hit radius, so hitting one is mostly luck.
  - `playerSpeed` is measured from head motion (`creature-system.ts:215-223`). Leaning into a throw from within 6 m can trip "hurry" and make the deer bolt mid-windup.
  - Each miss costs a walk to the spear and a 6 s calm-down (`P.calmSeconds`).
- **Change:**
  - Deer panic radius 2.5 → **1.7** m, so the page 4 fantasy ("walk slowly") allows a thrust.
  - Thrown-spear hit slack 0.1 → **0.25** m.
  - Measure `playerSpeed` from the locomotion rig, not the camera, so head motion doesn't count.
  - Optional: 5° of homing for a spear thrown faster than 6 m/s at a creature within 12 m.

**P1-5: Higher danger stages don't change how wolves behave.**

- **Evidence:** `WOLVES_BY_STAGE = [0, 1, 3, 5]` (`story.ts:79`) is the only thing that scales. Behaviour, speed, health and bite are the same at every stage. The GDD says "Enemies become more dangerous as the player progresses."
- **Change:**
  - Stage 2 adds flanking (2 attackers at once, P0-1) and fire-draining (P0-3).
  - Stage 3 cuts the warning crouch before a bite (`telegraphSeconds`) from 0.8 to 0.6 s and adds a howl at every dusk.
  - Keep wolf health at 2 so one bolt still kills.

### P2: polish

- **P2-1: Dead time while "Sleep" is the objective.**
  - The wrist and the "Next:" toast always show the first unfinished objective (`wrist-system.ts:192-196`, `toast-system.ts:168-176`). After the torch, that is "Sleep at the bedroll" all day, and trying to sleep gives "You aren't tired yet."
  - A fast player can wait up to about 5 minutes.
  - **Fix:** in `currentObjective`, skip `sleep` while the phase is day (pass the phase in) so the spear becomes the current objective. Or move `sleep` after `hunt` in `OBJECTIVES`.
- **P2-2: Survival pressure is gentle and doesn't interact with anything.**
  - The first stew overshoots by about 15 hunger.
  - The fire's "burning low" and "gone out" toasts appear wherever you are (for example at the outpost), but the fire only matters for cooking, healing and sleeping.
  - **Fix:**
    - Start hunger at **60** (`components.ts:109`) so the first stew fills you exactly.
    - Only show the low-fuel toast within 20 m of camp, or at dusk.
    - Once P0-3 lands, a fire going out at night has real consequences.
- **P2-3: Nights are bright and wolves are hard to see.**
  - In `13-night-wolf.png` the wolf is two red specks at about 25 m. The night lighting (`daynight-system.ts:30-35`) keeps the terrain clearly lit, so the campfire isn't the main light.
  - **Fix:**
    - Night hemisphere light 0.16 → **0.09**, moonlight 0.35 → **0.22**, fog far 60 → **42**.
    - Wolf eye glow ×1.5 while stalking.
    - Always spawn the first stage-1 wolf at the anchor with the clearest view from camp, and play a howl as it spawns.
- **P2-4: Guardian edge cases.**
  - Guardians spawned by day have `night = false` (`creature-system.ts:422`), so they never dissolve.
  - Each new beacon attempt, after progress decays to 0, spawns 2 more (`creature-system.ts:329`). Repeated attempts pile up daytime wolves.
  - **Fix:** mark guardians to dissolve 20 s after progress returns to 0, and cap live guardians at 4.
- **P2-5: The trails are empty.**
  - The longest trip is about 30 s and nothing happens on the way. Every discovery sits at a landmark.
  - **Fix:** add 2–3 small finds along the trail: the spare trigger (P0-3), a resin cache, a single page fragment with a hint about the stump. The valley feels bigger without adding travel time.
- **P2-6: Hauling salvage is fiddly.**
  - Storing anything means unrolling the pack, placing items one cell at a time, rolling it up and shouldering it again (`backpack-system.ts:176-205`). The 5-item outpost haul is the peak of this.
  - **Fix** (respecting the GDD's take-off-and-reach-in pack): pre-bundle the crate's salvage into one "salvage bundle" item that splits into its parts when struck on the bench. Or let the release target accept an item dropped within 0.3 m of the worn pack's shoulder spot into the first free cell.
- **P2-7: Nothing to do after the ending.**
  - `ended` stops all wolves (`creature-system.ts:319`), and the wrist shows "Free play. Keep the fire fed."
  - **Fix:** after the ending, keep stage-1 nights running and add a "Relight every brazier" goal using the two echo braziers.

**What already works (keep it):**

- The lighter, stew and torch sequence.
- The deer rule "the deer don't fear us, only our hurry" (`creature-ai.ts:56`).
- An emergent trade-off: carrying loads (hands full, torch packed) versus holding the torch, since a packed torch doesn't protect you (`creature-system.ts:245-246`).
- The pillar of light marking where you died, and the forgiving respawn (60 health, at least 50 hunger).
- Full audio coverage, including the heartbeat below 30 health.
- The wrist, journal and toast UI.
- Short travel. Don't slow locomotion down; add stakes instead.

---

## 4. Top 6 changes (priority order)

1. **Make nights a real test (P0-1).**
   - Refuse sleep at dusk, and while night wolves are alive during the first 90 s of night.
   - `DANGER.torchRadius` 3 → **1.6**, `W.torchMargin` 0.6 → **0.25**.
   - From stage 2, allow **2** wolves to attack at once.
2. **Remove the soft-locks (P0-2).**
   - Remove `fuel` from cloth and warn when it's dropped in the fire.
   - Add a renewable cloth node at the outpost tent (regrow 240 s).
   - Change the fuel toasts to say "log".
   - Put the stump-split instruction in the crossbow objective hint or page 6.
3. **Give the crossbow and sentry a purpose (P0-3).**
   - From stage 2, each wolf circling the fire drains **0.4 fuel/s**.
   - Wolves drop **1 flint** when they die.
   - Sentry recipe becomes **trigger + spring + plank**, with a second trigger at the lookout, so the crossbow is kept.
   - The sentry can be placed near the fire **or within 8 m of the Spire beacon**.
4. **Build the finale into a real climax (P1-1).**
   - Beacon fill time 3 s → **20 s**, decay 0.5/s → **0.08/s**.
   - A torch in the brazier doesn't hold wolves back.
   - Three guardian waves of **1 + stage** wolves at progress 0, 0.35 and 0.7.
   - On success: jump to dawn, relight the campfire (fuel 100), flare the sky and burst all wolves into ash.
5. **Add feedback to the transformation moments (P1-2).**
   - Bench: sparks, 3 pips and rising pitch on strikes; inputs shrink into the pad and the product scale-pops.
   - Pot: steam, and the broth colour follows stir progress.
   - Fuel: the flames flare.
   - Chop: chips and visible cracking.
   - Wolf death: an ash burst.
6. **Cut the grind and even out the hunt (P1-3, P1-4, P2-1).**
   - Bolts per bundle 4 → **6**, flint regrow 180 → **90 s**, deadwood regrow 240 → **150 s**.
   - Landed bolts can be picked up for 20 s.
   - Deer panic radius 2.5 → **1.7 m**, thrown-spear hit slack 0.1 → **0.25 m**, player speed read from the locomotion rig instead of the head.
   - Skip the "Sleep" objective on the wrist during the day.
