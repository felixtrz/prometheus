/**
 * Guide registry (owned by the guide build): the shade's prototype and its voice
 * clips. Evaluated in two realms (runtime and editor): pure data only. The clip URLs
 * come from voice-urls.ts, a static module of content hashes that
 * `node scripts/voice-urls.mjs` generates with @drawcall/generate (so neither realm
 * bundles the package).
 *
 * Clips are 'lazy', not 'background': until voice-prep.html has generated them they
 * 404, and a background preload would warn once per missing clip at every start. The
 * GuideSystem asks Drawcall once which clips exist, loads a clip when its line is
 * queued (the intro's at start), and warns at most once.
 */
import { AssetType } from '@iwsdk/core';
import { prometheusShade } from '../scene-assets/ghost.scene-asset.js';
import { clipId, DRAWCALL_ORIGIN, LINES } from './voice-lines.js';
import { VOICE_HASHES, voiceClipUrl } from './voice-urls.js';

const voiceClips: Record<string, { type: typeof AssetType.Audio; url: string; priority: 'lazy' }> = {};
for (const line of LINES) {
  const hash = VOICE_HASHES[line.id];
  // A line without a hash (voice-urls.ts not regenerated) simply has no clip: subtitles only.
  if (hash) voiceClips[clipId(line.id)] = { type: AssetType.Audio, url: voiceClipUrl(hash, DRAWCALL_ORIGIN), priority: 'lazy' };
}

export const guideAssets = {
  'prometheus-shade': prometheusShade,
  ...voiceClips,
};
