import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Camera, CheckCircle2, ChevronDown, Copy, ExternalLink, ImagePlus, Minus, Plus, QrCode, RefreshCw, ScanBarcode, Trash2, UtensilsCrossed, X } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { imgUrl } from "../../lib/imgUrl.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { CameraScanner } from "../../components/pos/CameraScanner.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";
import { PlanUpsell, isPlanError } from "../../components/vendor/PlanUpsell.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Caja con código de barras. Se escanea con la cámara o con un lector USB/Bluetooth (que escribe el código y Enter en el
// campo de arriba): el primer producto crea la venta con su número de 4 caracteres y cada escaneo repetido suma una unidad.
// Se cobra en el mostrador (con cálculo del vuelto) o, en restaurantes, se manda a una mesa. La pantalla para el cliente y el
// tablero de pedidos se abren en otra tablet o monitor con su enlace.
const TABS = [
  { id: "vender", label: "Vender" },
  { id: "hoy", label: "Hoy" },
  { id: "dinero", label: "Dinero" },
  { id: "pantallas", label: "Pantallas" },
];
const METHOD_LABEL = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" };
const ENTRY_LABEL = { SALE: "Cobro", CHANGE: "Vuelto", DEPOSIT: "Entrada", WITHDRAWAL: "Salida" };
const fmt = (n, cur) => `${Number(n ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${cur ?? ""}`.trim();
const timeText = (d) => new Date(d).toLocaleTimeString("es-CU", { hour: "2-digit", minute: "2-digit" });
const errText = (err, fallback) => err.response?.data?.error ?? fallback;
const fieldCls = "h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none focus:border-tertiary-accent";

