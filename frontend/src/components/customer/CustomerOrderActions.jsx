import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, MapPin, MessageCircle, Minus, Plus, Trash2, X } from "lucide-react";
import { waLink } from "../../lib/whatsapp.js";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { resolveUnitPrice } from "../../lib/pricing.js";
import { Button } from "../ui/Button.jsx";

// Acciones del cliente sobre su pedido: cancelarlo (con motivo) o cambiar sus productos mientras la tienda no lo haya confirmado.
// El servidor decide si se puede (canCancel / canEdit); aquí solo se muestra lo que corresponde.

const REASONS = ["Me equivoqué de producto", "Ya no lo necesito", "Encontré otra opción", "Tardan en responderme", "Hay un error en mi pedido"];
const money = (n, cur) => `${Number(n).toLocaleString("es-CU")} ${cur}`;

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-inverse-surface/50 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface-container-lowest sm:rounded-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-surface-container-high px-5 py-3.5">
          <h2 className="font-display text-[18px] font-extrabold text-on-surface">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-container">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function CancelOrderModal({ order, onClose }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: async () => (await api.post(`/customers/me/orders/${order.id}/cancel`, { reason: reason.trim() })).data,
    onSuccess: () => {
      toast.success(`Pedido ${order.code} cancelado. Ya le avisamos a la tienda.`);
      queryClient.invalidateQueries({ queryKey: ["my-customer-orders"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cancelar el pedido."),
  });
  return (
    <Modal title={`Cancelar pedido ${order.code}`} onClose={onClose}>
      <p className="mb-3 text-[13.5px] text-on-surface-variant">Cuéntale a la tienda por qué lo cancelas. Le avisamos al momento y no tendrás que pagar nada.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} className={`min-h-10 rounded-full border px-3.5 text-[12.5px] font-semibold ${reason === r ? "border-primary-container bg-primary-container text-white" : "border-outline-variant text-on-surface-variant"}`}>
            {r}
          </button>
        ))}
      </div>
      <label htmlFor="motivo-cancelar" className="mb-1 block text-[12px] font-bold uppercase tracking-wide text-outline">Motivo</label>
      <textarea id="motivo-cancelar" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Escribe el motivo de la cancelación" className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13.5px] outline-none focus:border-tertiary-accent" />
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button type="button" variant="outline" onClick={onClose}>Volver</Button>
        <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending || reason.trim().length < 3} className="min-h-11 rounded bg-error text-[13.5px] font-bold text-white disabled:opacity-50">
          {cancel.isPending ? "Cancelando..." : "Cancelar pedido"}
        </button>
      </div>
    </Modal>
  );
}

