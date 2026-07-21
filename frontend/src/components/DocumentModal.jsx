import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { FileText, ShieldCheck, Download, Mail } from "lucide-react";
import { api, getErrorMessage } from "../lib/api.js";
import { Input } from "./ui/Input.jsx";
import { Button } from "./ui/Button.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Bloque 29: factura y garantía comparten el mismo formulario de datos del
// cliente + acciones de descargar/enviar — kind="warranty" suma selección
// de productos del pedido y días de vigencia. Se genera sobre un pedido ya
// Vendido (confirmOrderSale ya corrió), nunca sobre uno Pendiente.
export function DocumentModal({ kind, order, onClose }) {
  const isWarranty = kind === "warranty";
  const [customerName, setCustomerName] = useState(order.customerName ?? "");
  const [customerIdNumber, setCustomerIdNumber] = useState("");
  const [customerPhone, setCustomerPhone] = useState(order.customerPhone ?? "");
  const [sendTo, setSendTo] = useState(order.customerEmail ?? "");
  const [selectedItemIds, setSelectedItemIds] = useState(order.items.map((i) => i.id));
  const [warrantyDays, setWarrantyDays] = useState(90);

  const docLabel = isWarranty ? "garantía" : "factura";
  const endpoint = isWarranty ? "warranty" : "invoice";

  function buildPayload() {
    return {
      customerName: customerName.trim() || undefined,
      customerIdNumber: customerIdNumber.trim(),
      customerPhone: customerPhone.trim() || undefined,
      ...(isWarranty ? { orderItemIds: selectedItemIds, warrantyDays: Number(warrantyDays) } : {}),
    };
  }

  const download = useMutation({
    mutationFn: async () => (await api.post(`/orders/${order.id}/${endpoint}/download`, buildPayload(), { responseType: "blob" })).data,
    onSuccess: (blob) => {
      downloadBlob(blob, `${endpoint === "invoice" ? "factura" : "garantia"}-${order.code}.pdf`);
      toast.success(`PDF de ${docLabel} descargado.`);
    },
    onError: async (err) => toast.error(await getErrorMessage(err, `No se pudo generar la ${docLabel}.`)),
  });

  const sendEmail = useMutation({
    mutationFn: async () => (await api.post(`/orders/${order.id}/${endpoint}/email`, { ...buildPayload(), sendTo: sendTo.trim() })).data,
    onSuccess: () => toast.success(`${isWarranty ? "Garantía" : "Factura"} enviada a ${sendTo}.`),
    onError: async (err) => toast.error(await getErrorMessage(err, `No se pudo enviar la ${docLabel}.`)),
  });

  const pending = download.isPending || sendEmail.isPending;
  const canGenerate = customerIdNumber.trim().length > 0 && (!isWarranty || (selectedItemIds.length > 0 && Number(warrantyDays) > 0));

  function toggleItem(id, checked) {
    setSelectedItemIds((ids) => (checked ? [...ids, id] : ids.filter((x) => x !== id)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center gap-2">
          {isWarranty ? <ShieldCheck className="h-5 w-5 text-tertiary-accent" /> : <FileText className="h-5 w-5 text-tertiary-accent" />}
          <h3 className="text-title-lg text-on-surface">{isWarranty ? "Certificado de garantía" : "Factura de compra"}</h3>
        </div>
        <p className="mb-4 text-[12.5px] text-outline">Pedido {order.code}</p>

        <div className="flex flex-col gap-3">
          <Input label="Nombre del cliente" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <Input
            label="Identificación del cliente"
            required
            value={customerIdNumber}
            onChange={(e) => setCustomerIdNumber(e.target.value)}
            placeholder="Carnet de identidad / pasaporte"
          />
          <Input label="Teléfono (opcional)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />

          {isWarranty && (
            <>
              <div>
                <span className="mb-1.5 block text-label-md text-on-surface-variant">Productos a incluir</span>
                <div className="flex flex-col gap-1.5 rounded-md border border-outline-variant p-3">
                  {order.items.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-[13px] text-on-surface">
                      <input type="checkbox" checked={selectedItemIds.includes(item.id)} onChange={(e) => toggleItem(item.id, e.target.checked)} />
                      {item.name} · {item.quantity} × {fmtCUP(item.price)}
                    </label>
                  ))}
                </div>
              </div>
              <Input
                label="Días de garantía"
                type="number"
                min={1}
                required
                value={warrantyDays}
                onChange={(e) => setWarrantyDays(e.target.value)}
              />
            </>
          )}

          <Input
            label="Enviar copia por email a (opcional)"
            type="email"
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
            placeholder="correo@ejemplo.com"
          />
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          <div className="flex gap-2.5">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="outline" className="flex-1" disabled={!canGenerate || pending} onClick={() => download.mutate()}>
              <Download className="h-4 w-4" /> {download.isPending ? "Generando..." : "Descargar PDF"}
            </Button>
          </div>
          <Button disabled={!canGenerate || !sendTo.trim() || pending} onClick={() => sendEmail.mutate()}>
            <Mail className="h-4 w-4" /> {sendEmail.isPending ? "Enviando..." : "Enviar por email"}
          </Button>
        </div>
      </div>
    </div>
  );
}
