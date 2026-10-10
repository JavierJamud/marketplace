import { X } from "lucide-react";

// Piezas compartidas por las pantallas de Socios de la API del admin: botones, campos, formato y ventana modal.
export const BTN = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_PRIMARY = `${BTN} bg-primary text-white hover:bg-primary/90`;
export const BTN_GHOST = `${BTN} border border-outline-variant text-on-surface hover:bg-surface-variant`;
export const INPUT = "min-h-[44px] w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none focus:border-primary";
export const LABEL = "mb-1 block text-[12px] font-bold text-on-surface-variant";

export const fmt = (n) => Number(n ?? 0).toLocaleString("es-CU");
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Nunca");
export const linesToList = (text) => text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
export const errMsg = (err, fallback) => err.response?.data?.error ?? fallback;
export const BTN_DANGER = `${BTN} border border-error/40 text-error hover:bg-error/5`;

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`relative max-h-[90vh] w-full ${wide ? "max-w-xl" : "max-w-md"} overflow-y-auto rounded-2xl bg-surface-container-lowest p-6 shadow-2xl`}>
        <button onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-outline hover:bg-surface-variant">
          <X className="h-4 w-4" />
        </button>
        <h2 className="mb-4 pr-10 text-[16px] font-bold text-on-surface">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function StatusPill({ ok, yes = "Activo", no = "Suspendido" }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ok ? "bg-verified/10 text-verified-dark" : "bg-error/10 text-error"}`}>{ok ? yes : no}</span>;
}
