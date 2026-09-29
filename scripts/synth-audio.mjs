#!/usr/bin/env node
/**
 * Prometheus offline sound synthesis (license-clean, no downloads, no npm deps).
 *
 *   node scripts/synth-audio.mjs              # regenerate every clip
 *   node scripts/synth-audio.mjs chop hit     # regenerate only these ids (variants included)
 *   SYNTH_WAV_DIR=/tmp/x node scripts/...     # also keep the intermediate WAVs
 *
 * Deterministic: every clip draws from its own PRNG seeded by its id, so a clip only
 * changes when its own recipe changes. Pure-JS DSP writes a 16-bit WAV, then the
 * ffmpeg CLI encodes it:
 *   - one-shots → mono MP3, 44.1 kHz (libmp3lame)
 *   - loops     → Ogg/Opus, 48 kHz (libopus): mono for positional loops, stereo for the
 *     two head-locked beds. This ffmpeg has no libvorbis and its native Vorbis encoder
 *     is stereo-only; Opus-in-Ogg decodes in Chromium / Quest Browser and trims its
 *     pre-skip, so the loop length stays sample-exact.
 * Loops are seamless: continuous layers are rendered past the loop length and the tail
 * is equal-power crossfaded into the head; sparse events (pops, chirps, bubbles) are
 * placed circularly, and reverb tails are folded back.
 *
 * Variants: `variants('chop', 3, …)` renders chop, chop-2, chop-3 (own seeds, ±6 % pitch);
 * the AudioSystem rotates them. Loudness is normalised on a K-weighted copy, so `rms`
 * targets read roughly as LUFS (one-shots: loudest 400 ms; loops: integrated).
 *
 * Output file names are `<clip id>.<mp3|ogg>`; src/game/audio-assets.ts maps ids to
 * files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'audio');
const FFMPEG = process.env.FFMPEG ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
const TAU = Math.PI * 2;

// ─────────────────────────── deterministic randomness ───────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Per-clip globals, reset before each clip renders. */
let SR = 44100;
let R = mulberry32(1);
const rand = (a = 0, b = 1) => a + (b - a) * R();
const randInt = (a, b) => a + Math.floor(R() * (b - a + 1));
const logRand = (a, b) => a * Math.pow(b / a, R());
const N = (seconds) => Math.max(1, Math.round(seconds * SR));
const db = (d) => Math.pow(10, d / 20);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function weighted(options) {
  let total = 0;
  for (const [, w] of options) total += w;
  let r = R() * total;
  for (const [value, w] of options) { if ((r -= w) <= 0) return value; }
  return options[options.length - 1][0];
}

// ─────────────────────────────────── signals ────────────────────────────────────
const zeros = (seconds) => new Float32Array(N(seconds));
function white(n) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = R() * 2 - 1; return o; }
function pink(n) {
  const o = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = R() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    o[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return o;
}
function brown(n) {
  const o = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) { last = (last + 0.02 * (R() * 2 - 1)) / 1.02; o[i] = last * 3.5; }
  return o;
}
const noise = (color, n) => (color === 'pink' ? pink(n) : color === 'brown' ? brown(n) : white(n));
/** Two noise channels sharing `corr` of their power (stereo width without phasiness). */
function noisePair(color, n, corr = 0.6) {
  const common = noise(color, n), a = noise(color, n), b = noise(color, n);
  const c = Math.sqrt(corr), s = Math.sqrt(1 - corr);
  for (let i = 0; i < n; i++) { a[i] = c * common[i] + s * a[i]; b[i] = c * common[i] + s * b[i]; }
  return [a, b];
}

/** Smooth random modulator in [-1, 1] (smoothstep-interpolated value noise). */
function smooth(rate, seconds) {
  const count = Math.ceil(rate * seconds) + 3;
  const v = new Float32Array(count);
  for (let i = 0; i < count; i++) v[i] = R() * 2 - 1;
  return (t) => {
    const p = Math.max(0, t) * rate;
    const i = Math.min(count - 2, Math.floor(p));
    const f = p - i;
    const s = f * f * (3 - 2 * f);
    return v[i] * (1 - s) + v[i + 1] * s;
  };
}

// ─────────────────────────────────── filters ────────────────────────────────────
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, freq, q, gainDb = 0) {
    const f = clamp(freq, 10, SR * 0.45);
    const w = (TAU * f) / SR, c = Math.cos(w), s = Math.sin(w), alpha = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; break;
      case 'hp': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; break;
      case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; break;
      case 'peak': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * c; a2 = 1 - alpha / A; break;
      }
      default: throw new Error(`unknown filter ${type}`);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}
/** Biquad over a whole signal. `freq`/`q` may be functions of time (seconds). */
function filt(x, type, freq, q = 0.707, gainDb = 0) {
  const bq = new Biquad();
  const out = new Float32Array(x.length);
  const dynF = typeof freq === 'function', dynQ = typeof q === 'function';
  if (!dynF && !dynQ) bq.set(type, freq, q, gainDb);
  for (let i = 0; i < x.length; i++) {
    if ((dynF || dynQ) && (i & 31) === 0) {
      const t = i / SR;
      bq.set(type, dynF ? freq(t) : freq, dynQ ? q(t) : q, gainDb);
    }
    out[i] = bq.tick(x[i]);
  }
  return out;
}
/** Approximate K-weighting (loudness measurement only). */
const kweight = (x) => filt(filt(x, 'hp', 60, 0.5), 'peak', 3000, 0.4, 4);

// ────────────────────────────────── envelopes ───────────────────────────────────
/** Linear attack, exponential decay (time constant `tau`). */
const ad = (attack, tau) => (t) => (t < attack ? t / attack : Math.exp(-(t - attack) / tau));
/** Sine-power bump between `start` and `end`. */
const hump = (start, end, pow = 1) => (t) =>
  t <= start || t >= end ? 0 : Math.pow(Math.sin((Math.PI * (t - start)) / (end - start)), pow);
/** Piecewise-linear breakpoint envelope: [[t, v], ...]. */
function lineEnv(points) {
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let k = 1; k < points.length; k++) {
      if (t <= points[k][0]) {
        const [t0, v0] = points[k - 1], [t1, v1] = points[k];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return points[points.length - 1][1];
  };
}
/** Cosine-interpolated breakpoints: no kinks (pitch contours). */
function cosEnv(points) {
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let k = 1; k < points.length; k++) {
      if (t <= points[k][0]) {
        const [t0, v0] = points[k - 1], [t1, v1] = points[k];
        const u = (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      }
    }
    return points[points.length - 1][1];
  };
}
function applyEnv(x, fn) { for (let i = 0; i < x.length; i++) x[i] *= fn(i / SR); return x; }
/** Raised-cosine fade over a buffer's last `s` seconds, so decaying layers never stop on a step. */
function tailFade(o, s = 0.01) {
  const f = Math.min(o.length, N(s));
  for (let i = 0; i < f; i++) o[o.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
  return o;
}

// ──────────────────────────────────── mixing ────────────────────────────────────
function add(dst, src, at = 0, gain = 1) {
  const o = Math.round(at * SR);
  for (let i = 0; i < src.length; i++) {
    const j = o + i;
    if (j >= dst.length) break;
    if (j >= 0) dst[j] += src[i] * gain;
  }
  return dst;
}
/** Add into a loop buffer, wrapping around its end. */
function addWrap(dst, src, at, gain = 1) {
  const L = dst.length;
  const o = ((Math.round(at * SR) % L) + L) % L;
  for (let i = 0; i < src.length; i++) dst[(o + i) % L] += src[i] * gain;
  return dst;
}
/** Equal-power pan of a mono source into a stereo pair (pan -1 left … 1 right). */
function addWrapPan(pair, src, at, gain, pan) {
  const a = ((pan + 1) * Math.PI) / 4;
  addWrap(pair[0], src, at, gain * Math.cos(a));
  addWrap(pair[1], src, at, gain * Math.sin(a));
}
/** mix(n, [x, gain?, atSeconds?], ...) */
function mix(n, ...layers) {
  const o = new Float32Array(n);
  for (const [x, gain = 1, at = 0] of layers) add(o, x, at, gain);
  return o;
}
function scale(x, g) { for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
function peakOf(x) { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; }
function rmsOf(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); }
function normPeak(x, peak = 1) { const m = peakOf(x); return m > 0 ? scale(x, peak / m) : x; }
/** Set a continuous layer's RMS level in dB (so mix gains mean something). */
function lay(x, dB) { const r = rmsOf(x); return r > 0 ? scale(x, db(dB) / r) : x; }
function sat(x, drive) { const k = Math.tanh(drive); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(drive * x[i]) / k; return x; }
function poisson(seconds, rate, fn) {
  let t = 0;
  for (;;) { t += -Math.log(1 - R()) / rate; if (t >= seconds) return; fn(t); }
}
/** Equal-power crossfade of the tail beyond `L` samples into the head. */
function loopify(x, L) {
  const X = x.length - L;
  const o = x.slice(0, L);
  for (let i = 0; i < X; i++) {
    const p = (i / X) * (Math.PI / 2);
    o[i] = x[i] * Math.sin(p) + x[L + i] * Math.cos(p);
  }
  return o;
}
/** Fold a rendered tail back over a loop of `L` samples (circular convolution). */
function fold(x, L) { const o = new Float32Array(L); for (let i = 0; i < x.length; i++) o[i % L] += x[i]; return o; }

// ────────────────────────────────── generators ──────────────────────────────────
/** Phase-accumulating oscillator; `freq` and `env` may be functions of time. */
function tone(seconds, freq, env, { harmonics = [[1, 1]], phase = 0 } = {}) {
  const n = N(seconds), o = new Float32Array(n);
  const dynF = typeof freq === 'function', dynA = typeof env === 'function';
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) s += harmonics[h][1] * Math.sin(ph * harmonics[h][0]);
    o[i] = s * (dynA ? env(t) : env);
    ph += (TAU * (dynF ? freq(t) : freq)) / SR;
    if (ph > TAU * 4096) ph -= TAU * 4096;
  }
  return tailFade(o);
}
/** Modal (resonant) impact: [[freq, tau, amp], ...] exponentially decaying sines. */
function modes(seconds, list, { attack = 0.0004, jitter = 0 } = {}) {
  const n = N(seconds), o = new Float32Array(n);
  for (const [f0, tau, amp] of list) {
    const w = (TAU * f0 * (1 + (R() * 2 - 1) * jitter)) / SR;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const e = (t < attack ? t / attack : 1) * Math.exp(-t / tau);
      if (t > attack && e < 1e-4) break;
      o[i] += amp * e * Math.sin(w * i);
    }
  }
  return tailFade(o);
}
/** Filtered noise burst with an envelope, peak-normalised to `gain`. */
function burst(seconds, { color = 'white', filters = [], env = ad(0.001, 0.02), gain = 1 } = {}) {
  let x = noise(color, N(seconds));
  for (const [type, f, q = 0.707, g = 0] of filters) x = filt(x, type, f, q, g);
  applyEnv(x, env);
  return normPeak(tailFade(x), gain);
}
/** Tiny cluster of dry micro-clicks (fire crackle, splinters, crunch grains). */
function crackle(amp = 1, fLo = 1500, fHi = 7000, maxClicks = 4) {
  const x = new Float32Array(N(0.024));
  const count = randInt(1, maxClicks);
  for (let c = 0; c < count; c++) {
    const len = rand(0.0002, 0.0012);
    const y = filt(white(N(len + 0.008)), 'bp', logRand(fLo, fHi), rand(1, 2.5));
    applyEnv(y, ad(0.00005, len * 0.7 + 0.0003));
    add(x, normPeak(y, amp * rand(0.35, 1)), rand(0, 0.007));
  }
  return x;
}
/** Resin pop: resonant noise body + sharp click, sometimes a fibre ring. */
function pop(fScale = 1) {
  const body = filt(white(N(0.05)), 'bp', logRand(600, 1800) * fScale, rand(2, 5));
  applyEnv(body, ad(0.0003, rand(0.004, 0.011)));
  const click = filt(white(N(0.004)), 'hp', 2500);
  applyEnv(click, ad(0.00005, 0.0004));
  const x = mix(N(0.06), [normPeak(tailFade(body), 0.8)], [normPeak(click, 1)]);
  if (R() < 0.35) add(x, tone(0.04, rand(1800, 3200) * fScale, ad(0.0002, 0.006)), 0, 0.3);
  return x;
}
/** Liquid bubble: sine whose pitch rises as it decays (van den Doel). */
function bubble(f0, tau, rise = 0.5) {
  const dur = tau * 6;
  return tone(dur, (t) => f0 * (1 + (rise * t) / (3 * tau)), (t) => Math.min(1, t / 0.0006) * Math.exp(-t / tau));
}
/** Karplus-Strong plucked string with fractional (allpass) tuning. */
function pluck(freq, seconds, { decay = 1.5, bright = 0.5, body = 0.25 } = {}) {
  const n = N(seconds), o = new Float32Array(n);
  const D = SR / freq;
  const L = Math.max(2, Math.floor(D - 0.6));
  const d = D - 0.5 - L;
  const C = (1 - d) / (1 + d);
  const buf = new Float32Array(L);
  const k = 0.12 + 0.85 * bright;
  let lp = 0, mean = 0;
  for (let i = 0; i < L; i++) { lp += (R() * 2 - 1 - lp) * k; buf[i] = lp; mean += lp; }
  mean /= L;
  for (let i = 0; i < L; i++) buf[i] -= mean;
  normPeak(buf, 1);
  const rho = Math.pow(10, -3 / (freq * decay));
  let idx = 0, prev = 0, apx = 0, apy = 0;
  for (let i = 0; i < n; i++) {
    const x = buf[idx];
    o[i] = x;
    const avg = rho * 0.5 * (x + prev);
    prev = x;
    const y = C * avg + apx - C * apy;
    apx = avg; apy = y;
    buf[idx] = y;
    if (++idx >= L) idx = 0;
  }
  applyEnv(o, (t) => Math.min(1, t / 0.0015));
  if (body > 0) add(o, tone(seconds, freq, ad(0.004, decay * 0.3)), 0, body);
  return tailFade(o, 0.05);
}
/** Soft bell / chime partials (harmonic, warm). */
function bell(freq, seconds, bright = 1) {
  return mix(N(seconds),
    [tone(seconds, freq, ad(0.003, seconds * 0.32))],
    [tone(seconds, freq * 2, ad(0.002, seconds * 0.14)), 0.28 * bright],
    [tone(seconds, freq * 3, ad(0.002, seconds * 0.07)), 0.1 * bright],
    [tone(seconds, freq * 4.2, ad(0.001, 0.05)), 0.04 * bright]);
}
/** Slow-attack detuned pad voice. */
function padVoice(freq, seconds, { attack = 1, release = 1.5, bright = 0.25, detune = 0.0035 } = {}) {
  const env = (t) => {
    const a = Math.min(1, t / attack), r = clamp((seconds - t) / release, 0, 1);
    return Math.sin((a * Math.PI) / 2) ** 2 * Math.sin((r * Math.PI) / 2) ** 2;
  };
  const harmonics = [[1, 1], [2, bright], [3, bright * 0.3], [4, bright * 0.1]];
  return mix(N(seconds),
    [tone(seconds, freq * (1 - detune), env, { harmonics, phase: rand(0, TAU) }), 0.5],
    [tone(seconds, freq * (1 + detune), env, { harmonics, phase: rand(0, TAU) }), 0.5],
    [tone(seconds, freq, env, { harmonics, phase: rand(0, TAU) }), 0.45]);
}
/** Freeverb-style mono reverb. Output length = input + tail. */
function reverb(x, { room = 0.84, damp = 0.3, wet = 0.3, dry = 1, tail = 2, pre = 0.012 } = {}) {
  const n = x.length + N(tail), o = new Float32Array(n);
  const s = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({ b: new Float32Array(Math.round(d * s)), i: 0, f: 0 }));
  const alls = [556, 441, 341, 225].map((d) => ({ b: new Float32Array(Math.round(d * s)), i: 0 }));
  const pd = N(pre);
  for (let i = 0; i < n; i++) {
    const j = i - pd;
    const inp = (j >= 0 && j < x.length ? x[j] : 0) * 0.015;
    let acc = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.f = y * (1 - damp) + c.f * damp;
      c.b[c.i] = inp + c.f * room;
      if (++c.i >= c.b.length) c.i = 0;
      acc += y;
    }
    for (const a of alls) {
      const bo = a.b[a.i];
      const y = bo - acc;
      a.b[a.i] = acc + bo * 0.5;
      if (++a.i >= a.b.length) a.i = 0;
      acc = y;
    }
    o[i] = (i < x.length ? x[i] * dry : 0) + acc * wet * 3;
  }
  return tailFade(o, 0.1);
}
const NOTE_OFFSETS = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
function hz(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  const semis = NOTE_OFFSETS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
}
const lorentz = (f, fc, bw) => { const d = (f - fc) / bw; return 1 / (1 + d * d); };

