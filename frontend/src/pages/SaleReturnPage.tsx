import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";

import { createSaleReturn, getSaleReceipt } from "../api/sales";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button, ButtonLink } from "../components/ui/Button";
import { Dialog, DialogBody, DialogFooter } from "../components/ui/Dialog";
import { InlineAlert } from "../components/ui/InlineAlert";
import { Money } from "../components/ui/Money";
import { QuantityControl } from "../components/ui/QuantityControl";
import { RouteError, RouteLoading } from "../components/ui/RouteState";
import { SectionHeader } from "../components/ui/SectionHeader";
import { useCurrentUser } from "../features/auth/queries";
import { usePosSession } from "../features/cash-session/queries";
import { useNetworkStatus } from "../features/offline/useNetworkStatus";
import {
  saleReceiptQueryKey,
  saleReturnReceiptQueryKey,
} from "../features/sales/queries";
import { readSaleOrigin, withSaleOrigin } from "../features/sales/origin";
import type { PaymentMethod, SaleReceipt, SaleReturn } from "../types/api";
import { describeErrorShort } from "../utils/errorCopy";
import { formatBackendMoney } from "../utils/money";
import {
  backendQuantityToMilli,
  formatQuantity,
  lineTotal,
  milliToBackendQuantity,
  milliToDisplayQuantity,
  parseQuantityToMilli,
} from "../utils/quantity";

const refundLabels: Record<PaymentMethod, string> = {
  CASH: "espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
};

