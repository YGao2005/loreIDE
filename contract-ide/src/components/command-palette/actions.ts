import type { LensId } from '@/store/graph';

/**
 * Command palette action registry (Plan 03-03 / SHELL-03).
 *
 * Keeping action descriptors out of the palette JSX means future plans
 * (Phase 4 inspector, Phase 8 agent loop) can register their own actions by
 * extending these arrays without touching the palette UI. The arrays are
 * typed so the palette's `onSelect` handlers get narrow types at the call
 * site.
 */
export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
}

export interface LensAction {
  id: string;
  label: string;
  lens: LensId;
}

export const repositoryActions: CommandAction[] = [
  { id: 'repo.open', label: 'Open repository…', hint: '⌘O' },
];

export const lensActions: LensAction[] = [
  { id: 'lens.journey',   label: 'Switch to Journey lens',   lens: 'journey' },
  { id: 'lens.system',    label: 'Switch to System lens',    lens: 'system' },
  { id: 'lens.ownership', label: 'Switch to Ownership lens', lens: 'ownership' },
];

export const navigationActions: CommandAction[] = [
  { id: 'nav.focus-chat', label: 'Focus chat panel' },
];
