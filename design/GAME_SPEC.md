# Prometheus — Game Spec (v2: full story arc)

Supersedes the first-playable spec (archived in `archive/first-playable/`). Source
GDD: `source/overview.md`, `vision.md`, `world.md`, `interaction.md`, `art.md`,
`decisions.md`. The first playable (cook stew, craft and light a torch) is the M0
baseline and is kept, generalised into the systems below.

**Pitch.** You wake in the seat of a burning plane, down in a quiet mountain valley, with
no memory and a lighter at your hip. Prometheus' shade gets you out (the emergency axe, the
jammed door), past the Hollow watching from the hills at dawn, to the waystation where your
pack waits, through the forest where you fell your first firewood, and on to the expedition's
camp, its cold fire and its tool bench (design/JOURNEY.md). Every fire in the valley went out the night the
Prometheus Expedition tried to steal the ancient flame of the Spire, and the notes
your team left reveal what happened. You gather, cook and craft with your hands. Each
new tool pulls you further from camp, but every fire you make also draws the
Hollow: ash-wolves that fear the flame and are drawn to it. The arc ends when you
carry fire back to the Spire's beacon. Single-player VR (Quest-class, controllers),
a 20–30 minute arc that saves between sessions.

**Pillars.**
1. **Made by hand.** Every result comes from a physical action (flick, stir, strike,
   chop, throw, pull). No crafting menus: the bench, pot and pack are the UI.
2. **Fire is life and lure.** Fire cooks, lights, warms and protects, and it also
   raises the danger. Every progression step spends that trade-off.
3. **A peaceful world with a secret.** Calm, tactile days and readable, tense nights.
   The story arrives in found pages, never in cutscenes.

## Platform & Mode

- Session: ImmersiveVR, with the browser as a launcher and non-XR preview (existing config).
- Device: Quest 3 class, two controllers; squeeze grabs, trigger uses tools.
  Hand tracking is out of scope (GDD: unconfirmed).
- Play space: standing. Smooth stick locomotion and snap turn, as the GDD specifies.
  The existing comfort assist is kept.

## Core Loop

The world.md proposed loop, made concrete. The 30-second loop is: pick up → carry
(hand or backpack) → place into a physical target (pot, bench bay, fire, pack
cell) → perform the action (stir, strike, chop, hold in flame) → use the result.

1. Explore and gather or hunt → 2. carry materials home in the pack → 3. cook and
   craft by hand at camp → 4. use new tools to reach further places and find pages
   (story and recipes) → 5. keep the fire fed through the night, then sleep at the
   bedroll to set your respawn → escalate: every new fire technology raises the
   night's danger.

## World (one handcrafted valley, ~70 × 80 m walkable)

| Place | Where (m) | What's there | Beat |
| --- | --- | --- | --- |
| The wreck | ≈ −22, 4 (south-west, below the ridges) | the crashed plane: the keeper's seat, the emergency axe above the jammed door, fires, the torn tail and wing in the furrow | the opening: out of the wreck; the Hollow watch from the hills at dawn |
| Waystation (outpost 1) | ≈ −28, −6 | lean-to, table with the pack, orange flag; markers lead there and on through the forest | the pack |
| Camp (outpost 2) | 0, 0 | campfire (cold, no fuel) + pot, bench, trestle, bedroll, chopping stump, lantern; loose sticks, two reed clumps and a resin-scarred pine at the clearing's edge | home, cooking, crafting, sleep |
| Resin Grove | ≈ −17, −11 (west) | old pines with resin blisters to fell and tap, mushrooms | fuel, resin, sticks, food |
| Meadow & Brook | ≈ 16, −15 (east) | open meadow, deer and rabbits, berry bushes, wild herb patches, reed clumps, four flint beds on the brook bank | hunting, food, flint, reeds |
| Expedition Outpost | ≈ −4, −33 (north, on the trail) | collapsed tent, lookout, Rennick's toppled sentry, emptied crates, cold brazier | story reveal (pages 5 and 6); nothing to salvage |
| The Spire | ≈ 5, −55 (far north ridge) | the pierced stone landmark, beacon brazier at its base | finale |

Steep ridges, dense tree walls and the mountains bound the valley. The trail links camp,
the outpost and the Spire; side paths lead to the grove and the meadow.

## Mechanics