// El pedido ya lo atiende la tienda (en preparación, en camino o entregado): la plataforma no lo cancela. Al abrir esta ventana se
// le pide al servidor la "cancelación", que responde sin cancelar, le manda al cliente un correo con el pedido y cómo contactar a
// la tienda, y devuelve los datos de la tienda que se muestran aquí.
export function CancelBlockedModal({ order, onClose }) {
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    api
      .post(`/customers/me/orders/${order.id}/cancel`, {})
      .then(() => setFailed("No se pudo revisar el pedido. Inténtalo de nuevo."))
      .catch((err) => {
        const data = err.response?.data;
        if (data?.code === "CONTACT_STORE") setResult(data);
        else setFailed(data?.error ?? "No se pudo revisar el pedido. Inténtalo de nuevo.");
      });
  }, [order.id]);

  const store = result?.store;
  return (
    <Modal title={`Cancelar pedido ${order.code}`} onClose={onClose}>
      {!result && !failed && <p className="text-[13.5px] text-on-surface-variant">Revisando el estado de tu pedido...</p>}
      {failed && <p className="text-[13.5px] text-error">{failed}</p>}
      {result && (
        <>
          <p className="mb-3 rounded-xl bg-secondary-container/25 p-3 text-[13.5px] font-semibold text-on-surface">{result.error}</p>
          <p className="mb-3 text-[13px] text-on-surface-variant">
            Un pedido solo se puede cancelar antes de que la tienda lo confirme. Para pedir la cancelación tienes que contactar directamente a la tienda y decirle tu número de pedido <strong className="text-on-surface">{result.orderCode}</strong>.
          </p>
          {result.emailSent ? (
            <p className="mb-4 flex items-start gap-2 rounded-xl bg-verified/10 p-3 text-[13px] text-verified-dark">
              <Mail className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>Te enviamos un correo a <strong>{result.email}</strong> con los detalles de este pedido y cómo cancelarlo con la tienda.</span>
            </p>
          ) : (
            <p className="mb-4 rounded-xl bg-surface-container p-3 text-[13px] text-on-surface-variant">No pudimos enviarte el correo ahora mismo, pero estos son los datos de la tienda.</p>
          )}
          {store && (
            <div className="rounded-xl border border-surface-container-high p-3.5">
              <div className="mb-2 text-[14px] font-bold text-on-surface">{store.name}</div>
              <ul className="flex flex-col gap-1.5 text-[13px] text-on-surface-variant">
                {store.whatsapp && <li className="flex items-center gap-2"><MessageCircle className="h-4 w-4" aria-hidden="true" /> {store.whatsapp}</li>}
                {store.email && <li className="flex items-center gap-2"><Mail className="h-4 w-4" aria-hidden="true" /> {store.email}</li>}
                {store.address && <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" /> {store.address}</li>}
              </ul>
              {store.whatsapp && (
                <a href={waLink(store.whatsapp, `Hola, quiero cancelar mi pedido ${result.orderCode}.`)} target="_blank" rel="noopener noreferrer" className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] text-[13.5px] font-bold text-white">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" /> Escribir a la tienda por WhatsApp
                </a>
              )}
            </div>
          )}
        </>
      )}
      <div className="mt-4"><Button type="button" variant="outline" className="w-full" onClick={onClose}>Entendido</Button></div>
    </Modal>
  );
}

