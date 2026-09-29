# Review: story and narrative direction

Date: 2026-09-28. Reviewer role: narrative director. Review only. I didn't run the game.

**What I read:**
- The GDD: `design/source/{overview,vision,world,interaction,decisions}.md` and `design/GAME_SPEC.md` (the Story, Objectives and Mechanics sections).
- The story data and systems: `src/game/story.ts` and `src/game/systems/{story,toast,journal,reader,wrist,daynight,campfire,survival,crafting,combat,creature}-system.ts`.
- `src/game/recipes.ts` (stew names) and `src/game/audio-map.ts`.
- The UI panels: `public/ui/*.uikitml`.
- The scene: page, beacon and item nodes in `public/scenes/main.iwsdk.scene.json`.
- Placement data: `src/game/terrain.ts` (`LANDMARKS`) and `src/scene-assets/valley-layout.scene-asset.ts` (GROVE, BROOK, OUTPOST, SPIRE, TRAILS).
- World dressing: `valley-regions.scene-asset.ts` (grove, outpost, Spire, trail), `camp-dressing.scene-asset.ts` and `valley-props.scene-asset.ts` (braziers).
- The screenshots in `design/verify/v2/*.png`.

The page texts below are written for the reader panel's font atlas, which covers ASCII and Latin-1 only (`plain()` in `journal-system.ts:16`). They use no em dashes and no curly quotes, and each page stays under 75 words.

---

## 1. Score: **6 / 10**

**Verdict:** the bones are good, but the hook and the ending don't land yet.

**What works:**
- The premise has a strong mythic spine: a team named for a fire thief steals the first fire, and you give it back.
- Each page sits at the landmark it talks about: resin notes at the resin grove, deer notes by the meadow, the sentry page at the lookout, the apology at the beacon.
- The expedition's flame emblem is a quiet visual thread. It appears on the lighter, the crate, the banner, the trail marker and the Spire glyph.
- A few lines are genuinely good: "like moths that hate the light" and "It held until the bolts ran out".

**What doesn't work:**

1. **The premise is optional.** It reaches the player only if they pick up a piece of paper that nothing tells them to read.
2. **The mythology has missing links.** Nothing explains:
   - why the lighter still works,
   - why the player's fires draw the Hollow,
   - why crafting a crossbow counts as "fire",
   - why a torch in a brazier undoes the Kindling.
3. **The ending promises things the game doesn't show.** The text mentions a dawn and a campfire you never lit, but neither happens. The payoff is a 3-second toast, 50 m from the only panel that holds the ending text.
4. **The team has no fate, and the player has no identity.** Ilse's "I am sorry I could not" goes nowhere.
5. **The world contradicts the premise in the first second.** A lantern glows at camp in a valley where "every fire went out".

All of these can be fixed with text and a handful of props. None of them needs a new system.

---

## 2. Beat-by-beat map, as a first-time player experiences it

Assumptions: the player follows the wrist objectives and walks at about 2 m/s. The clock starts 40 s into day 1, a day is 5 min and night falls about 5 min in.