// ───────────────────────────────── sound pieces ─────────────────────────────────
/** Ground thud. Identity lives at 85–170 Hz plus earth noise up to ~900 Hz (speaker-safe). */
function thud(amp = 1, { f = 85, drop = 80, tau = 0.09, dirt = 900 } = {}) {
  const body = tone(0.4, (t) => f + drop * Math.exp(-t / 0.02), (t) => Math.min(1, t / 0.002) * Math.exp(-t / tau), { harmonics: [[1, 1], [2, 0.35], [3, 0.12]] });
  const earth = burst(0.2, { filters: [['lp', dirt]], env: ad(0.001, tau * 0.5), gain: 0.7 });
  return scale(mix(N(0.4), [body], [earth]), amp);
}
function woodKnock(f = 200, amp = 1, tau = 0.06) {
  const m = modes(0.35, [[f, tau, 1], [f * 2.3, tau * 0.7, 0.6], [f * 3.8, tau * 0.45, 0.35], [f * 6.1, tau * 0.25, 0.18]], { jitter: 0.03 });
  const tick = burst(0.02, { filters: [['lp', f * 12]], env: ad(0.0002, 0.003), gain: 0.5 });
  return scale(mix(N(0.35), [normPeak(m, 1)], [tick]), amp);
}
function metalClick(f = 2600, amp = 1, tau = 0.01) {
  const m = modes(0.08, [[f, tau, 1], [f * 1.58, tau * 0.8, 0.6], [f * 2.41, tau * 0.6, 0.35]], { jitter: 0.02 });
  const tick = burst(0.006, { filters: [['hp', 2000]], env: ad(0.00005, 0.0006), gain: 0.6 });
  return scale(mix(N(0.08), [normPeak(m, 1)], [tick]), amp);
}
function whoosh(seconds, fFrom, fTo, { q = 1.2, pow = 2, color = 'pink' } = {}) {
  const x = filt(noise(color, N(seconds)), 'bp', (t) => fFrom * Math.pow(fTo / fFrom, Math.sin((Math.PI / 2) * (t / seconds))), q);
  applyEnv(x, hump(0, seconds, pow));
  return normPeak(x, 1);
}
function rustleGrains(seconds, rate, { fLo = 1800, fHi = 6500, env = () => 1 } = {}) {
  const x = new Float32Array(N(seconds + 0.03));
  poisson(seconds, rate, (t) => add(x, crackle(env(t) * rand(0.2, 1), fLo, fHi, 2), t));
  return x;
}
/** Voiced breath through formants (gasp, grunt, panting). */
function breathVoice(seconds, { f0 = 150, f0End = 110, formants = [[800, 5, 1], [1250, 6, 0.7], [2600, 8, 0.3]], voiced = 0.4, env = hump(0, seconds, 1) } = {}) {
  const n = N(seconds);
  const exc = white(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (TAU * (f0 + (f0End - f0) * (t / seconds))) / SR;
    exc[i] = exc[i] * 0.6 + voiced * Math.pow(0.5 + 0.5 * Math.sin(ph), 8) * 3;
  }
  const out = new Float32Array(n);
  for (const [f, q, a] of formants) add(out, normPeak(filt(exc, 'bp', f, q), a));
  return tailFade(applyEnv(out, env));
}
/** Fire bed: low roar, breathing mid band, faint hiss (all continuous). */
function fireBody(n, T, { roarLp = 380, roarDb = -26, breathF = 650, breathDb = -29, hissDb = -44, flicker = 2.6 } = {}) {
  const fl = smooth(flicker, T), br = smooth(0.7, T), hs = smooth(1.3, T);
  const roar = filt(brown(n), 'lp', roarLp, 0.7);
  applyEnv(lay(roar, roarDb), (t) => 0.72 + 0.28 * fl(t));
  const breath = filt(pink(n), 'bp', (t) => breathF + 250 * br(t), 1.0);
  applyEnv(lay(breath, breathDb), (t) => 2 * clamp(0.5 + 0.5 * br(t), 0, 1) ** 2);
  const hiss = filt(white(n), 'bp', 3600, 0.6);
  applyEnv(lay(hiss, hissDb), (t) => 0.6 + 0.4 * hs(t));
  return mix(n, [roar], [breath], [hiss]);
}

// ─────────────────────────────────── birds / owls ───────────────────────────────
function birdWarble() {
  const out = zeros(2.5);
  const base = rand(2300, 3600);
  let t = 0;
  const count = randInt(3, 7);
  for (let k = 0; k < count; k++) {
    const d = rand(0.05, 0.13);
    const fs = base * rand(0.85, 1.25);
    const fe = fs * (R() < 0.5 ? rand(0.7, 0.9) : rand(1.1, 1.4));
    const vib = rand(0, 0.03), vr = rand(30, 70);
    const h = hump(0, d, 0.8);
    add(out, tone(d, (tt) => fs * Math.pow(fe / fs, tt / d) * (1 + vib * Math.sin(TAU * vr * tt)), h, { harmonics: [[1, 1], [2, 0.1]] }), t, rand(0.6, 1));
    t += d + rand(0.03, 0.11);
  }
  return out.slice(0, N(t + 0.05));
}
function birdTrill() {
  const d = rand(0.5, 1.0), fc = rand(3600, 4600), rate = rand(18, 30), dev = rand(250, 500);
  const h = hump(0, d, 0.5);
  return tone(d, (t) => fc + dev * Math.sin(TAU * rate * t) - (300 * t) / d,
    (t) => h(t) * Math.pow(0.5 + 0.5 * Math.sin(TAU * rate * t - 1.2), 2), { harmonics: [[1, 1], [2, 0.08]] });
}
function birdFeebee() {
  const f = rand(3700, 4100);
  const out = zeros(0.9);
  add(out, tone(0.32, (t) => f * (1 - (0.02 * t) / 0.32), hump(0, 0.32, 0.6)), 0);
  add(out, tone(0.4, (t) => f * 0.86 * (1 - (0.015 * t) / 0.4), hump(0, 0.4, 0.6)), 0.42, 0.85);
  return out;
}
function birdDove() {
  const f = rand(470, 560);
  const out = zeros(2.6);
  for (const [at, d, fm, a] of [[0, 0.32, 1, 0.6], [0.42, 0.5, 1.06, 1], [1.0, 0.3, 1, 0.7], [1.45, 0.3, 1, 0.6], [1.85, 0.35, 0.98, 0.5]]) {
    const e = (t) => Math.min(1, t / 0.07) * clamp((d - t) / 0.12, 0, 1);
    add(out, tone(d, (t) => f * fm * (1 - (0.04 * t) / d), e, { harmonics: [[1, 1], [2, 0.18], [3, 0.05]] }), at, a);
  }
  return filt(out, 'lp', 1600);
}
function birdChip() {
  const d = rand(0.025, 0.045), f0 = rand(6000, 7500), f1 = f0 * rand(0.6, 0.75);
  const out = zeros(0.7);
  const reps = randInt(2, 4);
  for (let k = 0; k < reps; k++) add(out, tone(d, (t) => f0 + ((f1 - f0) * t) / d, hump(0, d, 1)), k * rand(0.12, 0.2), rand(0.6, 1));
  return out;
}
function owlNote(seconds, f, vib = 0) {
  const env = (t) => Math.min(1, t / 0.05) * clamp((seconds - t) / 0.14, 0, 1);
  const x = tone(seconds, (t) => f * (0.93 + 0.07 * Math.min(1, t / 0.06)) * (1 - 0.05 * Math.max(0, t - seconds * 0.6) / seconds) * (1 + vib * Math.sin(TAU * 6.5 * t)),
    env, { harmonics: [[1, 1], [2, 0.12], [3, 0.04]] });
  const breath = filt(white(x.length), 'bp', f, 6);
  applyEnv(breath, (t) => env(t));
  add(x, normPeak(breath, 0.25));
  return x;
}
function owlCall(kind, f) {
  const x = zeros(4);
  if (kind === 'tawny') {
    add(x, owlNote(0.75, f), 0);
    add(x, owlNote(0.14, f * 1.02), 1.9, 0.7);
    add(x, owlNote(0.12, f * 1.03), 2.12, 0.75);
    add(x, owlNote(1.1, f * 1.05, 0.035), 2.32);
  } else {
    add(x, owlNote(0.42, f), 0);
    add(x, owlNote(0.52, f * 0.97), 0.62, 0.9);
  }
  return filt(x, 'lp', 2200);
}

