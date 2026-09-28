const SENEGAL_PREFIX = "221"
const ALLOWED = /^\+?[\d\s.\-()/]+$/

/**
 * Même règle que le serveur (`apps/customers/phone.py`) : ramène un numéro à
 * sa forme E.164. Sert à valider la saisie avant l'envoi et à reconnaître un
 * doublon localement ; le serveur reste l'arbitre final.
 *
 * `77 123 45 67`, `771234567`, `+221771234567`, `00221771234567` →
 * `+221771234567`. Un numéro étranger explicite (`+33…`) est gardé tel quel.
 * Renvoie `null` si le numéro n'est pas reconnu.
 */
export function normalizePhone(raw: string): string | null {
  const value = raw.trim()
  if (!value || !ALLOWED.test(value)) return null

  let digits = value.replaceAll(/\D/g, "")
  let international = value.startsWith("+")
  if (!international && digits.startsWith("00")) {
    international = true
    digits = digits.slice(2)
  }

  if (international && !digits.startsWith(SENEGAL_PREFIX)) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  if (digits.startsWith(SENEGAL_PREFIX) && (international || digits.length === 12)) {
    digits = digits.slice(SENEGAL_PREFIX.length)
  }
  if (digits.length === 9 && (digits[0] === "7" || digits[0] === "3")) {
    return `+${SENEGAL_PREFIX}${digits}`
  }
  return null
}

/** `+221771234567` → `77 123 45 67` ; un numéro étranger est affiché tel quel. */
export function formatPhone(phone: string | null): string {
  if (!phone) return ""
  if (phone.startsWith(`+${SENEGAL_PREFIX}`) && phone.length === 13) {
    const national = phone.slice(4)
    return `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5, 7)} ${national.slice(7)}`
  }
  return phone
}

/** Une saisie de recherche composée uniquement de chiffres (et séparateurs) vise un numéro. */
export function phoneSearchDigits(query: string): string | null {
  const trimmed = query.trim()
  if (!/^\+?[\d\s.\-]+$/.test(trimmed)) return null
  const digits = trimmed.replaceAll(/\D/g, "")
  return digits.length >= 2 ? digits : null
}

/**
 * `+221771234567` → `77 ••• •• 67` : assez pour que le client reconnaisse
 * son numéro sur un ticket papier, sans l'exposer à qui le ramasse.
 */
export function maskPhone(phone: string | null): string {
  if (!phone) return ""
  const digits = phone.replaceAll(/\D/g, "")
  if (phone.startsWith(`+${SENEGAL_PREFIX}`) && digits.length === 12) {
    const national = digits.slice(3)
    return `${national.slice(0, 2)} ••• •• ${national.slice(7)}`
  }
  return `••• ${digits.slice(-2)}`
}
