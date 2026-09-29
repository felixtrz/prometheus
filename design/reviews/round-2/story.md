# Round 2 review: story and Prometheus' shade

Narrative director, 2026-09-28. Review only; the durations use `estimateSeconds`.

## 1. Scores

| Area | Score | Why |
| --- | --- | --- |
| Clarity and hook | **8** | "Every fire went out. All but one." and the note land before the world does. |
| Lore coherence | **7** | The keeper canon holds, but the shade isn't in it, and three lines contradict the systems (§3). |
| The shade | **6** | Great look and voice, but his motive inverts the myth and he has no arc. |
| Guidance | **6** | Concrete and accurate, but it repeats the toasts, and the first 90 s hold ~60 s of speech. |
| Pacing of reveals | **7** | Dated pages and the page 5 gate work. The shade gives away the page 4 and page 7 details early. |
| Ending | **7** | The round 1 package shipped, but toasts bury the farewell and it resolves nothing. |

## 2. Top 8 issues

**1. Every first-time line is also a toast.**
- Pairs: `dusk` (voice-lines.ts:175) and toast-system.ts:465; `bowl` and :427; `fire-out` and :430; `respawn` and :447; `bench-invalid` and crafting-system.ts:101; `beacon` and story-system.ts:222; and both `*-empty` lines.
- **Fix:** add `covers?: string` (a toast key) to `GuideLine`, and a `key` to the bus `toast` event. ToastSystem then suppresses a covered toast while its line is queued or speaking. The shade owns first times, and toasts handle repeats.

**2. The motive inverts the myth.**
- `intro` (:79) says "I stole fire once, as your people did, and this valley went cold." That equates the two thefts, and it blames him for the cold.
- Prometheus took fire from the few for everyone. The expedition did the opposite.
- **Fix:** replace the line, and add the shade to the `GAME_SPEC.md` canon: bound to every stolen flame, freed when it goes back.

> "Wake, keeper. I am Prometheus, or what is left of him. I stole fire to give it to everyone. Your people took it from everyone." (126 ch, 11.5 s)

**3. Silent at the story beats.**
- He talks about stew but never about the Kindling.
- **Fix:** have `triggersOf` (:258) also push `` `page:${index}` ``, emit `beacon-cold` at story-system.ts:211, and add these lines:

> `page-2`: "They named their venture for me. They learned the stealing, and not the giving." (79 ch, 6.7 s)
>
> `page-5`: "Now you know what you carry. I was chained for a stolen fire once. Give this one back, keeper, and we both go free." (115 ch, 11.0 s)
>
> `page-7`: "She stayed when the others fled. Do as she asked: bring a lit torch here, into the beacon, and do not let go." (109 ch, 10.6 s)
>
> `beacon-cold`: "The stone will not take it from a stranger. Remember what you did, keeper. Your people's notes wait at the outpost below." (121 ch, 10.2 s)

**4. The ending buries the farewell and never lets him go.**
- `ending` (:221) starts at 10 s, under the theme and smoke toasts (toast-system.ts:470). Three texts cover the flame (`finale-13`).
- He then fades out like after any other line.
- `welcome` is `finale: true` (:86), so he returns in every later session.
- **Fix:**
  - Cut the smoke toast.
  - Trigger the line on `ending-step:smoke+6`.
  - Give it a unique exit: embers rise into the Spire's eye.
  - Drop `finale` from `welcome`.

> "Look south, keeper: smoke. Someone made it out. The fire burns for everyone again, and I am free of it. Go home. Yours is burning." (130 ch, 11.5 s)

**5. The first minute is a monologue.**
- `intro`, `note`, `grab`, `page` and `lighter` add up to ~59 s.
- `intro` overlaps the opening toast (`opening-01`).
- `grab` (:90) fires after the first grab.
- `page` says "Your own words" for whichever page is read first.
- **Fix:**
  - Make the opening toast title-only (toast-system.ts:387).
  - Trigger `grab` on `hand-near` only, with `unless: 'grabbed'`.
  - Trigger `page` on `page:1`.
  - Shorten the lines:

> `grab`: "Squeeze to take hold. Open your hand to set it down; swing and let go to throw." (79 ch, 8.0 s)
>
> `page`: "Your own words. The others left pages across the valley. Each gives back a little of what the cold took." (104 ch, 9.3 s)
>
> `fire`: "There: the first warmth in many nights. Keep it fed. Now, meat and a mushroom in the pot." (89 ch, 8.4 s)

**6. The sentry comes loaded, but the lines say it doesn't.**
- `sentry` (:205), `sentry-kit` (:158) and the hint at story.ts:71 all say "feed it bolts". combat-system.ts:133 says "Loaded with 6 bolts".
- **Fix:** change the hint to "Trigger, spring and plank. Set the kit down on open ground near the fire." and the `sentry` line to:

> "It stands, six bolts loaded. It looses at any Hollow that comes near. When it runs dry, touch a bundle to it." (109 ch, 10.2 s)

**7. `wolf` (:180) recites page 4 and overpromises.**
- It reuses Rennick's "ash that remembers being warm".
- A torch doesn't "drive them back": it works only at arm's length (rules.ts:29).
- **Fix:** give him something only a Titan would know:

> "The Hollow. I knew them as wolves, before the first fire. Stay in the light. If one comes close, thrust your torch at it." (121 ch, 11.0 s)

**8. `respawn` (:196) is sometimes false.**
- "What you carried lies where you fell" plays even when nothing was dropped. The toast already checks for this.
- **Fix:** spend the line on the myth's eagle instead:

> "Not yet, keeper. An eagle tore me open each day, and each night I was made whole. The fire keeps you the same way." (114 ch, 11.0 s)

## 3. Contradictions

- **Sentry:** "Load it" (the shade and the hint) vs "Loaded with 6 bolts" (the toast). See issue 6.
- **Beacon:** page 7 says "fire here in your own hands", but only a lit torch counts (story-system.ts:199), and the lighter does nothing. The new `page-7` line fixes this.
- **After the ending:** `welcome` says "even when you do not" remember, but the ending says "So do you". See issue 4.
- **Minor:**
  - `intro` blames Prometheus for the cold, where the canon blames the Kindling.
  - `page` misfires when page 2 is read first.
  - `wolf` overstates the torch.

## 4. Improved since round 1

- **Start:** the start panel delivers the hook, and the opening toast points at the note.
- **Pages:** all seven round 1 pages shipped, with dated authors and three voices.
- **Ending:** it now plays out on screen:
  - the Spire's eye lights and dawn comes;
  - the echo braziers light in sequence;
  - the camp fire relights itself;
  - smoke rises in the south;
  - an 8 s toast reads "So do you";
  - the wrist shows "Go home".
- **Finale:** it waits for page 5, and the hold lasts 12 s with guardian waves.
- **Toasts:** they stay up longer for longer text, and wait while you read a page.
- **The guide:** the shade speaks each line once, drops lines the player has already acted on, respects priority and stays quiet while a page is read. His voice direction is well tuned.

These issues are about content and timing, not architecture.
