import type { ReactNode } from "react"

import { LogoMark } from "../ui/Logo"

type ReceiptHeadingProps = {
  titleId?: string
  storeName: string
  documentTitle: "Ticket de vente" | "Ticket de retour" | "Reçu de paiement"
  referenceLabel: string
  reference: string
  createdAt: string
  cashRegisterName: string
  cashierName: string
  secondaryLine?: ReactNode
  note?: ReactNode
}

/** En-tête imprimable commun : le type de ticket ne disparaît jamais. */
export function ReceiptHeading({
  titleId,
  storeName,
  documentTitle,
  referenceLabel,
  reference,
  createdAt,
  cashRegisterName,
  cashierName,
  secondaryLine,
  note,
}: ReceiptHeadingProps) {
  return (
    <header className="receipt-heading">
      <h1 id={titleId}>{storeName}</h1>
      <p className="receipt-document-title">{documentTitle}</p>
      <p><strong>{referenceLabel} : {reference}</strong></p>
      {secondaryLine ? <p>{secondaryLine}</p> : null}
      <p>{createdAt}</p>
      <p>Caisse : {cashRegisterName}</p>
      <p>Caissier : {cashierName}</p>
      {note}
    </header>
  )
}

/**
 * Signature en pied de ticket, discrète : le ticket appartient à la
 * boutique, dont le nom reste en tête. Symbole en noir seul, pour le
 * papier thermique.
 */
export function ReceiptSignature() {
  return (
    <span className="receipt-signature">
      <LogoMark size={14} tone="mono" />
      Encaissé avec LoPOS
    </span>
  )
}