// ─────────────────────────────────── wolves ─────────────────────────────────────
/** Near-pure howl voice: 7 steep harmonics, formant-weighted, smooth wobble. */
function howlVoice(seconds, contour, amp, { F1 = () => 600, F2 = () => 1100, harmonics = 7, breakAt = -1 } = {}) {
  const n = N(seconds), o = new Float32Array(n);
  const wob = smooth(2.5, seconds), jit = smooth(9, seconds);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const brk = breakAt > 0 ? 1 - 0.06 * Math.exp(-(((t - breakAt) / 0.07) ** 2)) : 1;
    const f = contour(t) * brk * (1 + 0.008 * wob(t) + 0.002 * jit(t));
    const f1 = F1(t), f2 = F2(t);
    let s = 0;
    for (let k = 1; k <= harmonics; k++) {
      const fk = f * k;
      if (fk > 8000) break;
      s += ((lorentz(fk, f1, 90) + 0.5 * lorentz(fk, f2, 140) + 0.015) * Math.sin(ph * k)) / Math.pow(k, 1.5);
    }
    o[i] = s * amp(t);
    ph += (TAU * f) / SR;
  }
  return tailFade(o);
}
function howlLayer(seconds, points, peakAt) {
  const contour = cosEnv(points);
  const amp = lineEnv([[0, 0], [0.12, 0.35], [0.45, 0.85], [seconds * 0.6, 1], [seconds * 0.82, 0.7], [seconds * 0.94, 0.25], [seconds, 0]]);
  const F1 = lineEnv([[0, 380], [0.6, 620], [seconds * 0.65, 680], [seconds * 0.9, 420]]);
  const F2 = lineEnv([[0, 850], [0.6, 1150], [seconds * 0.65, 1200], [seconds * 0.9, 800]]);
  const voice = howlVoice(seconds, contour, amp, { F1, F2, breakAt: peakAt });
  const breath = filt(white(N(seconds)), 'bp', (t) => F1(t), 3);
  applyEnv(breath, (t) => amp(t) * 0.8 + 0.6 * hump(0, 0.25, 1)(t) + 0.4 * hump(seconds - 0.3, seconds + 0.15, 1)(t));
  return mix(N(seconds), [normPeak(voice, 1)], [normPeak(tailFade(breath), 0.1)]);
}
/** Growl: irregular glottal pulses through a chest + sweeping mouth formant, optional inhale. */
function growlBody(seconds, rate, env, { inhaleAt = -1, inhaleLen = 0.25 } = {}) {
  const n = N(seconds), exc = new Float32Array(n);
  const rm = smooth(3, seconds), fm = smooth(1.5, seconds);
  let t = 0.01;
  while (t < seconds - 0.02) {
    const inInhale = inhaleAt >= 0 && t >= inhaleAt && t < inhaleAt + inhaleLen;
    if (!inInhale) exc[N(t)] += rand(0.6, 1);
    t += 1 / (rate * (1 + 0.25 * rm(t)) * rand(0.9, 1.1));
  }
  const voiced = mix(n,
    [lay(filt(exc, 'bp', 160, 3), -14)],
    [lay(filt(exc, 'bp', (tt) => 330 + 120 * fm(tt), 5), -12)],
    [lay(filt(exc, 'bp', 820, 6), -16)],
    [lay(filt(exc, 'bp', 2200, 7), -24)]);
  const pulseEnv = filt(exc.map(Math.abs), 'lp', 60);
  normPeak(pulseEnv, 1);
  const rasp = filt(white(n), 'bp', 1400, 1.2);
  for (let i = 0; i < n; i++) rasp[i] *= pulseEnv[i];
  const x = mix(n, [normPeak(voiced, 1)], [normPeak(rasp, 0.35)]);
  applyEnv(x, env);
  if (inhaleAt >= 0) {
    const inhale = filt(white(N(inhaleLen)), 'bp', 1200, 1);
    applyEnv(inhale, hump(0, inhaleLen, 1.2));
    add(x, normPeak(inhale, 0.3), inhaleAt);
  }
  return filt(sat(x, 1.8), 'lp', 3500);
}

// ─────────────────────────────────── clip table ─────────────────────────────────
const clips = [];
const PITCH = [1, 0.94, 1.06];
/** One-shot → MP3. `rms`: K-weighted loudest-400 ms target (≈ LUFS M-max); `level`: trim after. */
const oneShot = (id, gen, opts = {}) => clips.push({ id, loop: false, sr: 44100, kbps: 112, rms: -16, level: 0, ...opts, gen });
/** `count` renders of one recipe: id, id-2, id-3 … (own seeds; gen(k, pitch)). */
const variants = (id, count, gen, opts = {}) => {
  for (let k = 0; k < count; k++) oneShot(k ? `${id}-${k + 1}` : id, () => gen(k, PITCH[k % 3]), opts);
};
/** Seamless loop → Ogg/Opus. `gen(L)` returns N(L) samples, or [left, right] when stereo. */
const loopClip = (id, seconds, gen, opts = {}) => clips.push({ id, loop: true, sr: 48000, kbps: opts.stereo ? 72 : 56, seconds, rms: -22, level: 0, ...opts, gen });

// ── Beds (stereo, head-locked; birds and owls are world-anchored one-shots now) ──
loopClip('forest-day', 32, (L) => {
  const T = L + 3, n = N(T), Ln = N(L);
  const gA = smooth(0.09, T), gB = smooth(0.31, T);
  const gust = (t) => clamp(0.5 + 0.32 * gA(t) + 0.18 * gB(t), 0, 1);
  const out = [];
  const [wa, wb] = noisePair('pink', n, 0.6), [la, lb] = noisePair('white', n, 0.4), [ia, ib] = noisePair('white', n, 0.3);
  for (const [w, l, ins] of [[wa, la, ia], [wb, lb, ib]]) {
    const flutter = smooth(7, T), buzz = smooth(0.2, T);
    const wind = filt(filt(w, 'lp', (t) => 380 + 900 * gust(t) ** 2, 0.6), 'hp', 110);
    applyEnv(lay(wind, -27), (t) => 0.4 + 0.6 * gust(t));
    const leaves = filt(filt(l, 'bp', 4300, 0.5), 'lp', 7500);
    applyEnv(lay(leaves, -27), (t) => (0.25 + 1.6 * Math.max(0, gust(t) - 0.45) ** 1.5) * (0.55 + 0.45 * flutter(t)));
    const insects = filt(ins, 'bp', 5500, 0.7);
    applyEnv(lay(insects, -40), (t) => 0.7 + 0.3 * buzz(t));
    out.push(loopify(mix(n, [wind], [leaves], [insects]), Ln));
  }
  // Faint far-off chatter only (the signature calls are spot emitters in the world).
  const far = [new Float32Array(Ln), new Float32Array(Ln)];
  poisson(L, 0.7, (t) => {
    const call = filt(R() < 0.6 ? birdChip() : birdWarble(), 'lp', 3500);
    addWrapPan(far, normPeak(call, 1), t, rand(0.02, 0.05), rand(-0.9, 0.9));
  });
  return [add(out[0], far[0]), add(out[1], far[1])];
}, { stereo: true, rms: -25 });

loopClip('night', 32, (L) => {
  const T = L + 3, n = N(T), Ln = N(L);
  const gA = smooth(0.07, T), gB = smooth(0.23, T);
  const gust = (t) => clamp(0.45 + 0.35 * gA(t) + 0.2 * gB(t), 0, 1);
  const out = [];
  const [wa, wb] = noisePair('brown', n, 0.6), [ha, hb] = noisePair('pink', n, 0.5), [ca, cb] = noisePair('white', n, 0.3);
  for (const [w, h, c] of [[wa, ha, ca], [wb, hb, cb]]) {
    const wind = filt(filt(w, 'lp', (t) => 170 + 300 * gust(t), 0.7), 'hp', 60);
    applyEnv(lay(wind, -22), (t) => 0.5 + 0.5 * gust(t));
    const hush = filt(h, 'bp', (t) => 500 + 400 * gust(t), 0.6);
    applyEnv(lay(hush, -30), (t) => gust(t) ** 2);
    const wall = filt(filt(c, 'bp', 4600, 3), 'bp', 4700, 3);
    applyEnv(lay(wall, -36), (t) => Math.pow(0.6 + 0.4 * Math.sin(TAU * 31 * t), 4));
    out.push(loopify(mix(n, [wind], [hush], [wall]), Ln));
  }
  const insects = [new Float32Array(Ln), new Float32Array(Ln)];
  for (let c = 0; c < 9; c++) {
    const fc = rand(4200, 4950), P0 = rand(0.55, 1.2), reps = Math.max(1, Math.round(L / P0)), P = L / reps;
    const far = R(), g = 0.05 + 0.2 * (1 - far) ** 2, pan = rand(-0.85, 0.85);
    const pulses = randInt(3, 4), gap = rand(0.032, 0.042), len = rand(0.012, 0.018);
    const chirp = zeros(pulses * gap + 0.03);
    for (let p = 0; p < pulses; p++) add(chirp, tone(len, fc * (1 - (0.01 * p) / pulses), (t) => Math.sin((Math.PI * t) / len) ** 2, { harmonics: [[1, 1], [2, 0.08]] }), p * gap);
    const voice = filt(chirp, 'lp', 9000 - far * 4000);
    const offset = rand(0, P), pauseAt = rand(0, L), pauseLen = rand(0, 7);
    for (let k = 0; k < reps; k++) {
      const at = offset + k * P;
      if ((((at - pauseAt) % L) + L) % L < pauseLen) continue;
      addWrapPan(insects, voice, at + rand(-0.008, 0.008), g * rand(0.85, 1), pan);
    }
  }
  // Tree-cricket trill, gated into three bouts per loop (periodic by construction).
  const fTree = Math.round(2850 * L) / L, am = Math.round(46 * L) / L;
  for (let i = 0; i < Ln; i++) {
    const t = i / SR;
    const v = 0.012 * Math.sin(TAU * fTree * t) * Math.pow(0.5 + 0.5 * Math.sin(TAU * am * t), 3) * Math.max(0, Math.sin((TAU * 3 * t) / L));
    insects[0][i] += v * 0.8;
    insects[1][i] += v * 0.6;
  }
  return [add(out[0], insects[0]), add(out[1], insects[1])];
}, { stereo: true, rms: -26 });

// ── Positional loops ──
loopClip('fire-bed', 17, (L) => {
  const T = L + 2, n = N(T);
  return loopify(fireBody(n, T), N(L));
}, { rms: -25 });

loopClip('fire-pops', 29, (L) => {
  const Ln = N(L), ev = new Float32Array(Ln);
  const burstiness = smooth(0.45, L + 1);
  poisson(L, 30, (t) => { if (R() < 0.25 + 0.75 * Math.max(0, burstiness(t))) addWrap(ev, crackle(logRand(0.15, 1), 1200, 9000, 6), t); });
  poisson(L, 1.4, (t) => addWrap(ev, pop(), t, rand(0.4, 1)));
  poisson(L, 0.2, (t) => {
    const count = randInt(4, 9);
    let at = t;
    for (let k = 0; k < count; k++) { addWrap(ev, crackle(rand(0.5, 1), 1500, 8000, 3), at, rand(0.6, 1)); at += rand(0.008, 0.04); }
  });
  poisson(L, 0.1, (t) => {
    const d = rand(0.4, 1.0);
    const s = filt(white(N(d)), 'bp', rand(4000, 6000), 0.8);
    applyEnv(s, hump(0, d, 1));
    addWrap(ev, normPeak(s, 0.1), t);
  });
  return ev;
}, { rms: -24.5 });

