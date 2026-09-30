import { useState } from "react"

import { SegmentedControl } from "../ui/SegmentedControl"
import { type ThemePreference, getThemePreference, setThemePreference } from "../../theme"

const THEME_OPTIONS = [
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
  { value: "system", label: "Système" },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string }>

/** Réglage d'apparence du poste, dans le menu de session. */
export function ThemeSetting() {
  const [preference, setPreference] = useState(getThemePreference)

  return (
    <div className="session-menu-setting">
      <span aria-hidden="true">Apparence</span>
      <SegmentedControl
        label="Apparence"
        options={THEME_OPTIONS}
        value={preference}
        onChange={(value) => {
          setThemePreference(value)
          setPreference(value)
        }}
      />
    </div>
  )
}