| # | Mechanic | Player verb | Notes |
| --- | --- | --- | --- |
| M1 | Grab / carry / drop / throw / pass between hands | squeeze, release | Custom near grab (ItemSystem, not IWSDK grabbables): a gold rim and a haptic tick mark the item a hand would take; squeezing snaps it into a per-item hold pose (tool handle in the fist, crossbow level, bowl upright, page facing the eyes); the other hand can squeeze to take it over. A released item falls onto the ground or any prop tagged `ItemSurface` and rests; released fast, it flies ballistically. No physics engine `[ASSUMED]`. |
| M2 | Backpack | reach over the shoulder + squeeze; release low to unroll; grab the roll to roll up; release at the shoulder to wear | 3×3 cell grid, one item per cell (art.md). The worn pack follows the player. |
| M3 | Light fire | hold the lighter, pull the trigger to flick, hold the flame to the tinder for 1 s | Opening beat. A lit torch also ignites. |
| M4 | Fuel | release or toss a log or stick into the fire ring; loose sticks lie around camp and the paths; firewood comes from felling trees (M8) and from fallen deadwood | Fuel 0–100 burns down (~5 min). The camp ring starts empty: a fresh journey brings its first log from the forest. Only wood burns. From stage 2, wolves circling the fire smother it (+0.15 fuel/s each). At 0 the fire goes out and can be relit. |
| M5 | Cook stew | release 2 food items into the pot, stir 2 turns with the spoon (fire lit), dip the bowl, bring it to the mouth | Value = 1.5 × the ingredients. Named by ingredients. |
| M6 | Roast / eat raw | hold raw meat in the flame 3 s; bring food to the mouth | Berries +8, raw meat +5, roast +35, stew +45–75. |
| M7 | Craft | place 3 items in the bench bays (any order), strike the pad 3 times with either face of the hammer head | Pages teach the five products; the four parts (cord, plank, trigger latch, bow limb) are known from the start and listed in the journal. An unknown valid combination also crafts and is learned (experimentation). An invalid combination clanks and doesn't progress. |
| M8 | Chop | swing the axe into a standing tree (5 blows; every tree can be felled) or a log on the stump | A felled tree topples away from the chopper, breaks into 1–2 logs (firewood) and 2 sticks (3 for a broadleaf), and leaves a stump; after 2 min a sapling sprouts and grows back to a choppable tree over 8 min (felled trees are saved). Pines carrying a resin scar never fall. Deadwood → log + 2 sticks. Log on stump → 2 planks. The same blow breaks the wreck's jammed door (3 blows). |
| M9 | Forage | pull resin blisters, mushrooms, berries, reeds, flint pebbles | Only raw materials are found: nothing finished lies in the valley. A reed clump gives a bundle of reeds (three per pull, `yields`); nodes respawn after 1.5–3 min `[ASSUMED]`. |
| M10 | Hunt | throw or thrust the spear, or shoot the crossbow, at deer or rabbits; butcher the carcass with the axe | A kill leaves a carcass; a few axe blows give its meat (the hunt objective completes on the first meat). Animals flee when you get close. |
| M11 | Torch | hold in the fire to light; hold toward wolves; poke | Stays lit `[ASSUMED]`. A directional ward (v3): it keeps wolves back within 1.85 m in a ±60° cone in front of the flame (plus 0.9 m at the flame). Wolves circle to your back and feint into poke range; touching one with the flame makes it flee. |
| M12 | Crossbow | hold, pull the trigger to fire a bolt; touch a bolt bundle to it to reload (+4) | Bolts fly ballistically at 30 m/s. |
| M13 | Sentry | craft the sentry kit, release it low on open ground (camp, outpost, Spire) | Deploys with 3 starter bolts (v3), shows its ammo as bolt tips, and blinks red with a positional dry click when empty. Auto-aims at wolves within 12 m and fires every 1.5 s while loaded (capacity 12). Landed bolts can be picked up and reloaded. |
| M14 | Survival | eat | Hunger −1 / 7 s. At 0, health drains in ticks (1.5 per 3 s). Health regenerates near a lit fire when hunger > 50. Stew makes you well fed for 90 s: half hunger drain and +0.4 health/s anywhere (v3). |
| M15 | Death & respawn | — | Respawn at the last bedroll you slept in. Your pack and held items drop as a glowing "lost pack" at the death spot, recoverable. Respawn relights a dead camp fire to 30 fuel and the pack keeps off for 15 s (v3), so death is a setback, not a spiral. |
| M16 | Day / night | — | Day 5 min, dusk 30 s, night 2.5 min, dawn 30 s. The sky, sun, fog and ambience change. |
| M17 | Sleep | point at the bedroll + trigger (from 35% of the night, no wolf within 4 m; beside a dead fire only if no wolf within 8 m) | Skips to dawn, sets respawn, saves. Sleeping cold costs 15 health and 25 hunger (v3). |
| M18 | Danger ("fire draws them") | — | Stage = technology milestones: torch 1, crossbow 2, sentry 3. Wolves appear only at night: stage 1 → 1 prowler, stage 2 → 3 hunters, stage 3 → 5 plus Spire guardians. Stage 0 is peaceful forever. |
| M19 | Wolves | — | Circle outside the lit fire radius (6 m) and the torch radius (3 m). They telegraph (growl, crouch 0.8 s) then bite (−20 health). 2 health: bolt 2 damage, thrown spear 2, thrust 1; torch contact makes them flee. They dissolve at dawn. |
| M20 | Pages & recipes | pick up a page, hold it to read | 7 pages give the story and recipes. The journal tracks pages, recipes and objectives. |
| M21 | Finale | after reading page 5, hold a lit torch in the Spire beacon for 24 s while guardian waves come | The Hollow darken the sky when the hold begins (always a night climax). Waves of 2/3/3 guardians rise 10–13 m out, independent of danger stage: some attack (the last wave two at a time) while the rest crouch at the brazier and smother it, draining progress until driven off, so the hold must be defended with the free hand (a second torch, the crossbow, or a sentry on the plateau); a passive hold fails. Then the Spire's eye lights, dawn breaks, the braziers and campfire relight, smoke rises beyond the valley's mouth, and Prometheus' shade says farewell. Wolves dissolve. Then free play: no more wolves, an epilogue card with the journey's tally, and New journey. |
| M22 | Save / continue | automatic | Autosaves on sleep, on objective completion and every 60 s. "New journey" in the journal. |

