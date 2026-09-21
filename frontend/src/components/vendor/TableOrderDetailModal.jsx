import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { X, Plus, Minus, Trash2, CheckCircle2, DollarSign, History, UtensilsCrossed, Store, ChevronRight } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatElapsed } from "../../lib/duration.js";
import { Button } from "../ui/Button.jsx";
import { Select } from "../ui/Select.jsx";
import { Input } from "../ui/Input.jsx";
import { ConfirmModal } from "../ConfirmModal.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

const KITCHEN_STATUS_LABEL = { RECEIVED: "Recibido", PREPARING: "Preparando", READY: "Listo" };

// Bloque 190 (pedido explícito — "el cliente, ya servida su mesa y en
// espera del cierre de la cuenta, sigue agregando cosas... esos nuevos
// productos deben empezar en revisando pedido, luego preparando pedido, y
// así cada paso, así que cada producto dentro de su pedido debe mostrar el
// estado"): mismo texto que ITEM_STATUS_LABEL del backend
// (tables.controller.js) — cada línea ahora tiene su propio avance,
// independiente del resto de la cuenta (una ronda de postre recién pedida
// puede seguir "Revisando" mientras el plato principal ya está "Listo").
const ITEM_STATUS_LABEL = { RECEIVED: "Revisando", PREPARING: "Preparando", READY: "Listo" };
const ITEM_STATUS_STYLE = {
  RECEIVED: "bg-error/10 text-error",
  PREPARING: "bg-tertiary-accent/15 text-tertiary-accent",
  READY: "bg-verified/15 text-verified-dark",
};
const NEXT_ITEM_STATUS = { RECEIVED: "PREPARING", PREPARING: "READY", READY: null };
const NEXT_ITEM_ACTION_LABEL = { RECEIVED: "Marcar preparando", PREPARING: "Marcar listo" };

// Bloque 189 (pedido explícito — "cuando se agrega un pedido por un
// usuario solo se mostrará el nombre, no el apellido"): en el panel del
// vendedor (visto por el dueño o por otro usuario de sistema) se identifica
// a la persona, pero solo por su primer nombre — nunca el apellido
// completo. El cliente en la mesa nunca ve esto en absoluto (ver
// TableOrder.jsx, siempre texto genérico).
function firstNameOnly(fullName) {
  return fullName?.trim().split(/\s+/)[0] ?? null;
}

// Bloque 185 (pedido explícito — "se podrán identificar tanto para el
// restaurante como para el cliente cuáles de los pedidos se realizaron
// desde la mesa y cuáles se agregaron manualmente desde el asociado de la
// tienda"): badge chico por línea — `item.source` viene del backend
// (ver makeOrderItem, tables.controller.js); ausente (pedidos de mesa
// viejos, de antes de este bloque) se trata como "customer" sin mostrar
// nada, para no inventar información que esa fila nunca guardó.
// Bloque 186/189 (bug real reportado en vivo — "cuando el pedido lo agrega
// un camarero de atención a mesa, en vez de decir 'agregado por el local'
// debe decir 'agregado por' y la persona que lo agregó, solo con su
// nombre, no su apellido"): `addedByName` es el nombre completo real de
// quien estaba logueado — acá se recorta al primer nombre para mostrar.
function ItemSourceBadge({ source, addedByName }) {
  if (source === "staff") {
    const first = firstNameOnly(addedByName);
    return (
      <span className="flex items-center gap-1 rounded-full bg-secondary-container px-1.5 py-0.5 text-[9.5px] font-bold text-on-secondary-container">
        <Store className="h-2.5 w-2.5" /> {first ? `Agregado por ${first}` : "Agregado por el local"}
      </span>
    );
  }
  if (source === "customer") {
    // Bloque 189 (pedido explícito — "los que agregue el cliente desde su
    // dispositivo dirán agregado por el cliente"): mismo patrón "Agregado
    // por ___" que las líneas de staff, para que el vendedor lea de un
    // vistazo quién sumó cada línea sin tener que recordar 2 frases
    // distintas.
    return (
      <span className="flex items-center gap-1 rounded-full bg-tertiary-accent/10 px-1.5 py-0.5 text-[9.5px] font-bold text-tertiary-accent">
        <UtensilsCrossed className="h-2.5 w-2.5" /> Agregado por el cliente
      </span>
    );
  }
  return null;
}

