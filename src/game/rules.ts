/** Prototype tuning, isolated from the interaction transport and unit-tested. */
export const CAMP = {
  pot: { x: 0.25, y: 1.166, z: -1.9 },
  fire: { x: 0.25, y: 0.5, z: -1.9 },
  bench: { x: -2.15, y: 1.06, z: -1.55 },
  slotOffsets: [-0.83, -0.28, 0.28] as const,
  work: { x: -1.32, y: 1.0625, z: -1.55 },
  stirTarget: Math.PI * 4,
  ignitionSeconds: 0.65,
} as const;

export const SURVIVAL = {
  hungerPerSecond: 1 / 7,
  starveDamagePerSecond: .5,
  regenPerSecond: .25,
  regenRadius: 6,
  fuelPerSecond: 1 / 3,
  maxFuel: 100,
  lighterSeconds: 1,
  roastSeconds: 3,
  eatRadius: .18,
  eatSeconds: .9,
  respawnHunger: 50,
  respawnHealth: 60,
  /** "The fire kept you": a respawn relights a cold (or nearly dead) camp fire with at least this much fuel. */
  respawnFuel: 30,
  /**
   * From the smother stage (DANGER.smotherFromStage) the relit fire gets this much instead: with the
   * whole pack smothering it after the respite it outlasts SLEEP.shakenSeconds, so a night after a
   * death can be slept out without fetching wood (see respawnFuelFor).
   */
  respawnFuelSmother: 60,
  /** A bowl of stew leaves you well fed: hunger drains at `wellFedHunger`x and health mends anywhere. */
  wellFedSeconds: 90,
  wellFedHunger: .5,
  wellFedRegenPerSecond: .4,
  /** Sleeping beside a cold fire is allowed, but you wake stiff and hungry (it never kills). */
  coldSleepHealth: 15,
  coldSleepHunger: 25,
  coldSleepMinHealth: 10,
} as const;

export const DANGER = {
  fireSafeRadius: 6,
  /**
   * A held torch wards a cone: wolves within torchRadius of the flame and within
   * torchConeDegrees of where it points back off (and feint at it); anything this
   * close to the flame in any direction (torchCloseRadius) flinches too. The flame
   * itself is a small solid disc (torchPushRadius). A wolf at your back is not warded.
   */
  torchRadius: 1.85,
  torchConeDegrees: 60,
  torchCloseRadius: .9,
  torchPushRadius: .55,
  /** From this stage on, wolves circling a lit fire smother it (fuel/s each, within 10 m). */
  smotherFromStage: 2,
  smotherPerWolf: .15,
  biteDamage: 20,
  telegraphSeconds: .8,
  wolfHealth: 2,
  /** Seconds between two bites on the player, whatever bites. */
  biteCooldown: 1.5,
  /**
   * A stage-3 pincer's second wolf crouches this long after the first (its own growl, from its
   * side, announces it), so a quick torch-bearer can answer one and turn to the other.
   */
  pincerStagger: .35,
  /** After any attack ends, the pack waits this long before the next warning crouch. */
  attackGap: 2,
  /** After a respawn the pack keeps its distance (and off the fire) this long. */
  respiteSeconds: 15,
  /** Low-fuel warning threshold; from the smother stage the warning comes earlier. */
  lowFuel: 15,
  lowFuelSmother: 35,
  /**
   * Night wolves arrive in waves, not all at dusk: `nightWaveAt` is each wave's clock
   * offset from nightfall (s, negative = late dusk) and `nightWaves[stage]` its size.
   * Totals match story.ts WOLVES_BY_STAGE.
   */
  nightWaveAt: [-8, 20, 45],
  nightWaves: [[0, 0, 0], [1, 0, 0], [2, 1, 0], [2, 2, 1]],
} as const;

/** Fuel a respawn relights the camp fire with: more once the Hollow smother it (SURVIVAL.respawnFuelSmother). */
export function respawnFuelFor(stage: number): number {
  return stage >= DANGER.smotherFromStage ? SURVIVAL.respawnFuelSmother : SURVIVAL.respawnFuel;
}

