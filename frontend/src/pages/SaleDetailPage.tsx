import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";

import { cancelSale, getSaleReceipt } from "../api/sales";
import { PageHeader } from "../components/layout/PageHeader";
import { Button, ButtonLink } from "../components/ui/Button";
import { Dialog, DialogBody, DialogFooter } from "../components/ui/Dialog";
import { InlineAlert } from "../components/ui/InlineAlert";
import { ReceiptIcon, RotateCcwIcon, XIcon } from "../components/ui/Icons";
import { MetaList } from "../components/ui/Metadata";
import { Money } from "../components/ui/Money";
import { RouteError, RouteLoading } from "../components/ui/RouteState";
import { SectionHeader } from "../components/ui/SectionHeader";
import { useToast } from "../components/ui/Toast";
import { useCurrentUser } from "../features/auth/queries";
import { usePosSession } from "../features/cash-session/queries";
import { useNetworkStatus } from "../features/offline/useNetworkStatus";
import { saleReceiptQueryKey } from "../features/sales/queries";
import {
  readSaleOrigin,
  saleOriginBack,
  withSaleOrigin,
} from "../features/sales/origin";
import { formatDateTime } from "../utils/date";
import { describeErrorShort } from "../utils/errorCopy";
import { formatBackendMoney } from "../utils/money";
import { backendQuantityToMilli, formatQuantity } from "../utils/quantity";

const paymentLabels = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
} as const;