loopClip('torch-flame', 6, (L) => {
  const T = L + 1, n = N(T), Ln = N(L);
  const fl = smooth(1.2, T);
  const flutter = (t) => 0.5 + 0.5 * Math.sin(TAU * (7.5 * t + 0.4 * fl(t)));
  const roar = filt(brown(n), 'lp', 900, 0.7);
  applyEnv(lay(roar, -24), (t) => 0.75 + 0.25 * flutter(t));
  const breath = filt(pink(n), 'bp', 1200, 0.9);
  applyEnv(lay(breath, -28), (t) => 0.3 + 0.7 * flutter(t) ** 2);
  const bed = loopify(mix(n, [roar], [breath]), Ln);
  const ev = new Float32Array(Ln);
  poisson(L, 10, (t) => addWrap(ev, crackle(logRand(0.1, 0.8), 1500, 7000, 3), t));
  return mix(Ln, [bed], [ev, 0.25]);
}, { rms: -22 });

loopClip('brook', 24, (L) => {
  const T = L + 2, n = N(T), Ln = N(L);
  const sw = smooth(0.4, T);
  const rush = filt(pink(n), 'lp', 1300, 0.6);
  applyEnv(lay(rush, -22), (t) => 0.85 + 0.15 * sw(t));
  const spray = lay(filt(white(n), 'bp', 2400, 0.5), -36);
  const layers = [[rush], [spray]];
  for (const base of [420, 640, 900, 1250, 1700]) {
    const c = smooth(rand(1.5, 4), T), a = smooth(rand(2, 6), T);
    const ch = filt(white(n), 'bp', (t) => base * (1 + 0.35 * c(t)), rand(6, 12));
    applyEnv(lay(ch, -24), (t) => 2.2 * Math.max(0, a(t)) ** 2);
    layers.push([ch]);
  }
  const bed = loopify(mix(n, ...layers), Ln);
  const ev = new Float32Array(Ln);
  const dens = smooth(0.8, L + 1);
  poisson(L, 45, (t) => {
    if (R() > 0.4 + 0.6 * (0.5 + 0.5 * dens(t))) return;
    const f0 = logRand(450, 2400);
    const tau = 0.012 * Math.pow(1000 / f0, 0.8);
    addWrap(ev, bubble(f0, tau, rand(0.3, 0.8)), t, logRand(0.05, 0.5));
  });
  return mix(Ln, [bed], [ev, 0.22]);
}, { rms: -24 });

loopClip('beacon-roar', 16, (L) => {
  const T = L + 2, n = N(T), Ln = N(L);
  const a = smooth(0.9, T), b = smooth(1.7, T), c = smooth(0.4, T), d = smooth(0.3, T);
  const deep = filt(filt(brown(n), 'lp', 180, 1.0), 'peak', 110, 1.2, 6);
  applyEnv(lay(deep, -19), (t) => 0.75 + 0.25 * a(t));
  const body = filt(pink(n), 'bp', 380, 0.8);
  applyEnv(lay(body, -19), (t) => 0.6 + 0.4 * b(t));
  const swirl = filt(pink(n), 'bp', (t) => 900 + 400 * c(t), 1.2);
  applyEnv(lay(swirl, -24), (t) => 1.5 * clamp(0.5 + 0.5 * d(t), 0, 1) ** 2);
  const bed = loopify(mix(n, [deep], [body], [swirl]), Ln);
  const ev = new Float32Array(Ln);
  poisson(L, 16, (t) => addWrap(ev, crackle(logRand(0.1, 1), 900, 6000, 5), t));
  poisson(L, 2, (t) => addWrap(ev, pop(0.7), t, rand(0.5, 1)));
  return sat(mix(Ln, [bed], [ev, 0.75]), 1.2);
}, { rms: -20 });

/** Beacon build-up: a Shepard–Risset glissando (endlessly rising, exactly periodic) over a throbbing roar. */
loopClip('beacon-build', 7.2, (L) => {
  const Ln = N(L), x = new Float32Array(Ln);
  const f0 = 27.5, K = 10, center = Math.log2(330), sigma = 1.0;
  const phase0 = new Float64Array(K);
  for (let k = 1; k < K; k++) phase0[k] = phase0[k - 1] + (TAU * f0 * 2 ** (k - 1) * L) / Math.LN2;
  for (let i = 0; i < Ln; i++) {
    const t = i / SR, g = 2 ** (t / L);
    let s = 0;
    for (let k = 0; k < K; k++) {
      const f = f0 * 2 ** k * g;
      if (f > 12000) break;
      const w = Math.exp(-((Math.log2(f) - center) ** 2) / (2 * sigma * sigma));
      s += w * (Math.sin(phase0[k] + ((TAU * f0 * 2 ** k * L) / Math.LN2) * (g - 1)) + 0.3 * Math.sin(2 * (phase0[k] + ((TAU * f0 * 2 ** k * L) / Math.LN2) * (g - 1))));
    }
    x[i] = s;
  }
  lay(x, -22);
  const T = L + 1.5, n = N(T);
  const roar = loopify(fireBody(n, T, { roarLp: 500, roarDb: -24, breathF: 900, breathDb: -26, flicker: 4 }), Ln);
  // 12 throbs per loop (100 bpm), so the pulse is periodic too.
  const throb = new Float32Array(Ln);
  for (let k = 0; k < 12; k++) addWrap(throb, thud(1, { f: 90, drop: 50, tau: 0.12, dirt: 600 }), (k * L) / 12);
  return mix(Ln, [x], [roar], [lay(throb, -26)]);
}, { rms: -20 });

// Heartbeat: one 'lub-dub' per take. The AudioSystem plays one every HEARTBEAT.period
// (0.75 s) from its own clock, so the vignette pulse and the haptic tick lock to it:
// the lub starts at 0, the dub at 0.27 s = phase 0.36 (audio-map.ts HEARTBEAT.dub).
// Identity in the 150 Hz–1.4 kHz band (harmonics + knock) so it survives open-ear speakers.
const heartThump = (pitch) => filt(filt(sat(mix(N(0.4),
  [tone(0.4, (t) => (62 + 40 * Math.exp(-t / 0.03)) * pitch, (t) => Math.min(1, t / 0.005) * Math.exp(-t / 0.075), { harmonics: [[1, 1], [2, 0.7], [3, 0.5], [4, 0.3], [5, 0.15]] }), 0.7],
  [burst(0.1, { filters: [['lp', 300]], env: ad(0.002, 0.02), gain: 0.3 })],
  [burst(0.06, { filters: [['bp', 230 * pitch, 1.4]], env: ad(0.001, 0.02), gain: 0.9 })],
  [burst(0.05, { filters: [['bp', 520 * pitch, 1.5]], env: ad(0.001, 0.012), gain: 0.35 })]), 3.0), 'lp', 1400), 'hp', 80);
variants('heartbeat', 2, (k) => {
  const x = zeros(0.75);
  add(x, heartThump(k ? 0.98 : 1), 0.002);
  add(x, heartThump(k ? 1.2 : 1.22), 0.002 + 0.27, 0.62);
  return x;
}, { rms: -17.5 });

// ── Fire & cooking ──
oneShot('lighter-flick', () => {
  const x = zeros(0.65);
  const teeth = new Float32Array(N(0.08));
  let t = 0;
  while (t < 0.07) { add(teeth, burst(0.004, { filters: [['bp', rand(4000, 6500), 1.2]], env: ad(0.00005, 0.0006), gain: rand(0.4, 1) }), t); t += 1 / rand(240, 330); }
  applyEnv(teeth, hump(0, 0.075, 0.7));
  add(x, normPeak(teeth, 0.7));
  add(x, metalClick(3150, 0.55, 0.012));
  poisson(0.1, 60, (tt) => add(x, burst(0.003, { filters: [['hp', 6000]], env: ad(0.00005, 0.0003), gain: rand(0.1, 0.35) }), 0.02 + tt));
  add(x, whoosh(0.3, 320, 950, { q: 0.9, pow: 1.4 }), 0.06, 0.45);
  add(x, burst(0.45, { color: 'pink', filters: [['lp', 1200]], env: (tt) => Math.min(1, tt / 0.04) * Math.exp(-tt / 0.14), gain: 0.18 }), 0.08);
  return x;
}, { rms: -20 });

oneShot('lid-clink', () => {
  const x = zeros(0.2);
  add(x, metalClick(2800, 0.8, 0.01));
  add(x, burst(0.004, { filters: [['hp', 3000]], env: ad(0.0001, 0.001), gain: 0.3 }), 0.003);
  add(x, metalClick(3600, 0.25, 0.006), 0.018);
  return x;
}, { rms: -22 });

function igniteRecipe(D, lo, hi, riseAt, whumpF = 160) {
  const n = N(D);
  const sweep = filt(pink(n), 'bp', (t) => (t < riseAt ? lo * (1 + (hi / lo - 1) * Math.pow(t / riseAt, 1.3)) : hi * Math.exp(-(t - riseAt) / 0.6) + 700), 0.8);
  applyEnv(sweep, (t) => (t < riseAt * 0.82 ? Math.pow(t / (riseAt * 0.82), 2) : Math.exp(-(t - riseAt * 0.82) / 0.38)));
  const whump = filt(brown(n), 'lp', whumpF);
  applyEnv(whump, (t) => (t < riseAt * 0.6 ? Math.pow(t / (riseAt * 0.6), 1.5) : Math.exp(-(t - riseAt * 0.6) / 0.26)));
  const x = mix(n, [normPeak(sweep, 0.8)], [normPeak(whump, 0.9)]);
  for (let k = 0; k < 11; k++) { const t = rand(riseAt * 0.5, D - 0.2); add(x, crackle(0.45 * Math.exp(-(t - 0.3) / 0.6)), t); }
  return sat(x, 1.4);
}
oneShot('ignite', () => igniteRecipe(1.7, 250, 2000, 0.55), { rms: -17 });

oneShot('brazier-ignite', () => {
  const D = 3.2;
  const x = igniteRecipe(D, 150, 2400, 0.75, 220);
  const tail = loopify(fireBody(N(D + 0.5), D + 0.5, { roarLp: 600, roarDb: -20, breathF: 800, breathDb: -24 }), N(D));
  applyEnv(tail, (t) => (t < 0.6 ? 0 : Math.min(1, (t - 0.6) / 0.4)) * clamp((D - t) / 1.2, 0, 1));
  add(x, tail, 0, 1.2);
  poisson(D - 0.5, 8, (t) => add(x, crackle(rand(0.3, 0.8), 1000, 6000, 4), t + 0.5));
  return reverb(sat(x, 1.3), { room: 0.8, damp: 0.4, wet: 0.2, tail: 1.2 });
}, { rms: -15 });

variants('plop', 2, (k, p) => {
  const x = zeros(0.6);
  add(x, tone(0.3, (t) => (180 + 520 * Math.exp(-t / 0.025)) * p, (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.05), { harmonics: [[1, 1], [1.5, 0.25]] }));
  add(x, burst(0.2, { filters: [['hp', 800], ['bp', 2500 * p, 0.7]], env: ad(0.003, 0.06), gain: 0.4 }), 0.008);
  add(x, tone(0.2, 150 * p, ad(0.002, 0.04)), 0, 0.3);
  for (let j = 0; j < 3; j++) add(x, bubble(rand(600, 1100), rand(0.015, 0.025), rand(0.5, 0.9)), rand(0.06, 0.25), rand(0.15, 0.35));
  return x;
}, { rms: -19 });

oneShot('stir', () => {
  const D = 0.7, n = N(D);
  const slosh = filt(pink(n), 'bp', (t) => 350 + 450 * Math.sin((Math.PI * Math.min(t, 0.6)) / 0.6), 1.4);
  applyEnv(slosh, hump(0, 0.62, 1.5));
  const body = filt(pink(n), 'lp', 900);
  applyEnv(body, hump(0.02, 0.6, 2));
  const scrape = filt(white(n), 'bp', 1800, 3);
  const grain = smooth(40, D);
  applyEnv(scrape, (t) => hump(0.05, 0.55, 1)(t) * Math.max(0, grain(t)) ** 3);
  const x = mix(n, [normPeak(slosh, 0.7)], [normPeak(body, 0.4)], [normPeak(scrape, 0.12)]);
  for (let k = 0; k < 4; k++) add(x, bubble(rand(400, 900), rand(0.015, 0.03), rand(0.4, 0.8)), rand(0.08, 0.5), rand(0.08, 0.2));
  add(x, woodKnock(520, 0.18, 0.02), 0.04);
  return x;
}, { rms: -19 });