export function EditOrderModal({ order, onClose }) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState(() => order.items.map((i) => ({ productId: i.productId, name: i.name, size: i.size ?? null, quantity: i.quantity, currency: i.currency, price: Number(i.price) })));
  const [toAdd, setToAdd] = useState("");
  const [addSize, setAddSize] = useState("");

  const { data: store } = useQuery({
    queryKey: ["vendor", order.vendor.slug],
    queryFn: async () => (await api.get(`/vendors/${order.vendor.slug}`)).data.vendor,
  });
  const catalog = useMemo(() => Object.fromEntries((store?.products ?? []).map((p) => [p.id, p])), [store]);
  const sellable = useMemo(
    () => (store?.products ?? []).filter((p) => p.isActive && !p.hiddenFromStore && !p.overQuota && (p.unlimitedStock || p.stock > 0)),
    [store]
  );

  const maxFor = (l) => {
    const p = catalog[l.productId];
    if (!p || p.unlimitedStock) return 999;
    return l.size ? Number(p.sizeStock?.[l.size] ?? 0) : p.stock;
  };
  const unitFor = (l) => {
    const p = catalog[l.productId];
    return p ? resolveUnitPrice(p.price, p.priceTiers, l.quantity) : l.price;
  };
  const total = lines.reduce((s, l) => s + unitFor(l) * l.quantity, 0);
  const currency = lines[0]?.currency ?? "CUP";

  const setQty = (idx, qty) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, Math.min(qty, maxFor(l) || 1)) } : l)));
  const remove = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  const addProduct = catalog[toAdd];
  function add() {
    if (!addProduct) return;
    if (addProduct.sizes?.length && !addSize) return toast.error("Elige una talla.");
    const size = addProduct.sizes?.length ? addSize : null;
    setLines((ls) => {
      const existing = ls.findIndex((l) => l.productId === addProduct.id && (l.size ?? null) === size);
      if (existing >= 0) return ls.map((l, i) => (i === existing ? { ...l, quantity: Math.min(l.quantity + 1, maxFor(l) || 1) } : l));
      return [...ls, { productId: addProduct.id, name: addProduct.name, size, quantity: 1, currency: addProduct.currency, price: Number(addProduct.price) }];
    });
    setToAdd("");
    setAddSize("");
  }

  const changed = JSON.stringify(lines.map((l) => [l.productId, l.size, l.quantity])) !== JSON.stringify(order.items.map((i) => [i.productId, i.size ?? null, i.quantity]));

  const save = useMutation({
    mutationFn: async () => (await api.put(`/customers/me/orders/${order.id}/items`, { items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, size: l.size })) })).data,
    onSuccess: () => {
      toast.success("Pedido actualizado. La tienda ya ve los cambios.");
      queryClient.invalidateQueries({ queryKey: ["my-customer-orders"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el pedido."),
  });

  return (
    <Modal title={`Modificar pedido ${order.code}`} onClose={onClose}>
      <p className="mb-3 text-[13px] text-on-surface-variant">Quita productos, cambia las cantidades o agrega otros de {order.vendor.companyName}. Solo se puede mientras la tienda no lo haya confirmado.</p>
      <ul className="mb-4 flex flex-col gap-2">
        {lines.map((l, idx) => (
          <li key={`${l.productId}-${l.size ?? ""}`} className="flex items-center gap-3 rounded-xl border border-surface-container-high p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-on-surface">{l.name}{l.size ? ` (${l.size})` : ""}</div>
              <div className="text-[12px] text-outline">{money(unitFor(l), l.currency)} c/u</div>
            </div>
            <div className="flex items-center rounded-full border border-outline-variant">
              <button type="button" onClick={() => setQty(idx, l.quantity - 1)} disabled={l.quantity <= 1} aria-label="Menos" className="flex h-10 w-10 items-center justify-center disabled:opacity-40"><Minus className="h-4 w-4" /></button>
              <span className="min-w-[24px] text-center text-[14px] font-bold">{l.quantity}</span>
              <button type="button" onClick={() => setQty(idx, l.quantity + 1)} disabled={l.quantity >= maxFor(l)} aria-label="Más" className="flex h-10 w-10 items-center justify-center disabled:opacity-40"><Plus className="h-4 w-4" /></button>
            </div>
            <button type="button" onClick={() => remove(idx)} disabled={lines.length <= 1} aria-label={`Quitar ${l.name}`} title={lines.length <= 1 ? "Si ya no quieres nada, cancela el pedido" : "Quitar"} className="flex h-10 w-10 items-center justify-center text-error disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>

      <div className="mb-4 rounded-xl bg-surface-container/60 p-3">
        <label htmlFor="agregar-producto" className="mb-1 block text-[12px] font-bold uppercase tracking-wide text-outline">Agregar otro producto</label>
        <div className="flex flex-wrap gap-2">
          <select id="agregar-producto" value={toAdd} onChange={(e) => { setToAdd(e.target.value); setAddSize(""); }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none">
            <option value="">{store ? "Elige un producto" : "Cargando productos..."}</option>
            {sellable.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {money(p.price, p.currency)}</option>
            ))}
          </select>
          {addProduct?.sizes?.length > 0 && (
            <select value={addSize} onChange={(e) => setAddSize(e.target.value)} aria-label="Talla" className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none">
              <option value="">Talla</option>
              {addProduct.sizes.map((s) => (
                <option key={s} value={s} disabled={!addProduct.unlimitedStock && Number(addProduct.sizeStock?.[s] ?? 0) <= 0}>{s}</option>
              ))}
            </select>
          )}
          <Button type="button" variant="outline" onClick={add} disabled={!toAdd}>Agregar</Button>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between border-t border-surface-container-high pt-3">
        <span className="text-[13px] font-semibold text-on-surface-variant">Total nuevo</span>
        <span className="text-[18px] font-extrabold text-primary">{money(total, currency)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Button type="button" variant="outline" onClick={onClose}>Volver</Button>
        <Button type="button" onClick={() => save.mutate()} disabled={!changed || save.isPending}>{save.isPending ? "Guardando..." : "Guardar cambios"}</Button>
      </div>
    </Modal>
  );
}
