/**
 * Symbole LoPOS — « lo », le o en goutte : Lo comme l'eau, sous-entendu
 * facile. Mêmes tracés que public/icons/logo.svg (source des icônes d'app) :
 * toute retouche du logo se fait dans les deux fichiers.
 *
 * `tone="mono"` suit `currentColor` — c'est la version du ticket, imprimée
 * en noir sur papier thermique.
 */
export function LogoMark({
  size = 28,
  tone = "brand",
  className,
}: {
  size?: number
  tone?: "brand" | "mono"
  className?: string
}) {
  const tile = tone === "brand" ? "var(--color-primary)" : "currentColor"
  const mark = tone === "brand" ? "#ffffff" : "var(--logo-mono-cutout, #ffffff)"
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="14" fill={tile} />
      <rect x="13.5" y="13" width="7.5" height="38" rx="3.75" fill={mark} />
      <path
        d="M39 22.5C39 22.5 28.5 34 28.5 41a10.5 10.5 0 0 0 21 0C49.5 34 39 22.5 39 22.5Z"
        fill="none"
        stroke={mark}
        strokeWidth="6.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Symbole + nom. Le nom reste du texte : lisible par les lecteurs d'écran. */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`logo ${className}`.trim()}>
      <LogoMark size={size} />
      <span className="logo-wordmark">
        <span className="logo-wordmark-lo">Lo</span>POS
      </span>
    </span>
  )
}