oneShot('bowl-fill', () => {
  const D = 0.95, n = N(D);
  const pour = pink(n);
  const r1 = filt(pour, 'bp', (t) => 350 + 1100 * Math.min(1, t / 0.75), 4);
  const r2 = filt(pour, 'bp', (t) => 2.2 * (350 + 1100 * Math.min(1, t / 0.75)), 3);
  const env = (t) => Math.min(1, t / 0.04) * clamp((0.82 - t) / 0.12, 0, 1);
  const x = mix(n, [normPeak(applyEnv(r1, env), 0.7)], [normPeak(applyEnv(r2, env), 0.3)]);
  const sp = filt(white(n), 'bp', 3000, 1);
  const g = smooth(30, D);
  add(x, normPeak(applyEnv(sp, (t) => env(t) * Math.max(0, g(t)) ** 2), 0.15));
  for (let k = 0; k < 9; k++) { const t = rand(0.05, 0.75); add(x, bubble(500 + 900 * (t / 0.75) * rand(0.8, 1.2), rand(0.01, 0.02), 0.6), t, rand(0.1, 0.25)); }
  return x;
}, { rms: -19 });

variants('eat', 2, (k) => {
  const x = zeros(0.8);
  const chews = k === 0 ? [[0, 1], [0.24, 0.75], [0.47, 0.55]] : [[0, 0.9], [0.28, 1], [0.55, 0.5]];
  for (const [at, a] of chews) {
    const c = new Float32Array(N(0.12));
    const count = randInt(25, 45);
    for (let j = 0; j < count; j++) add(c, crackle(rand(0.2, 1), 1200, 5000, 1), rand(0, 0.065));
    add(c, burst(0.1, { color: 'pink', filters: [['lp', 600]], env: ad(0.002, 0.03), gain: 0.5 }));
    add(c, tone(0.1, 180, ad(0.002, 0.025)), 0, 0.3);
    add(c, burst(0.1, { filters: [['bp', 800, 2]], env: hump(0, 0.08, 1), gain: 0.15 }));
    add(x, normPeak(tailFade(c), a), at);
  }
  return filt(x, 'lp', 7000);
}, { rms: -20 });

oneShot('sizzle', () => {
  const D = 1.3, n = N(D);
  const hiss = filt(filt(white(n), 'hp', 3000), 'bp', 6000, 0.7);
  const grains = white(n);
  for (let i = 0; i < n; i++) grains[i] = R() < 0.018 ? rand(0.3, 1) : 0;
  const am = filt(grains, 'lp', 900);
  normPeak(am, 1);
  for (let i = 0; i < n; i++) hiss[i] *= 0.25 + 0.75 * Math.abs(am[i]);
  applyEnv(hiss, (t) => Math.min(1, t / 0.06) * clamp((D - t) / 0.4, 0, 1));
  const x = normPeak(hiss, 0.7);
  for (let k = 0; k < 6; k++) add(x, crackle(rand(0.3, 0.7), 1500, 5000), rand(0.05, 1.0));
  add(x, burst(D, { filters: [['lp', 1000]], env: (t) => Math.min(1, t / 0.08) * clamp((D - t) / 0.4, 0, 1), gain: 0.12 }));
  return x;
}, { rms: -20 });

/** Ember collapse (the fire only dies from lack of fuel): a log settles, crackles die, a soft exhale. */
oneShot('fire-out', () => {
  const D = 1.8, n = N(D), x = zeros(D);
  add(x, woodKnock(140, 0.5, 0.05));
  add(x, thud(0.4, { f: 70, drop: 30, tau: 0.08, dirt: 700 }), 0.05);
  poisson(1.5, 10, (t) => { if (R() < Math.exp(-t / 0.5)) add(x, crackle(rand(0.2, 0.5), 1200, 6000, 3), t + 0.05); });
  const exhale = filt(pink(n), 'lp', 800);
  applyEnv(exhale, ad(0.05, 0.6));
  add(x, normPeak(exhale, 0.35));
  const hiss = filt(filt(white(n), 'hp', 2000), 'bp', 5000, 0.5);
  applyEnv(hiss, ad(0.015, 0.45));
  add(x, normPeak(hiss, 0.15));
  return x;
}, { rms: -20 });

/** Wolves draining the fire: a dark D–Eb swell with a choking hiss. */
oneShot('smother', () => {
  const D = 3.4, n = N(D), x = zeros(D + 0.6);
  const swell = lineEnv([[0, 0], [1.4, 0.8], [2.0, 1], [2.8, 0.5], [D, 0]]);
  const saw = [[1, 1], [2, 0.5], [3, 0.33], [4, 0.25], [5, 0.2], [6, 0.16]];
  for (const [f, a] of [[73.42, 0.5], [77.78, 0.4], [146.83, 0.3], [155.56, 0.22]]) add(x, filt(tone(D, f, swell, { harmonics: saw, phase: rand(0, TAU) }), 'lp', (t) => 250 + 900 * swell(t)), 0, a);
  const hiss = filt(filt(white(n), 'hp', 2500), 'bp', 4000, 0.6);
  applyEnv(hiss, (t) => swell(t) ** 1.5);
  add(x, normPeak(hiss, 0.3));
  const choke = filt(brown(n), 'lp', 500);
  applyEnv(choke, swell);
  add(x, normPeak(choke, 0.4));
  return reverb(sat(x, 1.3), { room: 0.82, damp: 0.45, wet: 0.25, tail: 1 });
}, { rms: -17 });

// ── Crafting & tools ──
variants('hammer-clank', 3, (k, p) => {
  const f = 610 * p;
  const metal = modes(1.3, [[f, 0.45, 1], [f * 1.003, 0.4, 0.4], [f * 2.76, 0.28, 0.6], [f * 5.4, 0.18, 0.45], [f * 8.93, 0.1, 0.25], [f * 1.47, 0.3, 0.3], [f * 3.9, 0.15, 0.2]], { jitter: 0.01 });
  const strike = burst(0.01, { filters: [['hp', 2000]], env: ad(0.00005, 0.0012), gain: 0.8 });
  const wood = mix(N(0.4),
    [normPeak(modes(0.4, [[150 * p, 0.08, 1], [240 * p, 0.06, 0.6], [380, 0.05, 0.45], [560, 0.04, 0.3]]), 1)],
    [burst(0.1, { filters: [['lp', 700]], env: ad(0.001, 0.03), gain: 0.5 })]);
  const x = mix(N(1.3), [normPeak(metal, 0.55)], [strike], [wood, 0.6]);
  return reverb(x, { room: 0.7, damp: 0.5, wet: 0.08, tail: 0.5 });
}, { rms: -17 });

variants('knock', 2, (k, p) => {
  const x = zeros(0.4);
  add(x, woodKnock(230 * p, 1, 0.05));
  add(x, thud(0.35, { f: 110 * p, drop: 40, tau: 0.04, dirt: 1200 }));
  return filt(x, 'lp', 2200);
}, { rms: -20 });

oneShot('craft-complete', () => {
  const x = zeros(2.6);
  ['D5', 'F#5', 'A5', 'E6'].forEach((name, k) => {
    const f = hz(name);
    add(x, pluck(f, 2.4, { decay: 1.6, bright: 0.5, body: 0.2 }), k * 0.06, 0.55);
    add(x, bell(f, 2.3, 0.8), k * 0.06, 0.35);
  });
  return filt(reverb(x, { room: 0.82, damp: 0.4, wet: 0.22, tail: 1.2 }), 'lp', 8000);
}, { rms: -18 });

oneShot('bench-ready', () => {
  const x = zeros(1.4);
  add(x, woodKnock(700, 0.35, 0.02));
  add(x, pluck(hz('A4'), 1.2, { decay: 1.0, bright: 0.35, body: 0.2 }), 0.02, 0.6);
  add(x, pluck(hz('D5'), 1.3, { decay: 1.1, bright: 0.35, body: 0.2 }), 0.14, 0.7);
  add(x, bell(hz('D5'), 1.1, 0.4), 0.14, 0.2);
  return filt(reverb(x, { room: 0.78, damp: 0.45, wet: 0.18, tail: 0.8 }), 'lp', 7000);
}, { rms: -21 });

oneShot('recipe-learned', () => {
  const x = zeros(2.6);
  ['D5', 'F#5', 'A5'].forEach((name, k) => {
    const f = hz(name), len = k === 2 ? 2.2 : 1.2;
    add(x, bell(f, len, 1), k * 0.17, k === 2 ? 1 : 0.8);
    add(x, pluck(f, len, { decay: 1.2, bright: 0.35, body: 0.1 }), k * 0.17, 0.35);
  });
  return filt(reverb(x, { room: 0.84, damp: 0.4, wet: 0.28, tail: 1.3 }), 'lp', 8000);
}, { rms: -19 });

oneShot('invalid-clunk', () => {
  const x = zeros(0.45);
  add(x, woodKnock(190, 1, 0.06));
  add(x, woodKnock(160, 0.55, 0.05), 0.09);
  return filt(x, 'lp', 1600);
}, { rms: -20 });

oneShot('dry-click', () => {
  const x = zeros(0.25);
  add(x, metalClick(1500, 1, 0.02));
  add(x, woodKnock(300, 0.5, 0.03), 0.002);
  return x;
}, { rms: -19 });

// The deployed sentry's empty trigger (positional, at its muzzle): a heavier sear
// click in the wooden frame, then the pawl resetting.
oneShot('sentry-dry', () => {
  const x = zeros(0.4);
  add(x, metalClick(1250, 1, 0.025));
  add(x, woodKnock(240, 0.6, 0.04), 0.002);
  add(x, metalClick(2100, 0.35, 0.01), 0.075);
  add(x, woodKnock(330, 0.25, 0.025), 0.078);
  return x;
}, { rms: -18 });

variants('chop', 3, (k, p) => {
  const x = zeros(0.6);
  add(x, tone(0.25, (t) => (95 + 80 * Math.exp(-t / 0.012)) * p, (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.035), { harmonics: [[1, 1], [2, 0.4]] }), 0, 0.45);
  add(x, burst(0.05, { filters: [['bp', 2200 * p, 0.8]], env: ad(0.0002, 0.012), gain: 0.9 }));
  add(x, burst(0.004, { filters: [['hp', 4000]], env: ad(0.00005, 0.0006), gain: 0.6 }));
  add(x, normPeak(modes(0.4, [[520 * p, 0.05, 1], [870 * p, 0.04, 0.8], [1350 * p, 0.03, 0.55], [2100 * p, 0.02, 0.35], [2900 * p, 0.015, 0.15], [240 * p, 0.05, 0.4]], { jitter: 0.05 }), 0.8));
  for (let j = 0; j < 8; j++) { const t = rand(0.02, 0.22); add(x, crackle(0.35 * Math.exp(-t / 0.1)), t); }
  add(x, filt(x, 'lp', 1800), 0.09, 0.12);
  return sat(x, 1.3);
}, { rms: -17 });

variants('wood-split', 2, (k, p) => {
  const x = zeros(1.0);
  add(x, burst(0.006, { env: ad(0.00005, 0.0008), gain: 0.8 }));
  add(x, burst(0.03, { filters: [['bp', 1500 * p, 1]], env: ad(0.0003, 0.012), gain: 0.7 }));
  const tear = rustleGrains(0.2, 400, { fLo: 1000, fHi: 5000, env: (t) => Math.exp(-t / 0.08) });
  add(x, normPeak(tear, 0.55), 0.01);
  add(x, normPeak(modes(0.5, [[410 * p, 0.1, 1], [780 * p, 0.08, 0.7], [1260 * p, 0.06, 0.45], [1900 * p, 0.04, 0.3]], { jitter: 0.04 }), 0.5));
  const fall = k === 0 ? [0.34, 0.47] : [0.3, 0.52];
  add(x, woodKnock(170 * p, 0.6, 0.07), fall[0]);
  add(x, thud(0.35, { f: 90, drop: 40, tau: 0.05, dirt: 700 }), fall[0]);
  add(x, woodKnock(190 * p, 0.45, 0.06), fall[1]);
  add(x, woodKnock(420, 0.15, 0.03), fall[1] + 0.09);
  return sat(x, 1.2);
}, { rms: -17 });

