import { createSystem, Entity, UIKit, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { bus } from '../bus.js';
import { GameState } from '../components.js';
import { BENCH_RECIPES, knownRecipes, PRODUCT_COUNT } from '../recipes.js';
import { DAY, DAY_LENGTH, nightness, phaseAt, Phase } from '../rules.js';
import { type ComfortKey, cycleSetting, onSettings, settingLit, settingText } from '../settings.js';
import { currentObjective, ENDING, objectiveIndex, objectiveRank, OBJECTIVES, PAGES } from '../story.js';
import { DayNightSystem } from './daynight-system.js';
import { StorySystem } from './story-system.js';

/* ------------------------------------------------------------------------------------------
 * Shared UI helpers (imported by the wrist, toast and reader systems).
 * ---------------------------------------------------------------------------------------- */

/**
 * The bundled MSDF font atlases cover ASCII + Latin-1 only, so typographic punctuation
 * from story text (’ “ ” … — ·) would render as nothing. Map it to plain equivalents.
 */
export function plain(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/·/g, '-')
    .replace(/[^\u0000-ÿ]/g, '');
}

/** '0%'..'100%' without allocating a string per update. */
export const PERCENT: readonly `${number}%`[] = Array.from({ length: 101 }, (_, i) => `${i}%` as const);
/** Integer labels 0..100 for the vitals readouts. */
export const NUMBER: readonly string[] = Array.from({ length: 101 }, (_, i) => `${i}`);

export const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
/** Vitals bar bands, green -> amber -> red: 0 fine, 1 low, 2 critical. */
export const hungerBand = (value: number) => (value >= 50 ? 0 : value >= 25 ? 1 : 2);
export const healthBand = (value: number) => (value >= 60 ? 0 : value >= 35 ? 1 : 2);

