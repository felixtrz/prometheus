/**
 * Carrying on the body (pure, unit-tested in node): the backpack's nine slots and their
 * stacks, the two hip holsters, and the body heading that the worn pack and the holsters
 * follow. BackpackSystem and HolsterSystem own the entities; this module only decides.
 */
import { STACK_LIMIT, stackable } from './catalog.js';

export const PACK_SLOTS = 9;
/** Item.slot of the two holsters, indexed like HIP_SIDE. */
export const HIP_SLOTS = ['hip-left', 'hip-right'] as const;
/** Sideways sign of each holster (left of the body is -X). */
export const HIP_SIDE = [-1, 1] as const;

/** What one pack slot holds: `count` 0 is empty (kind and variant are then stale). */
export type SlotStack = { kind: string; variant: string; count: number };

export const emptyStacks = (): SlotStack[] =>
  Array.from({ length: PACK_SLOTS }, () => ({ kind: '', variant: '', count: 0 }));

/** Slot index of an Item.slot 'pack-N', else -1. */
export function packIndex(slot: string): number {
  if (!slot.startsWith('pack-')) return -1;
  const index = Number(slot.slice(5));
  return Number.isInteger(index) && index >= 0 && index < PACK_SLOTS ? index : -1;
}

/** Holster index of an Item.slot 'hip-left' | 'hip-right', else -1. */
export const hipIndex = (slot: string): number => HIP_SLOTS.indexOf(slot as typeof HIP_SLOTS[number]);

/** Items the pack never takes: the pack itself and the (bulky, deployable) sentry kit. */
export const packable = (kind: string): boolean => kind !== '' && kind !== 'pack' && kind !== 'sentry-kit';

/**
 * Whether one more of (kind, variant) goes into this slot: an empty slot takes anything;
 * a filled one only more of the same stackable kind and variant, up to STACK_LIMIT.
 */
export function fits(stack: SlotStack, kind: string, variant: string): boolean {
  if (stack.count === 0) return true;
  return stackable(kind) && stack.kind === kind && stack.variant === variant && stack.count < STACK_LIMIT;
}

/** Whether putting (kind, variant) into this slot would add to an existing stack. */
export const stacksOnto = (stack: SlotStack, kind: string, variant: string): boolean =>
  stack.count > 0 && fits(stack, kind, variant);

/**
 * The slot a stowed item goes to: the preferred slot when it fits, else a stack of the
 * same kind with room, else the first empty slot; -1 when the pack is full for it.
 */
export function chooseSlot(stacks: readonly SlotStack[], kind: string, variant: string, preferred = -1): number {
  if (!packable(kind)) return -1;
  if (preferred >= 0 && preferred < stacks.length && fits(stacks[preferred], kind, variant)) return preferred;
  for (let i = 0; i < stacks.length; i++) if (stacksOnto(stacks[i], kind, variant)) return i;
  for (let i = 0; i < stacks.length; i++) if (stacks[i].count === 0) return i;
  return -1;
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Head turns past this (rad, ~70°) drag the body round with them. */
export const BODY_LIMIT = 1.2;
/** Within this of the head (rad), the body slowly turns to face where the head does. */
const BODY_SETTLE = .5;
/** Rate (1/s) of that slow turn. */
const BODY_EASE = .6;

/**
 * Body heading (rad, rig-relative) after one frame: looking over a shoulder leaves the
 * body (and the pack and holsters on it) where it was; turning further drags it along,
 * and looking roughly ahead lets it settle toward the head.
 */
export function followYaw(body: number, head: number, delta: number): number {
  const diff = wrap(head - body);
  if (Math.abs(diff) > BODY_LIMIT) return wrap(body + diff - Math.sign(diff) * BODY_LIMIT);
  if (Math.abs(diff) < BODY_SETTLE) return wrap(body + diff * Math.min(1, delta * BODY_EASE));
  return body;
}
