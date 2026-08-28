import type { ReactNode } from "react"

type ReceiptHeadingProps = {
  titleId?: string
  storeName: string
  documentTitle: "Ticket de vente" | "Ticket de retour"
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