/**
 * Finale: hold a lit torch in the Spire beacon (needs page 5) for `holdSeconds`. The
 * sky goes dark as the hold begins, and three guardian waves of fixed size rise at
 * the `waves` progress marks, whatever the danger stage (better kit never makes it
 * harder).
 *
 * The torch hand holds; the other hand defends. Guardians attack `attackSlots[wave]`
 * at a time, `attackGap[wave]` apart (the last wave two at once). Every guardian not
 * attacking presses the beacon: it crouches within `pressRadius` of the brazier (on
 * a ring of `pressRing`, away from the player) and drains `pressPerGuardian` of
 * progress per second until it is warded off, scared (a torch poke) or killed (a
 * bolt, the sentry). Each bite knocks `biteSetback` off the progress. The last wave
 * (5) outnumbers one crossbow's 8 bolts: bring the sentry, or keep driving them off.
 * A quick jab with the beacon torch (out of the brazier up to `graceSeconds`) only
 * pauses the fill; longer, it cools at `decayPerSecond`, cheap enough to defend yourself.
 */
export const FINALE = {
  holdSeconds: 24, decayPerSecond: .08, graceSeconds: 1, requiresPage: 5,
  waves: [.02, .35, .65], waveSizes: [2, 3, 5],
  attackSlots: [1, 1, 2], attackGap: [4, 3.5, 2.5],
  pressRadius: 2.6, pressRing: 1.8, pressSpread: 1.6, pressPerGuardian: .0065, biteSetback: .05,
} as const;

/** Finale guardian attack slots for a wave (1-based; before the first wave, the first's). */
export function finaleSlots(wave: number): number {
  return FINALE.attackSlots[Math.max(0, Math.min(FINALE.attackSlots.length - 1, wave - 1))];
}

/** Finale seconds between guardian attacks for a wave (1-based; before the first wave, the first's). */
export function finaleGap(wave: number): number {
  return FINALE.attackGap[Math.max(0, Math.min(FINALE.attackGap.length - 1, wave - 1))];
}

/**
 * Beacon progress per second: the hold's own rate (nothing while the flame is out on
 * a jab of up to FINALE.graceSeconds (`grace`), the decay once it is out for longer)
 * minus the guardians pressing it.
 */
export function beaconRate(holding: boolean, pressing: number, grace = false): number {
  const own = holding ? 1 / FINALE.holdSeconds : grace ? 0 : -FINALE.decayPerSecond;
  return own - Math.max(0, pressing) * FINALE.pressPerGuardian;
}

/**
 * Sleep from a third of the way into the night, never mid-attack; beside a cold fire only
 * with no wolf near. A death at dusk or night leaves you `shakenSeconds` too shaken to sleep
 * (dying is no shortcut to the morning).
 */
export const SLEEP = { minNightFraction: .35, wolfClearRadius: 4, coldWolfClearRadius: 8, shakenSeconds: 60 } as const;

/**
 * The camp sentry: range, reload beat, and its aim. It leads a moving wolf but its aim
 * wanders: the spread (m, one sigma, across the line of fire) grows with distance and
 * with the target's speed, so a prowler at 10 m is hit about three times in four.
 */
export const SENTRY = {
  range: 12, cooldown: 1.5, boltSpeed: 30,
  spreadBase: .15, spreadPerMetre: .0075, spreadPerSpeed: .03,
  /** Effective radius (m) a bolt must pass within to strike a wolf's body. */
  hitRadius: .45,
} as const;

/** One-sigma aim error (m) across the line of fire for a target this far away and this fast. */
export function sentrySpread(distance: number, speed: number): number {
  return SENTRY.spreadBase + SENTRY.spreadPerMetre * Math.max(0, distance) + SENTRY.spreadPerSpeed * Math.max(0, speed);
}

/** Chance a round 2-D normal aim error of `spread` lands within `radius` (Rayleigh CDF). */
export function hitChance(spread: number, radius: number = SENTRY.hitRadius): number {
  return spread <= 0 ? 1 : 1 - Math.exp(-(radius * radius) / (2 * spread * spread));
}

/** One day cycle in seconds: day → dusk → night → dawn. */
export const DAY = { day: 300, dusk: 30, night: 150, dawn: 30 } as const;
export const DAY_LENGTH = DAY.day + DAY.dusk + DAY.night + DAY.dawn;
export type Phase = 'day' | 'dusk' | 'night' | 'dawn';

