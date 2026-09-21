import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "../lib/toast.jsx";
import { Trash2, Plus } from "lucide-react";
import { api } from "../lib/api.js";
import { Select } from "./ui/Select.jsx";
import { Button } from "./ui/Button.jsx";
import { UnsavedChangesModal } from "./UnsavedChangesModal.jsx";
import { useDirtyModal } from "../lib/useDirtyModal.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 158 (pedido explícito — "si el vendedor modifica su pedido, el
// cliente podrá ver el pedido modificado"): mismo patrón que
// EditOrderModal.jsx (pedidos normales) — reemplazo COMPLETO de items,
// precio siempre retomado del catálogo actual (nunca del que ya traía el
// pedido). Solo se puede abrir mientras el pedido sigue RECEIVED (ver el
// botón "Modificar" en VendorOrders.jsx, que ya lo gatea) — una vez que la
// cocina lo aceptó (PREPARING, que ya descontó stock real) editarlo a mano
// rompería esa contabilidad, por eso el backend (updateTableOrderItems)
// también lo rechaza pasado ese punto.
export function EditTableOrderModal({ order, onClose, onSaved }) {
  const [items, setItems] = useState(order.items.map((i) => ({ productId: i.productId, name: i.name, price: Number(i.price), quantity: i.quantity })));
  const [addingProductId, setAddingProductId] = useState("");

  // Bloque 158: mismos productos que el cliente ve en el menú QR de esta
  // mesa — activo, habilitado para mesa, y si tiene restricción de mesa,
  // que incluya justo esta mesa (order.tableId).
  const { data } = useQuery({
    queryKey: ["my-products-list"],
    queryFn: async () => (await api.get("/products/me/list")).data.products,
  });
  const availableProducts = (data ?? []).filter(
    (p) =>
      p.isActive &&
      p.availableForTableMenu &&
      (!p.tableRestricted || p.restrictedTables?.some((t) => t.id === order.tableId)) &&
      !items.some((i) => i.productId === p.id)
  );

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/tables/orders/${order.id}/items`, { items: items.map(({ productId, quantity }) => ({ productId, quantity })) })).data,
    onSuccess: () => {
      toast.success("Pedido actualizado.");
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo modificar el pedido."),
  });

  function updateQuantity(productId, quantity) {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, quantity: Math.max(1, quantity || 1) } : i)));
  }
  function removeItem(productId) {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }
  function addProduct() {
    const p = availableProducts.find((p) => p.id === addingProductId);
    if (!p) return;
    setItems((prev) => [...prev, { productId: p.id, name: p.name, price: Number(p.price), quantity: 1 }]);
    setAddingProductId("");
  }

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Bloque 196: el único borrador real es la lista de items — igual que en
  // CreateManualOrderModal, `addingProductId` es solo el picker transitorio
  // del selector "Agregar producto", no cuenta para saber si hay algo sin
  // guardar.
  const initialItemsSnapshot = useRef(JSON.stringify(items));
  const isDirty = JSON.stringify(items) !== initialItemsSnapshot.current;
  const canSaveNow = items.length > 0;
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSaveNow ? () => save.mutateAsync() : undefined });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <h3 className="mb-1 text-title-lg text-on-surface">Modificar pedido de mesa</h3>
        <p className="mb-4 text-[12.5px] text-outline">Pedido #{order.orderNumber} · todavía Recibido, sin aceptar</p>

        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.productId} className="flex items-center gap-2.5 rounded-md border border-outline-variant p-3">
              <span className="flex-1 text-[13px] font-semibold text-on-surface">{item.name}</span>
              <span className="text-[12px] text-outline">{fmtCUP(item.price)}</span>
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => updateQuantity(item.productId, Number(e.target.value))}
                className="h-9 w-16 rounded border border-outline-variant text-center text-[13px] outline-none"
              />
              <button onClick={() => removeItem(item.productId)} className="text-error">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {items.length === 0 && <p className="text-[12.5px] text-outline">Sin productos — agrega al menos uno para guardar.</p>}
        </div>

        {availableProducts.length > 0 && (
          <div className="mt-3.5 flex items-end gap-2.5">
            <Select label="Agregar producto" value={addingProductId} onChange={(e) => setAddingProductId(e.target.value)} className="flex-1">
              <option value="">Elige un producto</option>
              {availableProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {fmtCUP(p.price)}
                </option>
              ))}
            </Select>
            <button
              onClick={addProduct}
              disabled={!addingProductId}
              className="flex h-11 items-center gap-1.5 rounded-md bg-secondary-container px-4 text-[13px] font-bold text-on-secondary-container disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-surface-container-high pt-3.5">
          <span className="text-[13px] font-semibold text-on-surface-variant">Nuevo total</span>
          <span className="text-[16px] font-bold text-on-surface">{fmtCUP(total)}</span>
        </div>

        <div className="mt-5 flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button className="flex-1" disabled={items.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </div>
  );
}