### Recipes (bench: 3 bays + 3 hammer strikes)

Only raw materials are gathered: stick, log, resin, flint, reeds and food (meat comes from
butchering). Every part and tool is made at the bench, three inputs each (the bench has three bays).

| Product | Inputs | Learned from |
| --- | --- | --- |
| Cord (part) | reeds + reeds + reeds | known from the start |
| Plank (part) | stick + stick + resin (or split a log on the camp stump: 2 planks) | known from the start |
| Trigger latch (part) | plank + stick + flint | known from the start |
| Bow limb (part) | stick + cord + resin | known from the start |
| Torch | stick + reeds + resin | Page 1 (camp pack) |
| Spear | stick + flint + cord | Page 2 (camp bench) |
| Bolt bundle (×6) | stick + stick + flint | Page 4 (brook) |
| Crossbow | plank + bow limb + trigger latch | Page 5 (outpost table) |
| Sentry kit | log + bow limb + trigger latch | Page 6 (outpost lookout) |

`GameState.recipes` keeps one bit per recipe by its index in `BENCH_RECIPES`: the five products
keep bits 0–4 (older saves stay valid), the parts follow and are always known (`knownRecipes`).

Cooking (pot): any 2 of meat, mushroom, berries, herb → "Meat & mushroom stew" and so on.

### Objectives (soft-ordered; the journal and wrist show the current one)

The opening journey first (design/JOURNEY.md): Get out of the wreck. Find your pack at the
waystation. Firewood and mushrooms (fell a tree, pick a mushroom on the way to camp). Then:
1. Light the campfire. 2. Cook a meal and eat it. 3. Craft a torch and light it.
4. Sleep at the bedroll. 5. Craft a spear. 6. Hunt for meat. 7. Find the high
outpost. 8. Craft the crossbow. 9. Build a sentry to guard camp. 10. Carry fire to the
Spire and light the beacon. (The journey's three are bits 10–12 of GameState.objectives,
shown first through OBJECTIVE_ORDER; saves from before the wreck count them done.)

## Story — The Prometheus Expedition (keeper canon, M6)

1. The Spire's first fire burns in the pierced stone and warms the whole valley only while it burns
   for everyone. Warmth is how the valley remembers.
