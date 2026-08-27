import { useId, useState } from "react";

import type { SettingDescriptor } from "@/fluid/descriptor";
import type { ResolutionSettings } from "@/fluid/resolution";
import { clampResolution, RESOLUTION_DESCRIPTORS } from "@/fluid/resolution";
import type { FluidSettings } from "@/fluid/settings";
import { clampSetting, SETTING_DESCRIPTORS } from "@/fluid/settings";

interface SliderRowProps {
  descriptor: SettingDescriptor<string>;
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
}

const SliderRow = ({
  descriptor: { label, min, max, step, precision },
  value,
  onChange,
  onCommit,
}: SliderRowProps) => (
  <label className="settings__row">
    <span className="settings__label">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => {
        onChange(event.target.valueAsNumber);
      }}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      onBlur={onCommit}
    />
    <output className="settings__value">{value.toFixed(precision)}</output>
  </label>
);

interface SettingsPanelProps {
  settings: FluidSettings;
  resolution: ResolutionSettings;
  onChange: (settings: FluidSettings) => void;
  onResolutionChange: (resolution: ResolutionSettings) => void;
  onReset: () => void;
}

export const SettingsPanel = ({
  settings,
  resolution,
  onChange,
  onResolutionChange,
  onReset,
}: SettingsPanelProps) => {
  const [open, setOpen] = useState(false);
  // Held back until the drag ends, because each committed value rebuilds every
  // texture — far dearer than the per-move write the other sliders make.
  const [pending, setPending] = useState<ResolutionSettings | null>(null);
  const panelId = useId();

  const shownResolution = pending ?? resolution;

  const commitResolution = (): void => {
    if (pending === null) return;
    setPending(null);
    onResolutionChange(pending);
  };

  return (
    <div className="settings">
      <button
        type="button"
        className="settings__toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? "Close settings" : "Open settings"}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        {open ? "×" : "⚙"}
      </button>

      {open && (
        <div id={panelId} className="settings__panel">
          <h2 className="settings__title">Settings</h2>

          {SETTING_DESCRIPTORS.map((descriptor) => (
            <SliderRow
              key={descriptor.key}
              descriptor={descriptor}
              value={settings[descriptor.key]}
              onChange={(value) => {
                onChange({
                  ...settings,
                  [descriptor.key]: clampSetting(descriptor.key, value),
                });
              }}
            />
          ))}

          {RESOLUTION_DESCRIPTORS.map((descriptor) => (
            <SliderRow
              key={descriptor.key}
              descriptor={descriptor}
              value={shownResolution[descriptor.key]}
              onChange={(value) => {
                setPending({
                  ...shownResolution,
                  [descriptor.key]: clampResolution(descriptor.key, value),
                });
              }}
              onCommit={commitResolution}
            />
          ))}

          <button
            type="button"
            className="settings__reset"
            onClick={() => {
              setPending(null);
              onReset();
            }}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
};
