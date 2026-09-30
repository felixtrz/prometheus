/** Story and progression data. Bit index = array position (GameState bitmasks). */

/**
 * `where`: where the page lies, in landmarks (no compass): the journal's teaser for a
 * recipe the page teaches, before it is found.
 */
export type PageInfo = { index: number; title: string; author: string; body: string; teaches?: string; where: string };

export const PAGES: readonly PageInfo[] = [
  {
    index: 1, title: 'If you are reading this, it\u2019s you.', author: 'You, before', teaches: 'torch', where: 'in your pack',
    body: 'Write it down before it goes. The Kindling took the fire, and the fire took our names. Mine is '
      + 'going now. The lighter is yours, the last flame that still answers. The axe and bench are the '
      + 'expedition\u2019s; your hands will remember them. Light the fire. Eat something hot. Make a torch. '
      + 'See the stone with the hole through it? I did something there. Stay in the firelight after dark. '
      + 'You\u2019ll see why.',
  },
  {
    index: 2, title: 'Expedition orders', author: 'Dr. Ilse Varga, 1st day', teaches: 'spear', where: 'at the camp bench',
    body: 'The Spire on the ridge above camp holds the valley\u2019s first fire. It burned in that pierced stone '
      + 'before the pines grew. Prometheus is simple: carry one spark home in the lantern, and learn what '
      + 'it is. Tonight our keeper lit camp from a taper held to the stone. Resin and timber: the grove, '
      + 'left fork. Flint and reeds: the brook, right fork. Deer: the meadow. Spears for everyone. Nobody goes past '
      + 'the outpost alone.',
  },
  {
    index: 3, title: 'Grove notes', author: 'Rennick, 2nd day', where: 'on the grove stump',
    body: 'Old pines weep resin when the sun\u2019s on them. Pull the amber blisters; they come away clean. '
      + 'A pine comes down in five good swings and grows back by the season; a log on the stump splits into planks. I lit a brazier '
      + 'here to see by. Odd thing: the cold ones came the night we first carried torches out of camp. '
      + 'Grey shapes at the edge of the light, eyes like coals. They wouldn\u2019t cross into the glow. '
      + 'Just watched. Like they wanted it back.',
  },
  {
    index: 4, title: 'By the brook', author: 'Rennick, 5th day', teaches: 'bolts', where: 'on a rock by the brook',
    body: 'The deer don\u2019t fear us, only our hurry. Walk slow. Ilse has a name for the cold ones now: '
      + 'the Hollow. Her theory: they were wolves once, before the first fire. Now they\u2019re ash that '
      + 'remembers being warm. They fear the flame and come to it anyway. Every fire we carry, every new '
      + 'thing the bench makes, there are more. So, bolts. Two sticks and a flint. Trust the bench.',
  },
  {
    index: 5, title: 'The Kindling', author: 'Dr. Ilse Varga, 9th day', teaches: 'crossbow', where: 'on the outpost table',
    body: 'It worked. We named it for a beginning. The keeper raised the lantern to the stone and the '
      + 'Spire\u2019s flame poured in. For a heartbeat the valley shone like noon. The keeper lit a lighter '
      + 'from it, to prove a spark would travel. Then every fire went out at once, but that one. We woke '
      + 'in the dark, and some of us did not know our own names. The keeper least of all.',
  },
  {
    index: 6, title: 'The sentry', author: 'Rennick, 10th day', teaches: 'sentry-kit', where: 'below the lookout',
    body: 'No fire left but the keeper\u2019s lighter, and still the Hollow circle camp. So: a sentry. A '
      + 'carved latch and a bow limb lashed to a log; it turns and looses on its own and watches while we sleep. '
      + 'Mine held until the bolts ran out. I\u2019m taking the others back the way we came, while they '
      + 'still follow me. Ilse stays with the keeper. Keep it loaded. Keep it near the fire.',
  },
  {
    index: 7, title: 'Give it back', author: 'Dr. Ilse Varga, 12th day', where: 'at the Spire',
    body: 'Keeper. You don\u2019t know me now, so I\u2019ll be plain. The flame was never ours to take. The '
      + 'Spire warms the valley only while it burns for everyone, and warmth is how the valley remembers. '
      + 'I tried your lighter while you slept. It would not light for me; it answers only you. Light a torch '
      + 'from it, carry it up here, and hold it in the beacon. They will come for it: keep it there, and drive '
      + 'them off with your other hand. I\u2019m sorry.',
  },
];