2. The expedition's keeper (the player) lit camp from a taper held to the stone, so every expedition
   flame was the Spire's fire, borrowed.
3. The Hollow are wolves from before the first fire: ash that remembers being warm. They fear flame
   and come to it anyway, in greater numbers for every carried flame and every new thing the bench
   makes. This is why danger rises with torch, crossbow and sentry.
4. The Kindling (9th day): the keeper raised the Prometheus lantern to the stone and the flame poured
   in. The keeper lit a lighter from it, and every fire in the valley went out except that one. Memory
   went with the warmth, the keeper's most of all.
5. The lighter answers only the keeper. Rennick led the others out through the valley's mouth; Ilse stayed,
   went up to the Spire alone and left page 7.
6. Returning a flame to the beacon gives the fire back: the valley's fires wake, the Hollow are
   released into ash, memory returns.
7. Prometheus' shade (v3): the Titan who stole fire to give it to everyone walks as an ember-lit
   ghost beside the keeper, whose people took it from everyone. He guides, never commands: one
   line the first time each thing is done (src/game/voice-lines.ts), and while the
   Hollow are near he speaks only to keep the keeper alive, or at the beacon. He says farewell at the Spire and rises away with the embers. His voice is TTS
   (Drawcall, voice Charon), generated once via /voice-prep.html; subtitles carry every line.

Seven pages in three voices: page 1 is from "You, before" (in the pack), page 2 Ilse on the 1st day
(bench), page 3 Rennick on the 2nd day (grove), page 4 Rennick on the 5th day (brook), page 5 Ilse on
the 9th day, "The Kindling" (outpost), page 6 Rennick on the 10th day (lookout), page 7 Ilse on the
12th day, "Give it back" (Spire). The texts are in `src/game/story.ts`.

The outpost is a story place, not a supply depot: Rennick took what the expedition had made
when he led the others out, so its crates stand empty and the keeper makes every part again
from what the valley grows (page 6 names the sentry's parts: a carved latch and a bow limb
lashed to a log). There is no cloth and no iron in the keeper's crafting.

Camp is deliberately sparse (v3 feedback): the cold, empty fire ring with its pot, the bench,
one bedroll, the journal board with the cold lantern, and the chopping stump; the keeper brings
the axe from the wreck, the pack from the waystation and the firewood from the forest. A start screen tells the hook before the world starts; Prometheus' shade speaks the
first-time guidance. The lantern stays cold until the first fire. The ending: "A flame carried." /
"The valley remembers. So do you." Then "Go home. Your fire is burning."

## UI Surfaces

- **Field journal** (world-space panel at camp): current objective and checklist,
  known recipes, pages found (n/7), hunger and health, New journey, Enter/Leave VR.
- **Wrist band** (left controller): hunger and health bars, sun or moon, current
  objective, carried bolt count.
- **Page reader**: a panel beside a held page, showing its text.
- **Toasts**: short world-space notices ~1.4 m ahead of the player (recipe learned,
  page found, respawn set). They fade after 3 s and never lock to the head.
- **Damage / starving vignette**: subtle red or dark edge on hurt or starving.

## Audio

Ambient beds: forest day (wind, birds), night (crickets, low wind), campfire
crackle (positional), brook (positional), beacon roar. One-shots: lighter flick,
ignite whoosh, plop, stir, bowl fill, eat, hammer clank, craft complete, invalid
clunk, chop, wood split, grab tick, drop thud, slot snap, pack unroll/roll, page
rustle, recipe learned, spear whoosh, hit, crossbow twang, bolt thunk, reload
click, sentry fire, deer flee, wolf howl/growl/bite/dissolve, player hurt,
heartbeat (low health), sleep swell, dawn motif, ending theme, death sting.
Sounds are synthesized offline by a project script (license-clean, no downloads) `[ASSUMED]`.

## Art Direction

As art.md: stylized mid-poly, crisp manufactured objects with construction detail,
faceted natural rocks, low-frequency material variation, baked or blob shadows, no
postprocessing or dynamic shadows. Warm fire against cool environment light. The
creature style (open in the GDD) is `[ASSUMED]`: deer and rabbits in the same
chunky mid-poly style with warm natural palettes; Hollow wolves are charcoal with
ember eyes and ember cracks, so they read clearly at night.