variants('rustle', 3, (k) => {
  const D = [0.6, 0.5, 0.7][k], n = N(D);
  const leaves = filt(white(n), 'bp', 3500, 0.5);
  const g = smooth(25, D);
  applyEnv(leaves, (t) => hump(0, D * 0.8, 1)(t) * Math.max(0, g(t)) ** 2);
  return mix(n, [normPeak(leaves, 0.7)], [normPeak(rustleGrains(D * 0.75, 30, { fLo: 2000, fHi: 5000 }), 0.35)]);
}, { rms: -21 });

// ── Handling ──
variants('grab', 3, (k, p) => {
  const x = zeros(0.15);
  add(x, normPeak(modes(0.12, [[380 * p, 0.012, 0.8], [900 * p, 0.008, 0.4], [1700 * p, 0.006, 0.2]], { jitter: 0.04 }), 0.8));
  add(x, burst(0.06, { filters: [['bp', 2200 * p, 0.8]], env: ad(0.002, 0.02), gain: 0.35 }));
  add(x, burst(0.01, { filters: [['lp', 4000]], env: ad(0.0001, 0.001), gain: 0.2 }));
  return x;
}, { rms: -22 });

variants('drop', 3, (k, p) => {
  const x = zeros(0.55);
  add(x, thud(0.5, { f: 95 * p, drop: 80 * p }));
  add(x, normPeak(modes(0.2, [[210 * p, 0.05, 1], [380 * p, 0.035, 0.7], [620 * p, 0.02, 0.4]], { jitter: 0.05 }), 0.8));
  add(x, burst(0.12, { filters: [['hp', 2000]], env: ad(0.002, 0.06), gain: 0.08 }));
  add(x, thud(0.3, { f: 105 * p, drop: 40, tau: 0.05 }), 0.14);
  return filt(sat(x, 1.2), 'hp', 80);
}, { rms: -19 });

variants('drop-light', 3, (k, p) => {
  const x = zeros(0.35);
  const tap = () => mix(N(0.12),
    [normPeak(modes(0.12, [[520 * p, 0.03, 1], [940 * p, 0.022, 0.6], [1600 * p, 0.014, 0.35]], { jitter: 0.06 }), 0.8)],
    [burst(0.03, { filters: [['lp', 1500]], env: ad(0.0003, 0.015), gain: 0.5 })]);
  add(x, tap());
  add(x, tap(), 0.09, 0.35);
  add(x, tap(), 0.15, 0.12);
  add(x, burst(0.1, { filters: [['hp', 2500]], env: ad(0.002, 0.04), gain: 0.06 }));
  return x;
}, { rms: -21 });

variants('snap', 2, (k, p) => {
  const x = zeros(0.2);
  const click = (f) => mix(N(0.06),
    [normPeak(modes(0.06, [[f, 0.012, 1], [f * 1.72, 0.009, 0.6], [f * 2.72, 0.006, 0.35]], { jitter: 0.02 }), 0.8)],
    [burst(0.004, { filters: [['hp', 1500]], env: ad(0.00005, 0.0008), gain: 0.5 })]);
  add(x, click(1250 * p));
  add(x, click(1400 * p), 0.028, 0.7);
  return x;
}, { rms: -21 });

oneShot('pack-unroll', () => {
  const D = 1.0, n = N(D);
  const flap = filt(pink(n), 'lp', (t) => 2500 - 1300 * Math.min(1, t / 0.5), 0.8);
  const w = smooth(3, D);
  applyEnv(flap, (t) => ad(0.03, 0.25)(t) * Math.pow(0.5 + 0.5 * Math.sin(TAU * 14 * t + 2 * w(t)), 2));
  const x = mix(n, [normPeak(flap, 0.7)]);
  add(x, burst(0.2, { filters: [['lp', 700]], env: ad(0.002, 0.05), gain: 0.5 }), 0.55);
  add(x, thud(0.45, { f: 95, drop: 30, tau: 0.06 }), 0.55);
  add(x, burst(0.3, { filters: [['hp', 2000]], env: ad(0.01, 0.15), gain: 0.12 }), 0.58);
  return x;
}, { rms: -20 });

oneShot('sfx-pack-roll', () => {
  const D = 0.9, n = N(D);
  const cloth = filt(white(n), 'bp', 2800, 0.6);
  const g = smooth(30, D);
  applyEnv(cloth, (t) => hump(0, 0.62, 1)(t) * (0.3 + 0.7 * Math.max(0, g(t)) ** 2));
  const body = filt(pink(n), 'lp', 900);
  applyEnv(body, hump(0, 0.62, 1.5));
  const x = mix(n, [normPeak(cloth, 0.55)], [normPeak(body, 0.3)]);
  add(x, metalClick(2400, 0.4, 0.015), 0.7);
  add(x, metalClick(2600, 0.24, 0.012), 0.74);
  return x;
}, { rms: -20 });

oneShot('sfx-page', () => {
  const D = 0.6, n = N(D);
  const fwip = filt(filt(white(n), 'hp', 1500), 'bp', (t) => 2000 * Math.pow(3.25, Math.min(1, t / 0.2)), 0.7);
  applyEnv(fwip, hump(0, 0.26, 1.3));
  const x = mix(n, [normPeak(fwip, 0.6)]);
  add(x, normPeak(rustleGrains(0.35, 120, { fLo: 3000, fHi: 8000, env: (t) => Math.exp(-t / 0.15) }), 0.4));
  add(x, burst(0.12, { filters: [['lp', 1200]], env: ad(0.002, 0.03), gain: 0.3 }), 0.28);
  return x;
}, { rms: -20 });

// ── Weapons & combat ──
oneShot('spear-whoosh', () => {
  const D = 0.55, n = N(D);
  const w = filt(add(pink(n), white(n), 0, 0.3), 'bp', (t) => 350 + 900 * Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.42)), 2), 1.5);
  applyEnv(w, (t) => Math.pow(Math.sin(Math.PI * clamp((t - 0.02) / 0.45, 0, 1)), 2.5));
  const air = filt(white(n), 'bp', 3000, 1);
  applyEnv(air, hump(0.05, 0.4, 2));
  return mix(n, [normPeak(w, 0.9)], [normPeak(air, 0.15)]);
}, { rms: -18 });

variants('hit', 3, (k, p) => {
  const x = zeros(0.45);
  add(x, tone(0.4, (t) => (85 + 110 * Math.exp(-t / 0.018)) * p, (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.1), { harmonics: [[1, 1], [2, 0.6], [3, 0.35], [4, 0.2]] }), 0, 0.55);
  add(x, burst(0.2, { filters: [['bp', 450 * p, 0.9]], env: ad(0.0005, 0.045), gain: 1 }));
  add(x, burst(0.2, { filters: [['bp', 420 * p, 2]], env: ad(0.002, 0.06), gain: 0.35 }), 0.005);
  add(x, burst(0.03, { filters: [['bp', 1500 * p, 1]], env: ad(0.0003, 0.01), gain: 0.5 }));
  add(x, burst(0.01, { filters: [['bp', 2500, 1]], env: ad(0.0001, 0.003), gain: 0.45 }));
  return filt(sat(x, 2), 'hp', 90);
}, { rms: -17 });

function stringTwang(seconds, fFrom, fTo, tau) {
  const n = N(seconds), o = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = fTo + (fFrom - fTo) * Math.exp(-t / 0.02);
    let s = 0;
    for (let k = 1; k <= 12; k++) s += (Math.sin(ph * k) / Math.pow(k, 1.2)) * Math.exp(-t * (1 / tau + k * 2.5));
    o[i] = s * (1 + 0.15 * Math.sin(TAU * 35 * t) * Math.exp(-t / 0.1));
    ph += (TAU * f) / SR;
  }
  return normPeak(tailFade(o, 0.05), 1);
}
oneShot('crossbow-twang', () => {
  const x = zeros(0.8);
  add(x, metalClick(3100, 0.25, 0.006));
  add(x, stringTwang(0.75, 330, 220, 0.2), 0.004, 0.7);
  add(x, woodKnock(380, 0.7, 0.04), 0.004);
  add(x, burst(0.03, { filters: [['bp', 1500, 1]], env: ad(0.0003, 0.008), gain: 0.4 }), 0.004);
  add(x, whoosh(0.2, 1200, 600, { q: 1.5 }), 0.02, 0.25);
  return sat(x, 1.3);
}, { rms: -17 });

variants('bolt-thunk', 2, (k, p) => {
  const x = zeros(0.55);
  add(x, burst(0.006, { filters: [['bp', 3000 * p, 1]], env: ad(0.00005, 0.001), gain: 0.6 }));
  add(x, normPeak(modes(0.3, [[300 * p, 0.06, 1], [690 * p, 0.04, 0.6], [1250 * p, 0.02, 0.35]], { jitter: 0.05 }), 0.8));
  add(x, tone(0.2, 120 * p, ad(0.001, 0.04)), 0, 0.4);
  add(x, tone(0.5, 210 * p, (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.22) * (1 + 0.5 * Math.sin(TAU * 28 * t)), { harmonics: [[1, 1], [2.9, 0.4]] }), 0.003, 0.25);
  return sat(x, 1.2);
}, { rms: -18 });

oneShot('reload-click', () => {
  const x = zeros(0.35);
  for (const t of [0, 0.045, 0.09]) add(x, metalClick(2600 * rand(0.95, 1.05), 0.35, 0.008), t);
  add(x, metalClick(1700, 0.7, 0.015), 0.16);
  add(x, woodKnock(420, 0.35, 0.03), 0.16);
  return x;
}, { rms: -21 });

oneShot('sentry-fire', () => {
  const x = zeros(0.7);
  add(x, metalClick(1900, 0.5, 0.012));
  add(x, stringTwang(0.45, 260, 200, 0.12), 0.005, 0.7);
  add(x, woodKnock(260, 0.5, 0.05), 0.005);
  add(x, whoosh(0.23, 1100, 550, { q: 1.4 }), 0.02, 0.3);
  add(x, tone(0.3, (t) => 520 * (1 + 0.03 * Math.sin(TAU * 18 * t)), ad(0.002, 0.15)), 0.01, 0.08);
  return sat(x, 1.3);
}, { rms: -18 });

// ── Creatures ──
oneShot('deer-flee', () => {
  const x = zeros(1.45);
  const hoof = (bright) => mix(N(0.1),
    [normPeak(modes(0.1, [[rand(150, 200), 0.035, 1], [rand(280, 330), 0.025, 0.7], [rand(520, 600), 0.015, 0.4]]), 1)],
    [burst(0.05, { filters: [['lp', 1100 * bright]], env: ad(0.0005, 0.022), gain: 0.6 })],
    [burst(0.07, { filters: [['hp', 2500]], env: ad(0.002, 0.03), gain: 0.12 * bright })]);
  let k = 0;
  for (let group = 0; group < 3; group++) {
    for (const off of [0, 0.07, 0.16, 0.22]) {
      const g = 1 - (0.55 * k) / 12;
      add(x, filt(hoof(1.4 - k * 0.07), 'lp', 5000 - k * 300), 0.03 + group * 0.42 + off + rand(-0.01, 0.01), g * rand(0.8, 1));
      k++;
    }
  }
  add(x, burst(0.5, { filters: [['hp', 2000]], env: ad(0.01, 0.2), gain: 0.25 }));
  return x;
}, { rms: -19 });

variants('wolf-howl', 3, (k) => {
  const layers = [
    // solo long, solo short, duet (a second wolf joins 0.9 s later, its own contour)
    () => howlLayer(4.3, [[0, 330], [0.5, 560], [1.4, 590], [2.4, 610], [3.2, 520], [3.8, 420], [4.3, 380]], 2.2),
    () => howlLayer(2.8, [[0, 360], [0.4, 600], [1.3, 640], [2.1, 500], [2.8, 400]], 1.2),
    () => {
      const a = howlLayer(3.8, [[0, 340], [0.5, 570], [1.5, 600], [2.6, 520], [3.3, 430], [3.8, 390]], 1.8);
      const b = howlLayer(3.2, [[0, 420], [0.5, 690], [1.6, 710], [2.6, 560], [3.2, 460]], 1.4);
      return mix(N(4.8), [a], [b, 0.55, 0.9]);
    },
  ];
  const x = layers[k]();
  return filt(filt(reverb(x, { room: 0.9, damp: 0.35, wet: 0.45, tail: 2.5, pre: 0.035 }), 'lp', 6000), 'hp', 150);
}, { rms: -16 });

