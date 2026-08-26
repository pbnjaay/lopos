type SkeletonProps = {
  width?: string
  height?: string
  className?: string
}

/** Bloc de contenu en attente. La structure de l'écran reste visible :
 *  pas d'écran blanc → spinner → contenu. */
export function Skeleton({ width, height, className = "" }: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}

type SkeletonRowsProps = {
  count?: number
  /** Message annoncé aux lecteurs d'écran pendant l'attente. */
  label: string
  className?: string
}

/** Lignes de liste en attente — reprend la densité de `.list-row`. */
export function SkeletonRows({ count = 5, label, className = "" }: SkeletonRowsProps) {
  return (
    <div className={`skeleton-rows ${className}`.trim()} role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <span className="skeleton-row" key={index} aria-hidden="true">
          <span className="skeleton-row-main">
            <Skeleton width={`${60 + ((index * 13) % 25)}%`} height="0.95rem" />
            <Skeleton width={`${35 + ((index * 7) % 20)}%`} height="0.75rem" />
          </span>
          <Skeleton width="5.5rem" height="1.1rem" />
        </span>
      ))}
    </div>
  )
}
