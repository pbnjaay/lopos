import { type ComponentPropsWithRef, type ReactNode } from "react"
import { Link, type LinkProps } from "react-router-dom"

import { Spinner } from "./Spinner"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive"
export type ButtonSize = "sm" | "md" | "lg"

type ButtonStyleProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  className?: string
}

export function buttonClassName({
  variant = "secondary",
  size = "md",
  block = false,
  className = "",
}: ButtonStyleProps): string {
  return [
    "button",
    `button-${variant}`,
    size === "md" ? "" : `button-${size}`,
    block ? "button-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ")
}

type ButtonProps = ButtonStyleProps &
  Omit<ComponentPropsWithRef<"button">, "className"> & {
    /** Affiche l'état de traitement sans changer la largeur du bouton. */
    loading?: boolean
    loadingLabel?: string
    children: ReactNode
  }

export function Button({
  variant,
  size,
  block,
  className,
  loading = false,
  loadingLabel = "Traitement…",
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClassName({ variant, size, block, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        // Les deux libellés partagent la même cellule de grille : le bouton
        // est déjà large pour le plus long des deux, donc rien ne bouge au
        // passage en chargement.
        <span className="button-stack">
          <span data-stack-hidden="true" aria-hidden="true">
            {children}
          </span>
          <span>
            <Spinner />
            {loadingLabel}
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  )
}

type ButtonLinkProps = ButtonStyleProps & Omit<LinkProps, "className">

/** Lien interne présenté comme un bouton — même grammaire visuelle. */
export function ButtonLink({ variant, size, block, className, ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={buttonClassName({ variant, size, block, className })} />
}
