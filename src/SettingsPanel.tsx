import { useId, useState } from "react";

import type { FluidSettings } from "@/fluid/settings";
import { clampSetting, SETTING_DESCRIPTORS } from "@/fluid/settings";

interface SettingsPanelProps {
  settings: FluidSettings;
  onChange: (settings: FluidSettings) => void;
  onReset: () => void;
}

export const SettingsPanel = ({
  settings,
  onChange,
  onReset,
}: SettingsPanelProps) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="settings">
      <button
        type="button"
        className="settings__toggle"
        aria-expanded={open}
        aria-controls={panelId}
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

          {SETTING_DESCRIPTORS.map(
            ({ key, label, min, max, step, precision }) => (
              <label key={key} className="settings__row">
                <span className="settings__label">{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={settings[key]}
                  onChange={(event) => {
                    onChange({
                      ...settings,
                      [key]: clampSetting(key, event.target.valueAsNumber),
                    });
                  }}
                />
                <output className="settings__value">
                  {settings[key].toFixed(precision)}
                </output>
              </label>
            ),
          )}

          <button
            type="button"
            className="settings__reset"
            onClick={() => {
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
