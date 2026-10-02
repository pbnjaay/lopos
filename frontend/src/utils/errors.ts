/** Erreur déjà rédigée pour le caissier : son titre et son message
 *  s'affichent tels quels (voir `describeError`). */
export class UserFacingError extends Error {
  readonly title: string
  readonly canRetry: boolean

  constructor(title: string, message: string, { canRetry = false } = {}) {
    super(message)
    this.name = "UserFacingError"
    this.title = title
    this.canRetry = canRetry
  }
}