export function SaleDetailPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const [searchParams] = useSearchParams();
  const origin = readSaleOrigin(searchParams);
  const backDestination = saleOriginBack(origin);
  const user = useCurrentUser().data!;
  const { ownSession } = usePosSession(user);
  const online = useNetworkStatus();
  const queryClient = useQueryClient();
  const toast = useToast();
  const keepSaleButtonRef = useRef<HTMLButtonElement>(null);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const saleQuery = useQuery({
    queryKey: saleReceiptQueryKey(saleId, ownSession?.id),
    queryFn: () => getSaleReceipt(saleId!, ownSession!.id),
    enabled: Boolean(saleId && ownSession && online),
    retry: false,
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelSale(saleId!),
    onSuccess: (updatedSale) => {
      queryClient.setQueryData(
        saleReceiptQueryKey(saleId, ownSession?.id),
        updatedSale,
      );
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      setIsConfirmingCancel(false);
      toast.success("Vente annulée");
    },
  });

  if (!online) {
    return (
      <RouteError
        context="vente"
        title="Mode hors ligne"
        description="Le détail des ventes redeviendra consultable dès le retour de la connexion. Vous pouvez continuer à vendre."
      />
    );
  }
  if (saleQuery.isLoading)
    return <RouteLoading message="Chargement de la vente…" />;
  if (saleQuery.error || !saleQuery.data) {
    return (
      <RouteError
        error={saleQuery.error}
        context="vente"
        onRetry={() => void saleQuery.refetch()}
      />
    );
  }

  const sale = saleQuery.data;
  const canReturn =
    sale.status === "COMPLETED" &&
    sale.items.some(
      (item) => Number(item.quantity_returnable ?? item.quantity) > 0,
    );
  // Pré-filtre côté client pour ne montrer le bouton que quand il a une
  // chance d'aboutir — le serveur reste seul juge final (session encore
  // ouverte ou non, notamment, qu'on ne connaît pas ici).
  const canCancel =
    sale.status === "COMPLETED" && (sale.cashier.id === user.id || user.is_staff);

  return (
    <main className="operational-page">
      <PageHeader
        backTo={backDestination.to}
        backLabel={backDestination.label}
        eyebrow="Vente"
        title={`Ticket ${sale.id.slice(0, 8).toUpperCase()}`}
        context={`${sale.store.name} · ${sale.cash_register.name}`}
        actions={
          <>
            <ButtonLink
              variant="secondary"
              size="sm"
              to={withSaleOrigin(
                `/sales/${sale.id}/receipt?cash_session_id=${ownSession!.id}`,
                origin,
              )}
            >
              <ReceiptIcon />
              <span>Voir le ticket</span>
            </ButtonLink>
            {canReturn ? (
              <ButtonLink
                variant="primary"
                size="sm"
                to={withSaleOrigin(`/sales/${sale.id}/return`, origin)}
              >
                <RotateCcwIcon />
                <span>Effectuer un retour</span>
              </ButtonLink>
            ) : null}
            {canCancel ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsConfirmingCancel(true)}
              >
                <XIcon />
                <span>Annuler la vente</span>
              </Button>
            ) : null}
          </>
        }
      />
      <section className="operational-card sale-detail-card">
        <MetaList
          label="Informations de la vente"
          items={[
            { label: "Date et heure", value: formatDateTime(sale.created_at) },
            { label: "Caissier", value: sale.cashier.username },
            {
              label: "Mode de paiement",
              value: paymentLabels[sale.payment.method],
            },
            ...(sale.status === "CANCELLED"
              ? [{ label: "Statut", value: "Annulée" }]
              : []),
          ]}
        />
        <div className="card-section">
          <SectionHeader
            title="Articles vendus"
            trailing={`${sale.items.length} article${sale.items.length > 1 ? "s" : ""}`}
          />
          <ul className="sale-detail-items">
            {sale.items.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.product_name}</strong>
                  <span>
                    {formatQuantity(
                      backendQuantityToMilli(item.quantity),
                      item.sale_unit ?? "UNIT",
                    )}{" "}
                    × {formatBackendMoney(item.unit_price)}
                  </span>
                </div>
                <div>
                  <strong>
                    <Money backend={item.line_total} />
                  </strong>
                  {Number(item.quantity_returned ?? 0) > 0 ? (
                    <span>
                      Retourné :{" "}
                      {formatQuantity(
                        backendQuantityToMilli(item.quantity_returned!),
                        item.sale_unit ?? "UNIT",
                      )}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="sale-detail-summary">
          <p className="eyebrow">Récapitulatif</p>
          <dl className="sale-detail-totals">
            <div>
              <dt>Total vendu</dt>
              <dd>
                <Money backend={sale.total} />
              </dd>
            </div>
            {Number(sale.returned_total ?? 0) > 0 ? (
              <>
                <div>
                  <dt>Déjà retourné</dt>
                  <dd>
                    <Money backend={sale.returned_total!} sign="minus" />
                  </dd>
                </div>
                <div className="sale-detail-net">
                  <dt>Total net</dt>
                  <dd>
                    <Money backend={sale.net_total!} />
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        </div>
        {!canReturn && sale.status === "COMPLETED" ? (
          <InlineAlert className="sale-detail-note">
            Aucun article de cette vente ne peut encore être retourné.
          </InlineAlert>
        ) : null}
        {sale.status === "CANCELLED" ? (
          <InlineAlert tone="warning" className="sale-detail-note">
            Cette vente a été annulée — son stock a été restitué.
          </InlineAlert>
        ) : null}
      </section>

      {isConfirmingCancel ? (
        <Dialog
          eyebrow="Vente"
          title="Annuler cette vente ?"
          size="sm"
          initialFocusRef={keepSaleButtonRef}
          dismissible={!cancelMutation.isPending}
          onClose={() => setIsConfirmingCancel(false)}
        >
          <DialogBody>
            <p>
              Le stock sera remis à jour. Mode de paiement :{" "}
              {paymentLabels[sale.payment.method]} — cette action ne touche
              pas le paiement, c'est à vous de rembourser le client si
              besoin.
            </p>
            {cancelMutation.error ? (
              <InlineAlert tone="error">
                {describeErrorShort(cancelMutation.error, "vente")}
              </InlineAlert>
            ) : null}
            <DialogFooter>
              <Button
                ref={keepSaleButtonRef}
                variant="secondary"
                disabled={cancelMutation.isPending}
                onClick={() => setIsConfirmingCancel(false)}
              >
                Garder la vente
              </Button>
              <Button
                variant="destructive"
                loading={cancelMutation.isPending}
                loadingLabel="Annulation…"
                onClick={() => cancelMutation.mutate()}
              >
                Confirmer l'annulation
              </Button>
            </DialogFooter>
          </DialogBody>
        </Dialog>
      ) : null}
    </main>
  );
}