/**
 * `hint` (toasts, the camp journal) says how and where: every part's source is named.
 * `wrist` is the short form for the wrist band (at most 64 characters, verbs kept).
 * Directions use landmarks and the trail, never the compass (the keeper has none):
 * the main trail leaves camp past the fire and climbs to the outpost and on to the
 * stone spire on the ridge; its first fork (left) runs to the grove, its second
 * (right) runs downhill through the meadow to the brook.
 * Nothing finished lies in the valley: only raw materials are gathered, and every part
 * is made at the bench (BENCH_RECIPES). Sources, as placed in the valley: loose sticks
 * around camp (or from felling a tree); reeds by camp and at the brook; resin
 * in your pack, on a pine by camp and on the grove pines (left fork); flint at the brook
 * (right fork, past the meadow); firewood logs from felling any tree.
 * Parts: cord (three reeds), plank (two sticks and resin, or a log split on the camp
 * stump), trigger latch (plank, stick, flint), bow limb (stick, cord, resin).
 */
export type ObjectiveInfo = { id: string; title: string; hint: string; wrist: string };

export const OBJECTIVES: readonly ObjectiveInfo[] = [
  {
    id: 'light-fire', title: 'Light the campfire',
    hint: 'Lay a log in the cold fire ring. Take the lighter from your hip, hold its trigger down and keep the flame in the wood.',
    wrist: 'Log in the ring; lighter from your hip, trigger held.',
  },
  {
    id: 'eat-meal', title: 'Cook a meal and eat it',
    hint: 'The meat from your pack (trigger opens it) and a mushroom into the pot. Stir with the spoon, dip the bowl, drink.',
    wrist: 'Meat and mushroom in the pot; stir, dip the bowl, drink.',
  },
  {
    id: 'torch', title: 'Craft a torch and light it',
    hint: 'Stick, reeds, resin in the bench bays; strike the pad three times. Sticks and reeds: around camp. Resin: grove pines, left fork.',
    wrist: 'Stick, reeds, resin in the bays; hammer the pad 3 times.',
  },
  {
    id: 'sleep', title: 'Survive the night, then sleep',
    hint: 'Keep the fire fed after dusk and stay in its light. Late in the night, point at the bedroll and pull the trigger.',
    wrist: 'Keep the fire fed; late at night, sleep at the bedroll.',
  },
  {
    id: 'spear', title: 'Craft a spear',
    hint: 'Stick, flint, cord at the bench; twist three reeds into cord there. Flint: the trail\'s right fork, past the meadow, at the brook.',
    wrist: 'Stick, flint, cord (3 reeds). Flint: brook, past the meadow.',
  },
  {
    id: 'hunt', title: 'Hunt for meat',
    hint: 'Take the right fork down to the meadow. Walk slowly toward a deer; thrust or throw the spear, then butcher it with your axe.',
    wrist: 'Right fork to the meadow; spear a deer, butcher it with the axe.',
  },
  {
    id: 'outpost', title: 'Find the high outpost',
    hint: 'Stay on the main trail, uphill past both forks, toward the stone spire. The team left notes at the high outpost.',
    wrist: 'Main trail uphill, past both forks, to the high outpost.',
  },
  {
    id: 'crossbow', title: 'Craft the crossbow',
    hint: 'Plank, bow limb, trigger latch. Limb: stick, cord, resin. Latch: plank, stick, flint. Plank: split a log on the camp stump.',
    wrist: 'Plank, bow limb, latch. Your journal lists every part.',
  },
  {
    id: 'sentry', title: 'Build a sentry for camp',
    hint: 'Bench: a log, a bow limb and a trigger latch, made as for the crossbow. Set the kit down low by the fire.',
    wrist: 'Bench: log, bow limb, latch. Set the kit by the fire.',
  },
  {
    id: 'beacon', title: 'Carry fire to the Spire',
    hint: 'Carry a lit torch up the trail, past the outpost, to the stone spire. Hold it in the beacon. Bring something for your other hand.',
    wrist: 'Lit torch into the Spire\'s beacon; fight with the other hand.',
  },
  // The opening journey (design/JOURNEY.md). Appended so the older bits keep their meaning
  // (saves, tests); OBJECTIVE_ORDER puts them first everywhere they are shown.
  {
    id: 'escape', title: 'Get out of the wreck',
    hint: 'Walk to the door at the front. The emergency axe hangs above it: take it and strike the door until it gives.',
    wrist: 'Axe above the door; strike the door till it gives.',
  },
  {
    id: 'waystation', title: 'Find your pack at the waystation',
    hint: 'Follow the trail and the orange markers from the wreck. Your pack lies on the waystation table: put it on your back.',
    wrist: 'Follow the markers; put on the pack from the table.',
  },
  {
    id: 'forest', title: 'Firewood and mushrooms',
    hint: 'Through the forest to the camp: fell a tree for its logs (five axe blows) and pick mushrooms on the way.',
    wrist: 'Fell a tree for logs; pick mushrooms on the way.',
  },
];