| # | When | Where | What the player sees, reads and hears | Story delivered | Problem |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00 | Camp spawn (0, 0.4), facing north | Cold fire ring, tripod and pot, the bench on the left, the unrolled pack on the stand on the right, the journal board. **A lantern glowing on a mossy rock.** The Spire is visible on the horizon straight up the trail (`01-camp-day.png`, `05-trail-north.png`). Toast: "The fire is cold. Your pack is on the table." | None. Nothing says "you don't remember". | The glowing lantern contradicts the premise. The Spire, the game's most important image, gets no attention. |
| 2 | 0:10–0:40 | Pack on the stand | The objective hint says "Take the lighter from the pack". Page 1 sits in a different cell (`pack-5`, lighter in `pack-2`). | **Only if the player chooses to pick up the paper:** "The Kindling takes memory..." and the lighter, axe and bench line. | The hook is optional. Most players will grab the named object, the lighter, and go. |
| 3 | 0:40–1:30 | Fire ring | Flick, flame, crackle. Toasts: "Light the campfire" (complete), then "Next: Cook a meal..." | Warmth. The camp comes alive. | Fine. This is the tactile peak of the first minute. |
| 4 | 1:30–3:30 | Pot | Stew from the meat and mushroom on the stand. Toast: "Hearty stew. Warm, and filling." | Comfort. The peaceful tone. | Fine. |
| 5 | 3:30–5:00 | Bench | Page 2 lies on the bench's west end (`page-2` at -2.72, -1.19). Torch crafted and lit. Toast: "The Hollow stir... Your fire has been noticed." | Ilse's plan and the Spire's first fire. The first dread. | Page 2 is usually the first page read, and it is the one that introduces the Spire. If the player skipped page 1, "the Kindling" is never set up. |
| 6 | 5:00–8:00 | Camp, dusk and night 1 | One prowler circles outside the light (`13-night-wolf.png`). Howls. Sleep, then "Respawn set - Day 2". | Night 1 turns page 1's "you will understand why" into something real. | "Respawn set" is gamey language at the most atmospheric moment. |
| 7 | 8:00–12:00 | Brook (page 4 on the west-bank rock) and meadow | Deer, reeds, flint. Page 4: Rennick names the Hollow. Bolt recipe. | The Hollow get a name and a behaviour. | "Every new fire we make" doesn't cover the crossbow or sentry stages that follow. |
| 8 | optional | Grove (page 3 on the stump by the cold brazier) | Resin pines, deadwood, rabbits. | The "cold ones" first appeared the night after the first campfire. | No objective sends the player here, so page 3 is often missed. It must stay non-essential, and it is. It also contradicts stage 0, where a lit campfire alone draws nothing. |
| 9 | 12:00–15:00 | Outpost (pages 5 and 6) | Collapsed tent, knocked-over stool, open crate, red flame banner, broken ladder (`09-outpost.png`). The lookout box holding page 6 is **nearer the trail** than the table holding page 5, so many players read 6 before 5. | Page 5 (the Kindling) is the central reveal. Page 6: "It held until the bolts ran out." | Page 5 ends with a parts list: "The crossbow parts are in the crate". That tonal whiplash wrecks the reveal. Pages carry no dates, so reading them out of order is confusing. |
| 10 | 15:00–25:00 | Camp | Crossbow, bolts, sentry. Stage toasts 2 and 3. | Escalation. | The reason escalates ("they gather in numbers"), but not why they come. The crossbow isn't a fire. |
| 11 | 25:00+ | Spire (page 7 on the ledge) | The stone steps, the pierced stone and the brazier (`10-spire.png`). Page 7: "It was never ours to take." Hold the torch: "Hold the flame steady... the Hollow are coming." | Why, and what to do. | "It" is unclear if page 5 is unread. Page 7 can be read on day 1. **The beacon lights for any lit torch, so the finale can happen at 10 minutes, before pages 3–6.** |
| 12 | +3 s | Spire | The beacon flame, ignite and roar sounds, wolves dissolve, the outpost and grove braziers light at once, the ending sting. Toast: "A flame carried." and "The valley remembers." for about 3.9 s. | The payoff. | No dawn. The pierced stone stays dark. Nothing lights in the direction of home. The full ending text is on the camp journal, 51 m away. Afterwards the wrist says "Free play. Keep the fire fed." |

**Order robustness:**
- Pages 1 and 2 are nearly always read first and in order.
- Page 4 is effectively guaranteed, because the spear objective needs brook flint and reeds.
- Page 3 is optional.
- Pages 5 and 6 are found together, often as 6 then 5.
- Page 7 can be found at any time by an explorer.

The story therefore has to survive any order of 3–7. With the dated pages and self-contained page 7 below, it does.

---

## 3. Findings

### P0: the story fails to land for most players

#### P0-1: The premise, amnesia and the incident are optional in the first two minutes

**Evidence:**
- The opening toast is `story-system.ts:128`: "The fire is cold. Your pack is on the table."
- The first hint, "Take the lighter from the pack...", is at `story.ts:57`.
- Page 1 is an unmarked paper in a different pack cell from the named object (`main.iwsdk.scene.json`, `page-1` slot `pack-5`, lighter slot `pack-2`).
- Nothing on the journal board states the premise.
- A player who goes straight for the lighter learns nothing about amnesia, the expedition or the Spire until they happen to read page 2 at the bench about 4 minutes in.

**Fix (text plus one data change):**

1. Change the opening toast to a title and body. The `toast` bus event (`bus.ts:45`) takes only `text`. Either add an optional `body` field to it, or call `ToastSystem.show()` from `StorySystem` directly.
   - Title: **"You wake beside a cold fire."**
   - Body: **"You don't remember lying down. There's a note in your pack, in your handwriting."**
   - Hold time: 6 s (see P1-8).