export function SaleReturnPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const [searchParams] = useSearchParams();
  const origin = readSaleOrigin(searchParams);
  const user = useCurrentUser().data!;
  const { ownSession } = usePosSession(user);
  const online = useNetworkStatus();
  const queryClient = useQueryClient();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [restocks, setRestocks] = useState<Record<string, boolean>>({});
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [completedReturn, setCompletedReturn] = useState<SaleReturn | null>(
    null,
  );
  const saleQuery = useQuery({
    queryKey: saleReceiptQueryKey(saleId, ownSession?.id),
    queryFn: () => getSaleReceipt(saleId!, ownSession!.id),
    enabled: Boolean(saleId && ownSession && online),
    retry: false,
  });
  const sale: SaleReceipt | null = saleQuery.data ?? null;
  const method = selectedMethod ?? sale?.payment.method ?? "CASH";

  const selected =
    sale?.items.flatMap((item) => {
      const milli = parseQuantityToMilli(quantities[item.id] ?? "");
      if (!milli) return [];
      return [
        {
          item,
          milli,
          amount: lineTotal(Math.round(Number(item.unit_price)), milli),
        },
      ];
    }) ?? [];
  const total = selected.reduce((sum, row) => sum + row.amount, 0);
  const hasInvalidQuantity = selected.some(
    ({ item, milli }) =>
      milli >
        backendQuantityToMilli(item.quantity_returnable ?? item.quantity) ||
      ((item.sale_unit ?? "UNIT") === "UNIT" && milli % 1000 !== 0),
  );
  const returnableItems =
    sale?.items.filter(
      (item) =>
        backendQuantityToMilli(item.quantity_returnable ?? item.quantity) > 0,
    ) ?? [];
  const allReturnableSelected =
    returnableItems.length > 0 &&
    returnableItems.every(
      (item) =>
        parseQuantityToMilli(quantities[item.id] ?? "") ===
        backendQuantityToMilli(item.quantity_returnable ?? item.quantity),
    );

  useEffect(() => {
    if (completedReturn) successHeadingRef.current?.focus();
  }, [completedReturn]);

  function adjustQuantity(
    item: SaleReceipt["items"][number],
    direction: -1 | 1,
  ) {
    const saleUnit = item.sale_unit ?? "UNIT";
    const maximum = backendQuantityToMilli(
      item.quantity_returnable ?? item.quantity,
    );
    const current = parseQuantityToMilli(quantities[item.id] ?? "") ?? 0;
    const step = saleUnit === "KG" ? 100 : 1000;
    const next = Math.max(0, Math.min(maximum, current + direction * step));
    setQuantities({
      ...quantities,
      [item.id]: next === 0 ? "" : milliToDisplayQuantity(next),
    });
  }

  function toggleAllQuantities() {
    if (allReturnableSelected) {
      setQuantities({});
      return;
    }
    setQuantities(
      Object.fromEntries(
        returnableItems.map((item) => {
          const maximum = backendQuantityToMilli(
            item.quantity_returnable ?? item.quantity,
          );
          return [item.id, milliToDisplayQuantity(maximum)];
        }),
      ),
    );
  }

  async function submit() {
    if (
      !sale ||
      !ownSession ||
      selected.length === 0 ||
      hasInvalidQuantity ||
      submittingRef.current
    )
      return;

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    idempotencyKeyRef.current ??= crypto.randomUUID();

    try {
      const result = await createSaleReturn({
        sale_id: sale.id,
        cash_session_id: ownSession.id,
        idempotency_key: idempotencyKeyRef.current,
        payment_method: method,
        items: selected.map(({ item, milli }) => ({
          sale_item_id: item.id,
          quantity: milliToBackendQuantity(milli),
          restock: restocks[item.id] ?? true,
        })),
      });

      queryClient.setQueryData(
        saleReturnReceiptQueryKey(result.id, ownSession.id),
        { saleReturn: result, originalSale: sale },
      );
      setIsConfirming(false);
      setCompletedReturn(result);

      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({
        queryKey: ["cash-sessions", ownSession.id, "summary"],
      });
      if (selected.some(({ item }) => restocks[item.id] ?? true)) {
        void queryClient.invalidateQueries({ queryKey: ["products"] });
      }
    } catch (caught) {
      setError(describeErrorShort(caught, "retour"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function requestSubmit() {
    if (!sale) return;
    if (method !== sale.payment.method) {
      setIsConfirming(true);
      return;
    }
    void submit();
  }

  if (completedReturn && sale && ownSession) {
    return (
      <main className="operational-page operational-page-narrow">
        <PageHeader
          backTo={withSaleOrigin(`/sales/${sale.id}`, origin)}
          backLabel="Retour à la vente"
          eyebrow={`Retour ${completedReturn.reference}`}
          title={`Ticket ${sale.id.slice(0, 8).toUpperCase()}`}
          context={`${sale.store.name} · ${sale.cash_register.name}`}
        />
        <section
          className="operational-card return-success-panel"
          aria-labelledby="return-success-title"
        >
          <div className="success-mark" aria-hidden="true">
            ✓
          </div>
          <p className="eyebrow">Retour enregistré</p>
          <h2 id="return-success-title" ref={successHeadingRef} tabIndex={-1}>
            Remboursement effectué
          </h2>
          <p className="return-success-copy">
            Le stock et les montants de la vente ont été mis à jour.
          </p>
          <dl className="sale-amounts return-success-amounts">
            <div>
              <dt>Remboursement</dt>
              <dd>{refundLabels[completedReturn.payment_method]}</dd>
            </div>
            <div className="sale-change">
              <dt>Total remboursé</dt>
              <dd>
                <Money backend={completedReturn.total_refund} />
              </dd>
            </div>
            <div>
              <dt>Articles concernés</dt>
              <dd>{completedReturn.items.length}</dd>
            </div>
          </dl>
          <div className="return-success-actions">
            <ButtonLink
              variant="secondary"
              to={withSaleOrigin(`/returns/${completedReturn.id}/receipt?print=1`, origin)}
            >
              Imprimer le ticket
            </ButtonLink>
            <ButtonLink variant="primary" to={withSaleOrigin(`/sales/${sale.id}`, origin)}>
              Retour à la vente
            </ButtonLink>
          </div>
        </section>
      </main>
    );
  }

  if (!online) {
    return (
      <RouteError
        context="retour"
        title="Mode hors ligne"
        description="Un retour marchandise nécessite une connexion. Vous pouvez continuer à vendre."
      />
    );
  }
  if (saleQuery.isLoading)
    return <RouteLoading message="Chargement de la vente…" />;
  if (saleQuery.error || !sale) {
    return (
      <RouteError
        error={saleQuery.error}
        context="retour"
        onRetry={() => void saleQuery.refetch()}
      />
    );
  }

  return (
    <main className="operational-page">
      <PageHeader
        backTo={withSaleOrigin(`/sales/${sale.id}`, origin)}
        backLabel="Retour à la vente"
        eyebrow="Retour marchandise"
        title={`Ticket ${sale.id.slice(0, 8).toUpperCase()}`}
        context={`${sale.store.name} · ${sale.cash_register.name}`}
      />
      <section className="operational-card return-sheet">
        <div className="card-section">
          <SectionHeader
            title="Articles à retourner"
            description="Saisissez uniquement les quantités réellement rapportées par le client."
            trailing={
              returnableItems.length > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={toggleAllQuantities}
                >
                  {allReturnableSelected
                    ? "Effacer la sélection"
                    : "Tout sélectionner"}
                </Button>
              ) : undefined
            }
          />

          <div className="return-workspace">
            <div className="return-items">
              {sale.items.map((item) => {
                const saleUnit = item.sale_unit ?? "UNIT";
                const returnableMilli = backendQuantityToMilli(
                  item.quantity_returnable ?? item.quantity,
                );
                const enteredMilli = parseQuantityToMilli(
                  quantities[item.id] ?? "",
                );
                const isUnavailable = returnableMilli <= 0;
                return (
                  <article
                    className={`return-item${isUnavailable ? " return-item-disabled" : ""}`}
                    key={item.id}
                  >
                    <header>
                      <div>
                        <strong>{item.product_name}</strong>
                        <span>
                          Acheté :{" "}
                          {formatQuantity(
                            backendQuantityToMilli(item.quantity),
                            saleUnit,
                          )}
                        </span>
                      </div>
                      <Badge tone={isUnavailable ? "neutral" : "success"}>
                        {isUnavailable
                          ? "Entièrement retourné"
                          : `${formatQuantity(returnableMilli, saleUnit)} disponible${saleUnit === "UNIT" && returnableMilli > 1000 ? "s" : ""}`}
                      </Badge>
                    </header>
                    <div className="return-item-controls">
                      <div className="field">
                        <label htmlFor={`return-quantity-${item.id}`}>
                          Quantité à retourner
                        </label>
                        <QuantityControl
                          valueMilli={enteredMilli}
                          saleUnit={saleUnit}
                          maximumMilli={returnableMilli}
                          disabled={isUnavailable}
                          inputId={`return-quantity-${item.id}`}
                          quantityLabel="Quantité à retourner"
                          decreaseLabel={`Diminuer la quantité de ${item.product_name}`}
                          increaseLabel={`Augmenter la quantité de ${item.product_name}`}
                          onDecrease={() => adjustQuantity(item, -1)}
                          onIncrease={() => adjustQuantity(item, 1)}
                          onCommit={(value) =>
                            setQuantities({
                              ...quantities,
                              [item.id]: milliToDisplayQuantity(value),
                            })
                          }
                        />
                      </div>
                      <label className="return-restock-field">
                        <input
                          type="checkbox"
                          checked={restocks[item.id] ?? true}
                          disabled={isUnavailable}
                          onChange={(event) =>
                            setRestocks({
                              ...restocks,
                              [item.id]: event.target.checked,
                            })
                          }
                        />
                        <span
                          className="return-restock-switch"
                          aria-hidden="true"
                        />
                        <span>
                          <strong>Remettre en stock</strong>
                          <small>Le produit peut être revendu.</small>
                        </span>
                      </label>
                    </div>
                  </article>
                );
              })}
            </div>
            <aside
              className="return-summary"
              aria-label="Résumé du remboursement"
            >
              <SectionHeader eyebrow="Remboursement" title="Résumé du retour" />
              <div className="return-selection-count">
                <span>Articles sélectionnés</span>
                <strong>{selected.length}</strong>
              </div>
              <div className="field">
                <label htmlFor="return-payment-method">
                  Mode de remboursement
                </label>
                <select
                  id="return-payment-method"
                  value={method}
                  onChange={(event) =>
                    setSelectedMethod(event.target.value as PaymentMethod)
                  }
                >
                  <option value="CASH">Espèces</option>
                  <option value="WAVE">Wave</option>
                  <option value="ORANGE_MONEY">Orange Money</option>
                </select>
                {method !== sale.payment.method ? (
                  <small className="return-payment-warning">
                    Paiement initial : {refundLabels[sale.payment.method]}.
                  </small>
                ) : null}
              </div>
              <div className="return-total">
                <span>Montant à rembourser</span>
                <strong>
                  <Money value={total} />
                </strong>
              </div>
              <Button
                variant="primary"
                size="lg"
                block
                loading={submitting && !isConfirming}
                loadingLabel="Enregistrement…"
                disabled={
                  selected.length === 0 || hasInvalidQuantity || submitting
                }
                onClick={requestSubmit}
              >
                Rembourser {formatBackendMoney(`${total}.00`)} par{" "}
                {refundLabels[method]}
              </Button>
              {error && !isConfirming ? (
                <InlineAlert tone="error">{error}</InlineAlert>
              ) : null}
            </aside>
          </div>
        </div>
      </section>

      {isConfirming ? (
        <Dialog
          eyebrow="Mode de remboursement"
          title="Confirmer un autre mode ?"
          size="sm"
          dismissible={!submitting}
          initialFocusRef={confirmButtonRef}
          onClose={() => setIsConfirming(false)}
        >
          <DialogBody>
            <p>
              La vente a été payée par{" "}
              <strong>{refundLabels[sale.payment.method]}</strong>, mais le
              remboursement sera effectué par{" "}
              <strong>{refundLabels[method]}</strong>.
            </p>
            <p className="dialog-hint">
              Montant à rembourser : {formatBackendMoney(`${total}.00`)}.
            </p>
            {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={submitting}
                onClick={() => setIsConfirming(false)}
              >
                Annuler
              </Button>
              <Button
                ref={confirmButtonRef}
                variant="primary"
                loading={submitting}
                loadingLabel="Enregistrement…"
                onClick={() => void submit()}
              >
                Confirmer le remboursement
              </Button>
            </DialogFooter>
          </DialogBody>
        </Dialog>
      ) : null}
    </main>
  );
}
