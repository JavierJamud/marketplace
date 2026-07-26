import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Trash2, Plus } from "lucide-react";
import { api } from "../lib/api.js";
import { formatPrice, formatMixedTotal } from "../lib/format.js";
import { Select } from "./ui/Select.jsx";
import { Button } from "./ui/Button.jsx";

// Bloque 29: modifica cantidades/productos de un pedido todavía Pendiente
// (nunca confirmado) — el precio siempre se vuelve a tomar del catálogo
// actual al guardar, nunca de lo que ya venía en el pedido. Un ítem cuyo
// producto se borró después de pedirse (OrderItem.productId null) no se
// puede re-enviar tal cual — se filtra acá y se avisa que se va a quitar.
// Bloque 52: la talla del ítem original SÍ se preserva (se manda de vuelta
// tal cual al guardar) — este modal reemplaza la lista COMPLETA de ítems, así
// que si no se reenviara acá se perdería silenciosamente. No hay selector de
// talla para AGREGAR un producto nuevo desde acá (availableProducts filtra
// los que tienen tallas) — eso sigue siendo exclusivo de la ficha pública.
export function EditOrderModal({ order, onClose, onSaved }) {
  const droppedCount = order.items.filter((i) => !i.productId).length;
  const [items, setItems] = useState(
    order.items
      .filter((i) => i.productId)
      .map((i) => ({ productId: i.productId, name: i.name, price: Number(i.price), currency: i.currency, size: i.size ?? null, quantity: i.quantity }))
  );
  const [addingProductId, setAddingProductId] = useState("");

  const { data } = useQuery({
    queryKey: ["my-products-list"],
    queryFn: async () => (await api.get("/products/me/list")).data.products,
  });
  const availableProducts = (data ?? []).filter((p) => !items.some((i) => i.productId === p.id) && !(p.sizes?.length > 0));

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/orders/${order.id}/items`, { items: items.map(({ productId, quantity, size }) => ({ productId, quantity, size: size ?? undefined })) }))
        .data,
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
    setItems((prev) => [...prev, { productId: p.id, name: p.name, price: Number(p.price), currency: p.currency, size: null, quantity: 1 }]);
    setAddingProductId("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <h3 className="mb-1 text-title-lg text-on-surface">Modificar pedido</h3>
        <p className="mb-4 text-[12.5px] text-outline">Pedido {order.code} · todavía Pendiente, sin confirmar</p>

        {droppedCount > 0 && (
          <p className="mb-3 rounded-md bg-error/10 px-3 py-2 text-[12px] text-error">
            {droppedCount} producto(s) de este pedido ya no existen en tu catálogo — se van a quitar del pedido al guardar.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={`${item.productId}-${item.size ?? ""}`} className="flex items-center gap-2.5 rounded-md border border-outline-variant p-3">
              <span className="flex-1 text-[13px] font-semibold text-on-surface">
                {item.name}
                {item.size && <span className="ml-1.5 text-outline">(talla {item.size})</span>}
              </span>
              <span className="text-[12px] text-outline">{formatPrice(item.price, item.currency)}</span>
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
                  {p.name} · {formatPrice(p.price, p.currency)}
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
          <span className="text-[16px] font-bold text-on-surface">{formatMixedTotal(items)}</span>
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
    </div>
  );
}