2. Move page 1 into the pack cell closest to the spawn point, the front row facing the player, and move the lighter one cell behind it. The first natural reach then picks up the note, and the reader opens automatically.
3. Change the objective 1 hint (`story.ts:57`) to: **"Read the note in your pack, then take the lighter. Pull the trigger, hold the flame to the fire."** (86 characters, which is fine on the journal. The toast version is in P1-8.)
4. Rewrite page 1 (P1-1) so it points at the **Spire**, which is visible from spawn: "See the stone with the hole through it? I did something there." That gives the player a visual anchor and a personal stake in the first minute.

#### P0-2: The ending promises things the game doesn't show, and it lasts 3 seconds

**Evidence:**
- `ENDING.body` (`story.ts:71`) promises that "The Hollow scatter into ash with the dawn, and somewhere below, a campfire you never lit is burning."
- `StorySystem.finale()` (`story-system.ts:177`) only sets the Beacons lit and `ended`.
- `DayNightSystem` has no ending handling, so no dawn comes.
- No campfire is relit. The camp `Campfire` isn't touched, and the two echo braziers are braziers, not campfires, and they light all at once.
- The toast holds 3 s (`toast-system.ts:39`).
- `ENDING.body` is shown only on the camp journal (`journal-system.ts:243`), 51 m from where the player stands.
- The pierced stone, the image the whole valley has been looking at, doesn't change.
- Afterwards the wrist says "Free play. Keep the fire fed." (`wrist-system.ts:196`), and the journal's unused all-done hint says "...and the Hollow at bay" (`journal-system.ts:153`), even though the Hollow are gone.

**Fix: the ending package.** It is ordered by delay after the beacon lights.

| Delay | Beat | Implementation note |
| --- | --- | --- |
| 0 s | Beacon ignites (existing ignite sound and roar loop). **The Spire's eye lights:** an emissive flame disc fills the pierced opening and ramps from 0 to 1 over 2 s. | Add a named `spire-eye` child in `valley-regions.scene-asset.ts` (the Spire block). The opening is `absarc(.15, 8.6, .85)` in stone-local space, scale .92. Keep the child out of the static batch, and have `FxSystem.updateBeacons` drive it from the spire Beacon. It is visible from camp (see `05-trail-north.png`). |
| 0.5 s | The Hollow dissolve (existing). | – |
| 0–6 s | **Dawn breaks.** If the phase is dusk or night, blend the clock to `DAWN_CLOCK`. This also triggers the existing dawn sound. | In `DayNightSystem`, on `ending`, do what `sleep()` does: set the clock and `forceSky`, without the hunger cost. |
| 1.5 s | The outpost brazier lights (20 m away). | Stagger the echo Beacons by distance from the Spire, about 12 m/s, in `FxSystem` rather than setting them all in `finale()`. |
| 3.5 s | The grove brazier lights (44 m). | Same stagger. |
| 4 s | **The camp campfire relights itself:** `lit = true`, fuel 100. | Add an echo role to the camp campfire in `finale()`. |
| 5 s | Ending theme. Toast title **"A flame carried."**, body **"The valley remembers. So do you."**, held for **8 s**. | Add a per-message hold to `ToastSystem.show()`. |
| 8 s | **Smoke rises in the far south.** A stylized smoke column, opaque puffs in the style of the existing clouds and 10–14 m tall, with a small ember glow at its base, appears beyond the south tree wall at **(6, 0, 34)**. That is 20 m outside `WORLD_BOUNDS.maxZ` and visible from the Spire plateau looking home. This is "the campfire you never lit". | A new prop that stays hidden until `GameState.ended`. See P1-3 for what it means. |
| After | Wrist objective: **"Go home. Your fire is burning."** Once the player is within 8 m of camp, it becomes **"The valley is warm. Stay as long as you like."** | `wrist-system.ts:196`. Use the same text for `ALL_DONE_HINT`. |

New `ENDING`, which the camp journal end card shows when the player walks home:

```ts
export const ENDING = {
  title: 'A flame carried.',
  body: 'The Hollow are ash, and every fire in the valley woke with the Spire. '
    + 'Far to the south, smoke rises from a campfire you never lit. Someone made it out.',
};
```

This makes the ending **earned and seen**:
- The player's act visibly restores the icon they have looked at since spawn.
- The fire they spent the whole game keeping alive is burning on its own when they get home.
- The south smoke answers "what happened to the team" without a word of exposition.
- "So do you" closes the amnesia arc that page 1 opened.

---

### P1: significant

#### P1-1: The mythology has missing links. Adopt the keeper canon and rewrite the seven pages

