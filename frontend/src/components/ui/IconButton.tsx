import { type ButtonHTMLAttributes, type ReactNode } from "react"

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
  /** Toujours obligatoire : un bouton icône n'a pas de libellé visible. */
  label: string
  icon: ReactNode
  tone?: "neutral" | "danger"
  shape?: "square" | "round"
  surface?: boolean
  className?: string
}

export function IconButton({
  label,
  icon,
  tone = "neutral",
  shape = "square",
  surface = false,
  className = "",
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={[
        "icon-button",
        shape === "round" ? "icon-button-round" : "",
        surface ? "icon-button-surface" : "",
        tone === "danger" ? "icon-button-danger" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      title={rest.title ?? label}
    >
      {icon}
    </button>
  )
}