/** Day-cycle presentation shared by the journal and wrist. */
export const PHASE_INDEX: Readonly<Record<Phase, number>> = { day: 0, dusk: 1, night: 2, dawn: 3 };
export const SKY_ICON_SUFFIX = ['day', 'dusk', 'night', 'dawn'] as const;
export function phaseLabel(clock: number): string {
  const phase = phaseAt(clock);
  if (phase !== 'day') return phase === 'dusk' ? 'Dusk' : phase === 'night' ? 'Night' : 'Dawn';
  const t = ((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
  return t < DAY.day / 2 ? 'Morning' : 'Afternoon';
}

/** Any UIKit element; `setProperties` accepts text and style keys alike. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Element = UIKit.Component<any>;
export type Style = Parameters<Element['setProperties']>[0];

/** Resolves element ids once and applies text only when it changed. */
export class PanelText {
  private readonly elements = new Map<string, Element>();
  private readonly shown = new Map<string, string>();

  constructor(readonly asset: UIKitMLAsset, ids: readonly string[], label: string) {
    for (const id of ids) {
      const element = asset.getElementById<Element>(id);
      if (element) this.elements.set(id, element);
      else console.warn(`[Prometheus UI] ${label}: element #${id} is missing`);
    }
  }

  get(id: string): Element | undefined {
    return this.elements.get(id);
  }

  text(id: string, value: string): void {
    if (this.shown.get(id) === value) return;
    this.shown.set(id, value);
    this.elements.get(id)?.setProperties({ text: value });
  }

  style(id: string, style: Style): void {
    this.elements.get(id)?.setProperties(style);
  }
}

export const SHOW: Style = { display: 'flex' };
export const HIDE: Style = { display: 'none' };

/**
 * Cross-system hook without an import cycle: ReaderSystem (which imports this module)
 * registers its board reader here; JournalSystem calls it when a found page is tapped.
 */
export const readerHooks: {
  toggleBoard?: (pageIndex: number, board: import('@iwsdk/core').Object3D) => void;
  boardIndex?: () => number;
} = {};

/* ------------------------------------------------------------------------------------------
 * Night palette: every colour token lerps from its day value toward a darker night value
 * by nightness(clock), so the board never glows brighter than the dark valley. Night
 * values keep small text >= 4.5:1 against its card (locked #7f8b80 on #151f1a = 4.7:1).
 * ---------------------------------------------------------------------------------------- */

const NIGHT_STEPS = 8;
const TOKENS = {
  panel: ['#192520', '#0e1512'],
  frame: ['#75634a', '#4a3f30'],
  card: ['#25352d', '#151f1a'],
  focus: ['#2b3c32', '#18231d'],
  ink: ['#ede9da', '#bdb7a6'],
  hint: ['#d3dacd', '#a9aea4'],
  muted: ['#a5b2a5', '#8a968a'],
  item: ['#a9b8a8', '#909d8f'],
  dim: ['#909f92', '#7f8b80'],
  gold: ['#d4b180', '#a88d66'],
  brass: ['#cba875', '#9c8157'],
  rule: ['#3a4a40', '#26312b'],
  track: ['#141e19', '#0b110e'],
  boxLine: ['#5d6d60', '#435047'],
  vitalOk: ['#86b36a', '#67894f'],
  vitalLow: ['#e0a53f', '#ad7f31'],
  vitalCrit: ['#e0503a', '#b0402e'],
  warn: ['#e58a55', '#b86e44'],
  btn: ['#d9ae70', '#9c7f55'],
  btnHover: ['#e6c089', '#ad8e61'],
  btnLine: ['#b78d59', '#7f6440'],
  btnInk: ['#17231e', '#0b110e'],
  quietLine: ['#667567', '#465048'],
  quietInk: ['#d5dece', '#a6ada0'],
  armed: ['#7c2f22', '#5a2219'],
  armedLine: ['#c4583f', '#8f402e'],
  rowHover: ['#33473c', '#1f2c25'],
  inset: ['#1e2b24', '#101814'],
} as const;
type Token = keyof typeof TOKENS;
type Palette = Record<Token, string>;

function mixHex(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  let out = '#';
  for (const shift of [16, 8, 0]) {
    const va = (ca >> shift) & 255;
    const vb = (cb >> shift) & 255;
    out += Math.round(va + (vb - va) * t).toString(16).padStart(2, '0');
  }
  return out;
}

const PALETTES: readonly Palette[] = Array.from({ length: NIGHT_STEPS + 1 }, (_, step) => {
  const palette = {} as Palette;
  for (const key of Object.keys(TOKENS) as Token[]) palette[key] = mixHex(TOKENS[key][0], TOKENS[key][1], step / NIGHT_STEPS);
  return palette;
});

/** Per-step style objects, built once. */
function styles(p: Palette) {
  return {
    boxDone: { backgroundColor: p.gold, borderColor: p.gold } as Style,
    boxNow: { backgroundColor: p.card, borderColor: p.gold } as Style,
    boxTodo: { backgroundColor: p.card, borderColor: p.boxLine } as Style,
    textDone: { color: p.dim, fontWeight: 500 } as Style,
    textNow: { color: p.ink, fontWeight: 700 } as Style,
    textTodo: { color: p.item, fontWeight: 500 } as Style,
    knownName: { color: p.ink } as Style,
    knownInputs: { color: p.gold } as Style,
    unknown: { color: p.dim } as Style,
    pageOn: { color: p.ink, cursor: 'pointer', hover: { backgroundColor: p.rowHover } } as Style,
    pageOff: { color: p.dim, cursor: 'default', hover: { backgroundColor: p.card } } as Style,
    /** Bar fill per band (green, amber, red), shared by hunger and health. */
    vital: [{ backgroundColor: p.vitalOk }, { backgroundColor: p.vitalLow }, { backgroundColor: p.vitalCrit }] as Style[],
    value: [{ color: p.gold }, { color: p.vitalLow }, { color: p.vitalCrit }] as Style[],
    xrButton: { backgroundColor: p.btn, borderColor: p.btnLine, color: p.btnInk, hover: { backgroundColor: p.btnHover } } as Style,
    newIdle: { backgroundColor: p.panel, borderColor: p.quietLine, hover: { backgroundColor: p.card } } as Style,
    newArmed: { backgroundColor: p.armed, borderColor: p.armedLine, hover: { backgroundColor: p.armed } } as Style,
    newIdleLabel: { text: 'New journey', fontSize: 2.8, color: p.quietInk } as Style,
    /** After the ending New journey is the way on: the primary button. */
    newPrimary: { backgroundColor: p.btn, borderColor: p.btnLine, hover: { backgroundColor: p.btnHover } } as Style,
    newPrimaryLabel: { text: 'New journey', fontSize: 2.8, color: p.btnInk } as Style,
    /** Comfort chip values: lit (on, or any speed/turning) in gold, off in the quiet ink. */
    chipOn: { color: p.gold } as Style,
    chipOff: { color: p.quietInk } as Style,
    newArmedLabel: { text: 'Tap again to erase your journey', fontSize: 2.3, color: p.ink } as Style,
    /** Class-wide colours, applied in order (jr-focus after jr-card). */
    classes: [
      ['jr-root', { backgroundColor: p.panel, borderColor: p.frame, color: p.ink }],
      ['jr-card', { backgroundColor: p.card }],
      ['jr-focus', { backgroundColor: p.focus, borderColor: p.gold }],
      ['jr-eyebrow', { color: p.brass }],
      ['jr-num', { color: p.brass }],
      ['jr-brand', { color: p.ink }],
      ['jr-day', { color: p.ink }],
      ['jr-clock', { color: p.muted }],
      ['jr-label', { color: p.muted }],
      ['jr-help', { color: p.muted }],
      ['jr-caption', { color: p.muted }],
      ['jr-sky', { color: p.gold }],
      ['jr-tonight', { color: p.gold }],
      ['jr-tonight-icon', { color: p.gold }],
      ['jr-tonight-row', { backgroundColor: p.inset }],
      ['jr-obj-hint', { color: p.hint }],
      ['jr-end-body', { color: p.ink }],
      ['jr-rule', { backgroundColor: p.rule }],
      ['jr-track', { backgroundColor: p.track }],
      ['jr-tick', { color: p.panel }],
      ['jr-chip', { backgroundColor: p.panel, borderColor: p.quietLine, hover: { backgroundColor: p.rowHover } }],
      ['jr-chip-label', { color: p.muted }],
      ['jr-stat', { backgroundColor: p.inset }],
      ['jr-stat-label', { color: p.muted }],
      ['jr-stat-val', { color: p.gold }],
      ['jr-end-prompt', { color: p.gold }],
    ] as [string, Style][],
  };
}
const STYLES = PALETTES.map(styles);
type Styles = (typeof STYLES)[number];

/* ------------------------------------------------------------------------------------------
 * Journal constants: every string is prepared once so refreshes only pick references.
 * ---------------------------------------------------------------------------------------- */

const SLEEP = objectiveIndex('sleep');
const OBJ_BOX = OBJECTIVES.map((_, i) => `jr-o${i}-box`);
const OBJ_TICK = OBJECTIVES.map((_, i) => `jr-o${i}-tick`);
const OBJ_TEXT = OBJECTIVES.map((_, i) => `jr-o${i}-text`);
const OBJ_TITLE = OBJECTIVES.map((o) => plain(o.title));
const OBJ_HINT = OBJECTIVES.map((o) => plain(o.hint));
const OBJ_NUM = OBJECTIVES.map((_, i) => `${objectiveRank(i)} OF ${OBJECTIVES.length}`);
const OBJ_COUNT = Array.from({ length: OBJECTIVES.length + 1 }, (_, i) => `${i} / ${OBJECTIVES.length}`);
/** Secondary line while the sleep objective waits for the night. */
export const TONIGHT_TEXT = `Tonight: ${OBJ_TITLE[SLEEP] ?? 'Survive the night, then sleep'}`;

const REC_NAME = BENCH_RECIPES.map((_, i) => `jr-r${i}-name`);
const REC_INPUTS = BENCH_RECIPES.map((_, i) => `jr-r${i}-inputs`);
const REC_LABEL = BENCH_RECIPES.map((r) => r.label);
/** Journal notation: 'stick, reeds, resin'; duplicates fold into '2 sticks' ('3 reeds' stays plural). */
export function recipeInputs(inputs: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const kind of inputs) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => (n > 1 ? `${n} ${kind.endsWith('s') ? kind : `${kind}s`}` : kind)).join(', ');
}
const REC_TEXT = BENCH_RECIPES.map((r) => recipeInputs(r.inputs));
/** An unlearned recipe is a lead, not a dead end: the page that teaches it and where it lies. */
const REC_TEASER = BENCH_RECIPES.map((r) => {
  const page = PAGES.find((p) => p.teaches === r.product);
  return page ? plain(`Page ${page.index}, ${page.where}`) : 'not yet learned';
});
/** The tally counts the page-taught products; the parts are known from the start. */
const REC_COUNT = Array.from({ length: PRODUCT_COUNT + 1 }, (_, i) => `${i} / ${PRODUCT_COUNT}`);

