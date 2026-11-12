import { useCallback, useEffect, useRef, useState } from "react";

import type { PointerTracker } from "@/fluid/pointer";
import type { ResolutionSettings } from "@/fluid/resolution";
import type { FluidSettings } from "@/fluid/settings";
import {
  loadResolution,
  loadSettings,
  saveResolution,
  saveSettings,
} from "@/fluid/settingsStorage";
import type { FluidRenderer } from "@/fluid/types";

const SAVE_DEBOUNCE_MS = 200;

export const useFluidSettings = () => {
  const [settings, setSettings] = useState<FluidSettings>(loadSettings);
  const [resolution, setResolution] =
    useState<ResolutionSettings>(loadResolution);

  // Held in a ref as well as state: the simulation effect must not re-run —
  // and tear down the GPU device — every time a slider moves.
  const rendererRef = useRef<FluidRenderer | null>(null);
  const pointerRef = useRef<PointerTracker | null>(null);
  const settingsRef = useRef(settings);
  const resolutionRef = useRef(resolution);

  const saveTimerRef = useRef<number | null>(null);

  const applySettings = useCallback((next: FluidSettings) => {
    settingsRef.current = next;
    setSettings(next);
    rendererRef.current?.applySettings(next);
    pointerRef.current?.setForce(next.splatForce);

    // Debounced because a dragged slider fires per pointer move; only the value
    // it rests on has to be stored, while the lines above take every one.
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveSettings(settingsRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Undebounced, unlike the settings above: the panel only reports a resolution
  // once the drag ends, so there is no per-move burst to collapse.
  const applyResolution = useCallback((next: ResolutionSettings) => {
    resolutionRef.current = next;
    setResolution(next);
    rendererRef.current?.setResolution(next);
    saveResolution(next);
  }, []);

  // Flushed on hide because a pending save would otherwise be lost to a tab
  // closed mid-drag; `pagehide` is the last event a bfcache-eligible page gets.
  useEffect(() => {
    const flush = (): void => {
      if (saveTimerRef.current === null) return;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      saveSettings(settingsRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return {
    settings,
    resolution,
    applySettings,
    applyResolution,
    rendererRef,
    pointerRef,
    settingsRef,
    resolutionRef,
  };
};