Nothing currently explains any of the following:
- why the lighter is "the last flame that still answers" (`story.ts:8`),
- why the player's fires draw the Hollow,
- why returning a torch undoes the Kindling,
- who the player was.

**Proposed canon.** Add it to the Story section of `GAME_SPEC.md`. It also answers the open question in `decisions.md`, "What happened in the incident...".

1. The Spire's first fire burns in the pierced stone. It warms the whole valley only while it burns there, for everyone. **Warmth is how the valley remembers.**
2. On the 1st day, the expedition's **keeper** (the player) lit camp from a taper held to the stone. From then on, every expedition flame is the Spire's fire, borrowed.
3. The **Hollow** are wolves from before the first fire: ash that remembers being warm. They fear flame and come to it anyway. They come in greater numbers for every carried flame and every new thing made by firelight at the bench. In the myth of Prometheus, fire and craft are one gift, so the crossbow and sentry stages fit the theme.
4. **The Kindling** (9th day): the keeper raised the Prometheus lantern to the stone, and the whole flame poured in. The keeper lit a lighter from the lantern to prove a spark would travel. Then every fire in the valley went out, **except the lighter**. With the warmth gone, so were the team's memories, the keeper's most of all.
5. The lighter answers only the keeper. Every fire the player makes descends from it, which is why the player's fires draw the Hollow and why a torch lit from the player's fire can relight the beacon.
6. Rennick led the others south out of the valley. Ilse stayed with the keeper, tried the lighter (it wouldn't light for her), and went up to the Spire alone to leave page 7. She didn't come back.
7. Giving a flame back at the beacon returns the fire to the stone. The valley's fires wake, the Hollow are released into ash, and memory returns.

**Rewritten pages.** They are ready to paste into `PAGES`. The date goes in `author`. The `teaches` fields are unchanged, and the recipe box already shows each recipe, so the prose no longer repeats it (see P1-6).

**Page 1**
- Title: "If you are reading this, it's you."
- Author: "You, before" (undated on purpose: the date is lost)
- 73 words:

> Write it down before it goes. The Kindling took the fire, and the fire took our names. Mine is going now. The lighter is yours, the last flame that still answers. The axe and bench are the expedition's; your hands will remember them. Light the fire. Eat something hot. Make a torch. See the stone with the hole through it? I did something there. Stay in the firelight after dark. You'll see why.

"Your hands will remember them" gives a story reason for the whole hands-on crafting fantasy: procedural memory outlives amnesia.

**Page 2**
- Title: "Expedition orders"
- Author: "Dr. Ilse Varga, 1st day"
- 70 words:

> The Spire on the north ridge holds the valley's first fire. It burned in that pierced stone before the pines grew. Prometheus is simple: carry one spark home in the lantern, and learn what it is. Tonight our keeper lit camp from a taper held to the stone. Resin and deadwood: western grove. Flint and reeds: eastern brook. Deer: the meadow. Spears for everyone. Nobody goes past the outpost alone.

**Page 3**
- Title: "Grove notes"
- Author: "Rennick, 2nd day"
- 70 words:

> Old pines weep resin when the sun's on them. Pull the amber blisters; they come away clean. Deadwood splits in three good swings. I lit a brazier here to see by. Odd thing: the cold ones came the night we first carried torches out of camp. Grey shapes at the edge of the light, eyes like coals. They wouldn't cross into the glow. Just watched. Like they wanted it back.

This page now matches stage 0, where a campfire alone draws nothing and the torch triggers stage 1. It also explains the cold brazier 3 m away (`grove-brazier` at -14.3, -12.1), and "wanted it back" plants page 7.

**Page 4**
- Title: "By the brook"
- Author: "Rennick, 5th day"
- 70 words:

> The deer don't fear us, only our hurry. Walk slow. Ilse has a name for the cold ones now: the Hollow. Her theory: they were wolves once, before the first fire. Now they're ash that remembers being warm. They fear the flame and come to it anyway. Every fire we carry, every new thing the bench makes, there are more. So, bolts. Two sticks and a flint. Trust the bench.

**Page 5**
- Title: "The Kindling"
- Author: "Dr. Ilse Varga, 9th day"
- 73 words:

> It worked. We named it for a beginning. The keeper raised the lantern to the stone and the Spire's flame poured in. For a heartbeat the valley shone like noon. The keeper lit a lighter from it, to prove a spark would travel. Then every fire went out at once, but that one. We woke in the dark, and some of us did not know our own names. The keeper least of all.

The last line is where a player who read page 1 realises "the keeper is me".

**Page 6**
- Title: "The sentry"
- Author: "Rennick, 10th day"
- 69 words:

> No fire left but the keeper's lighter, and still the Hollow circle camp. So: a sentry. Crossbow on a frame, spring and plank. It turns and looses on its own and watches while we sleep. It held until the bolts ran out. I'm taking the others south, out of the valley, while they still follow me. Ilse stays with the keeper. Keep it loaded. Keep it near the fire.

**Page 7**
- Title: "Give it back"
- Author: "Dr. Ilse Varga, 12th day"
- 72 words:

> Keeper. You don't know me now, so I'll be plain. The flame was never ours to take. The Spire warms the valley only while it burns for everyone, and warmth is how the valley remembers. I tried your lighter while you slept. It would not light for me; it answers only you. Bring fire here in your own hands and hold it to the beacon. They will come. Hold anyway. I'm sorry.

**How the "keeper" reveal works in any order:**
- Page 2 raises the question: "our keeper".
- Page 5 implies the answer: "The keeper least of all", next to page 1's "Mine is going now" and "The lighter is yours".
- Page 7 confirms it by speaking to the player directly: "Keeper."

Any one of those pages leaves a question, and any two answer it.

#### P1-2: A lantern glows at camp in a valley where every fire went out

**Evidence:**
- `camp-dressing.scene-asset.ts:33–34` (the `glow` MeshBasicMaterial, commented "reads as a lit lantern") and `:95`.
- The lantern glows orange in daylight next to the cold fire (`02-bench.png`, `04-camp-home.png`).
- This undercuts page 1 ("the last flame that still answers"), page 5 ("every fire went out") and the opening toast.

**Fix:**
- Give the glass cylinder a cold, sooty material, for example `MeshStandardMaterial` colour `0x4a4236`, roughness .9.
- Name it `camp-lantern-glass` and keep it out of `batchStatic`.
- Swap it to the existing glow material the first time the campfire is lit. Let `FxSystem` watch objective bit 0 or `fire-lit`.

The lantern catching when you light the first fire is a small, wordless reward: warmth spreading.

#### P1-3: The team's fate and the player's identity are never answered

**Evidence:**
- Ilse's "I am sorry I could not" (`story.ts:47`) has no follow-up.
- Rennick disappears after page 6.
- The camp has one bedroll, one cup and one pack, so it reads as a solo camp, not an expedition base.
- The player is only "You, before".

**Fix:**
- The pages above give the answer: Rennick took the others south, Ilse stayed, went up and didn't return, and you were the keeper.
- The ending's south smoke (P0-2) says someone made it out.
- The props in P1-4 show all of this physically.

Keep Ilse's fate implied, not stated. Her satchel on the ledge beside page 7 is enough, and it fits "peaceful, subtle mystery".

#### P1-4: Too much of the story is told in text and not in the world

The dressing is careful: a collapsed tent, a knocked-over stool, a broken ladder, the emblem motif. But none of it points at the specific events the pages describe.

Add these props. They are small, static and batched except where noted. The coordinates are world XZ, checked against `nodeSpots` and `TRAILS`.

| Where | Prop | Exact placement | What it tells the player |
| --- | --- | --- | --- |
| Camp | Two more rolled bedrolls, Ilse's rust-red and Rennick's moss-green (reuse the outpost's rolled-bedroll recipe), tied with cord. | Leaning on the south side of the lantern rock: (-3.40, -3.70) and (-2.70, -3.95). They are clear of the bedroll at (-1.55, -3.05) and the bench. | This was a team camp. Two people are missing. |
| Camp | Two more wooden cups, one tipped over. | On `camp-log-seat` (1.1, -3.25), at seat-local x = -.35 and +.05, beside the existing cup. | Three cups, one of them yours. |
| Camp | **Ash paw prints:** 7 dark grey flat decals (colour `0x3a3836`, 8 cm), in a trail that **stops 6.2 m from the fire**, which is the lit radius in M19. | From (-8.5, -0.2) to (-5.9, -1.5), and a second trail from (-4.5, 5.2) to (-2.9, 3.9). | Something came to the edge of the light and stopped. This foreshadows the Hollow on the first day, before any page names them. |
| Outpost table | **Turn the unlit lantern into the Prometheus lantern.** Brass body (`0xa0763a`), soot-black glass (`0x1e1a16`) with a pale crack line, and the painted flame emblem (`flameShape(.05)`) on its base. | The existing lantern at table-local (.45, top, -.14). Page 5 is at world (-6.49, -30.78), 0.5 m away. | The player reads "the keeper raised the lantern" next to the lantern itself. |
| Outpost table | The map gets the Spire **circled in red**: a thin `0xc8502a` torus decal on the map plane, plus a small flame mark. | Map at table-local (.06, top + .003, .12). Put the ring at map-local (+.09, -.07). | They were going there. You are going there. |
| Outpost lookout | **Rennick's broken sentry:** a static, un-grabbable copy of the `sentry-kit` mesh tipped on its side, with its frame snapped, next to an empty open bolt case. | (0.30, -34.90), beside page 6's supply box at (-0.5, -35.5). | "It held until the bolts ran out", made physical. |
| North of the outpost | **Six spent bolts** stuck in the ground at 35–45 degrees, all pointing north, with 3 grey ash smudges among them. | West group: (-3.4, -39.8), (-4.2, -40.9), (-3.0, -41.8). East group: (1.8, -39.6), (2.9, -40.6), (1.6, -41.3). All are at least 2 m off the main trail. | The fight at the lookout, and where the Hollow fell. |
| Spire, stone | A **soot ring** around the pierced opening: darken the vertex colours within 1.1 m of stone-local (.15, 8.6). | In the `stoneGeo` colour loop (`valley-regions.scene-asset.ts`, Spire block). | Fire used to burn in the hole. The empty eye is visibly wrong. |
| Spire, ledge | **Ilse's satchel** (a leather box and strap, with the emblem) and a **burnt-out taper** (a thin cylinder with a charred tip). | Ledge (3.4, -52.7), top .58. Satchel at ledge-local (+.28, top, +.10), taper at (-.22, top, -.05). Page 7 stays on the ledge. | She came up here and left without her bag. |
| Spire, flagstones | Darken the 6 flagstones nearest the beacon (a scorch ring). | In the flagstone loop, for `d < 1.8`. | The Kindling happened on this spot. |
| South, beyond the bounds | The ending smoke plume and ember (see P0-2). | (6, 0, 34). | Someone made it out. |

#### P1-5: Out-of-order reading breaks the timeline

**Evidence:**
- Only page 5 carries a date ("Day 9", and only in its title, `story.ts:34`).
- Page 6's box (-0.5, -35.5) is closer to the main trail (x ≈ -2.6 at z -33) than page 5's table (-6.5, -31.1), so most players read 6 first.
- Page 7 is reachable on day 1, and it opens with an undefined "It" ("It was never ours to take").
- The game's own counter says "Day 1", which collides with a "Day 9" page title.

**Fix:**
- Put ordinal dates in the author line: "Rennick, 5th day". An ordinal day reads as expedition time and doesn't collide with the game's "Day N".
- Leave page 1 undated.
- Use the self-contained page 7 above ("The flame was never ours to take").
- No page positions need to change.

#### P1-6: The designer's voice leaks into the pages

**Evidence:**
- Page 5 ends its catastrophe with "The crossbow parts are in the crate: plank, cord and the trigger." (`story.ts:34–39`).
- Pages 1, 4 and 6 each spend 10–15 words restating the recipe.
- The reader already shows every recipe in its own box (`reader-system.ts:15`, `pg-teach`).

**Fix:**
- The rewrites above drop the redundant recipe prose and keep at most a diegetic nod ("So, bolts. Two sticks and a flint.").
- Optionally, change the `pg-teach` eyebrow from "BENCH RECIPE" to **"SKETCHED IN THE MARGIN"** on pages 5 and 7, where the author wouldn't be writing instructions. This would need a per-page label field.

#### P1-7: The voices aren't distinct enough

All three authors currently write short, neutral declaratives. The rewrites follow this voice guide. Keep it for any future text.

**You, before**
- Hurried and frightened, writing against their own forgetting.
- Imperatives and fragments.
- Undated.
- Only this voice addresses the reader as "you".

**Dr. Ilse Varga**
- Precise and a little grand.
- Colon lists and full sentences.
- Names things ("Prometheus is simple", "We named it for a beginning").
- Carries the guilt and the apology.

**Rennick**
- A woodsman and engineer.
- Dry and practical, uses contractions.
- Offers observations as "Odd thing:".
- Signs off with advice ("Trust the bench", "Keep it loaded").
- His fear shows only in understatement.

#### P1-8: The on-screen text is timed for a monitor, not a headset

**Evidence:**
- Toasts hold 3.0 s plus the fades, about 3.85 s visible (`toast-system.ts:39`), whatever their length.
- The "Next:" toast shows the full objective hint, 55–80 characters, at a body size of about 1.5 cm at 1.4 m (about 0.6 degrees).
- Picking up a page triggers "Page N found" and "Recipe learned" toasts while the reader is open. Toasts ignore the depth buffer, so they draw over everything.

**Fix:**
- Set the hold per message: `HOLD = clamp(2.2 + 0.045 × (title + body characters), 3, 8)`.
- Hold the ending toast for 8 s.
- **Defer page and recipe toasts until the reader closes.** Reading shouldn't be interrupted.
- Split long page bodies into 2 or 3 paragraphs. First check that UIKit keeps `\n\n` in `pg-body` (use `ui_render_preview`). If it doesn't, add `pg-body-2`.
- Use the shorter hints and toasts below. The journal can keep the longer form.

| Where | Current | Proposed |
| --- | --- | --- |
| Objective 1 hint | Take the lighter from the pack. Pull the trigger and hold the flame to the fire. | Read the note in your pack, then take the lighter. Pull the trigger, hold the flame to the fire. |
| Objective 3 hint | Stick, cloth and resin in the bench bays. Strike the pad three times. | Stick, cloth and resin in the bays. Strike three times, then light it in the fire. |
| Objective 4 hint | At night, with the fire lit, point at the bedroll and pull the trigger. | Once night falls, with the fire lit, point at the bedroll and pull the trigger. |
| Objective 5 hint | Stick, flint and cord. Flint lies by the eastern brook, reeds make cord. | Stick, flint and cord. Flint and reeds lie by the eastern brook. |
| Objective 7 hint | Follow the trail north past the camp. | Follow the trail north toward the Spire. Look for the red banner. |
| Objective 10 hint | Light a torch and hold it in the beacon on the north ridge. | Carry a lit torch up to the Spire. Hold it in the brazier, and don't let go. |
| Opening toast | The fire is cold. Your pack is on the table. | **You wake beside a cold fire.** / You don't remember lying down. There's a note in your pack, in your handwriting. |
| Stage 1 toast | The Hollow stir... / Your fire has been noticed. Stay near the light after dark. | The Hollow stir... / A carried flame. They've noticed. Stay in the light after dark. |
| Stage 2 toast | More of them will come tonight. Keep the torch close. | Every new thing you make draws more. Several will come tonight. |
| Stage 3 toast | They gather in numbers now. Guard the camp. | They gather in numbers now. Let the sentry keep watch. |
| Sleep toast | Respawn set - Day 2 / You slept by the fire. The journey is saved. | **Day 2.** / You slept by the fire. If you fall, you'll wake here. Journey saved. |
| Respawn toast | You wake by the fire / Your pack lies where you fell. Go and get it. | You wake by the fire / It kept you. Your pack lies where you fell. |
| Beacon hold toast | Hold the flame steady... the Hollow are coming. | Hold the flame steady. They're coming. (Page 7 then pays off with "Hold anyway.") |
| Ending toast | A flame carried. / The valley remembers. | A flame carried. / The valley remembers. So do you. (8 s) |
| Wrist after the ending | Free play. Keep the fire fed. | Go home. Your fire is burning. Then: The valley is warm. Stay as long as you like. |

The respawn line "It kept you" turns the GDD's campfire respawn rule (world.md, "Home and respawning") into part of the fire-and-memory motif. No new system is needed.

#### P1-9: The finale can happen before the story is known, and the climax is 3 seconds long

**Evidence:**
- `updateBeacon` (`story-system.ts:150–175`) accepts any lit torch, with no story condition.
- Objectives are soft-ordered, so an explorer can take the day-1 torch north and end the game at about 10 minutes, having read pages 1, 2 and 7.
- The hold is `delta / 3` (3 s). The guardians spawn when progress rises above 0, so they are barely out of their anchors (about 8 m away) before the game ends. "They will come. Hold anyway." never becomes a moment.

**Fix:**
- **Gate the beacon on page 5.** In `updateBeacon`, if page bit 4 isn't set, don't advance progress. Instead show once:
  - Title: "The flame gutters on the cold stone."
  - Body: "You don't remember yet what you're giving back. The outpost below holds the rest."
  - This keeps the ending tied to understanding, and memory is the theme.
- **Hold for 8 s, not 3:** `delta / 8`, with decay kept at `-delta * .5`.
  - Over those 8 s, ramp the beacon flame and the Spire eye together.
  - Duck the day and night ambience to about 40%.
  - Let the guardians arrive at about 3 s and circle at the edge of the torch radius, growling.
  - The tension comes from holding still while they circle, not from the bite damage.
- These are tuning changes. Check them with the gameplay reviewer.

---

### P2: polish

- **Page 3 is optional.** No objective routes the player to the grove: the camp has resin and logs, and the outpost crate has planks. That's acceptable because the rewritten page 3 is flavour and foreshadowing only. If the grove should be a required stop, make the spear hint mention mushrooms, or take the resin off the camp stand.
- **Stage 1 trigger.** It fires when the torch is *crafted* (`STAGE_BY_PRODUCT`). Firing it on the first `torch-lit` would match "a carried flame" and page 3. That is one line in `StorySystem`.
- **The name "Prometheus".** Keep it. The inversion (a thief's name, a story about returning what was stolen) is the thematic spine. Optionally, let Rennick say it once as dry humour, for example: "Naming us after a thief was asking for it."
- **"Kindling" and "Hollow".** Both are strong. The rewrites make the irony of "Kindling" explicit ("We named it for a beginning"). They also let "Hollow" rhyme with the pierced stone's empty eye, without spelling that out.
- **Stew names** (`recipes.ts`):
  - "Sweet meat stew" reads as "sweetmeat" (candy). Rename it **"Meat and berry stew"**.
  - "Green soup" becomes **"Mushroom and herb soup"**.
  - "Berry porridge" has no grain in it. Rename it **"Stewed berries"**.
  - The rest fit the tone.
- **Page re-reading.** The journal lists page titles only (`journal-system.ts:101`), so re-reading means walking back to the page. Either make the page rows ray-clickable to open the reader, or let pages ride in the pack. Pages already fit a cell (`catalog.ts`, `page`).
- **Journal board help text.** Add one diegetic line above the controls: **"Prometheus Expedition. Keeper's journal."** The player's role is then written on the most-looked-at object in camp and pays off when page 5 is read.
- **Dead text.** `ALL_DONE_TITLE` and `ALL_DONE_HINT` (`journal-system.ts:152–153`) can only show when `ended` is true, and in that case the end card replaces them. Update them anyway for consistency, or remove them.
- **Update the spec.** `GAME_SPEC.md`'s Story section needs updating:
  - Page 2 "Under the hammer" is actually at the bench's west end (-2.72, -1.19).
  - "Dawn breaks" and "braziers across the valley relight" are not implemented as written.
  - Replace that section with the canon in P1-1 and the ending package in P0-2.
- **Wayfinding.** The trail marker's two blank boards at (2.7, -10.4) could carry painted icons: a pine for the grove to the west, a wave for the brook to the east, the flame emblem for north. This supports the new hints without text.

---

## 4. Top 6 changes (priority order)

1. **Ship the ending package (P0-2).**
   - The Spire's eye ignites and dawn is forced.
   - The echo braziers light in sequence, and then the **camp campfire relights itself**.
   - Smoke rises in the south.
   - The 8-second toast reads "A flame carried. / The valley remembers. So do you."
   - The new `ENDING` body appears on the journal.
   - The wrist says "Go home. Your fire is burning."
2. **Make the premise impossible to miss in minute one (P0-1).**
   - The opening toast becomes a title and body that mention the note.
   - Page 1 moves into the front pack cell.
   - Objective 1's hint says to read the note.
   - Page 1 points at the Spire, which is visible from spawn.
3. **Adopt the keeper canon and replace all seven pages (P1-1, P1-5, P1-6, P1-7).** This gives:
   - dated author lines and three distinct voices,
   - the lighter as the last Spire ember,
   - "every fire we carry, every new thing the bench makes" as the escalation rule,
   - a self-contained page 7 addressed to "Keeper."
4. **Fix the camp's first impression (P1-2, P1-4).**
   - The lantern stays cold until the first fire.
   - Two more bedrolls and two more cups show the team.
   - Ash paw prints stop exactly at the edge of the light.
5. **Stage the evidence next to the pages (P1-4).**
   - The cracked Prometheus lantern and the map with the Spire circled, beside page 5.
   - Rennick's toppled sentry and the spent bolts, beside page 6.
   - The soot ring on the Spire's eye, the scorched flagstones, and Ilse's satchel and taper, beside page 7.
6. **Make the climax a real moment and give text VR timing (P1-8, P1-9).**
   - Gate the beacon on page 5.
   - Hold for 8 s, with the Hollow circling at the edge of the torch light.
   - Scale toast hold time to length, and defer toasts while a page is being read.
   - Use the rewritten objective hints and stage toasts.
