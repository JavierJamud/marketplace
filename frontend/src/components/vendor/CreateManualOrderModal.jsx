import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { X, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { generateId } from "../../lib/uuid.js";
import { Button } from "../ui/Button.jsx";
import { Select } from "../ui/Select.jsx";
import { Input } from "../ui/Input.jsx";
import { UnsavedChangesModal } from "../UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 173 (pedido explícito — "también agreguemos que el camarero puede
// crear un nuevo pedido asignado para una mesa en específico ya que a lo
// mejor nadie pide escaneando el código, así el camarero solo crea el
// pedido en el sistema y lo asigna a la mesa y así se abre una cuenta y se
// empiezan a mostrar datos en el QR"): se arma la lista de items EN el
// modal (agregar/quitar filas localmente) y recién se manda todo junto a
// createManualTableOrder al confirmar — a diferencia de "Agregar consumo"
// (TableOrderDetailModal), que suma de a un item por vez sobre una cuenta
// que YA existe, acá la cuenta todavía no existe: se crea con todos los
// items juntos en un solo request.
export function CreateManualOrderModal({ tableId, tableLabel, onClose, onCreated }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  const { data: products } = useQuery({
    queryKey: ["my-products-list"],
    queryFn: async () => (await api.get("/products/me/list")).data.products,
  });

  function addRow() {
    const quantity = Number(qty) || 1;
    if (manualMode) {
      if (!manualName.trim() || !(Number(manualPrice) > 0)) return;
      setItems((rows) => [...rows, { key: generateId(), name: manualName.trim(), price: Number(manualPrice), quantity }]);
      setManualName("");
      setManualPrice("");
    } else {
      const product = (products ?? []).find((p) => p.id === productId);
      if (!product) return;
      setItems((rows) => [...rows, { key: generateId(), productId: product.id, name: product.name, price: Number(product.price), quantity }]);
      setProductId("");
    }
    setQty("1");
  }

  function removeRow(key) {
    setItems((rows) => rows.filter((r) => r.key !== key));
  }

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/tables/me/${tableId}/order`, {
          items: items.map((i) => (i.productId ? { productId: i.productId, quantity: i.quantity } : { name: i.name, price: i.price, quantity: i.quantity })),
          customerName: customerName.trim() || undefined,
        })
      ).data,
    onSuccess: ({ tableOrder }) => {
      toast.success(`Se abrió la cuenta en ${tableLabel}.`);
      queryClient.invalidateQueries({ queryKey: ["my-tables"] });
      queryClient.invalidateQueries({ queryKey: ["my-orders"] });
      onCreated?.(tableOrder);
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo crear el pedido."),
  });

  const canAddRow = manualMode ? manualName.trim() && Number(manualPrice) > 0 : !!productId;

  // Bloque 196: solo el borrador que de verdad se manda al crear (items ya
  // agregados a la lista + nombre del cliente) — igual que ProductModal no
  // cuenta tagInput sin confirmar, acá tampoco cuentan los campos sueltos de
  // "Agregar producto" (productId/qty/manualName/manualPrice) mientras no se
  // agreguen a la lista con el botón dedicado.
  const initialFormSnapshot = useRef(JSON.stringify({ items, customerName }));
  const isDirty = JSON.stringify({ items, customerName }) !== initialFormSnapshot.current;
  const canSaveNow = items.length > 0;
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSaveNow ? () => create.mutateAsync() : undefined });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">Crear pedido — {tableLabel}</h3>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>

        <Input
          label="Nombre del cliente (opcional)"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="¿A nombre de quién?"
          maxLength={60}
        />

        {items.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {items.map((it) => (
              <div key={it.key} className="flex items-center justify-between rounded-md border border-surface-container-high p-2.5 text-[13px]">
                <span className="text-on-surface">
                  {it.quantity} × {it.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-on-surface-variant">{fmtCUP(it.price * it.quantity)}</span>
                  <button onClick={() => removeRow(it.key)} className="text-error hover:opacity-70">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-surface-container-high pt-2">
              <span className="text-[13px] font-semibold text-on-surface-variant">Total</span>
              <span className="text-[16px] font-bold text-primary">{fmtCUP(total)}</span>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-md bg-surface-container p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-label-md font-bold text-on-surface">Agregar producto</p>
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
                <Input label="Cant." type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[160px] flex-1">
                <Select label="Producto" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Elige un producto...</option>
                  {(products ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {fmtCUP(p.price)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-20">
                <Input label="Cant." type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
            </div>
          )}
          <Button size="sm" variant="outline" className="mt-2.5 w-full" disabled={!canAddRow} onClick={addRow}>
            <Plus className="h-3.5 w-3.5" /> Agregar a la lista
          </Button>
        </div>

        <Button className="mt-4 w-full" disabled={items.length === 0 || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creando..." : "Crear pedido y abrir cuenta"}
        </Button>
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
