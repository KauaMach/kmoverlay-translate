import { updateSettings, type Settings } from '@/utils/settings';
import { debounce, type Debounced } from './debounce';

/** Delay after the last keystroke before a text field is saved. */
export const SAVE_DEBOUNCE_MS = 500;

/** A pure change applied to the stored settings (see the helpers in `utils/settings.ts`). */
export type SettingsChange = (current: Settings) => Settings;

/** What the header save indicator shows. */
export type SaveState = 'saved' | 'saving' | 'error';

export interface SettingsSaverOptions {
  /** Called when the state changes, e.g. to update the save indicator. */
  onStateChange(state: SaveState): void;
  /** Writes a change; defaults to {@link updateSettings}. */
  update?: (change: SettingsChange) => Promise<Settings>;
  debounceMs?: number;
}

export interface SettingsSaver {
  /**
   * Saves a change now. Resolves to `false` when it failed; the failure is
   * already logged and shown by the save indicator, so callers only decide
   * what to do next.
   */
  save(change: SettingsChange): Promise<boolean>;
  /**
   * Saves after the typing stops. `prepare` runs when the delay ends and
   * returns the change, or `null` to save nothing (invalid input). A later
   * call with the same key replaces the one still waiting.
   */
  saveLater(key: string, prepare: () => SettingsChange | null): void;
  /** Runs the waiting delayed saves now and waits for every save. Resolves to `false` if the last one failed. */
  flush(): Promise<boolean>;
  /** True while a save is waiting or being written. */
  isBusy(): boolean;
}

/**
 * Saves the options page changes and reports a single state for all of them,
 * so the header can say "Salvando…" while anything is pending.
 */
export function createSettingsSaver(options: SettingsSaverOptions): SettingsSaver {
  const update = options.update ?? updateSettings;
  const debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;
  const delayedSaves = new Map<string, Debounced<[() => SettingsChange | null]>>();
  let savesInFlight = 0;
  // `updateSettings` runs the writes in order, so the last one started is the last to finish.
  let lastSave: Promise<boolean> = Promise.resolve(true);
  let lastSaveFailed = false;
  let reportedState: SaveState = 'saved';

  const isBusy = (): boolean =>
    savesInFlight > 0 || [...delayedSaves.values()].some((delayed) => delayed.isPending());

  const reportState = (): void => {
    const state: SaveState = isBusy() ? 'saving' : lastSaveFailed ? 'error' : 'saved';
    if (state !== reportedState) {
      reportedState = state;
      options.onStateChange(state);
    }
  };

  const save = (change: SettingsChange): Promise<boolean> => {
    savesInFlight += 1;
    reportState();
    const outcome = update(change).then(
      () => true,
      (error: unknown) => {
        console.error('KMOverlay: could not save the settings.', error);
        return false;
      },
    );
    lastSave = outcome.then((saved) => {
      lastSaveFailed = !saved;
      savesInFlight -= 1;
      reportState();
      return saved;
    });
    return lastSave;
  };

  const runDelayedSave = (prepare: () => SettingsChange | null): void => {
    const change = prepare();
    if (change === null) {
      reportState();
      return;
    }
    void save(change);
  };

  return {
    save,
    saveLater(key, prepare) {
      let delayed = delayedSaves.get(key);
      if (delayed === undefined) {
        delayed = debounce(runDelayedSave, debounceMs);
        delayedSaves.set(key, delayed);
      }
      delayed.call(prepare);
      reportState();
    },
    async flush() {
      for (const delayed of delayedSaves.values()) {
        delayed.flush();
      }
      return lastSave;
    },
    isBusy,
  };
}