const PAGE_ID = PAGES.map((_, i) => `jr-p${i}`);
const PAGE_FOUND = PAGES.map((p, i) => `${i + 1}.  ${plain(p.title)}`);
const PAGE_MISSING = PAGES.map((_, i) => `${i + 1}.  ...`);
const PAGE_COUNT = Array.from({ length: PAGES.length + 1 }, (_, i) => `${i} / ${PAGES.length}`);

const SKY_IDS = SKY_ICON_SUFFIX.map((s) => `jr-ic-${s}`);

/** Comfort chips (element id -> the setting it steps, via settings.ts cycleSetting). */
const CHIPS: readonly { key: ComfortKey; id: string; value: string; name: string }[] = [
  { key: 'speed', id: 'jr-set-speed', value: 'jr-set-speed-val', name: 'Walking Speed Setting' },
  { key: 'turn', id: 'jr-set-turn', value: 'jr-set-turn-val', name: 'Turning Setting' },
  { key: 'tunnel', id: 'jr-set-tunnel', value: 'jr-set-tunnel-val', name: 'Comfort Tunnel Setting' },
  { key: 'flashes', id: 'jr-set-flashes', value: 'jr-set-flashes-val', name: 'Reduce Flashes Setting' },
  { key: 'subs', id: 'jr-set-subs', value: 'jr-set-subs-val', name: 'Subtitles Setting' },
];
const STAT_IDS = ['jr-st-days', 'jr-st-falls', 'jr-st-pages', 'jr-st-recipes', 'jr-st-made', 'jr-st-slain'] as const;
const popcount = (mask: number) => {
  let n = 0;
  for (let m = mask >>> 0; m; m &= m - 1) n++;
  return n;
};

