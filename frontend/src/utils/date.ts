const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value)).replace(",", "")
}

/** `24/08/2026` — métadonnée secondaire d'une ligne de liste. */
export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value))
}

/** `14:32` — repère principal d'une ligne de vente. */
export function formatTime(value: string): string {
  return timeFormatter.format(new Date(value))
}
