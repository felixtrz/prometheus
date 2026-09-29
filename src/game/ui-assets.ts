/** UIKitML panel registry (owned by the UI build). Deterministic: no World/DOM access. */
import { AssetType } from '@iwsdk/core';

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export const uiAssets = {
  /** Scene-placed field journal (scene node 'camp-journal'); JournalSystem binds it. */
  'camp-journal': { name: 'Field journal', type: AssetType.UIKitML, url: url('ui/camp-journal.uikitml') },
  /** Code-spawned by WristSystem under the left grip space. */
  'wrist-hud': { name: 'Wrist band', type: AssetType.UIKitML, url: url('ui/wrist-hud.uikitml') },
  /** Code-spawned pool of 3 by ToastSystem. */
  toast: { name: 'Toast notice', type: AssetType.UIKitML, url: url('ui/toast.uikitml') },
  /** Code-spawned by ReaderSystem beside a held page. */
  'page-reader': { name: 'Page reader', type: AssetType.UIKitML, url: url('ui/page-reader.uikitml') },
  /** Code-spawned by StartSystem in front of the view until New journey / Continue is chosen. */
  'start-menu': { name: 'Start panel', type: AssetType.UIKitML, url: url('ui/start-menu.uikitml') },
  /** Code-spawned by ToastSystem: the shade's spoken lines (bus 'guide'). */
  subtitle: { name: 'Guide subtitle', type: AssetType.UIKitML, url: url('ui/subtitle.uikitml') },
};
