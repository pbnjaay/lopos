import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"

import { getSaleReceipt, getSaleReturn } from "../api/sales"
import { PageHeader } from "../components/layout/PageHeader"
import { Button } from "../components/ui/Button"
import { MetaList } from "../components/ui/Metadata"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { SectionHeader } from "../components/ui/SectionHeader"
import { useFocusOnMount } from "../hooks/useFocusOnMount"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import type { PaymentMethod } from "../types/api"
import { formatDateTime } from "../utils/date"
import { formatBackendMoney } from "../utils/money"
import { backendQuantityToMilli, formatQuantity } from "../utils/quantity"

const paymentLabels: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
}

export function SaleReturnReceiptPage() {
  const { returnId } = useParams<{ returnId: string }>()
  // Le focus repart du résultat du retour, pas du haut du document.
  const headingRef = useFocusOnMount<HTMLHeadingElement>()
  const user = useCurrentUser().data!
  const { ownSession } = usePosSession(user)
  const receiptQuery = useQuery({
    queryKey: ["returns", returnId, ownSession?.id, "receipt"],
    queryFn: async () => {
      const saleReturn = await getSaleReturn(returnId!, ownSession!.id)
      const originalSale = await getSaleReceipt(saleReturn.original_sale_id, ownSession!.id)
      return { saleReturn, originalSale }
    },
    enabled: Boolean(returnId && ownSession),
    retry: false,
  })

  if (!returnId) return <RouteError context="ticket" title="Ticket de retour introuvable" description="Ce retour n’existe pas ou n’est plus accessible." />
  if (receiptQuery.isLoading) return <RouteLoading message="Chargement du ticket de retour…" />
  if (receiptQuery.error) {
    return (
      <RouteError
        error={receiptQuery.error}
        context="ticket"
        onRetry={() => void receiptQuery.refetch()}
      />
    )
  }

  const receipt = receiptQuery.data
  if (!receipt) return <RouteLoading message="Chargement du ticket de retour…" />
  const { saleReturn, originalSale } = receipt

  return (
    <main className="operational-page operational-page-narrow receipt-screen-page">
      <div className="no-print">
        <PageHeader
          backTo={`/sales/${saleReturn.original_sale_id}`}
          backLabel="Retour à la vente"
          eyebrow={`Retour ${saleReturn.reference}`}
          title="Ticket de retour"
          context={`${originalSale.store.name} · ${originalSale.cash_register.name}`}
          actions={(
            <Button variant="primary" size="sm" onClick={() => window.print()}>
              Imprimer le ticket
            </Button>
          )}
        />
      </div>

      <article className="receipt return-detail-receipt" aria-labelledby="return-receipt-title">
        <div className="return-detail-intro no-print">
          <div className="success-mark" aria-hidden="true">✓</div>
          <div>
            <p className="eyebrow">Retour enregistré</p>
            <h2 id="return-receipt-title" ref={headingRef} tabIndex={-1}>
              Remboursement effectué
            </h2>
            <p>Le stock et les montants de la vente ont été mis à jour.</p>
          </div>
        </div>
        <div className="no-print return-detail-meta">
          <MetaList
            label="Informations du retour"
            items={[
              { label: "Référence", value: saleReturn.reference },
              { label: "Ticket d’origine", value: saleReturn.original_sale_id.slice(0, 8).toUpperCase() },
              { label: "Date et heure", value: formatDateTime(saleReturn.created_at) },
            ]}
          />
        </div>

        <header className="receipt-heading print-only">
          <h1>{originalSale.store.name}</h1>
          <p><strong>N° retour : {saleReturn.reference}</strong></p>
          <p>Ticket d’origine : {saleReturn.original_sale_id.slice(0, 8).toUpperCase()}</p>
          <p>{formatDateTime(saleReturn.created_at)}</p>
          <p>Caisse : {originalSale.cash_register.name}</p>
          <p>Caissier : {originalSale.cashier.username}</p>
        </header>

        <div className="no-print return-detail-section">
          <SectionHeader
            title="Articles retournés"
            trailing={`${saleReturn.items.length} article${saleReturn.items.length > 1 ? "s" : ""}`}
          />
        </div>
        <ul className="receipt-items return-detail-items" aria-label="Articles retournés">
          {saleReturn.items.map((item) => (
            <li key={item.id}>
              <strong>{item.product_name}</strong>
              <div>
                <span>
                  {formatQuantity(backendQuantityToMilli(item.quantity), item.sale_unit)} × {formatBackendMoney(item.unit_price)}{item.sale_unit === "KG" ? "/kg" : ""}
                </span>
                <span><Money backend={item.refund_amount} /></span>
              </div>
              <small>Remis en stock : {item.restock ? "Oui" : "Non"}</small>
            </li>
          ))}
        </ul>

        <dl className="receipt-totals">
          <div className="receipt-total">
            <dt>Total remboursé</dt>
            <dd><Money backend={saleReturn.total_refund} /></dd>
          </div>
          <div>
            <dt>Remboursement</dt>
            <dd>{paymentLabels[saleReturn.payment_method]}</dd>
          </div>
        </dl>

        <footer className="receipt-footer">Retour traité</footer>
      </article>
    </main>
  )
}