variants('wolf-growl', 3, (k) => {
  const envs = [
    lineEnv([[0, 0], [0.15, 0.8], [0.55, 1], [0.7, 0.4], [0.95, 0.4], [1.05, 0.9], [1.5, 0.8], [1.7, 0]]),
    lineEnv([[0, 0], [0.1, 0.9], [0.8, 1], [1.1, 0.6], [1.3, 0]]),
    lineEnv([[0, 0], [0.2, 0.6], [0.5, 1], [0.62, 0.3], [0.9, 0.3], [1.0, 1], [1.8, 0.7], [2.0, 0]]),
  ];
  const lens = [1.7, 1.3, 2.0], rates = [48, 55, 42], inhale = [0.7, -1, 0.62];
  return growlBody(lens[k], rates[k], envs[k], { inhaleAt: inhale[k] });
}, { rms: -17 });

oneShot('wolf-bite', () => {
  const x = zeros(0.45);
  add(x, growlBody(0.14, 80, lineEnv([[0, 0], [0.03, 1], [0.12, 0.8], [0.14, 0]])), 0, 0.6);
  for (const [t, f] of [[0.12, 2200], [0.135, 3000]]) {
    add(x, burst(0.006, { filters: [['bp', f, 3]], env: ad(0.00005, 0.0015), gain: 0.9 }), t);
    add(x, normPeak(modes(0.05, [[f * 0.72, 0.008, 1], [f * 1.08, 0.006, 0.6]]), 0.4), t);
  }
  add(x, tone(0.12, 140, ad(0.001, 0.03)), 0.12, 0.5);
  return x;
}, { rms: -17 });

/** Stalking wolf: four panting breaths over paws in grass. */
oneShot('wolf-pant', () => {
  const x = zeros(1.6);
  for (let k = 0; k < 4; k++) {
    const b = breathVoice(0.22, { f0: 95, f0End: 80, voiced: 0.15, formants: [[500, 3, 1], [1400, 4, 0.5], [3000, 5, 0.25]] });
    add(x, b, 0.05 + k * 0.36, k % 2 ? 0.65 : 1);
  }
  add(x, normPeak(rustleGrains(1.4, 6, { fLo: 800, fHi: 3000 }), 0.3), 0.05);
  return x;
}, { rms: -18 });

oneShot('wolf-yelp', () => {
  const D = 0.35;
  const amp = lineEnv([[0, 0], [0.01, 1], [0.2, 0.6], [D, 0]]);
  const v = howlVoice(D, cosEnv([[0, 900], [0.08, 1400], [D, 700]]), amp, { F1: () => 900, F2: () => 1600, harmonics: 5 });
  const x = mix(N(D + 0.1), [normPeak(v, 1)], [burst(D, { filters: [['bp', 1200, 2]], env: (t) => amp(t) * 0.5, gain: 0.15 })]);
  return reverb(x, { room: 0.75, damp: 0.4, wet: 0.2, tail: 0.6 });
}, { rms: -17 });

oneShot('wolf-dissolve', () => {
  const D = 2.4, n = N(D);
  const x = zeros(D);
  add(x, tone(0.9, (t) => 70 + 50 * Math.exp(-t / 0.08), ad(0.004, 0.25), { harmonics: [[1, 1], [2, 0.4], [3, 0.2]] }), 0, 0.5);
  add(x, burst(0.8, { filters: [['lp', 400]], env: ad(0.004, 0.2), gain: 0.4 }));
  const ash = filt(pink(n), 'lp', (t) => 4000 * Math.exp(-t / 0.8) + 250, 0.8);
  applyEnv(ash, ad(0.08, 0.7));
  add(x, normPeak(ash, 0.7));
  const swirl = filt(pink(n), 'bp', (t) => 800 + 400 * Math.sin(TAU * 0.8 * t), 2);
  applyEnv(swirl, ad(0.1, 0.6));
  add(x, normPeak(swirl, 0.25));
  poisson(D, 220, (t) => { if (R() < Math.exp(-t / 0.6)) add(x, crackle(0.35 * Math.exp(-t / 0.9), 1500, 6000, 2), t); });
  const ember = filt(white(n), 'hp', 4000);
  const g = smooth(40, D);
  applyEnv(ember, (t) => ad(0.05, 0.9)(t) * Math.max(0, g(t)) ** 2);
  add(x, normPeak(ember, 0.15));
  return reverb(x, { room: 0.8, damp: 0.4, wet: 0.2, tail: 1 });
}, { rms: -17 });

variants('bird', 6, (k) => {
  const gens = [birdWarble, birdTrill, birdFeebee, birdDove, birdChip, birdWarble];
  const x = normPeak(gens[k](), 1);
  return filt(reverb(x, { room: 0.7, damp: 0.5, wet: 0.12, tail: 0.8 }), 'hp', 300);
}, { rms: -18 });

variants('owl', 2, (k) => {
  const x = owlCall(k === 0 ? 'tawny' : 'pair', k === 0 ? rand(390, 420) : rand(330, 350));
  return reverb(x, { room: 0.88, damp: 0.45, wet: 0.35, tail: 2.5 });
}, { rms: -17 });

// ── Player ──
/** Body blow and a pained gasp; `slap` adds a hide-and-flesh smack (a bite from one side). */
function hurtRecipe(slap = 0) {
  const x = zeros(0.75);
  add(x, sat(tone(0.4, (t) => 75 + 90 * Math.exp(-t / 0.02), (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.12), { harmonics: [[1, 1], [2, 0.6], [3, 0.35], [4, 0.2]] }), 1.8), 0, 0.55);
  add(x, burst(0.2, { filters: [['bp', 400, 0.9]], env: ad(0.001, 0.05), gain: 0.5 }));
  add(x, burst(0.08, { filters: [['bp', 900, 1.2]], env: ad(0.0005, 0.02), gain: 0.65 }));
  if (slap > 0) add(x, burst(0.04, { filters: [['bp', 1600, 0.8], ['hp', 500]], env: ad(0.0002, 0.008), gain: slap }));
  add(x, normPeak(breathVoice(0.4, { f0: 190, f0End: 130, voiced: 0.5, env: (t) => Math.min(1, t / 0.03) * Math.exp(-t / 0.12) }), 0.9), 0.04);
  return filt(filt(x, 'lp', 5000), 'hp', 90);
}
oneShot('player-hurt', () => hurtRecipe(), { rms: -16 });
// The same hurt from an attacker: the AudioSystem places it just off the head, toward it.
oneShot('player-struck', () => hurtRecipe(0.55), { rms: -16 });

// Footsteps (4 takes per surface, played one per 0.7 m of locomotion). Soft: rendered
// at −24 and played at volume 0.5, about −30 LUFS in game. Heel, then the toe rolling
// down ~70 ms later; identity above 150 Hz so they read on open-ear speakers.
function footfall(surface, p) {
  const x = zeros(0.36);
  const toe = rand(0.055, 0.085);
  if (surface === 'grass') {
    // A muffled press into turf, then blades crushing and swishing under the sole.
    add(x, burst(0.09, { color: 'pink', filters: [['lp', 420 * p], ['hp', 110]], env: ad(0.004, 0.025), gain: 0.55 }));
    add(x, burst(0.07, { color: 'pink', filters: [['lp', 380 * p], ['hp', 110]], env: ad(0.004, 0.02), gain: 0.3 }), toe);
    const blades = filt(white(N(0.26)), 'bp', 3200 * p, 0.6);
    applyEnv(blades, (t) => Math.min(1, t / 0.012) * Math.exp(-t / 0.07));
    add(x, normPeak(tailFade(blades), 0.3), 0.004);
    add(x, normPeak(rustleGrains(0.2, 260, { fLo: 1800 * p, fHi: 6000, env: (t) => Math.exp(-t / 0.06) }), 0.45), 0.004);
    add(x, normPeak(rustleGrains(0.12, 160, { fLo: 2200, fHi: 6500, env: (t) => Math.exp(-t / 0.04) }), 0.25), toe);
  } else {
    // Packed earth: a short heel thud with grit, the toe scuffing, a few pebble ticks.
    add(x, thud(0.5, { f: 120 * p, drop: 60, tau: 0.03, dirt: 1400 }));
    add(x, burst(0.05, { filters: [['bp', 900 * p, 0.9]], env: ad(0.001, 0.012), gain: 0.5 }));
    add(x, thud(0.25, { f: 135 * p, drop: 40, tau: 0.025, dirt: 1600 }), toe);
    add(x, normPeak(rustleGrains(0.12, 180, { fLo: 1200, fHi: 4500, env: (t) => Math.exp(-t / 0.04) }), 0.4), toe * 0.6);
    const scuff = filt(pink(N(0.14)), 'bp', 1800 * p, 0.7);
    applyEnv(scuff, hump(0, 0.14, 2));
    add(x, normPeak(scuff, 0.18), toe);
  }
  return filt(x, 'hp', 100);
}
variants('step-grass', 4, (k, p) => footfall('grass', p), { rms: -24 });
variants('step-dirt', 4, (k, p) => footfall('dirt', p), { rms: -24 });

// ── Stingers & music ──
oneShot('journey', () => {
  const D = 6.5, x = zeros(D + 0.2);
  for (const [name, a] of [['D2', 0.2], ['A2', 0.3], ['D3', 0.4], ['A3', 0.35], ['F#4', 0.12]]) add(x, padVoice(hz(name), D, { attack: 2.6, release: 3.2, bright: 0.4 }), 0, a);
  add(x, bell(hz('A4'), 2.4, 0.3), 2.2, 0.06);
  add(x, bell(hz('E5'), 2.2, 0.3), 3.1, 0.05);
  const air = filt(pink(N(D)), 'bp', 700, 0.6);
  applyEnv(air, hump(0, D, 1.5));
  add(x, normPeak(air, 0.08));
  return filt(reverb(filt(x, 'lp', 2200), { room: 0.86, damp: 0.4, wet: 0.35, tail: 1.5 }), 'hp', 70);
}, { rms: -21 });

oneShot('sleep', () => {
  const D = 4.6, x = zeros(D + 0.2);
  for (const [name, a] of [['D3', 0.5], ['A3', 0.45], ['E4', 0.35], ['F#4', 0.35]]) add(x, padVoice(hz(name), D, { attack: 1.6, release: 2.4, bright: 0.2 }), 0, a);
  add(x, bell(hz('A5'), 1.6, 0.4), 1.2, 0.08);
  add(x, bell(hz('E6'), 1.4, 0.4), 1.9, 0.06);
  return filt(reverb(filt(x, 'lp', 1800), { room: 0.86, damp: 0.4, wet: 0.35, tail: 1.5 }), 'hp', 60);
}, { rms: -19 });

oneShot('dawn', () => {
  const x = zeros(4.4);
  for (const [name, a] of [['D4', 0.4], ['F#4', 0.3], ['A4', 0.3]]) add(x, padVoice(hz(name), 4.0, { attack: 1.2, release: 2.2, bright: 0.2 }), 0, a);
  [['A4', 0], ['D5', 0.22], ['E5', 0.44], ['F#5', 0.66], ['A5', 0.95]].forEach(([name, at], k) => {
    const f = hz(name), last = k === 4;
    add(x, pluck(f, last ? 3 : 1.6, { decay: last ? 2.2 : 1.3, bright: 0.45, body: 0.25 }), at, last ? 0.75 : 0.55);
    add(x, bell(f, last ? 2.4 : 1.2, 0.5), at, 0.18);
  });
  return filt(reverb(x, { room: 0.85, damp: 0.4, wet: 0.3, tail: 1.6 }), 'lp', 7500);
}, { rms: -18 });

/** Dusk: D minor pad under a falling pluck, a low wind swell. */
oneShot('dusk', () => {
  const D = 4.4, x = zeros(D + 0.2);
  for (const [name, a] of [['D3', 0.45], ['A3', 0.35], ['F4', 0.3]]) add(x, padVoice(hz(name), D, { attack: 1.2, release: 2.4, bright: 0.25 }), 0, a);
  [['A4', 0.3], ['F4', 0.7], ['D4', 1.15]].forEach(([name, at], k) => add(x, pluck(hz(name), k === 2 ? 3 : 1.6, { decay: k === 2 ? 2.2 : 1.3, bright: 0.35, body: 0.3 }), at, 0.5));
  const wind = filt(pink(N(D)), 'bp', (t) => 300 + 250 * hump(0, D, 1)(t), 0.7);
  applyEnv(wind, hump(0, D, 1.3));
  add(x, normPeak(wind, 0.15));
  return filt(reverb(x, { room: 0.86, damp: 0.45, wet: 0.32, tail: 1.6 }), 'lp', 6000);
}, { rms: -19 });

