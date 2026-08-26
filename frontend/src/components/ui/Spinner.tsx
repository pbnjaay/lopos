type SpinnerProps = {
  size?: "sm" | "lg"
  label?: string
}

/** Indicateur d'activité neutre. Jamais utilisé seul en plein écran : il
 *  accompagne un bouton ou une zone déjà structurée (voir Skeleton). */
export function Spinner({ size = "sm", label }: SpinnerProps) {
  return (
    <>
      <span className={size === "lg" ? "spinner spinner-lg" : "spinner"} aria-hidden="true" />
      {label ? <span className="visually-hidden">{label}</span> : null}
    </>
  )
}