// Bloque 168 (pedido explícito — "las mesas ocupadas deben mostrar un
// botón de ver pedido de la mesa y se mostrará una ventana emergente que
// mostrará todo sobre el pedido en curso... también se debe poder agregar
// cuentas a la mesa... el camarero puede agregar a su mesa productos
// manualmente... se irá agregando en tiempo real a la cuenta y al pedido
// del cliente"): centraliza en un solo lugar todo lo que el mesero necesita
// hacer sobre UNA cuenta abierta — verla completa, sumarle consumo, y
// avanzarla por sus 2 pasos finales (entregado, luego cobrar y liberar).
export function TableOrderDetailModal({ orderId, tableLabel, onClose }) {
  const queryClient = useQueryClient();
  const [addingProductId, setAddingProductId] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [removingItem, setRemovingItem] = useState(null);

  // Bloque 185: `staffSectionPermissions` es null para dueño/admin (sin
  // restricción) — viene de VendorLayout.jsx vía el Outlet, tanto si este
  // modal se abre desde Mesas como desde Pedidos (mismo árbol de React,
  // mismo contexto). El servidor ya rechaza estas acciones igual
  // (requireVendorWrite) si alguien las intenta con "solo lectura" — esto
  // es además para no ofrecer un botón que sabemos que va a fallar.
  const { staffSectionPermissions } = useOutletContext() ?? {};
  const canAddConsumo = canWriteSection(staffSectionPermissions, "pedidos") || canWriteSection(staffSectionPermissions, "mesas");
  const canManageStatus = canWriteSection(staffSectionPermissions, "pedidos");
  const canEditItems = canWriteSection(staffSectionPermissions, "pedidos") || canWriteSection(staffSectionPermissions, "mesas");

  // Bloque 168 (bug real evitado antes de shippearlo): pedir solo el id y
  // traer el pedido con su propio polling — no un snapshot fijo pasado por
  // prop — es lo que hace que "se irá agregando en tiempo real a la
  // cuenta" también se vea DENTRO de este mismo modal (agregar un consumo
  // desde acá invalida la query y el próximo poll ya trae el total nuevo,
  // sin tener que cerrar y volver a abrir el modal). Mismo endpoint
  // público que ya usa el cliente para su seguimiento (GET
  // /tables/order/:id) — funciona igual de bien para el vendedor.
  const { data: order } = useQuery({
    queryKey: ["table-order-status", orderId],
    queryFn: async () => (await api.get(`/tables/order/${orderId}`)).data.tableOrder,
    refetchInterval: 5000,
  });

  // Bloque 168: el mesero puede sumar CUALQUIER producto propio (no solo
  // los habilitados para el menú QR — esto es un agregado manual interno,
  // no el menú que ve el cliente al escanear).
  const { data: products } = useQuery({
    queryKey: ["my-products-list"],
    queryFn: async () => (await api.get("/products/me/list")).data.products,
  });

  // Bloque 175 (pedido explícito — "ver los detalles de cada pedido y
  // registro en ese pedido en esa mesa"): mismo componente lo usa tanto
  // VendorTables.jsx ("Ver pedido" en una mesa ocupada) como
  // VendorOrders.jsx ("Ver pedido" en la lista de Pedidos) — con esto,
  // ambos lugares muestran EXACTAMENTE la misma información sin
  // duplicar nada.
  const { data: activity } = useQuery({
    queryKey: ["table-order-activity", orderId],
    queryFn: async () => (await api.get(`/tables/orders/${orderId}/activity`)).data.entries,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["my-tables"] });
    queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    queryClient.invalidateQueries({ queryKey: ["pending-table-orders"] });
    queryClient.invalidateQueries({ queryKey: ["table-order-status", orderId] });
    // Bloque 180 (bug real reportado en vivo): faltaba esta — el "Registro
    // de esta cuenta" nunca se refrescaba después de una acción hecha
    // DESDE el propio modal (marcar entregado, agregar consumo, etc.), solo
    // se veía actualizado si se cerraba y volvía a abrir.
    queryClient.invalidateQueries({ queryKey: ["table-order-activity", orderId] });
  };

  const addItem = useMutation({
    mutationFn: async () => {
      const quantity = Number(addQty);
      if (manualMode) {
        return (
          await api.post(`/tables/orders/${orderId}/items/add`, {
            name: manualName.trim(),
            price: Number(manualPrice),
            quantity,
          })
        ).data;
      }
      return (await api.post(`/tables/orders/${orderId}/items/add`, { productId: addingProductId, quantity })).data;
    },
    onSuccess: () => {
      toast.success("Se agregó a la cuenta.");
      setAddingProductId("");
      setAddQty("1");
      setManualName("");
      setManualPrice("");
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo agregar."),
  });

  // Bloque 185 (pedido explícito — "se podrá modificar como eliminar un
  // producto de la mesa o del pedido o incluso cambiarle la cantidad"):
  // solo aplica a items que ya tienen `id` propio (pedidos creados después
  // de este bloque, ver makeOrderItem en tables.controller.js) y sobre una
  // cuenta ya aceptada — el backend rechaza lo demás con un mensaje claro.
  const removeItem = useMutation({
    mutationFn: async (itemId) => (await api.delete(`/tables/orders/${orderId}/items/${itemId}`)).data,
    onSuccess: () => {
      toast.success("Producto quitado de la cuenta.");
      setRemovingItem(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo quitar el producto.");
      setRemovingItem(null);
    },
  });

  const changeItemQty = useMutation({
    mutationFn: async ({ itemId, quantity }) => (await api.patch(`/tables/orders/${orderId}/items/${itemId}`, { quantity })).data,
    onSuccess: invalidateAll,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cambiar la cantidad."),
  });

  // Bloque 190: avanza el estado de UNA línea (Revisando -> Preparando ->
  // Listo), independiente del resto de la cuenta — una ronda de consumo
  // agregada después de que la cuenta ya venía en curso.
  const advanceItemStatus = useMutation({
    mutationFn: async ({ itemId, status }) => (await api.patch(`/tables/orders/${orderId}/items/${itemId}/status`, { status })).data,
    onSuccess: invalidateAll,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el estado."),
  });

  const markDelivered = useMutation({
    mutationFn: async () => (await api.patch(`/tables/orders/${orderId}/delivered`)).data,
    onSuccess: () => {
      toast.success("Marcado como entregado.");
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo marcar como entregado."),
  });

  const clearTable = useMutation({
    mutationFn: async () => (await api.patch(`/tables/orders/${orderId}/clear`)).data,
    onSuccess: () => {
      toast.success("Cuenta cobrada — mesa liberada.");
      setConfirmClose(false);
      invalidateAll();
      onClose();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo cobrar y liberar la mesa.");
      setConfirmClose(false);
    },
  });

  if (!order) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
        <div className="rounded-lg bg-surface-container-lowest p-6 text-body-md text-on-surface-variant">Cargando pedido...</div>
      </div>
    );
  }

  const canAddManual = manualMode ? manualName.trim() && Number(manualPrice) > 0 : !!addingProductId;
  const canDeliver = order.kitchenStatus === "READY" && !order.deliveredAt;
  const canCharge = !!order.deliveredAt && !order.clearedAt;
  // Bloque 185: quitar/ajustar una línea puntual solo tiene sentido sobre
  // una cuenta ya aceptada (mismo motivo que el backend, ver
  // findEditableItem en tables.controller.js) y solo para items con `id`
  // propio (pedidos de mesa viejos no lo tienen).
  const canEditLines = canEditItems && order.kitchenStatus !== "RECEIVED" && !order.cancelledAt && !order.clearedAt;

  return (
    // Bloque 196 (pedido explícito — "si se hace clic fuera de un
    // contenedor mostrado como ventana o popup en el panel debe cerrarse
    // automáticamente"): esta ventana no tiene borrador propio — cada
    // acción (cambiar cantidad, avanzar estado) ya es una mutación
    // inmediata contra el servidor, nunca un "guardar" pendiente — así que
    // cierra directo al hacer clic afuera, sin preguntar nada.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-title-lg font-bold text-on-surface">
              {tableLabel} · Pedido #{order.orderNumber}
            </h3>
            <p className="text-[12.5px] text-outline">
              {KITCHEN_STATUS_LABEL[order.kitchenStatus] ?? order.kitchenStatus} · en la mesa hace {formatElapsed(order.createdAt)}
              {order.customerName && ` · Pidió: ${order.customerName}`}
            </p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Bloque 178 (pedido explícito — "se debe marcar de todos los
            pedidos cuál es el último que se agregó... no se puede
            confundir el camarero y darle nuevamente pedidos que ya le
            había dado"): los items de la ÚLTIMA ronda que sumó el cliente
            (lastCustomerAddCount, backend) parpadean en verde claro — así
            el mesero ve de una qué es lo nuevo sin tener que comparar a
            ojo contra lo que ya le había llevado antes.
            Bloque 195 (bug real reportado en vivo — el parpadeo seguía
            mostrándose aun con la cuenta ya cerrada, y aun después de que
            ese mismo producto ya había pasado por todo el proceso de
            cocina hasta "Listo"): el parpadeo es SOLO para identificar
            líneas que todavía nadie revisó — deja de tener sentido en
            cuanto esa línea avanza de estado (ya la vieron) o en cuanto la
            cuenta se cierra/cancela (ya no hay nada que "llevarle" a
            nadie). */}
        {order.lastCustomerAddCount > 0 && !order.clearedAt && !order.cancelledAt && (
          <p className="mb-1.5 text-[11px] font-bold text-verified">● Resaltado = lo que el cliente acaba de agregar</p>
        )}
        <div className="flex flex-col gap-2">
          {order.items.map((it, i) => {
            // Bloque 190: sin `it.status` (pedidos de mesa viejos, de antes
            // de este bloque) se asume que sigue el estado de TODA la
            // cuenta — es la mejor estimación disponible sin inventar un
            // historial que esa fila nunca guardó.
            const itemStatus = it.status ?? order.kitchenStatus;
            const isNew =
              order.lastCustomerAddCount > 0 &&
              i >= order.items.length - order.lastCustomerAddCount &&
              itemStatus === "RECEIVED" &&
              !order.clearedAt &&
              !order.cancelledAt;
            const canEditThis = canEditLines && !!it.id && order.items.length > 1;
            const nextStatus = NEXT_ITEM_STATUS[itemStatus];
            const canAdvanceThis = canEditLines && !!it.id && !!nextStatus;
            return (
              <div
                key={it.id ?? i}
                className={`rounded-md border p-2.5 text-[13px] ${
                  isNew ? "border-verified animate-new-item-blink" : "border-surface-container-high"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-on-surface">
                      {it.quantity} × {it.name}
                    </span>
                    {/* Bloque 185 (pedido explícito — "podrán ver en la
                        cuenta de la mesa el precio por unidad de cada
                        producto"): antes solo se veía el subtotal de la
                        línea — el precio unitario es el que realmente
                        ayuda a verificar la cuenta contra el menú. */}
                    <p className="text-[11px] text-outline">{fmtCUP(it.price)} c/u</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {canEditThis && (
                      <div className="flex items-center gap-1 rounded border border-outline-variant">
                        <button
                          onClick={() => changeItemQty.mutate({ itemId: it.id, quantity: it.quantity - 1 })}
                          disabled={it.quantity <= 1 || changeItemQty.isPending}
                          className="flex h-6 w-6 items-center justify-center text-on-surface-variant disabled:opacity-30"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center text-[12px]">{it.quantity}</span>
                        <button
                          onClick={() => changeItemQty.mutate({ itemId: it.id, quantity: it.quantity + 1 })}
                          disabled={changeItemQty.isPending}
                          className="flex h-6 w-6 items-center justify-center text-on-surface-variant"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <span className="font-semibold text-on-surface-variant">{fmtCUP(it.price * it.quantity)}</span>
                    {canEditThis && (
                      <button onClick={() => setRemovingItem(it)} className="text-error hover:opacity-70">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {it.source && <ItemSourceBadge source={it.source} addedByName={it.addedByName} />}
                  {/* Bloque 190: pill de estado propio de la línea — se ve
                      SIEMPRE (no solo cuando hay más de una ronda), para
                      que el vendedor nunca tenga que adivinar si un
                      producto puntual ya está listo o todavía no. */}
                  <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${ITEM_STATUS_STYLE[itemStatus] ?? ITEM_STATUS_STYLE.RECEIVED}`}>
                    {ITEM_STATUS_LABEL[itemStatus] ?? itemStatus}
                  </span>
                  {canAdvanceThis && (
                    <button
                      onClick={() => advanceItemStatus.mutate({ itemId: it.id, status: nextStatus })}
                      disabled={advanceItemStatus.isPending}
                      className="flex items-center gap-0.5 rounded-full bg-primary px-2 py-0.5 text-[9.5px] font-bold text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                      {NEXT_ITEM_ACTION_LABEL[itemStatus]} <ChevronRight className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-surface-container-high pt-3">
          <span className="text-[13px] font-semibold text-on-surface-variant">Total a pagar</span>
          <span className="text-[18px] font-bold text-primary">{fmtCUP(order.total)}</span>
        </div>

        {activity?.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 flex items-center gap-1.5 text-label-md font-bold text-on-surface">
              <History className="h-3.5 w-3.5" /> Registro de esta cuenta
            </p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-on-surface-variant">
                <span>Se abrió la cuenta{order.customerName ? ` — pidió ${order.customerName}` : ""}</span>
                <span className="flex-shrink-0 text-outline">{new Date(order.createdAt).toLocaleString("es-CU")}</span>
              </div>
              {activity.map((entry) => (
                <div key={entry.id} className="flex items-baseline justify-between gap-2 text-[11.5px] text-on-surface-variant">
                  <span>{entry.description}</span>
                  <span className="flex-shrink-0 text-outline">{new Date(entry.createdAt).toLocaleString("es-CU")}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!order.cancelledAt && !order.clearedAt && canAddConsumo && (
          <div className="mt-4 rounded-md bg-surface-container p-3.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-label-md font-bold text-on-surface">Agregar consumo</p>
              <button onClick={() => setManualMode((v) => !v)} className="text-[11.5px] font-semibold text-tertiary-accent hover:underline">
                {manualMode ? "Elegir del catálogo" : "Cargar algo que no está en el catálogo"}
              </button>
            </div>
            {manualMode ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[140px] flex-1">
                  <Input label="Nombre" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Ej.: Cerveza Cristal" />
                </div>
                <div className="w-24">
                  <Input label="Precio (c/u)" type="number" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="250" />
                </div>
                <div className="w-20">
                  <Input label="Cant." type="number" min={1} value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[160px] flex-1">
                  <Select label="Producto" value={addingProductId} onChange={(e) => setAddingProductId(e.target.value)}>
                    <option value="">Elige un producto...</option>
                    {(products ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {fmtCUP(p.price)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-20">
                  <Input label="Cant." type="number" min={1} value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                </div>
              </div>
            )}
            <Button
              size="sm"
              className="mt-2.5 w-full"
              disabled={!canAddManual || addItem.isPending}
              onClick={() => addItem.mutate()}
            >
              <Plus className="h-3.5 w-3.5" /> {addItem.isPending ? "Agregando..." : "Agregar a la cuenta"}
            </Button>
          </div>
        )}

        {canManageStatus && (
          <div className="mt-4 flex flex-col gap-2">
            {canDeliver && (
              <Button disabled={markDelivered.isPending} onClick={() => markDelivered.mutate()}>
                <CheckCircle2 className="h-4 w-4" /> Marcar como entregado
              </Button>
            )}
            {canCharge && (
              <Button variant="dark" disabled={clearTable.isPending} onClick={() => setConfirmClose(true)}>
                <DollarSign className="h-4 w-4" /> Cobrar y liberar mesa
              </Button>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmClose}
        title="¿Cobrar y liberar la mesa?"
        message={`Se cierra la cuenta por ${fmtCUP(order.total)} — el cliente ya pagó y se retira. Esta acción libera la mesa para clientes nuevos.`}
        confirmLabel={clearTable.isPending ? "Cerrando..." : "Cobrar y liberar"}
        confirmDisabled={clearTable.isPending}
        onConfirm={() => clearTable.mutate()}
        onCancel={() => setConfirmClose(false)}
      />
      <ConfirmModal
        open={!!removingItem}
        title={removingItem ? `¿Quitar "${removingItem.name}"?` : ""}
        message="Se resta de la cuenta y se le devuelve el stock al producto (si aplica). No se puede deshacer."
        confirmLabel={removeItem.isPending ? "Quitando..." : "Quitar"}
        confirmDisabled={removeItem.isPending}
        danger
        onConfirm={() => removeItem.mutate(removingItem.id)}
        onCancel={() => setRemovingItem(null)}
      />
    </div>
  );
}