/** The spire's eye opens: a rising D-major swell with a noise riser and a shimmer. */
oneShot('spire-eye', () => {
  const D = 5, x = zeros(D + 0.3);
  const rise = lineEnv([[0, 0], [3.8, 1], [4.3, 1], [D, 0]]);
  for (const [name, a] of [['D3', 0.4], ['A3', 0.35], ['D4', 0.3], ['F#4', 0.25], ['A4', 0.2]]) {
    const v = padVoice(hz(name), D, { attack: 3.5, release: 1.0, bright: 0.35 });
    add(x, v, 0, a);
  }
  const riser = filt(pink(N(D)), 'bp', (t) => 400 * Math.pow(7.5, clamp(t / 4, 0, 1)), 1.4);
  applyEnv(riser, (t) => rise(t) ** 2);
  add(x, normPeak(riser, 0.2));
  for (const [name, at] of [['A5', 2.4], ['D6', 3.0], ['F#6', 3.5]]) add(x, bell(hz(name), 1.6, 0.5), at, 0.06);
  applyEnv(x, (t) => 0.3 + 0.7 * rise(t));
  return filt(reverb(x, { room: 0.88, damp: 0.4, wet: 0.35, tail: 1.6 }), 'lp', 8000);
}, { rms: -17 });

oneShot('ending', () => {
  const beat = 60 / 66, bar = beat * 4;
  const total = 25.5;
  const x = zeros(total);
  const chords = [['D3', 'A3', 'D4', 'F#4'], ['B2', 'F#3', 'B3', 'D4'], ['G2', 'D3', 'G3', 'B3'], ['A2', 'E3', 'A3', 'C#4']];
  chords.forEach((notes, b) => {
    for (const name of notes) add(x, padVoice(hz(name), bar + 1.4, { attack: 0.9, release: 1.3, bright: 0.22 }), b * bar, 0.16);
    add(x, tone(bar + 1, hz(notes[0]) / 2, (t) => Math.min(1, t / 0.05) * Math.exp(-t / 2.5), { harmonics: [[1, 1], [2, 0.35], [3, 0.12]] }), b * bar, 0.28);
  });
  const finalAt = 4 * bar, finalLen = total - finalAt - 0.5;
  for (const name of ['D3', 'A3', 'D4', 'F#4', 'A4']) add(x, padVoice(hz(name), finalLen, { attack: 1.0, release: 4.5, bright: 0.22 }), finalAt, 0.15);
  add(x, tone(finalLen, hz('D2'), (t) => Math.min(1, t / 0.05) * Math.exp(-t / 3.5), { harmonics: [[1, 1], [2, 0.35], [3, 0.12]] }), finalAt, 0.3);
  // Frame drum on the final chord.
  add(x, thud(0.5, { f: 80, drop: 40, tau: 0.35, dirt: 500 }), finalAt);
  add(x, burst(0.4, { filters: [['bp', 300, 1.2]], env: ad(0.002, 0.12), gain: 0.2 }), finalAt);
  const melody = [
    [0, 'A4', 1], [1, 'D5', 0.5], [1.5, 'E5', 0.5], [2, 'F#5', 2],
    [4, 'E5', 1], [5, 'D5', 0.5], [5.5, 'B4', 0.5], [6, 'D5', 2],
    [8, 'B4', 0.5], [8.5, 'D5', 0.5], [9, 'E5', 1], [10, 'A5', 1], [11, 'F#5', 0.5], [11.5, 'E5', 0.5],
    [12, 'E5', 1], [13, 'F#5', 1], [14, 'E5', 1.5], [15.5, 'A4', 0.5],
    [16, 'D5', 0.5], [16.5, 'F#5', 0.5], [17, 'A5', 1], [18, 'D6', 4],
  ];
  for (const [at, name, len] of melody) {
    const f = hz(name), long = len >= 2;
    add(x, pluck(f, long ? 4 : 2.2, { decay: long ? 2.6 : 1.5, bright: 0.45, body: 0.3 }), at * beat, 0.5);
    add(x, bell(f, long ? 3 : 1.4, 0.4), at * beat, 0.12);
  }
  const arps = [['D4', 'A4', 'D5', 'A4'], ['B3', 'F#4', 'B4', 'F#4'], ['G3', 'D4', 'G4', 'D4'], ['A3', 'E4', 'A4', 'E4']];
  for (let b = 1; b < 4; b++) {
    for (let s = 0; s < 8; s++) add(x, pluck(hz(arps[b][s % 4]), 1.2, { decay: 0.9, bright: 0.3, body: 0.15 }), (b * 4 + s * 0.5) * beat, 0.16);
  }
  const wet = reverb(filt(x, 'lp', 6500), { room: 0.87, damp: 0.4, wet: 0.3, tail: 0.1 });
  return applyEnv(wet, (t) => clamp((total + 0.1 - t) / 2, 0, 1));
}, { rms: -18, kbps: 128 });

oneShot('death', () => {
  const D = 3.4, total = D + 1.2, x = zeros(total);
  const drone = [[1, 0.8], [2, 0.6], [3, 0.4], [4, 0.25], [5, 0.12]];
  add(x, tone(total, 110, ad(0.02, 1.2), { harmonics: drone }), 0, 0.5);
  add(x, tone(total, 116.5, ad(0.02, 1.1), { harmonics: drone }), 0, 0.4);
  add(x, tone(total, 55, ad(0.02, 1.2)), 0, 0.15);
  add(x, normPeak(modes(total, [[196, 1.4, 1], [286, 1.1, 0.7], [422, 0.9, 0.5], [574, 0.7, 0.35], [722, 0.5, 0.25]], { attack: 0.003 }), 0.5));
  add(x, tone(2.4, (t) => 220 * Math.pow(0.5, t / 2), (t) => hump(0, 2.4, 1)(t), { harmonics: [[1, 1], [2, 0.2]] }), 0.15, 0.2);
  add(x, burst(total, { color: 'pink', filters: [['lp', 900]], env: ad(0.1, 1.2), gain: 0.3 }));
  add(x, burst(1.4, { filters: [['hp', 3000]], env: ad(0.3, 0.4), gain: 0.05 }), 0.3);
  return filt(reverb(sat(filt(x, 'lp', 2500), 1.4), { room: 0.86, damp: 0.45, wet: 0.35, tail: 1.2 }), 'hp', 70);
}, { rms: -16 });

oneShot('stage', () => {
  const D = 4.6, n = N(D), x = zeros(D);
  const swell = lineEnv([[0, 0], [2.2, 0.8], [2.7, 1], [3.4, 0.6], [4.6, 0]]);
  const saw = [];
  for (let k = 1; k <= 8; k++) saw.push([k, 1 / k]);
  for (const [f, a] of [[73.42, 0.5], [103.83, 0.35], [146.83, 0.25], [73.9, 0.3], [146.8, 0.2], [207.7, 0.2]]) {
    add(x, filt(tone(D, f, swell, { harmonics: saw, phase: rand(0, TAU) }), 'lp', (t) => 350 + 1400 * swell(t), 0.9), 0, a);
  }
  const wind = filt(pink(n), 'bp', (t) => 300 + 500 * swell(t), 0.7);
  add(x, normPeak(applyEnv(wind, swell), 0.25));
  add(x, thud(0.6, { f: 70, drop: 40, tau: 0.35, dirt: 400 }), 2.4);
  add(x, tone(D, 1174.7, (t) => swell(t) * 0.5), 0, 0.02);
  add(x, tone(D, 1244.5, (t) => swell(t) * 0.5), 0, 0.02);
  return reverb(sat(x, 1.3), { room: 0.87, damp: 0.45, wet: 0.3, tail: 1.2 });
}, { rms: -17 });

// ─────────────────────────────── render & encode ────────────────────────────────
/** DC removal, one-shot trim/fades, K-weighted loudness normalisation. `chans`: 1 or 2 arrays. */
function finish(chans, clip) {
  for (const x of chans) {
    let mean = 0;
    for (let i = 0; i < x.length; i++) mean += x[i];
    mean /= x.length;
    for (let i = 0; i < x.length; i++) x[i] -= mean;
  }
  if (!clip.loop) {
    let x = chans[0];
    const peak = peakOf(x);
    let end = x.length;
    while (end > N(0.05) && Math.abs(x[end - 1]) < peak * 0.0015) end--;
    x = x.slice(0, Math.min(x.length, end + N(0.02)));
    const fi = Math.min(N(0.0015), x.length);
    for (let i = 0; i < fi; i++) x[i] *= i / fi;
    chans = [tailFade(x, 0.04)];
  }
  let loudness;
  if (clip.loop) {
    let ms = 0;
    for (const x of chans) { const r = rmsOf(kweight(x)); ms += r * r; }
    loudness = Math.sqrt(ms);
  } else {
    const k = kweight(chans[0]), w = N(0.4);
    let acc = 0;
    loudness = 0;
    for (let i = 0; i < k.length; i++) {
      acc += k[i] * k[i];
      if (i >= w) acc -= k[i - w] * k[i - w];
      loudness = Math.max(loudness, Math.sqrt(Math.max(0, acc) / w));
    }
  }
  const peak = Math.max(...chans.map(peakOf));
  const gain = Math.min(db(-1) / peak, db(clip.rms) / loudness) * db(clip.level);
  return chans.map((x) => scale(x, gain));
}
function wavBuffer(chans, sr) {
  const ch = chans.length, n = chans[0].length, bytes = n * 2 * ch, b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2 * ch, 28); b.writeUInt16LE(2 * ch, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const dither = (R() - R()) / 32768;
      b.writeInt16LE(Math.round(clamp(chans[c][i] + dither, -1, 1) * 32767), 44 + (i * ch + c) * 2);
    }
  }
  return b;
}
function encode(wavPath, outPath, clip, channels) {
  const common = ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-ac', String(channels), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
  const codec = clip.loop
    ? ['-c:a', 'libopus', '-b:a', `${clip.kbps}k`, '-vbr', 'on', '-compression_level', '10', '-application', 'audio']
    : ['-ar', String(clip.sr), '-c:a', 'libmp3lame', '-b:a', `${clip.kbps}k`, '-id3v2_version', '0'];
  execFileSync(FFMPEG, [...common, ...codec, outPath], { stdio: ['ignore', 'ignore', 'inherit'] });
}

const only = new Set(process.argv.slice(2));
const selected = (id) => !only.size || only.has(id) || only.has(id.replace(/-\d$/, ''));
const unknown = [...only].filter((id) => !clips.some((c) => c.id === id || c.id.replace(/-\d$/, '') === id));
if (unknown.length) { console.error(`Unknown clip id(s): ${unknown.join(', ')}`); process.exit(1); }
mkdirSync(OUT_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'prometheus-audio-'));
let total = 0;
try {
  for (const clip of clips) {
    if (!selected(clip.id)) continue;
    SR = clip.sr;
    R = mulberry32(hashString(clip.id));
    const raw = clip.loop ? clip.gen(clip.seconds) : clip.gen();
    const chans = (Array.isArray(raw) ? raw : [raw]).map((x) => Float32Array.from(x));
    if (clip.loop && chans.some((x) => x.length !== N(clip.seconds))) throw new Error(`${clip.id}: loop length != ${N(clip.seconds)}`);
    const out = finish(chans, clip);
    const wav = join(work, `${clip.id}.wav`);
    writeFileSync(wav, wavBuffer(out, clip.sr));
    if (process.env.SYNTH_WAV_DIR) writeFileSync(join(process.env.SYNTH_WAV_DIR, `${clip.id}.wav`), readFileSync(wav));
    const file = `${clip.id}.${clip.loop ? 'ogg' : 'mp3'}`;
    encode(wav, join(OUT_DIR, file), clip, out.length);
    const size = statSync(join(OUT_DIR, file)).size;
    total += size;
    console.log(`${file.padEnd(22)} ${(out[0].length / clip.sr).toFixed(2).padStart(6)} s ${(size / 1024).toFixed(1).padStart(7)} KB${clip.loop ? `  loop${out.length > 1 ? ' stereo' : ''}` : ''}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`${only.size ? 'regenerated' : 'total'}: ${(total / 1024).toFixed(1)} KB`);