## Scope

- **MVP (must ship):** M1–M22 with the camp, grove, meadow, outpost and Spire, 7 pages,
  5 recipes, 3 creature species, day/night, save, full audio list.
- **Target:** polish passes from sub-agent reviews (fun, visual fidelity, intuitiveness,
  immersion, sound, story).
- **Stretch / non-goals:** hand tracking, a generated landscape (the GDD mentions it; we
  author one valley), multiple save slots, multiplayer, physics-engine stacking,
  animated creature rigs (procedural part animation only), seated mode, native
  Quest performance tuning beyond budgets.

## Success Criteria (asserted in Phase 6)

| # | Criterion (observable) | How it will be checked |
| --- | --- | --- |
| S1 | Flicking the lighter at the cold fire's tinder lights it; fuel then decreases | ecs query Campfire.lit / fuel over time |
| S2 | 2 ingredients + stirring (fire lit) → pot ready; the dipped bowl fills; eating raises hunger by the recipe value | ecs query GameState.hunger before/after |
| S3 | Bench: a known recipe + 3 strikes spawns the product; an unknown valid recipe also crafts and becomes known; an invalid set doesn't progress | ecs find product + GameState.recipes |
| S4 | Axe: 5 blows fell a tree into firewood logs + sticks; forage nodes yield items | ecs find Item kinds |
| S5 | Pack: released low → unrolled; item over a cell snaps; roll up hides the contents; worn pack follows the player | Backpack.state + child positions |
| S6 | Fire fuel falls over time; a log raises it; the fire goes out at 0 | Campfire.fuel series |
| S7 | Hunger falls; starving drains health; death respawns at the bedroll with a lost pack holding the inventory | GameState + LostPack entity |
| S8 | Time advances; night changes the sun and sky; sleep at night → dawn, respawn set, save written | GameState.time, localStorage |
| S9 | After the torch, the next night spawns ≥1 wolf; wolves stay outside the lit fire radius; a bite reduces health; bolt/spear hits kill | Creature entities + distances |
| S10 | A thrown spear hitting a deer drops meat | ecs find meat |
| S11 | Crossbow trigger fires when loaded; the bolt count decrements; a bundle reloads | Item.charges |
| S12 | The deployed sentry fires at a wolf in range | Sentry.bolts decrement + wolf health |
| S13 | Picking up a page shows its text, increments pages and unlocks its recipe | GameState.pages/recipes, screenshot |
| S14 | A lit torch in the Spire brazier for 3 s → beacon lit, ending state, wolves gone | GameState.ended, screenshot |
| S15 | Reloading the page restores progress | reload + ecs query |
| S16 | Key interactions play their SFX; the ambience switches day/night | audio event log pattern |
| S17 | Hero views ≤ 200 draw calls and ≤ 250k triangles | scene/runtime render stats |
| S18 | Typecheck, unit tests and production build pass | CLI |

## Decisions & Assumptions

| Decision | Chosen | Why | Source |
| --- | --- | --- | --- |
| Incident | Prometheus Expedition, the Kindling | Explains the lighter, axe and bench; mythic tie-in | user |
| Danger trigger | Fire/technology milestones | Thematic; lets you stay peaceful | user |
| Crossbow | Handheld, then auto sentry | Combat verb plus automation payoff | user |
| Scope | 20–30 min arc, one valley, autosave | GDD session length and persistence | user |
| Physics | Custom ballistic items on an analytic terrain, no engine | Predictable, cheap on Quest, verifiable | [ASSUMED] |
| Recipe discovery | Pages teach; valid experiments also succeed | Rewards curiosity, no dead ends | [ASSUMED] |
| Repeated deaths | Lost packs accumulate, none despawn | Forgiving; GDD leaves open | [ASSUMED] |
| Torch burn time | Unlimited | Keeps the finale carry stress-free | [ASSUMED] |
| Sleep | Night only, requires a lit fire; sets respawn | world.md checkpoint role | [ASSUMED] |
| HUD language | Wrist band + physical journal + world toasts | Diegetic and comfortable | [ASSUMED] |
| Audio source | Offline procedural synthesis → mp3 | License-clean, no network | [ASSUMED] |
| Creature style | Chunky mid-poly; ember-cracked charcoal wolves | Fits art.md; readable at night | [ASSUMED] |