export function phaseAt(clock: number): Phase {
  const t = ((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
  if (t < DAY.day) return 'day';
  if (t < DAY.day + DAY.dusk) return 'dusk';
  if (t < DAY.day + DAY.dusk + DAY.night) return 'night';
  return 'dawn';
}

/** 0 at full day, 1 at full night, eased through dusk and dawn. */
export function nightness(clock: number): number {
  const t = ((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
  const ease = (v: number) => v * v * (3 - 2 * v);
  if (t < DAY.day) return 0;
  if (t < DAY.day + DAY.dusk) return ease((t - DAY.day) / DAY.dusk);
  if (t < DAY.day + DAY.dusk + DAY.night) return 1;
  return 1 - ease((t - DAY.day - DAY.dusk - DAY.night) / DAY.dawn);
}
/** Clock value at the first moment of dawn of the same cycle. */
export const DAWN_CLOCK = DAY.day + DAY.dusk + DAY.night;

export const ingredientBit = (kind: string): number =>
  kind === 'meat' ? 1 : kind === 'mushroom' ? 2 : 0;
export const materialSlot = (kind: string): number =>
  kind === 'stick' ? 0 : kind === 'cloth' ? 1 : kind === 'resin' ? 2 : -1;

export function inPot(x: number, y: number, z: number): boolean {
  return Math.hypot(x - CAMP.pot.x, z - CAMP.pot.z) < 0.29 &&
    y > CAMP.pot.y - 0.12 && y < CAMP.pot.y + 0.25;
}

/** Any of the three input bays (bay index), or -1. */
export function benchBayAt(x: number, y: number, z: number): number {
  if (Math.abs(z - CAMP.bench.z) >= 0.25 || Math.abs(y - CAMP.bench.y) >= 0.23) return -1;
  for (let slot = 0; slot < 3; slot++) {
    if (Math.abs(x - CAMP.bench.x - CAMP.slotOffsets[slot]) < 0.22) return slot;
  }
  return -1;
}

export function inMaterialSlot(slot: number, x: number, y: number, z: number): boolean {
  return slot >= 0 && benchBayAt(x, y, z) === slot;
}

export function stirTravel(previous: number, next: number): number {
  const delta = Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
  // Teleports and a sample across the pot cannot count as a circular stroke.
  return Math.abs(delta) < 0.8 ? Math.abs(delta) : 0;
}

export function inFire(x: number, y: number, z: number): boolean {
  return Math.hypot(x - CAMP.fire.x, z - CAMP.fire.z) < 0.3 && y > 0.22 && y < 0.86;
}

/** Release point counts as "into the fire ring" for fuel (wider than ignition). */
export function inFireRing(x: number, y: number, z: number): boolean {
  return Math.hypot(x - CAMP.fire.x, z - CAMP.fire.z) < 0.5 && y > 0 && y < 1.0;
}

/**
 * Camp surfaces that catch dropped items (oriented boxes in world space). The
 * trestle top is raised when the unrolled pack lies on it (see BackpackSystem).
 * Valley props that items rest on carry the ItemSurface component instead.
 */
export type Surface = { id: string; x: number; z: number; hx: number; hz: number; yawDeg: number; y: number };
export const SURFACES: readonly Surface[] = [
  { id: 'bench-bays', x: -2.15, z: -1.55, hx: 1.1, hz: .3, yawDeg: 0, y: 1.0 },
  { id: 'bench', x: -2.15, z: -1.55, hx: 1.24, hz: .45, yawDeg: 0, y: .935 },
  { id: 'trestle', x: 1.96, z: -.7, hx: .975, hz: .59, yawDeg: 0, y: .79 },
  { id: 'stump', x: 2.7, z: -3.25, hx: .22, hz: .22, yawDeg: 0, y: .425 },
  { id: 'bedroll', x: -1.55, z: -3.05, hx: .68, hz: .4, yawDeg: 57.4, y: .13 },
];

/** Height of the highest surface under (x, z), or -Infinity. */
export function surfaceHeight(x: number, z: number, surfaces: readonly Surface[] = SURFACES): number {
  let best = -Infinity;
  for (const s of surfaces) {
    const yaw = s.yawDeg * Math.PI / 180, dx = x - s.x, dz = z - s.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(lx) <= s.hx && Math.abs(lz) <= s.hz && s.y > best) best = s.y;
  }
  return best;
}

export const THROW = { gravity: 9.81, minThrowSpeed: .35, maxSpeed: 18, damageSpeed: 4, bounce: .25, killY: -5 } as const;