const IDS: readonly string[] = [
  ...OBJ_BOX, ...OBJ_TICK, ...OBJ_TEXT, ...REC_NAME, ...REC_INPUTS, ...PAGE_ID, ...SKY_IDS,
  'jr-day', 'jr-clock', 'jr-obj-card', 'jr-obj-num', 'jr-obj-title', 'jr-obj-hint', 'jr-tonight-row',
  'jr-end-card', 'jr-end-title', 'jr-end-body', 'jr-obj-count', 'jr-rec-count', 'jr-pages-count',
  'jr-hunger-val', 'jr-hunger-fill', 'jr-health-val', 'jr-health-fill',
  'enter-xr', 'exit-xr', 'jr-new', 'jr-new-label',
  ...CHIPS.flatMap((c) => [c.id, c.value]), ...STAT_IDS,
];

const CONFIRM_SECONDS = 4;
const ALL_DONE_TITLE = 'The valley is warm';
const ALL_DONE_HINT = plain(ENDING.rest);

/**
 * Field journal at camp (scene node 'camp-journal'). Reads GameState at 5 Hz and
 * writes UIKit properties only when a snapshot changed. Re-binds after a level
 * reload (New journey: StartSystem resets the world by reloading the level, which
 * rebuilds the scene panel).
 * - The current objective follows the day rule (sleep waits for the night) with a
 *   "Tonight:" line while sleep is pending.
 * - Colours dim with nightness in 8 steps (class-wide restyle only when the step changes).
 * - Tapping a found page title re-opens it on the board (ReaderSystem, 12 s).
 * - Unlearned recipes name the page that teaches them and where it lies.
 * - COMFORT chips step the player settings (settings.ts cycleSetting, saved per device):
 *   walking speed, turning, comfort tunnel, reduce flashes, subtitles. Others read them live.
 * - After the ending the end card shows the journey (days, falls, pages, recipes, things
 *   made, Hollow slain: StorySystem.stats, saved with the journey; the 'epilogue' event's
 *   tally when it arrives) and New journey becomes the primary button.
 * Emits: `new-game` (two-step confirm), which StartSystem answers with the same full
 * reset the start panel's New journey uses. Calls world.launchXR / exitXR.
 */
