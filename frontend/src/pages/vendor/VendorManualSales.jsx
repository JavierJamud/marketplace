import { useState } from "react";
import { Navigate, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, X, Wallet } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { canWriteSection } from "../../lib/vendorSections.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}
function fmtMoney(amount, currency) {
  return `${Number(amount ?? 0).toLocaleString("es-CU")} ${currency || "CUP"}`;
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString("es-CU") : "—";
}
function fmtDateShort(iso) {
  return iso ? new Date(iso).toLocaleDateString("es-CU") : "—";
}

const PERIOD_TABS = [
  { key: "today", label: "Hoy" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
];

// Bloque 202 (pedido explícito — "no será una sección visible en el panel
// del... dueño... será una sección que se habilita sola cuando un usuario
// de venta tiene productos asignados... quiero que Venta por lote y Cuadre
// de caja y Mis ventas las ubiquemos responsivamente a la parte superior...
// no quiero que los usuarios vean o puedan reclamar stock de los productos
// que no tienen asignados, en ese panel es exclusivo solo para los
// productos que su tienda le asignó a ellos"): reemplaza por completo el
// archivo anterior —
//   - Ya NO hay vista de dueño acá — esa supervisión (equipo, reasignar
//     stock, cuadre de caja, análisis, log completo) se mudó a
//     VendorUsers.jsx, la sección "Usuarios" del panel del dueño.
//   - Ya NO hay "Buscar y reclamar productos" — el auto-servicio se
//     eliminó (bloqueado también server-side, ver claimAllocation,
//     vendorStaffSales.controller.js). Lo único que un usuario de sistema
//     puede tener es lo que el dueño le asignó a mano.
//   - Orden nuevo: Venta por lote → Cuadre de caja → Mis ventas primero
//     (son las acciones/configuración del día a día), el detalle
//     producto-por-producto al final.

function AllocationRow({ allocation, canWrite }) {
  const [mode, setMode] = useState(null); // null | "sell" | "release"
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [saleError, setSaleError] = useState(null);
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-allocations"] });
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-sales"] });
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-cash-close"] });
  };

  const sell = useMutation({
    mutationFn: async () =>
      (await api.post("/vendor-staff-sales/sales", { productId: allocation.productId, quantity: Number(qty), note: note.trim() || undefined })).data,
    onSuccess: () => {
      toast.success("Venta registrada.");
      setMode(null);
      setQty(1);
      setNote("");
      setSaleError(null);
      invalidate();
    },
    onError: (err) => {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.suggestedTeammates !== undefined) {
        setSaleError(data);
      } else {
        toast.error(data?.error ?? "No se pudo registrar la venta.");
      }
    },
  });

  const release = useMutation({
    mutationFn: async () => (await api.post("/vendor-staff-sales/allocations/release", { productId: allocation.productId, quantity: Number(qty) })).data,
    onSuccess: () => {
      toast.success("Stock liberado.");
      setMode(null);
      setQty(1);
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo liberar el stock."),
  });

  const photo = imgUrl(allocation.product?.images?.[0]);
  const isUnlimited = !!allocation.product?.unlimitedStock;
  const sellMax = mode === "sell" && isUnlimited ? undefined : allocation.remainingQty;

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded bg-surface-container">
          {photo && <img src={photo} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-on-surface">{allocation.product?.name}</p>
          <p className="text-[12px] text-outline">
            {isUnlimited ? (
              <strong className="text-on-surface">Siempre disponible</strong>
            ) : (
              <>
                Te quedan <strong className="text-on-surface">{allocation.remainingQty}</strong>
              </>
            )}{" "}
            · {fmtMoney(allocation.product?.price, allocation.product?.currency)}
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-shrink-0 gap-1.5">
            <button
              onClick={() => {
                setMode(mode === "sell" ? null : "sell");
                setSaleError(null);
              }}
              className="rounded-[7px] bg-primary px-2.5 py-1.5 text-[11.5px] font-bold text-on-primary"
            >
              Registrar venta
            </button>
            <button
              onClick={() => setMode(mode === "release" ? null : "release")}
              className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant"
            >
              Liberar
            </button>
          </div>
        )}
      </div>

      {mode && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-surface-container pt-3">
          <div className="w-24">
            <Input label="Cantidad" type="number" min={1} max={sellMax} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          {mode === "sell" && (
            <div className="min-w-[160px] flex-1">
              <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          <Button
            size="sm"
            disabled={sell.isPending || release.isPending || Number(qty) < 1 || (sellMax !== undefined && Number(qty) > sellMax)}
            onClick={() => (mode === "sell" ? sell.mutate() : release.mutate())}
          >
            {mode === "sell" ? (sell.isPending ? "Registrando..." : "Confirmar venta") : release.isPending ? "Liberando..." : "Confirmar"}
          </Button>
          <button
            onClick={() => {
              setMode(null);
              setSaleError(null);
            }}
            className="text-[12px] font-semibold text-outline"
          >
            Cancelar
          </button>
        </div>
      )}

      {saleError && (
        <div className="mt-3 rounded-md border border-tertiary-accent/30 bg-tertiary-accent/[0.06] p-3">
          <p className="text-[12.5px] font-semibold text-on-surface">Solo te quedan {saleError.yourRemaining} — no alcanza para esa cantidad.</p>
          {saleError.suggestedTeammates?.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <p className="text-[11.5px] text-outline">Tus compañeros todavía tienen stock:</p>
              {saleError.suggestedTeammates.map((t, i) => (
                <p key={i} className="text-[12px] text-on-surface-variant">
                  <strong className="text-on-surface">{t.fullName}</strong> — {t.remainingQty} disponibles
                  {t.phone ? ` · ${t.phone}` : " · sin teléfono registrado"}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-[12px] text-outline">Ningún compañero tiene stock de este producto ahora mismo.</p>
          )}
        </div>
      )}
    </div>
  );
}

function MySaleRow({ sale }) {
  const [returning, setReturning] = useState(false);
  const [qty, setQty] = useState(sale.quantity);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-sales"] });
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-allocations"] });
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-cash-close"] });
  };

  const returnSale = useMutation({
    mutationFn: async () =>
      (await api.post(`/vendor-staff-sales/sales/${sale.id}/return`, { quantity: Number(qty), reason: reason.trim() || undefined })).data,
    onSuccess: () => {
      toast.success("Devolución registrada.");
      setReturning(false);
      setReason("");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo registrar la devolución."),
  });

  return (
    <div className="border-b border-surface-container last:border-b-0">
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-on-surface">{sale.productName}</p>
          <p className="text-[11.5px] text-outline">
            {sale.quantity} u. · {fmtDate(sale.createdAt)}
            {sale.note ? ` · ${sale.note}` : ""}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <p className="text-[13px] font-bold text-on-surface">{fmtMoney(sale.total)}</p>
          <button
            onClick={() => setReturning((v) => !v)}
            className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11px] font-bold text-on-surface-variant"
          >
            Devolver
          </button>
        </div>
      </div>
      {returning && (
        <div className="flex flex-wrap items-end gap-2 border-t border-surface-container bg-surface-container/40 p-3">
          <div className="w-24">
            <Input label="Cantidad" type="number" min={1} max={sale.quantity} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="min-w-[160px] flex-1">
            <Input label="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={returnSale.isPending || Number(qty) < 1 || Number(qty) > sale.quantity}
            onClick={() => returnSale.mutate()}
          >
            {returnSale.isPending ? "Devolviendo..." : "Confirmar devolución"}
          </Button>
          <button onClick={() => setReturning(false)} className="text-[12px] font-semibold text-outline">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

// Feedback del dueño: "podrá filtrar productos uno a uno o inclusive varios a
// la vez, eso irá sumando el total... para llevar un cuadre de caja
// perfecto" — arma una lista tipo carrito con lo que ya tiene asignado y la
// manda entera a /sales/batch (todo o nada del lado del server).
function BatchSaleBuilder({ allocations, canWrite }) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [cart, setCart] = useState([]);
  const [batchError, setBatchError] = useState(null);
  const queryClient = useQueryClient();

  const claimable = (allocations ?? []).filter((a) => a.product?.unlimitedStock || a.remainingQty > 0);

  const cartQtyFor = (pid) => cart.filter((c) => c.productId === pid).reduce((s, c) => s + c.quantity, 0);

  const addToCart = () => {
    const alloc = claimable.find((a) => a.productId === productId);
    if (!alloc) return;
    const isUnlimited = !!alloc.product?.unlimitedStock;
    const remaining = isUnlimited ? Infinity : alloc.remainingQty - cartQtyFor(productId);
    const q = Number(qty);
    if (q < 1 || q > remaining) return;
    setCart((c) => [
      ...c,
      {
        key: `${productId}-${Date.now()}`,
        productId,
        productName: alloc.product?.name,
        unitPrice: alloc.product?.price,
        currency: alloc.product?.currency,
        quantity: q,
        note: note.trim() || undefined,
      },
    ]);
    setQty(1);
    setNote("");
  };

  const removeFromCart = (key) => setCart((c) => c.filter((i) => i.key !== key));

  const total = cart.reduce((s, i) => s + i.quantity * Number(i.unitPrice ?? 0), 0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-allocations"] });
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-sales"] });
    queryClient.invalidateQueries({ queryKey: ["staff-sales-my-cash-close"] });
  };

  const submitBatch = useMutation({
    mutationFn: async () =>
      (
        await api.post("/vendor-staff-sales/sales/batch", {
          items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity, note: i.note })),
        })
      ).data,
    onSuccess: (data) => {
      toast.success(`${data.sales?.length ?? cart.length} ventas registradas.`);
      setCart([]);
      setBatchError(null);
      invalidate();
    },
    onError: (err) => {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.suggestedTeammates !== undefined) {
        setBatchError(data);
      } else {
        toast.error(data?.error ?? "No se pudo registrar el lote de ventas.");
      }
    },
  });

  if (!canWrite) return null;

  const failedItem = batchError ? cart.find((i) => i.productId === batchError.productId) : null;

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-[18px]">
      <h2 className="mb-1 text-[15px] font-bold text-on-surface">Venta por lote</h2>
      <p className="mb-3 text-[11.5px] text-outline">Sumá varios de tus productos asignados y registrá todas las ventas juntas, para un cuadre de caja exacto.</p>
      {claimable.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">Todavía no tienes productos asignados para vender.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[160px] flex-1">
              <label className="mb-1 block text-label-md text-on-surface-variant">Producto</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-body-md text-on-surface"
              >
                <option value="">Elige un producto</option>
                {claimable.map((a) => (
                  <option key={a.productId} value={a.productId}>
                    {a.product?.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <Input label="Cantidad" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="min-w-[140px] flex-1">
              <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button size="sm" disabled={!productId || Number(qty) < 1} onClick={addToCart}>
              Agregar al lote
            </Button>
          </div>

          {cart.length > 0 && (
            <div className="mt-4 border-t border-surface-container pt-3">
              <div className="flex flex-col gap-2">
                {cart.map((i) => (
                  <div key={i.key} className="flex items-center justify-between gap-3 rounded-md bg-surface-container p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-on-surface">{i.productName}</p>
                      <p className="text-[11px] text-outline">
                        {i.quantity} u. · {fmtMoney(i.quantity * Number(i.unitPrice ?? 0), i.currency)}
                        {i.note ? ` · ${i.note}` : ""}
                      </p>
                    </div>
                    <button onClick={() => removeFromCart(i.key)} className="flex-shrink-0 rounded-full p-1 text-outline hover:bg-surface-container-high">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] font-bold text-on-surface">Total del lote: {fmtMoney(total)}</p>
                <Button size="sm" disabled={submitBatch.isPending} onClick={() => submitBatch.mutate()}>
                  {submitBatch.isPending ? "Registrando..." : `Registrar ${cart.length} ${cart.length === 1 ? "venta" : "ventas"}`}
                </Button>
              </div>
            </div>
          )}

          {batchError && (
            <div className="mt-3 rounded-md border border-tertiary-accent/30 bg-tertiary-accent/[0.06] p-3">
              <p className="text-[12.5px] font-semibold text-on-surface">
                {failedItem ? `${failedItem.productName}: solo` : "Solo"} te quedan {batchError.yourRemaining} — no alcanza para esa cantidad.
              </p>
              {batchError.suggestedTeammates?.length > 0 ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  <p className="text-[11.5px] text-outline">Tus compañeros todavía tienen stock:</p>
                  {batchError.suggestedTeammates.map((t, i) => (
                    <p key={i} className="text-[12px] text-on-surface-variant">
                      <strong className="text-on-surface">{t.fullName}</strong> — {t.remainingQty} disponibles
                      {t.phone ? ` · ${t.phone}` : " · sin teléfono registrado"}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-[12px] text-outline">Ningún compañero tiene stock de este producto ahora mismo.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StaffSelfView({ canWrite }) {
  const [salesPeriod, setSalesPeriod] = useState("today");
  const queryClient = useQueryClient();

  const { data: allocations, isLoading: allocationsLoading } = useQuery({
    queryKey: ["staff-sales-my-allocations"],
    queryFn: async () => (await api.get("/vendor-staff-sales/me/allocations")).data.allocations,
    refetchInterval: 8000,
  });
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ["staff-sales-my-sales", salesPeriod],
    queryFn: async () => (await api.get("/vendor-staff-sales/me/sales", { params: { period: salesPeriod } })).data,
    refetchInterval: 8000,
  });
  const { data: cashClose } = useQuery({
    queryKey: ["staff-sales-my-cash-close"],
    queryFn: async () => (await api.get("/vendor-staff-sales/me/cash-close")).data,
    refetchInterval: 8000,
  });

  const reportCash = useMutation({
    mutationFn: async () => (await api.post("/vendor-staff-sales/me/cash-close", {})).data,
    onSuccess: () => {
      toast.success("Caja marcada como cuadrada.");
      queryClient.invalidateQueries({ queryKey: ["staff-sales-my-cash-close"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo reportar el cuadre."),
  });

  return (
    <div className="flex flex-col gap-6">
      {!canWrite && (
        <p className="rounded-lg border border-tertiary-accent/30 bg-tertiary-accent/[0.06] p-[14px] text-[12.5px] font-semibold text-tertiary-accent">
          Tienes acceso de solo lectura a Productos Asignados — puedes ver tus productos y ventas, pero no vender, devolver ni registrar nada. Pídele a tu
          administrador que te dé permiso de escritura si necesitas hacerlo.
        </p>
      )}

      {/* Bloque 202: Venta por lote, Cuadre de caja y Mis ventas primero —
          son las acciones/configuración del día a día; el detalle
          producto-por-producto va al final. */}
      <BatchSaleBuilder allocations={allocations} canWrite={canWrite} />

      {cashClose?.frequency ? (
        <div
          className={`rounded-lg border p-[18px] ${cashClose.reported ? "border-verified/30 bg-verified/[0.06]" : "border-tertiary-accent/30 bg-tertiary-accent/[0.06]"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-bold text-on-surface">Cuadre de caja</p>
              <p className="text-[12px] text-outline">
                Período: {fmtDateShort(cashClose.periodStart)} – {fmtDateShort(cashClose.periodEnd)} · Total vendido: {fmtMoney(cashClose.totalSales)}
              </p>
            </div>
            {cashClose.reported ? (
              <span className="flex items-center gap-1.5 rounded-full bg-verified/15 px-3 py-1.5 text-[12px] font-bold text-verified-dark">
                <CheckCircle2 className="h-3.5 w-3.5" /> Ya reportaste este período
              </span>
            ) : canWrite ? (
              <Button size="sm" disabled={reportCash.isPending} onClick={() => reportCash.mutate()}>
                {reportCash.isPending ? "Guardando..." : "Marcar caja cuadrada"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-[18px] text-[12.5px] text-outline">
          Tu tienda no tiene un día de cuadre configurado todavía.
        </p>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-on-surface">Mis ventas</h2>
            <p className="text-[11.5px] text-outline">Total del período: {fmtMoney(salesData?.total)}</p>
          </div>
          <div className="flex gap-1.5">
            {PERIOD_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setSalesPeriod(t.key)}
                className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold ${
                  salesPeriod === t.key ? "bg-verified/15 text-verified-dark" : "bg-surface-container text-on-surface-variant"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {salesLoading ? (
          <p className="text-body-md text-on-surface-variant">Cargando ventas...</p>
        ) : (
          <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
            {(salesData?.sales ?? []).length === 0 && <p className="p-4 text-body-md text-on-surface-variant">Sin ventas en este período.</p>}
            {(salesData?.sales ?? []).map((s) => (
              <MySaleRow key={s.id} sale={s} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-1 text-[15px] font-bold text-on-surface">Detalle por producto</h2>
        <p className="mb-3 text-[11.5px] text-outline">Los productos que tu tienda te asignó — vende o libera cada uno desde acá.</p>
        {allocationsLoading ? (
          <p className="text-body-md text-on-surface-variant">Cargando...</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(allocations ?? []).length === 0 && <p className="text-body-md text-on-surface-variant">Todavía no tienes productos asignados.</p>}
            {(allocations ?? []).map((a) => (
              <AllocationRow key={a.id} allocation={a} canWrite={canWrite} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function VendorManualSales() {
  const { isStaff, staffSectionPermissions } = useOutletContext();
  const canWrite = canWriteSection(staffSectionPermissions, "ventas-manuales");

  // Bloque 202: el dueño/admin ya no tiene esta sección en su propio panel
  // — lo que antes vivía acá para supervisión (equipo, reasignar stock,
  // cuadre de caja, análisis, log completo de ventas) ahora vive en
  // Usuarios (VendorUsers.jsx). Si de todos modos entra por URL directa,
  // lo mandamos para allá — el NAV ya no le muestra este link.
  if (!isStaff) return <Navigate to="/vendedor/usuarios" replace />;

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1 flex items-center gap-3">
          <IconCircle icon={Wallet} tone="teal" />
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Productos Asignados</h1>
        </div>
        <p className="text-[13.5px] text-outline">Los productos que tu tienda te asignó — registrá tus ventas, devoluciones y tu cuadre de caja.</p>
      </div>
      <StaffSelfView canWrite={canWrite} />
    </div>
  );
}
