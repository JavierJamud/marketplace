import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { UtensilsCrossed, CheckCircle2, Pencil, XCircle, ShoppingBag, Eye } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatElapsed } from "../../lib/duration.js";
import { playNewOrderSound } from "../../lib/orderNotificationSound.js";
import { Button } from "../ui/Button.jsx";
import { ConfirmModal } from "../ConfirmModal.jsx";
import { EditTableOrderModal } from "../EditTableOrderModal.jsx";
import { TableOrderDetailModal } from "./TableOrderDetailModal.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 185 (pedido explícito — "todo será en tiempo real"): bajado de
// 5000 a 2500 — sigue siendo polling (no WebSockets), pero a la mitad del
// intervalo un pedido aceptado por otro usuario desaparece de acá casi el
// doble de rápido, y el 409 atómico de updateKitchenStatus (backend) ya
// cierra la ventana real donde 2 personas podían aceptarlo a la vez.
const POLL_MS = 2500;

// Bloque 164 (pedido explícito — "cuando entra un pedido nuevo el popup
// suena y aparece en medio de la pantalla como pedido nuevo, si entran más
// en el mismo momento se espera aceptar uno para confirmar el otro"):
// montado una sola vez en VendorLayout.jsx (como OffersAnnouncementPopup),
// así que suena y aparece sin importar en qué sección del panel esté el
// vendedor en ese momento — no solo dentro de "Pedidos". Solo corre para
// restaurantes (vendor.isRestaurant) — el resto de los vendedores no tiene
// pedidos de mesa.
// Bloque 183: `enabled` (default true — VENDOR/ADMIN nunca lo pasan)
// apaga el poll entero para un usuario de sistema sin la sección
// "pedidos" — ver VendorLayout.jsx.
// Bloque 185: `staffSectionPermissions` llega como PROP directa (no por
// useOutletContext — este popup se monta como hermano del <Outlet> en
// VendorLayout.jsx, no como su descendiente, así que ese contexto no le
// llegaría).
export function NewOrderPopup({ vendor, enabled = true, staffSectionPermissions = null }) {
  const queryClient = useQueryClient();
  const canManage = canWriteSection(staffSectionPermissions, "pedidos");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [viewingFull, setViewingFull] = useState(false);
  // Bloque 177 (bug real reportado en vivo — "un cliente con una mesa
  // ocupada agregó productos... eso no se notificó en el panel del
  // vendedor"): la clave de "ya visto" ahora es `${id}:${eventAt}`, no solo
  // el id — un pedido de mesa YA aceptado puede volver a aparecer acá (con
  // un eventAt más nuevo) cada vez que el cliente le suma otra ronda de
  // consumo, y cada una de esas tiene que sonar de nuevo, no solo la
  // primera vez que ese id apareció en la lista.
  const seenKeysRef = useRef(new Set());
  const firstLoadRef = useRef(true);

  const { data: orders } = useQuery({
    queryKey: ["pending-table-orders"],
    queryFn: async () => (await api.get("/tables/pending-orders")).data.orders,
    enabled: !!vendor?.isRestaurant && enabled,
    refetchInterval: POLL_MS,
  });

  useEffect(() => {
    if (!orders) return;
    const keys = orders.map((o) => `${o.id}:${o.eventAt}`);
    // Bloque 164: la primera carga (al abrir/recargar el panel) nunca suena
    // — esos pedidos ya estaban ahí antes, no "acaban de entrar". Solo a
    // partir de la 2ª lectura en adelante una clave nueva dispara el sonido.
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      seenKeysRef.current = new Set(keys);
      return;
    }
    const isNew = keys.some((k) => !seenKeysRef.current.has(k));
    if (isNew) {
      playNewOrderSound();
      // Bloque 181 (auditoría): el cliente sumó consumo o pidió por su
      // cuenta — ninguna mutación del vendedor va a invalidar las listas
      // (Pedidos/Mesas seguían mostrando el total viejo hasta su propio
      // poll de 8s). Este poll YA detectó el evento: refresca esas listas
      // ahora mismo para que el monto/estado coincida con el popup.
      queryClient.invalidateQueries({ queryKey: ["my-orders"] });
      queryClient.invalidateQueries({ queryKey: ["my-tables"] });
      queryClient.invalidateQueries({ queryKey: ["table-order-status"] });
    }
    seenKeysRef.current = new Set(keys);
  }, [orders]);

  // Bloque 180 (bug real reportado en vivo — ver el comentario largo en
  // VendorOrders.jsx): aceptar/cancelar un pedido acá también tiene que
  // invalidar table-order-status/activity, o el modal "Ver pedido" de otra
  // sección puede quedar mostrando el estado viejo.
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-table-orders"] });
    queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    queryClient.invalidateQueries({ queryKey: ["my-tables"] });
    queryClient.invalidateQueries({ queryKey: ["table-order-status"] });
    queryClient.invalidateQueries({ queryKey: ["table-order-activity"] });
  };

  const accept = useMutation({
    mutationFn: async (id) => (await api.patch(`/tables/orders/${id}/status`, { status: "PREPARING" })).data,
    onSuccess: invalidateAll,
    // Bloque 185: si esto da 409 es porque otro usuario logueado a la vez
    // ganó la carrera y ya lo aceptó (ver el chequeo atómico en
    // updateKitchenStatus, backend) — invalida igual que onSuccess para
    // que este popup refresque solo y deje de mostrar un pedido que ya no
    // necesita acción, en vez de quedar pegado hasta el próximo poll.
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo aceptar el pedido.");
      invalidateAll();
    },
  });

  // Bloque 177: el vendedor reconoce que vio el consumo que el cliente sumó
  // a una cuenta YA aceptada — no avanza ningún estado de cocina, solo
  // apaga el aviso (ver ackCustomerTableOrderUpdate, backend).
  const ack = useMutation({
    mutationFn: async (id) => (await api.patch(`/tables/orders/${id}/ack-customer-update`)).data,
    onSuccess: invalidateAll,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo marcar como visto."),
  });

  // Bloque 167 (pedido explícito — "no se debe borrar del todo, siempre
  // los movimientos deben quedar registrados... se debe insertar un
  // motivo"): PATCH con motivo obligatorio, ya no DELETE — el pedido queda
  // en el historial (Pedidos) marcado como cancelado, con ese motivo
  // visible también para el cliente en su seguimiento.
  const cancel = useMutation({
    mutationFn: async (id) => (await api.patch(`/tables/orders/${id}/cancel`, { reason: cancelReason.trim() })).data,
    onSuccess: () => {
      toast.success("Pedido cancelado.");
      setConfirmCancel(false);
      setCancelReason("");
      invalidateAll();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo cancelar el pedido.");
    },
  });

  if (!vendor?.isRestaurant || !orders || orders.length === 0) return null;

  // Bloque 164: SOLO el más viejo (el primero en llegar) — "se espera
  // aceptar uno para confirmar el otro" es, literalmente, mostrar nada más
  // que este mientras siga RECEIVED. En cuanto se acepta/cancela, el
  // siguiente poll ya no lo trae y este mismo componente muestra
  // automáticamente el que sigue en la cola, si hay otro.
  const order = orders[0];
  const tableLabel = order.table.label || `Mesa ${order.table.tableNumber}`;
  // Bloque 177 (bug real reportado en vivo): needsAccept:false = esta
  // cuenta YA estaba aceptada y el cliente le sumó consumo — no hay nada
  // que "aceptar/cancelar" acá, solo avisar y dejar que el vendedor lo
  // reconozca (o vea el detalle completo antes de hacerlo).
  const needsAccept = order.needsAccept;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-inverse-surface/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl animate-fade-up">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container">
            {needsAccept ? (
              <UtensilsCrossed className="h-5 w-5 text-on-secondary-container" />
            ) : (
              <ShoppingBag className="h-5 w-5 text-on-secondary-container" />
            )}
          </div>
          <div>
            <h2 className="text-title-lg font-bold text-on-surface">
              {needsAccept ? "¡Pedido nuevo!" : "Se agregó consumo a una mesa"}
            </h2>
            <p className="text-[12.5px] text-outline">
              {tableLabel} · #{order.orderNumber} · hace {formatElapsed(order.eventAt)}
            </p>
          </div>
        </div>

        {order.customerName && (
          <p className="mb-3 text-[13px] text-on-surface-variant">
            Pidió: <span className="font-semibold text-on-surface">{order.customerName}</span>
          </p>
        )}

        {/* Bloque 178: mismo resaltado que TableOrderDetailModal — en un
            aviso de "se agregó consumo", lo nuevo parpadea en verde para
            que no se confunda con lo que ya se llevó a la mesa. */}
        <div className="mb-4 space-y-1.5">
          {order.items.map((it, i) => {
            const isNewItem = !needsAccept && order.lastCustomerAddCount > 0 && i >= order.items.length - order.lastCustomerAddCount;
            return (
              <div
                key={i}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-[13px] ${
                  isNewItem ? "border border-verified animate-new-item-blink" : "bg-surface-container"
                }`}
              >
                <span className="text-on-surface">
                  {it.quantity} × {it.name}
                </span>
                <span className="font-semibold text-on-surface-variant">{fmtCUP(it.price * it.quantity)}</span>
              </div>
            );
          })}
        </div>

        <div className="mb-5 flex items-center justify-between border-t border-surface-container-high pt-3.5">
          <span className="text-[13px] font-semibold text-on-surface-variant">Monto a pagar</span>
          <span className="text-[18px] font-bold text-primary">{fmtCUP(order.total)}</span>
        </div>

        {needsAccept ? (
          <div className="flex flex-col gap-2">
            {/* Bloque 185: un usuario con "pedidos" en solo lectura puede
                seguir viendo este aviso (necesita saber que llegó un
                pedido) pero no tiene ningún botón para actuar sobre él —
                el servidor ya lo rechazaría igual. */}
            {canManage ? (
              <>
                <Button className="w-full" disabled={accept.isPending} onClick={() => accept.mutate(order.id)}>
                  <CheckCircle2 className="h-4 w-4" /> Verificar y aceptar
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" /> Modificar
                  </Button>
                  <Button variant="danger" className="flex-1" onClick={() => setConfirmCancel(true)}>
                    <XCircle className="h-3.5 w-3.5" /> Cancelar
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-center text-[12px] text-outline">Tienes acceso de solo lectura a Pedidos — avísale a alguien con permiso para aceptarlo.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={() => setViewingFull(true)}>
              <Eye className="h-3.5 w-3.5" /> Ver cuenta completa
            </Button>
            {canManage && (
              <Button className="flex-1" disabled={ack.isPending} onClick={() => ack.mutate(order.id)}>
                <CheckCircle2 className="h-3.5 w-3.5" /> {ack.isPending ? "..." : "OK, visto"}
              </Button>
            )}
          </div>
        )}
      </div>

      {viewingFull && (
        <TableOrderDetailModal orderId={order.id} tableLabel={tableLabel} onClose={() => setViewingFull(false)} />
      )}

      {editing && (
        <EditTableOrderModal
          order={order}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            invalidateAll();
          }}
        />
      )}

      <ConfirmModal
        open={confirmCancel}
        title={`¿Cancelar el pedido #${order.orderNumber}?`}
        message={`El pedido de ${tableLabel} queda cancelado y visible en tu historial de Pedidos — el cliente también va a ver este motivo.`}
        confirmLabel={cancel.isPending ? "Cancelando..." : "Cancelar pedido"}
        confirmDisabled={cancelReason.trim().length < 3 || cancel.isPending}
        danger
        onConfirm={() => cancel.mutate(order.id)}
        onCancel={() => {
          setConfirmCancel(false);
          setCancelReason("");
        }}
      >
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Motivo de la cancelación (el cliente lo va a ver)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}
