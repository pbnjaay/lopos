const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value)).replace(",", "")
}