/** Objective bit indices in the order they are pursued and shown (the journey's three first). */
export const OBJECTIVE_ORDER: readonly number[] = [10, 11, 12, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/** The journey's objectives as one mask (see save.ts: older saves count them done). */
export const JOURNEY_MASK = (1 << 10) | (1 << 11) | (1 << 12);
/** 1-based position of an objective in OBJECTIVE_ORDER ("2 OF 13"). */
export const objectiveRank = (index: number) => OBJECTIVE_ORDER.indexOf(index) + 1;

/** First words of a fresh journey, shown when the player first sees the world. */
export const OPENING = {
  title: 'You wake to smoke and red light.',
  body: 'The plane is down, and burning. Get out.',
};

/**
 * The start panel (StartSystem): the game's name and a three-line hook built from
 * OPENING, before the player chooses New journey or Continue.
 */
export const START = {
  title: 'Prometheus \u2014 First Fire',
  /** Split so the panel can set the name and the subtitle in different weights. */
  name: 'Prometheus',
  subtitle: 'First Fire',
  hook: [
    'The night the expedition took the Spire\u2019s flame, every fire in the valley went out. All but one.',
    `${OPENING.title} ${OPENING.body}`,
  ],
  /** Continue's first line and New journey's second line. */
  continue: 'Continue',
  fresh: 'Wake in the wreck',
  confirm: 'Erase your saved journey?',
  confirmBody: 'Choose again to start over',
};

export const objectiveIndex = (id: string) => OBJECTIVES.findIndex((o) => o.id === id);

/**
 * The ending's words on screen (the farewell line and the ending steps tell the rest).
 * `tally`: the epilogue's pointer home, shown when the journey ends far from the board.
 */
export const ENDING = {
  title: 'A flame carried.',
  toast: 'The valley remembers. So do you.',
  tally: 'Your journal at camp holds the tally.',
  home: 'Go home. Your fire is burning.',
  rest: 'The valley is warm. Stay as long as you like.',
};

/** Danger stage from crafted technology ("fire draws them"). */
export const STAGE_BY_PRODUCT: Readonly<Record<string, number>> = { torch: 1, crossbow: 2, 'sentry-kit': 3 };
export const WOLVES_BY_STAGE = [0, 1, 3, 5] as const;

/**
 * First objective that is not complete, or -1 when all are. By day the sleep
 * objective waits ("tonight") and the next daytime goal is shown instead.
 */
export function currentObjective(mask: number, phase?: string): number {
  const sleep = objectiveIndex('sleep');
  for (const i of OBJECTIVE_ORDER) {
    if (mask & (1 << i)) continue;
    if (i === sleep && phase === 'day') continue;
    return i;
  }
  return phase === 'day' && !(mask & (1 << sleep)) ? sleep : -1;
}