export class JournalSystem extends createSystem({
  game: { required: [GameState] },
}) {
  private panel?: UIKitMLAsset;
  private ui?: PanelText;
  private unbind: (() => void)[] = [];
  private game?: Entity;
  private needsBind = true;
  private bindTimer = 0;
  private refreshTimer = 0;
  private now = 0;
  private confirmUntil = 0;
  private step = -1;
  private s: Styles = STYLES[0];

  private objectiveRows = new Int8Array(OBJECTIVES.length).fill(-1);
  private recipeRows = new Int8Array(BENCH_RECIPES.length).fill(-1);
  private pageRows = new Int8Array(PAGES.length).fill(-1);
  private snapObjectives = -1;
  private snapEnded = -1;
  private snapRecipes = -1;
  private snapPages = -1;
  private snapHunger = -1;
  private snapHealth = -1;
  private snapDay = -1;
  private snapPhase = -1;
  private snapClock = -1;
  private snapStats = '';
  /** The epilogue's tally when it arrives (bus 'epilogue'); StorySystem.stats otherwise. */
  private epilogue: { days?: number; deaths?: number; crafted?: number; slain?: number } = {};
  private ended = false;

  private readonly onEnter = () => this.world.launchXR();
  private readonly onExit = () => this.world.exitXR();
  private readonly onNew = () => {
    if (this.confirmUntil > 0 && this.now < this.confirmUntil) {
      this.setConfirm(false);
      bus.emit({ type: 'new-game' });
      return;
    }
    this.setConfirm(true);
  };

  init(): void {
    this.cleanupFuncs.push(
      // Level (re)loads rebuild the scene panel and GameState: resolve again.
      this.world.activeLevel.subscribe(() => { this.needsBind = true; }),
      this.visibilityState.subscribe(() => this.applyXrButtons()),
      this.queries.game.subscribe('qualify', (entity) => {
        this.game = entity;
        this.resetSnapshots();
      }, true),
      this.queries.game.subscribe('disqualify', (entity) => {
        if (this.game !== entity) return;
        this.game = undefined;
        for (const other of this.queries.game.entities) if (other !== entity) this.game = other;
        this.resetSnapshots();
      }),
      bus.on('new-game', () => {
        this.setConfirm(false);
        this.epilogue = {};
      }),
      bus.on('epilogue', (event) => {
        this.epilogue = { days: event.days, deaths: event.deaths, crafted: event.crafted, slain: event.slain };
        this.snapStats = '';
      }),
      onSettings(() => this.applySettings()),
      () => this.unbindPanel(),
    );
    this.tryBind();
  }

  private tryBind(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('camp-journal');
    if (!panel || panel.document.disposed) return;
    this.needsBind = false;
    if (panel === this.panel) return;
    this.unbindPanel();
    this.panel = panel;
    const ui = this.ui = new PanelText(panel, IDS, 'camp-journal');

    const enter = ui.get('enter-xr');
    const exit = ui.get('exit-xr');
    const fresh = ui.get('jr-new');
    // Stable names let the XR verification tools resolve exact button transforms.
    if (enter) { enter.name = 'Enter VR Button'; enter.addEventListener('click', this.onEnter); }
    if (exit) { exit.name = 'Leave VR Button'; exit.addEventListener('click', this.onExit); }
    if (fresh) { fresh.name = 'New Journey Button'; fresh.addEventListener('click', this.onNew); }
    this.unbind.push(() => {
      enter?.removeEventListener('click', this.onEnter);
      exit?.removeEventListener('click', this.onExit);
      fresh?.removeEventListener('click', this.onNew);
    });
    // Comfort chips: each tap steps its setting (saved; locomotion, the vignette and the subtitles follow).
    for (const chip of CHIPS) {
      const element = ui.get(chip.id);
      if (!element) continue;
      element.name = chip.name;
      const onTap = () => cycleSetting(chip.key);
      element.addEventListener('click', onTap);
      this.unbind.push(() => element.removeEventListener('click', onTap));
    }
    // Found pages re-open on the board.
    for (let i = 0; i < PAGES.length; i++) {
      const row = ui.get(PAGE_ID[i]);
      if (!row) continue;
      row.name = `Journal Page ${i + 1}`;
      const onTap = () => {
        if (this.pageRows[i] === 1 && this.panel) readerHooks.toggleBoard?.(i + 1, this.panel);
      };
      row.addEventListener('click', onTap);
      this.unbind.push(() => row.removeEventListener('click', onTap));
    }

    for (let i = 0; i < OBJECTIVES.length; i++) ui.text(OBJ_TEXT[i], OBJ_TITLE[i]);
    ui.text('jr-end-title', plain(ENDING.title));
    // The long ending was told (toasts, the farewell): the card keeps its closing line and makes room for the stats.
    ui.text('jr-end-body', plain(ENDING.toast));
    this.confirmUntil = 0;
    this.step = -1;
    this.resetSnapshots();
    this.applyXrButtons();
    this.applySettings();
    if (this.game?.active) this.refresh(this.game);
  }

  /** Chip values from the live settings (and their colours for the night step). */
  private applySettings(): void {
    const ui = this.ui;
    if (!ui) return;
    for (const chip of CHIPS) {
      ui.text(chip.value, settingText(chip.key));
      ui.style(chip.value, settingLit(chip.key) ? this.s.chipOn : this.s.chipOff);
    }
  }

  private unbindPanel(): void {
    for (const off of this.unbind) off();
    this.unbind.length = 0;
    this.panel = undefined;
    this.ui = undefined;
  }

  private resetSnapshots(): void {
    this.objectiveRows.fill(-1);
    this.recipeRows.fill(-1);
    this.pageRows.fill(-1);
    this.snapObjectives = this.snapEnded = this.snapRecipes = this.snapPages = -1;
    this.snapHunger = this.snapHealth = this.snapDay = this.snapPhase = this.snapClock = -1;
    this.snapStats = '';
  }

  /** Restyle every colour on the board for a new night step (event-like: <= 16 times a day). */
  private applyPalette(step: number): void {
    const ui = this.ui;
    const panel = this.panel;
    if (!ui || !panel) return;
    this.step = step;
    this.s = STYLES[step];
    for (const [className, style] of this.s.classes) {
      for (const element of panel.document.getElementsByClassName(className)) (element as Element).setProperties(style);
    }
    ui.style('enter-xr', this.s.xrButton);
    ui.style('exit-xr', this.s.xrButton);
    this.applyConfirmStyle();
    this.applySettings();
    this.resetSnapshots();
  }

  private applyXrButtons(): void {
    const ui = this.ui;
    if (!ui) return;
    const browser = this.visibilityState.peek() === VisibilityState.NonImmersive;
    const armed = this.confirmUntil > 0;
    ui.style('enter-xr', this.world.xrEnabled && browser && !armed ? SHOW : HIDE);
    ui.style('exit-xr', this.world.xrEnabled && !browser && !armed ? SHOW : HIDE);
  }

  private applyConfirmStyle(): void {
    const ui = this.ui;
    if (!ui) return;
    const armed = this.confirmUntil > 0;
    ui.style('jr-new', armed ? this.s.newArmed : this.ended ? this.s.newPrimary : this.s.newIdle);
    ui.style('jr-new-label', armed ? this.s.newArmedLabel : this.ended ? this.s.newPrimaryLabel : this.s.newIdleLabel);
  }

  private setConfirm(armed: boolean): void {
    this.confirmUntil = armed ? this.now + CONFIRM_SECONDS : 0;
    this.applyConfirmStyle();
    this.applyXrButtons();
  }

  update(delta: number): void {
    this.now += delta;
    if (this.confirmUntil > 0 && this.now >= this.confirmUntil) this.setConfirm(false);

    if (this.needsBind || this.panel?.document.disposed) {
      this.bindTimer += delta;
      if (this.bindTimer >= 0.25) {
        this.bindTimer = 0;
        this.needsBind = true;
        this.tryBind();
      }
    }

    this.refreshTimer += delta;
    if (this.refreshTimer < 0.2) return;
    this.refreshTimer = 0;
    const game = this.game;
    if (this.ui && game?.active) this.refresh(game);
  }

  /** The end card's journey stats (at 5 Hz, written only when they change). */
  private refreshStats(game: Entity): void {
    const ui = this.ui!;
    const e = this.epilogue;
    const live = this.world.getSystem(StorySystem)?.stats;
    const days = e.days ?? live?.days ?? (game.getValue(GameState, 'day') ?? 1);
    const deaths = e.deaths ?? live?.deaths ?? (game.getValue(GameState, 'deaths') ?? 0);
    const made = e.crafted ?? live?.crafted ?? 0;
    const slain = e.slain ?? live?.slain ?? 0;
    const pages = Math.min(PAGES.length, popcount(game.getValue(GameState, 'pages') ?? 0));
    const recipes = popcount(game.getValue(GameState, 'recipes') ?? 0);
    const key = `${days}|${deaths}|${pages}|${made}|${recipes}|${slain}`;
    if (key === this.snapStats) return;
    this.snapStats = key;
    ui.text('jr-st-days', `${days}`);
    ui.text('jr-st-falls', `${deaths}`);
    ui.text('jr-st-pages', `${pages}/${PAGES.length}`);
    ui.text('jr-st-recipes', `${recipes}/${PRODUCT_COUNT}`);
    ui.text('jr-st-made', `${made}`);
    ui.text('jr-st-slain', `${slain}`);
  }

  private refresh(game: Entity): void {
    const ui = this.ui!;
    const clock = game.getValue(GameState, 'clock') ?? 0;

    // Night dimming first: a new step restyles everything below.
    const step = Math.round(Math.max(nightness(clock), this.world.getSystem(DayNightSystem)?.finaleDark ?? 0) * NIGHT_STEPS);
    if (step !== this.step) this.applyPalette(step);
    const s = this.s;

    // Objectives (day rule: sleep waits for the night), the current one, and the ending.
    const objectives = game.getValue(GameState, 'objectives') ?? 0;
    const ended = game.getValue(GameState, 'ended') ? 1 : 0;
    const phaseName = phaseAt(clock);
    const key = objectives | (phaseName === 'day' ? 1 << 20 : 0);
    if (key !== this.snapObjectives || ended !== this.snapEnded) {
      const endedChanged = ended !== this.snapEnded;
      this.snapObjectives = key;
      this.snapEnded = ended;
      const current = ended ? -1 : currentObjective(objectives, phaseName);
      let done = 0;
      for (let i = 0; i < OBJECTIVES.length; i++) {
        const complete = (objectives & (1 << i)) !== 0;
        if (complete) done++;
        const state = complete ? 2 : i === current ? 1 : 0;
        if (this.objectiveRows[i] === state) continue;
        this.objectiveRows[i] = state;
        ui.style(OBJ_BOX[i], state === 2 ? s.boxDone : state === 1 ? s.boxNow : s.boxTodo);
        ui.style(OBJ_TICK[i], state === 2 ? SHOW : HIDE);
        ui.style(OBJ_TEXT[i], state === 2 ? s.textDone : state === 1 ? s.textNow : s.textTodo);
      }
      ui.text('jr-obj-count', OBJ_COUNT[done]);
      if (current >= 0) {
        ui.text('jr-obj-num', OBJ_NUM[current]);
        ui.text('jr-obj-title', OBJ_TITLE[current]);
        ui.text('jr-obj-hint', OBJ_HINT[current]);
      } else {
        ui.text('jr-obj-num', OBJ_COUNT[done]);
        ui.text('jr-obj-title', ALL_DONE_TITLE);
        ui.text('jr-obj-hint', ALL_DONE_HINT);
      }
      const tonight = !ended && current !== SLEEP && (objectives & (1 << SLEEP)) === 0;
      ui.style('jr-tonight-row', tonight ? SHOW : HIDE);
      if (endedChanged) {
        ui.style('jr-obj-card', ended ? HIDE : SHOW);
        ui.style('jr-end-card', ended ? SHOW : HIDE);
        this.ended = ended === 1;
        this.applyConfirmStyle();
      }
    }
    if (ended) this.refreshStats(game);

    // Known bench recipes.
    const recipes = game.getValue(GameState, 'recipes') ?? 0;
    if (recipes !== this.snapRecipes) {
      this.snapRecipes = recipes;
      let known = 0;
      const all = knownRecipes(recipes);
      for (let i = 0; i < BENCH_RECIPES.length; i++) {
        const state = all & (1 << i) ? 1 : 0;
        if (!BENCH_RECIPES[i].part) known += state;
        if (this.recipeRows[i] === state) continue;
        this.recipeRows[i] = state;
        ui.text(REC_NAME[i], REC_LABEL[i]);
        ui.text(REC_INPUTS[i], state ? REC_TEXT[i] : REC_TEASER[i]);
        ui.style(REC_NAME[i], state ? s.knownName : s.unknown);
        ui.style(REC_INPUTS[i], state ? s.knownInputs : s.unknown);
      }
      ui.text('jr-rec-count', REC_COUNT[known]);
    }

    // Pages found (found rows are tappable).
    const pages = game.getValue(GameState, 'pages') ?? 0;
    if (pages !== this.snapPages) {
      this.snapPages = pages;
      let found = 0;
      for (let i = 0; i < PAGES.length; i++) {
        const state = pages & (1 << i) ? 1 : 0;
        found += state;
        if (this.pageRows[i] === state) continue;
        this.pageRows[i] = state;
        ui.text(PAGE_ID[i], state ? PAGE_FOUND[i] : PAGE_MISSING[i]);
        ui.style(PAGE_ID[i], state ? s.pageOn : s.pageOff);
      }
      ui.text('jr-pages-count', PAGE_COUNT[found]);
    }

    // Vitals.
    const hunger = clampPercent(game.getValue(GameState, 'hunger') ?? 0);
    if (hunger !== this.snapHunger) {
      const bandChanged = this.snapHunger < 0 || hungerBand(hunger) !== hungerBand(this.snapHunger);
      this.snapHunger = hunger;
      ui.text('jr-hunger-val', NUMBER[hunger]);
      ui.get('jr-hunger-fill')?.setProperties({ width: PERCENT[hunger] });
      if (bandChanged) {
        const b = hungerBand(hunger);
        ui.style('jr-hunger-fill', s.vital[b]);
        ui.style('jr-hunger-val', s.value[b]);
      }
    }
    const health = clampPercent(game.getValue(GameState, 'health') ?? 0);
    if (health !== this.snapHealth) {
      const bandChanged = this.snapHealth < 0 || healthBand(health) !== healthBand(this.snapHealth);
      this.snapHealth = health;
      ui.text('jr-health-val', NUMBER[health]);
      ui.get('jr-health-fill')?.setProperties({ width: PERCENT[health] });
      if (bandChanged) {
        const b = healthBand(health);
        ui.style('jr-health-fill', s.vital[b]);
        ui.style('jr-health-val', s.value[b]);
      }
    }

    // Day and time of day.
    const day = game.getValue(GameState, 'day') ?? 1;
    const phase = PHASE_INDEX[phaseName];
    const t = ((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
    const half = phase === 0 && t >= DAY.day / 2 ? 1 : 0;
    if (day !== this.snapDay || phase * 2 + half !== this.snapPhase) {
      if (phase !== this.snapPhase >> 1 || this.snapPhase < 0) {
        for (let i = 0; i < SKY_IDS.length; i++) ui.style(SKY_IDS[i], i === phase ? SHOW : HIDE);
      }
      this.snapDay = day;
      this.snapPhase = phase * 2 + half;
      ui.text('jr-day', `Day ${day} - ${phaseLabel(clock)}`);
    }
    const remaining = phase === 0 ? DAY.day - t : phase === 2 ? DAY.day + DAY.dusk + DAY.night - t : 0;
    const minutes = Math.ceil(remaining / 60);
    const clockKey = phase * 100 + minutes;
    if (clockKey !== this.snapClock) {
      this.snapClock = clockKey;
      ui.text('jr-clock', clockLine(phase, remaining, minutes));
    }
  }
}

function clockLine(phase: number, remaining: number, minutes: number): string {
  if (phase === 1) return 'Night is falling. Stay by the fire.';
  if (phase === 3) return 'The sun is rising';
  const next = phase === 0 ? 'Dusk' : 'Dawn';
  return remaining < 60 ? `${next} is near` : `${next} in ${minutes} min`;
}