// Sonido corto al escanear (sin archivos): confirma la lectura aunque no se mire la pantalla.
function beep(ok = true) {
  try {
    const ctx = beep.ctx ?? (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1250 : 320;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
  } catch {
    /* sin audio: no pasa nada */
  }
}

function PayModal({ sale, onClose, onPaid }) {
  const [method, setMethod] = useState("CASH");
  const [received, setReceived] = useState("");
  const total = Number(sale.total);
  const cash = Number(String(received).replace(",", "."));
  const change = method === "CASH" && cash >= total ? Math.round((cash - total) * 100) / 100 : null;
  const quick = useMemo(() => {
    const steps = [1, 5, 10, 20, 50, 100, 200, 500, 1000, 5000];
    const out = new Set([total]);
    for (const s of steps) if (s >= total / 4) out.add(Math.ceil(total / s) * s);
    return [...out].filter((n) => n >= total).sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  const pay = useMutation({
    mutationFn: async () => (await api.post(`/pos/sales/${sale.id}/pay`, { method, ...(method === "CASH" ? { cashReceived: cash } : {}) })).data,
    onSuccess: (r) => {
      toast.success(`Venta ${sale.code} cobrada`, r.change ? `Vuelto: ${fmt(r.change, sale.currency)}` : undefined);
      onPaid(r.sale);
    },
    onError: (err) => toast.error(errText(err, "No se pudo cobrar.")),
  });
  const canPay = method !== "CASH" || cash >= total;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-inverse-surface/50 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Cobrar venta ${sale.code}`} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-2xl bg-surface-container-lowest p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="text-[12.5px] text-on-surface-variant">Venta {sale.code}</p>
            <p className="font-display text-[28px] font-extrabold text-on-surface">{fmt(total, sale.currency)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-container">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Forma de pago">
          {Object.entries(METHOD_LABEL).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={method === id} onClick={() => setMethod(id)} className={`min-h-11 rounded-xl border text-[13px] font-bold ${method === id ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface"}`}>
              {label}
            </button>
          ))}
        </div>
        {method === "CASH" && (
          <>
            <label htmlFor="pos-cash" className="mb-1 block text-[12.5px] font-bold text-on-surface">Efectivo recibido</label>
            <input id="pos-cash" autoFocus inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value.replace(/[^\d.,]/g, ""))} className={`${fieldCls} text-[18px] font-bold`} placeholder={String(total)} />
            <div className="mt-2 flex flex-wrap gap-2">
              {quick.map((n) => (
                <button key={n} type="button" onClick={() => setReceived(String(n))} className="min-h-10 rounded-lg border border-outline-variant px-3 text-[13px] font-semibold text-on-surface hover:bg-surface-container">
                  {n === total ? "Exacto" : fmt(n)}
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-xl bg-surface-container/60 px-3 py-2.5" aria-live="polite">
              {received === "" ? (
                <p className="text-[13px] text-on-surface-variant">Escribe cuánto entregó el cliente para calcular el vuelto.</p>
              ) : change != null ? (
                <p className="text-[15px] font-extrabold text-verified-dark">Vuelto: {fmt(change, sale.currency)}</p>
              ) : (
                <p className="text-[13.5px] font-bold text-error">Faltan {fmt(total - (cash || 0), sale.currency)}</p>
              )}
            </div>
          </>
        )}
        <Button className="mt-4 w-full" size="lg" disabled={!canPay || pay.isPending} onClick={() => pay.mutate()}>
          {pay.isPending ? "Cobrando..." : `Cobrar ${fmt(total, sale.currency)}`}
        </Button>
      </div>
    </div>
  );
}

function SaleCard({ sale, canWrite, isRestaurant, onPay, refresh }) {
  const [name, setName] = useState(sale.customerName ?? "");
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => setName(sale.customerName ?? ""), [sale.id, sale.customerName]);

  const qty = useMutation({
    mutationFn: async ({ productId, quantity }) => (await api.patch(`/pos/sales/${sale.id}/items/${productId}`, { quantity })).data,
    onSuccess: refresh,
    onError: (err) => toast.error(errText(err, "No se pudo cambiar la cantidad.")),
  });
  const saveName = useMutation({
    mutationFn: async () => (await api.patch(`/pos/sales/${sale.id}`, { customerName: name.trim() || null })).data,
    onSuccess: refresh,
  });
  const toTable = useMutation({
    mutationFn: async () => (await api.post(`/pos/sales/${sale.id}/table`)).data,
    onSuccess: () => {
      toast.info(`Venta ${sale.code} esperando mesa`, "Escanea el QR de la mesa o el cliente escribe el número en su mesa.");
      refresh();
    },
    onError: (err) => toast.error(errText(err, "No se pudo mandar a mesa.")),
  });
  const cancel = useMutation({
    mutationFn: async () => (await api.post(`/pos/sales/${sale.id}/cancel`)).data,
    onSuccess: () => {
      setConfirmCancel(false);
      toast.success(`Venta ${sale.code} anulada`);
      refresh();
    },
  });

  return (
    <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest" aria-label={`Venta ${sale.code}`}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-surface-container-high px-4 py-3">
        <div>
          <p className="text-[12px] text-on-surface-variant">Venta</p>
          <p className="font-display text-[28px] font-extrabold leading-none tracking-[0.12em] text-on-surface">{sale.code}</p>
        </div>
        <input
          aria-label="Nombre del cliente (opcional)"
          placeholder="Nombre (opcional)"
          maxLength={40}
          value={name}
          disabled={!canWrite}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== (sale.customerName ?? "") && saveName.mutate()}
          className={`${fieldCls} w-auto min-w-0 max-w-[180px] flex-1`}
        />
      </div>
      {sale.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-on-surface-variant">Escanea o busca un producto para empezar.</p>
      ) : (
        <ul className="divide-y divide-surface-container-high">
          {sale.items.map((i) => (
            <li key={i.productId} className="flex items-center gap-3 px-4 py-2.5">
              <Thumb src={i.image} name={i.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-on-surface">{i.name}</p>
                <p className="text-[12px] text-on-surface-variant">{fmt(i.price, i.currency)} c/u</p>
              </div>
              {canWrite && (
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={`Quitar una unidad de ${i.name}`} disabled={qty.isPending} onClick={() => qty.mutate({ productId: i.productId, quantity: i.quantity - 1 })} className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant">
                    {i.quantity === 1 ? <Trash2 className="h-4 w-4 text-error" /> : <Minus className="h-4 w-4" />}
                  </button>
                  <span className="w-8 text-center text-[15px] font-bold" aria-label={`${i.quantity} unidades`}>{i.quantity}</span>
                  <button type="button" aria-label={`Sumar una unidad de ${i.name}`} disabled={qty.isPending} onClick={() => qty.mutate({ productId: i.productId, quantity: i.quantity + 1 })} className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
              <p className="w-20 flex-shrink-0 text-right text-[13.5px] font-bold text-on-surface sm:w-24 sm:text-[14px]">{fmt(i.price * i.quantity, i.currency)}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-surface-container-high px-4 py-3">
        <span className="text-[14px] font-semibold text-on-surface-variant">Total</span>
        <span className="font-display text-[24px] font-extrabold text-primary">{fmt(sale.total, sale.currency)}</span>
      </div>
      {canWrite && (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <Button className="flex-1" size="lg" disabled={!sale.items.length} onClick={() => onPay(sale)}>
            <Banknote className="h-5 w-5" /> Cobrar
          </Button>
          {isRestaurant && (
            <Button variant="outline" size="lg" disabled={!sale.items.length || toTable.isPending} onClick={() => toTable.mutate()}>
              <UtensilsCrossed className="h-4 w-4" /> A mesa
            </Button>
          )}
          <Button variant="ghost" size="lg" onClick={() => (sale.items.length ? setConfirmCancel(true) : cancel.mutate())}>
            Anular
          </Button>
        </div>
      )}
      <ConfirmModal
        open={confirmCancel}
        title={`¿Anular la venta ${sale.code}?`}
        message="Se descartan los productos escaneados. No se cobra nada ni se toca el stock."
        confirmLabel="Sí, anular"
        danger
        onConfirm={() => cancel.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </section>
  );
}

function AssignBarcode({ barcode, onDone }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["pos-products", q], queryFn: async () => (await api.get("/pos/products", { params: { q } })).data.products, enabled: q.trim().length >= 2 });
  const assign = useMutation({
    mutationFn: async (productId) => (await api.post("/pos/barcode", { productId, barcode })).data,
    onSuccess: (r) => {
      toast.success("Código guardado", `${barcode} ahora es "${r.product.name}".`);
      onDone(true);
    },
    onError: (err) => toast.error(errText(err, "No se pudo guardar el código.")),
  });
  return (
    <div className="rounded-2xl border border-secondary/40 bg-secondary-container/15 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-[13.5px] text-on-surface">
          Ningún producto tiene el código <strong>{barcode}</strong>. ¿A cuál se lo pones?
        </p>
        <button type="button" onClick={() => onDone(false)} aria-label="Cerrar" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full hover:bg-surface-container">
          <X className="h-4 w-4" />
        </button>
      </div>
      <input autoFocus aria-label="Buscar producto" placeholder="Nombre del producto" value={q} onChange={(e) => setQ(e.target.value)} className={fieldCls} />
      {data?.length > 0 && (
        <ul className="mt-2 divide-y divide-surface-container-high rounded-xl bg-surface-container-lowest">
          {data.map((p) => (
            <li key={p.id}>
              <button type="button" disabled={assign.isPending} onClick={() => assign.mutate(p.id)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left hover:bg-surface-container/60">
                <span className="min-w-0 truncate text-[13px] text-on-surface">{p.name}</span>
                <span className="flex-shrink-0 text-[12px] text-on-surface-variant">{p.barcode ? `tiene ${p.barcode}` : "sin código"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SellTab({ state, canWrite, refresh }) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [camera, setCamera] = useState(false);
  const [unknown, setUnknown] = useState(null);
  const [paying, setPaying] = useState(null);
  const [tableFor, setTableFor] = useState(null);
  const [tableLink, setTableLink] = useState("");
  const inputRef = useRef(null);
  const activeRef = useRef(null);

  const open = state.open;
  const active = open.find((s) => s.id === activeId) ?? open[0] ?? null;
  activeRef.current = active?.id ?? null;

  const setSaleInCache = (sale) => {
    queryClient.setQueryData(["pos-state"], (old) => (old ? { ...old, open: [sale, ...old.open.filter((s) => s.id !== sale.id)] } : old));
    setActiveId(sale.id);
  };

  const scan = useMutation({
    mutationFn: async (barcode) => (await api.post("/pos/scan", { barcode, saleId: activeRef.current ?? undefined })).data,
    onSuccess: (r) => {
      beep(true);
      setSaleInCache(r.sale);
    },
    onError: (err, barcode) => {
      beep(false);
      if (err.response?.data?.unknownBarcode) setUnknown(barcode);
      else toast.error(errText(err, "No se pudo agregar."));
    },
  });
  const addProduct = useMutation({
    mutationFn: async (productId) => (await api.post(`/pos/sales/${activeRef.current ?? "new"}/items`, { productId, quantity: 1 })).data,
    onSuccess: (r) => {
      setInput("");
      setSaleInCache(r.sale);
      inputRef.current?.focus();
    },
    onError: (err) => toast.error(errText(err, "No se pudo agregar.")),
  });
  const newSale = useMutation({
    mutationFn: async () => (await api.post("/pos/sales", {})).data,
    onSuccess: (r) => setSaleInCache(r.sale),
  });
  const attach = useMutation({
    mutationFn: async ({ id, qr }) => (await api.post(`/pos/sales/${id}/attach-table`, { qr })).data,
    onSuccess: (r) => {
      toast.success(`Venta ${r.sale.code} en la mesa ${r.sale.tableNumber}`);
      setTableFor(null);
      setTableLink("");
      refresh();
    },
    onError: (err) => toast.error(errText(err, "No se pudo pasar a la mesa.")),
  });

  const looksLikeCode = (v) => /^[A-Za-z0-9.-]{3,40}$/.test(v) && /\d/.test(v);
  const search = useQuery({
    queryKey: ["pos-products", input.trim()],
    queryFn: async () => (await api.get("/pos/products", { params: { q: input.trim() } })).data.products,
    enabled: input.trim().length >= 2 && !looksLikeCode(input.trim()),
  });

  function submitInput(e) {
    e.preventDefault();
    const v = input.trim();
    if (!v) return;
    if (looksLikeCode(v)) {
      setInput("");
      scan.mutate(v);
    } else if (search.data?.length === 1) addProduct.mutate(search.data[0].id);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        {canWrite && (
          <>
            <form onSubmit={submitInput} className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-outline" aria-hidden="true" />
                <input
                  ref={inputRef}
                  autoFocus
                  aria-label="Código de barras o nombre del producto"
                  placeholder="Código o nombre del producto"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className={`${fieldCls} h-12 pl-10 text-[15px]`}
                />
              </div>
              <Button type="button" variant={camera ? "dark" : "outline"} size="lg" onClick={() => setCamera((c) => !c)} aria-pressed={camera} aria-label="Escanear con la cámara">
                <Camera className="h-5 w-5" />
              </Button>
            </form>
            <p className="-mt-1 text-[12px] text-outline">Con un lector USB o Bluetooth, deja el cursor en este campo y escanea.</p>
            {search.data?.length > 0 && input.trim().length >= 2 && (
              <ul className="divide-y divide-surface-container-high rounded-xl border border-surface-container-high bg-surface-container-lowest">
                {search.data.map((p) => (
                  <li key={p.id}>
                    <button type="button" disabled={p.hasSizes || !p.isActive || addProduct.isPending} onClick={() => addProduct.mutate(p.id)} className="flex min-h-12 w-full items-center gap-3 px-3 text-left hover:bg-surface-container/60 disabled:opacity-50">
                      {p.image ? <img src={imgUrl(p.image)} alt="" className="h-9 w-9 flex-shrink-0 rounded-lg object-cover" /> : <span className="h-9 w-9 flex-shrink-0 rounded-lg bg-surface-container" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-on-surface">{p.name}</span>
                        <span className="block text-[12px] text-on-surface-variant">
                          {fmt(p.price, p.currency)} · {p.unlimitedStock ? "siempre disponible" : `${p.stock} en stock`}
                          {p.hasSizes ? " · tiene tallas" : !p.isActive ? " · pausado" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {search.data?.length === 0 && input.trim().length >= 2 && <p className="text-[13px] text-on-surface-variant">Ningún producto con ese nombre.</p>}
            {camera && <CameraScanner title="Escanear productos" hint="Pasa cada producto frente a la cámara" onScan={(code) => scan.mutate(code)} onClose={() => setCamera(false)} />}
            {unknown && <AssignBarcode barcode={unknown} onDone={(retry) => { const code = unknown; setUnknown(null); if (retry) scan.mutate(code); }} />}
          </>
        )}

        {open.length > 0 && (
          <div>
            <p className="mb-1.5 text-[12.5px] font-bold text-on-surface">Ventas abiertas</p>
            <div className="flex flex-wrap gap-2">
              {open.map((s) => (
                <button key={s.id} type="button" onClick={() => setActiveId(s.id)} aria-pressed={active?.id === s.id} className={`min-h-11 rounded-xl border px-3 text-[13px] font-bold ${active?.id === s.id ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface"}`}>
                  {s.code}
                  {s.customerName ? ` · ${s.customerName}` : ""} · {fmt(s.total, s.currency)}
                </button>
              ))}
              {canWrite && (
                <button type="button" onClick={() => newSale.mutate()} className="flex min-h-11 items-center gap-1 rounded-xl border border-dashed border-outline-variant px-3 text-[13px] font-bold text-tertiary-accent">
                  <Plus className="h-4 w-4" /> Otra venta
                </button>
              )}
            </div>
          </div>
        )}

        {state.pendingTable.length > 0 && (
          <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
            <p className="mb-1 text-[13.5px] font-bold text-on-surface">Esperando mesa</p>
            <p className="mb-2 text-[12px] text-outline">Escanea el QR de la mesa o pide al cliente que escriba el número en la página de su mesa.</p>
            <ul className="divide-y divide-surface-container-high">
              {state.pendingTable.map((s) => (
                <li key={s.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13.5px] font-bold text-on-surface">
                      {s.code}
                      {s.customerName ? ` · ${s.customerName}` : ""} · {fmt(s.total, s.currency)}
                    </span>
                    {canWrite && (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setTableFor(tableFor === s.id ? null : s.id)}>
                          <QrCode className="h-4 w-4" /> QR de la mesa
                        </Button>
                        <Button size="sm" onClick={() => setPaying(s)}>Cobrar</Button>
                      </div>
                    )}
                  </div>
                  {tableFor === s.id && (
                    <div className="mt-2 flex flex-col gap-2">
                      <CameraScanner title="Escanea el QR de la mesa" onScan={(qr) => !attach.isPending && attach.mutate({ id: s.id, qr })} onClose={() => setTableFor(null)} />
                      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tableLink.trim()) attach.mutate({ id: s.id, qr: tableLink.trim() }); }}>
                        <input aria-label="Enlace del QR de la mesa" placeholder="O pega el enlace del QR" value={tableLink} onChange={(e) => setTableLink(e.target.value)} className={fieldCls} />
                        <Button type="submit" variant="outline" disabled={!tableLink.trim() || attach.isPending}>Pasar</Button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        {active ? (
          <SaleCard sale={active} canWrite={canWrite} isRestaurant={state.isRestaurant} onPay={setPaying} refresh={refresh} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-outline-variant px-5 py-12 text-center">
            <ScanBarcode className="h-10 w-10 text-outline" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-[15px] font-bold text-on-surface">Escanea un producto para empezar</p>
            <p className="max-w-xs text-[13px] text-on-surface-variant">La venta se crea sola con el primer producto. También puedes buscar por nombre.</p>
          </div>
        )}
      </div>

      {paying && (
        <PayModal
          sale={paying}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            setActiveId(null);
            refresh();
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

const FUL_LABEL = { PREPARING: "Preparando", READY: "Listo para recoger", PICKED_UP: "Recogido" };
const FUL_CLS = { PREPARING: "bg-secondary/15 text-[#8A5100]", READY: "bg-verified/15 text-verified-dark", PICKED_UP: "bg-surface-container-high text-on-surface-variant" };

function Thumb({ src, name, size = "h-10 w-10" }) {
  return src ? (
    <img src={imgUrl(src)} alt="" className={`${size} flex-shrink-0 rounded-lg object-cover`} loading="lazy" />
  ) : (
    <span className={`${size} flex flex-shrink-0 items-center justify-center rounded-lg bg-surface-container text-[13px] font-bold text-on-surface-variant`}>{name?.[0]}</span>
  );
}

// Detalle de una venta cobrada: a nombre de quién, qué lleva, cómo se pagó, quién cobró y en qué momento pasó por cada estado.
function SaleDetail({ sale, canWrite, refresh }) {
  const [name, setName] = useState(sale.customerName ?? "");
  useEffect(() => setName(sale.customerName ?? ""), [sale.id, sale.customerName]);
  const saveName = useMutation({
    mutationFn: async () => (await api.patch(`/pos/sales/${sale.id}`, { customerName: name.trim() || null })).data,
    onSuccess: () => {
      toast.success("Nombre guardado", "Se ve en las pantallas y en Pedidos.");
      refresh();
    },
    onError: (err) => toast.error(errText(err, "No se pudo guardar el nombre.")),
  });
  const units = sale.items.reduce((n, i) => n + i.quantity, 0);
  const times = [
    ["Cobrado", sale.paidAt],
    ["Listo", sale.readyAt],
    ["Recogido", sale.pickedUpAt],
  ].filter(([, t]) => t);
  return (
    <div className="border-t border-surface-container-high bg-surface-container-low/60 px-4 py-3">
      {canWrite && sale.status === "PAID" && (
        <form
          className="mb-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveName.mutate();
          }}
        >
          <label htmlFor={`name-${sale.id}`} className="text-[12.5px] font-semibold text-on-surface-variant">
            A nombre de
          </label>
          <input id={`name-${sale.id}`} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" className={`${fieldCls} h-10 max-w-[220px] flex-1`} />
          <Button size="sm" variant="outline" type="submit" disabled={saveName.isPending || name.trim() === (sale.customerName ?? "")}>
            Guardar
          </Button>
        </form>
      )}
      <ul className="divide-y divide-surface-container-high rounded-xl bg-surface-container-lowest">
        {sale.items.map((i) => (
          <li key={i.productId} className="flex items-center gap-3 px-3 py-2">
            <Thumb src={i.image} name={i.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-on-surface">{i.name}</p>
              <p className="text-[12px] text-on-surface-variant">
                {i.quantity} × {fmt(i.price, sale.currency)}
              </p>
            </div>
            <p className="flex-shrink-0 text-[13.5px] font-bold text-on-surface">{fmt(i.price * i.quantity, sale.currency)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
        <div>
          <dt className="text-outline">Total</dt>
          <dd className="font-bold text-on-surface">{fmt(sale.total, sale.currency)} · {units} {units === 1 ? "unidad" : "unidades"}</dd>
        </div>
        <div>
          <dt className="text-outline">Pago</dt>
          <dd className="font-bold text-on-surface">{sale.status === "SENT_TO_TABLE" ? `Cuenta de la mesa ${sale.tableNumber}` : METHOD_LABEL[sale.paymentMethod] ?? "—"}</dd>
        </div>
        {sale.paymentMethod === "CASH" && (
          <div>
            <dt className="text-outline">Recibido / vuelto</dt>
            <dd className="font-bold text-on-surface">
              {fmt(sale.cashReceived, sale.currency)} / {fmt(sale.changeGiven ?? 0, sale.currency)}
            </dd>
          </div>
        )}
        {sale.createdByName && (
          <div>
            <dt className="text-outline">Atendió</dt>
            <dd className="truncate font-bold text-on-surface">{sale.createdByName}</dd>
          </div>
        )}
        {times.map(([label, t]) => (
          <div key={label}>
            <dt className="text-outline">{label}</dt>
            <dd className="font-bold text-on-surface">{timeText(t)}</dd>
          </div>
        ))}
      </dl>
      {sale.orderId && (
        <Link to={`/vendedor/pedidos?ver=${sale.orderId}&tipo=orden`} className="mt-3 inline-flex min-h-11 items-center text-[13px] font-bold text-tertiary-accent underline">
          Ver en Pedidos
        </Link>
      )}
    </div>
  );
}

// Ventas cobradas hoy. Cada una se abre para ver el detalle completo; los botones cambian su estado (y el de su pedido en
// Pedidos y en la pantalla de pedidos del local).
function TodayTab({ state, canWrite, refresh }) {
  const [openId, setOpenId] = useState(null);
  const set = useMutation({
    mutationFn: async ({ id, fulfillment }) => (await api.patch(`/pos/sales/${id}/fulfillment`, { fulfillment })).data,
    onSuccess: refresh,
    onError: (err) => toast.error(errText(err, "No se pudo cambiar el estado.")),
  });
  if (!state.today.length) return <p className="rounded-2xl border border-dashed border-outline-variant px-5 py-10 text-center text-[13.5px] text-on-surface-variant">Todavía no cobraste ninguna venta hoy.</p>;
  return (
    <ul className="divide-y divide-surface-container-high overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest">
      {state.today.map((s) => {
        const isOpen = openId === s.id;
        const units = s.items.reduce((n, i) => n + i.quantity, 0);
        const summary = s.items.slice(0, 2).map((i) => `${i.quantity}× ${i.name}`).join(", ") + (s.items.length > 2 ? ` y ${s.items.length - 2} más` : "");
        return (
          <li key={s.id}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button type="button" onClick={() => setOpenId(isOpen ? null : s.id)} aria-expanded={isOpen} className="min-w-[220px] flex-1 text-left">
                <span className="flex items-center gap-2.5">
                  <span className="font-display text-[20px] font-extrabold tracking-[0.08em] text-on-surface">{s.code}</span>
                  {s.status === "SENT_TO_TABLE" ? (
                    <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-[11.5px] font-bold text-on-surface-variant">Mesa {s.tableNumber}</span>
                  ) : (
                    s.fulfillment && <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${FUL_CLS[s.fulfillment]}`}>{FUL_LABEL[s.fulfillment]}</span>
                  )}
                  <ChevronDown className={`ml-auto h-4 w-4 flex-shrink-0 text-outline transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </span>
                <span className="mt-0.5 block truncate text-[14px] font-bold text-on-surface">{s.customerName || "Sin nombre"}</span>
                <span className="block truncate text-[12px] text-on-surface-variant">
                  {timeText(s.paidAt ?? s.updatedAt)} · {fmt(s.total, s.currency)} · {units} u. · {summary}
                </span>
              </button>
              {canWrite && s.status === "PAID" && s.fulfillment === "PREPARING" && (
                <Button size="sm" onClick={() => set.mutate({ id: s.id, fulfillment: "READY" })}>Marcar listo</Button>
              )}
              {canWrite && s.status === "PAID" && s.fulfillment === "READY" && (
                <Button size="sm" variant="outline" onClick={() => set.mutate({ id: s.id, fulfillment: "PICKED_UP" })}>
                  <CheckCircle2 className="h-4 w-4" /> Recogido
                </Button>
              )}
            </div>
            {isOpen && <SaleDetail sale={s} canWrite={canWrite} refresh={refresh} />}
          </li>
        );
      })}
    </ul>
  );
}

function MoneyTab({ state, canWrite, refresh }) {
  const [type, setType] = useState("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { cash, currency } = state;
  const add = useMutation({
    mutationFn: async () => (await api.post("/pos/cash", { type, amount: Number(amount.replace(",", ".")), note: note.trim() })).data,
    onSuccess: () => {
      toast.success(type === "DEPOSIT" ? "Entrada registrada" : "Salida registrada");
      setAmount("");
      setNote("");
      refresh();
    },
    onError: (err) => toast.error(errText(err, "No se pudo registrar.")),
  });
  const drawer = Object.entries(cash.cashInDrawer);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
          <p className="text-[12.5px] text-on-surface-variant">Efectivo en caja hoy</p>
          <p className="font-display text-[26px] font-extrabold text-on-surface">{drawer.length ? drawer.map(([c, v]) => fmt(v, c)).join(" + ") : fmt(0, currency)}</p>
          <p className="mt-1 text-[12px] text-outline">Cobros en efectivo menos vueltos, más entradas y menos salidas registradas desde las 00:00.</p>
          {cash.sales.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-surface-container-high pt-3 text-[13px] text-on-surface">
              {cash.sales.map((s) => (
                <li key={`${s.method}-${s.currency}`} className="flex justify-between">
                  <span>{METHOD_LABEL[s.method] ?? s.method} ({s.count})</span>
                  <span className="font-bold">{fmt(s.total, s.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canWrite && (
          <form className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <p className="mb-2 text-[13.5px] font-bold text-on-surface">Registrar entrada o salida</p>
            <div className="mb-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de movimiento">
              {[["DEPOSIT", "Entrada (fondo, cambio)"], ["WITHDRAWAL", "Salida (pago, retiro)"]].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={type === id} onClick={() => setType(id)} className={`min-h-11 rounded-xl border px-2 text-[12.5px] font-bold ${type === id ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
              <input aria-label={`Monto (${currency})`} placeholder={`Monto (${currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} className={fieldCls} />
              <input aria-label="Motivo" placeholder="Motivo" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={fieldCls} />
            </div>
            <Button type="submit" className="mt-2" disabled={!(Number(amount.replace(",", ".")) > 0) || note.trim().length < 3 || add.isPending}>Registrar</Button>
          </form>
        )}
      </div>
      <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
        <p className="mb-2 text-[13.5px] font-bold text-on-surface">Movimientos de hoy</p>
        {cash.entries.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant">Sin movimientos todavía.</p>
        ) : (
          <ul className="divide-y divide-surface-container-high">
            {cash.entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-on-surface">{ENTRY_LABEL[e.type]}{e.note ? ` · ${e.note}` : ""}</p>
                  <p className="text-[11.5px] text-outline">{timeText(e.createdAt)}</p>
                </div>
                <p className={`flex-shrink-0 text-[13.5px] font-extrabold ${e.amount >= 0 ? "text-verified-dark" : "text-error"}`}>{e.amount > 0 ? "+" : ""}{fmt(e.amount, e.currency)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ScreensTab({ state, canWrite, refresh }) {
  const [confirm, setConfirm] = useState(null);
  const fileRef = useRef(null);
  const origin = window.location.origin;
  const links = [
    { which: "display", title: "Pantalla para el cliente", text: "Ábrela en una tablet o monitor frente al cliente: ve cada producto que escaneas con su foto, el total y su número al cobrar. Sin venta en curso pasa tus productos más vistos y vendidos, y tu imagen si subiste una.", url: `${origin}/caja/pantalla/${state.settings.displayToken}` },
    { which: "board", title: "Tablero de pedidos", text: "Muestra los pedidos cobrados hoy en preparación y listos para recoger, con número, nombre y qué lleva. Los recogidos salen solos.", url: `${origin}/caja/tablero/${state.settings.boardToken}` },
  ];
  const regen = useMutation({
    mutationFn: async (which) => (await api.post("/pos/links", { which })).data,
    onSuccess: () => {
      setConfirm(null);
      toast.success("Enlace nuevo creado", "El anterior dejó de funcionar.");
      refresh();
    },
  });
  const upload = useMutation({
    mutationFn: async (file) => {
      const form = new FormData();
      form.append("image", file);
      return (await api.post("/pos/idle-image", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Imagen guardada", "La pantalla en reposo ahora muestra esta imagen fija.");
      refresh();
    },
    onError: (err) => toast.error(errText(err, "No se pudo subir la imagen.")),
  });
  const remove = useMutation({ mutationFn: async () => (await api.delete("/pos/idle-image")).data, onSuccess: refresh });
  const setMode = useMutation({
    mutationFn: async (idleMode) => (await api.patch("/pos/settings", { idleMode })).data,
    onSuccess: (_d, idleMode) => {
      toast.success(idleMode === "IMAGE" ? "La pantalla muestra tu imagen fija" : "La pantalla muestra la vitrina animada");
      refresh();
    },
    onError: (err) => toast.error(errText(err, "No se pudo cambiar.")),
  });
  const [minutes, setMinutes] = useState(String(state.settings.readyAutoClearMinutes ?? 15));
  const saveMinutes = useMutation({
    mutationFn: async () => (await api.patch("/pos/settings", { readyAutoClearMinutes: Math.trunc(Number(minutes)) })).data,
    onSuccess: () => {
      toast.success("Tiempo guardado");
      refresh();
    },
    onError: (err) => toast.error(errText(err, "No se pudo guardar.")),
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {links.map((l) => (
        <div key={l.which} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
          <p className="text-[14px] font-bold text-on-surface">{l.title}</p>
          <p className="mb-3 text-[12.5px] leading-[18px] text-on-surface-variant">{l.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(l.url).then(() => toast.success("Enlace copiado"), () => toast.error("No se pudo copiar."))}>
              <Copy className="h-4 w-4" /> Copiar enlace
            </Button>
            <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded border border-outline px-3 text-label-sm font-semibold text-on-surface hover:bg-surface-container">
              <ExternalLink className="h-4 w-4" /> Abrir
            </a>
            {canWrite && (
              <Button size="sm" variant="ghost" onClick={() => setConfirm(l.which)}>
                <RefreshCw className="h-4 w-4" /> Cambiar enlace
              </Button>
            )}
          </div>
          <p className="mt-2 text-[11.5px] text-outline">El enlace solo se ve aquí. Si alguien que no debe lo tiene, cámbialo.</p>
        </div>
      ))}
      <form
        className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 lg:col-span-2"
        onSubmit={(e) => {
          e.preventDefault();
          saveMinutes.mutate();
        }}
      >
        <label htmlFor="ready-minutes" className="text-[14px] font-bold text-on-surface">
          Pedidos listos en el tablero
        </label>
        <p className="mb-3 text-[12.5px] text-on-surface-variant">
          Si nadie lo marca como recogido, un pedido listo sale del tablero pasado este tiempo y queda como entregado en Pedidos.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input id="ready-minutes" inputMode="numeric" value={minutes} disabled={!canWrite} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} className={`${fieldCls} w-24`} />
          <span className="text-[13px] text-on-surface-variant">minutos</span>
          {canWrite && (
            <Button size="sm" type="submit" disabled={saveMinutes.isPending || !(Number(minutes) >= 2 && Number(minutes) <= 240) || Number(minutes) === state.settings.readyAutoClearMinutes}>
              Guardar
            </Button>
          )}
        </div>
      </form>
      <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 lg:col-span-2">
        <p className="text-[14px] font-bold text-on-surface">Pantalla del cliente sin venta en curso</p>
        <p className="mb-3 text-[12.5px] text-on-surface-variant">Elige qué ve el cliente mientras espera.</p>
        <div role="radiogroup" aria-label="Qué muestra la pantalla en reposo" className="mb-4 grid gap-2 sm:grid-cols-2">
          {[
            ["SHOWCASE", "Vitrina animada", "Recorre tus productos y abre en grande los que más se venden, los que están en oferta y tus ofertas con código. Se actualiza sola."],
            ["IMAGE", "Imagen fija", "Muestra siempre la misma imagen: una promoción, el menú del día o tu logo."],
          ].map(([id, title, text]) => {
            const selected = (state.settings.idleMode ?? "SHOWCASE") === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!canWrite || setMode.isPending}
                onClick={() => {
                  if (selected) return;
                  if (id === "IMAGE" && !state.settings.idleImageUrl) fileRef.current?.click();
                  else setMode.mutate(id);
                }}
                className={`rounded-xl border-2 p-3 text-left transition-colors disabled:opacity-60 ${selected ? "border-primary bg-primary/[0.04]" : "border-outline-variant hover:border-outline"}`}
              >
                <span className="flex items-center gap-2 text-[13.5px] font-bold text-on-surface">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${selected ? "border-primary" : "border-outline"}`}>{selected && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
                  {title}
                </span>
                <span className="mt-1 block text-[12px] leading-[17px] text-on-surface-variant">{text}</span>
              </button>
            );
          })}
        </div>
        <p className="mb-2 text-[12.5px] font-semibold text-on-surface">Imagen fija</p>
        <div className="flex flex-wrap items-center gap-3">
          {state.settings.idleImageUrl ? (
            <img src={imgUrl(state.settings.idleImageUrl)} alt="Imagen actual de la pantalla en reposo" className="h-24 w-40 rounded-xl object-cover" />
          ) : (
            <span className="flex h-24 w-40 items-center justify-center rounded-xl bg-surface-container px-2 text-center text-[12px] text-outline">Sin imagen. Al subir una, se usa como imagen fija.</span>
          )}
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload.mutate(f); }} />
              <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                <ImagePlus className="h-4 w-4" /> {upload.isPending ? "Subiendo..." : state.settings.idleImageUrl ? "Cambiar imagen" : "Subir imagen"}
              </Button>
              {state.settings.idleImageUrl && <Button size="sm" variant="ghost" onClick={() => remove.mutate()}>Quitar</Button>}
            </div>
          )}
        </div>
      </div>
      <ConfirmModal
        open={!!confirm}
        title="¿Cambiar el enlace?"
        message="El enlace actual deja de funcionar al instante: tendrás que abrir el nuevo en la pantalla que lo usaba."
        confirmLabel={regen.isPending ? "Cambiando..." : "Sí, cambiar"}
        onConfirm={() => regen.mutate(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function VendorPos() {
  const { staffSectionPermissions } = useOutletContext() ?? {};
  const canWrite = canWriteSection(staffSectionPermissions, "caja");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("vender");
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["pos-state"],
    queryFn: async () => (await api.get("/pos/state")).data,
    // Sin la caja en el plan no tiene sentido reintentar ni consultar cada 15 s.
    refetchInterval: (q) => (isPlanError(q.state.error) ? false : 15_000),
    retry: (count, err) => !isPlanError(err) && count < 2,
  });
  const planLocked = isPlanError(error);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pos-state"] });

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={ScanBarcode} tone="teal" />
        <h1 className="font-display text-[24px] font-extrabold tracking-tight text-on-surface sm:text-[26px]">Caja</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Vende escaneando el código de barras de cada producto. Cobra en el mostrador y el stock se descuenta solo.</p>
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />
      {isLoading && <ListSkeleton />}
      {planLocked && (
        <PlanUpsell
          title="La caja es del Plan Premium"
          text="Con la caja vendes en el mostrador escaneando códigos de barras, cobras con cálculo del vuelto, muestras el pedido en una pantalla para el cliente y llevas el dinero del día. Tus productos y su stock no cambian."
        />
      )}
      {isError && !planLocked && <p className="text-body-md text-error">No se pudo cargar la caja. Recarga la página.</p>}
      {data && tab === "vender" && <SellTab state={data} canWrite={canWrite} refresh={refresh} />}
      {data && tab === "hoy" && <TodayTab state={data} canWrite={canWrite} refresh={refresh} />}
      {data && tab === "dinero" && <MoneyTab state={data} canWrite={canWrite} refresh={refresh} />}
      {data && tab === "pantallas" && <ScreensTab state={data} canWrite={canWrite} refresh={refresh} />}
    </div>
  );
}
