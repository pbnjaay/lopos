type EmptyStateProps = {
  title: string
  description: string
  role?: "status"
}

export function EmptyState({ title, description, role }: EmptyStateProps) {
  return (
    <section className="empty-state" role={role}>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  )
}
