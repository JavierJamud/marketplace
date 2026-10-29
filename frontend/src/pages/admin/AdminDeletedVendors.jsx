import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Trash2, Smartphone, Clock, User as UserIcon, Store } from "lucide-react";
import { api } from "../../lib/api.js";
import { CARD } from "../../components/dashboard/DashboardCard.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";
import { Button } from "../../components/ui/Button.jsx";

// Tiendas > Eliminadas (pedido del dueño): las tiendas eliminadas o con la eliminación pendiente, que antes desaparecían de
// todas las listas sin dejar rastro a la vista. La lista lleva a una ficha con quién la creó, desde qué dispositivo e IP, qué
// pasó en ella y cómo y por qué se eliminó. Solo lectura: lo que queda de una tienda eliminada no se edita.

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("es-CU", { dateStyle: "medium", timeStyle: "short" }) : "Sin dato");

function LoadError({ onRetry, retrying, message }) {
  return (
    <div role="alert" className={`${CARD} flex flex-col items-center gap-3 p-6 text-center`}>
      <p className="text-body-md text-error">{message}</p>
      <Button variant="outline" disabled={retrying} onClick={onRetry}>
        {retrying ? "Reintentando..." : "Reintentar"}
      </Button>
    </div>
  );
}

const STATUS_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "deleted", label: "Eliminadas" },
  { id: "pending", label: "Eliminación pendiente" },
];

export default function AdminDeletedVendors() {
  const { id } = useParams();
  return id ? <DeletedVendorDetail id={id} /> : <DeletedVendorList />;
}

function DeletedVendorList() {
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-deleted-vendors", status, q.trim()],
    queryFn: async () => (await api.get("/admin/deleted-vendors", { params: { status, q: q.trim() || undefined } })).data.vendors,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <Link to="/admin/tiendas" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-tertiary-accent hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Tiendas
      </Link>
      <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Tiendas eliminadas</h1>
      <p className="mb-5 mt-1 text-[13.5px] text-outline">
        Las tiendas que se eliminaron o están por eliminarse. Toca una para ver quién la creó, desde dónde y todo lo que pasó en ella.
      </p>

      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={status === f.id}
              onClick={() => setStatus(f.id)}
              className={`min-h-11 rounded-full border px-3.5 text-[12.5px] font-bold ${status === f.id ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por tienda, dueño o correo"
          aria-label="Buscar tienda eliminada"
          className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-tertiary-accent sm:w-72"
        />
      </div>

      {isLoading && <ListSkeleton />}
      {isError && !data && <LoadError message="No se pudo cargar la lista." onRetry={() => refetch()} retrying={isFetching} />}
      {data && data.length === 0 && (
        <div className={`${CARD} px-5 py-12 text-center text-body-md text-on-surface-variant`}>
          {q.trim() ? "Ninguna tienda coincide con la búsqueda." : "No hay tiendas eliminadas."}
        </div>
      )}
      {data && data.length > 0 && (
        <ul className={`${CARD} divide-y divide-surface-container`}>
          {data.map((v) => (
            <li key={v.id}>
              <Link to={`/admin/tiendas/eliminadas/${v.id}`} className="flex min-h-11 items-center gap-3 px-4 py-3.5 hover:bg-surface-container-low">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white" style={{ background: v.color ?? "#232F3E" }} aria-hidden="true">
                  {v.companyName?.[0] ?? "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-on-surface">{v.companyName}</span>
                  <span className="block truncate text-[12px] text-on-surface-variant">
                    {v.ownerName ?? "Sin nombre"}
                    {v.ownerEmail ? ` · ${v.ownerEmail}` : ""}
                  </span>
                  <span className="block text-[12px] text-outline">
                    {v.status === "deleted" ? `Eliminada ${fmtDateTime(v.deletedAt)}` : `Eliminación pedida ${fmtDateTime(v.pendingSince)}`} · {v.products} productos · {v.orders} pedidos
                  </span>
                </span>
                <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${v.status === "deleted" ? "bg-error/10 text-error" : "bg-secondary-container/20 text-on-secondary-container"}`}>
                  {v.status === "deleted" ? "Eliminada" : "Pendiente"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-outline">{label}</dt>
      <dd className="break-words text-[13.5px] text-on-surface">{value || "Sin dato"}</dd>
    </div>
  );
}

function ContextFields({ ctx }) {
  if (!ctx) return <p className="text-[13px] text-on-surface-variant">Sin datos del dispositivo: la tienda se creó antes de que se guardara este registro.</p>;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="IP" value={ctx.ip} />
      <Field label="Navegador" value={[ctx.browser, ctx.inApp ? `dentro de ${ctx.inApp}` : null].filter(Boolean).join(" ")} />
      <Field label="Sistema" value={ctx.os} />
      <Field label="Dispositivo" value={[ctx.device, ctx.model].filter(Boolean).join(" · ")} />
      <Field label="Pantalla" value={ctx.screen} />
      <Field label="Zona horaria e idioma" value={[ctx.timezone, ctx.language].filter(Boolean).join(" · ")} />
    </dl>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className={`${CARD} p-4 sm:p-5`}>
      <h2 className="mb-3 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
        <Icon className="h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" /> {title}
      </h2>
      {children}
    </section>
  );
}

function DeletedVendorDetail({ id }) {
  const { data, isLoading, isError, isFetching, refetch, error } = useQuery({
    queryKey: ["admin-deleted-vendor", id],
    queryFn: async () => (await api.get(`/admin/deleted-vendors/${encodeURIComponent(id)}`)).data,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:py-8">
      <Link to="/admin/tiendas/eliminadas" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-tertiary-accent hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Tiendas eliminadas
      </Link>
      {isLoading && <ListSkeleton />}
      {isError && !data && <LoadError message={error?.response?.data?.error ?? "No se pudo cargar la tienda."} onRetry={() => refetch()} retrying={isFetching} />}
      {data && (
        <>
          <div>
            <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">{data.vendor.companyName}</h1>
            <p className="mt-1 text-[13.5px] text-outline">
              baznova.com/tienda/{data.vendor.slug} · {data.vendor.deletedAt ? `Eliminada ${fmtDateTime(data.vendor.deletedAt)}` : `Eliminación pedida ${fmtDateTime(data.vendor.deletionRequestedAt)}`}
            </p>
          </div>

          <Section icon={Trash2} title="Eliminación">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Cómo" value={data.deletion.sourceLabel ?? (data.vendor.deletedAt ? "Sin dato" : "Pendiente")} />
              <Field label="Quién" value={data.deletion.by ?? (data.deletion.source === "CUSTOMER_REQUEST" ? "Su dueño" : null)} />
              <Field label="Motivo" value={data.deletion.reason} />
              <Field label="Fecha" value={fmtDateTime(data.vendor.deletedAt ?? data.vendor.deletionRequestedAt)} />
            </dl>
          </Section>

          <Section icon={Store} title="La tienda">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Creada" value={fmtDateTime(data.vendor.createdAt)} />
              <Field label="Responsable" value={data.vendor.ownerName} />
              <Field label="Documento" value={data.vendor.ownerIdNumber} />
              <Field label="WhatsApp" value={data.vendor.whatsapp} />
              <Field label="Correo de la tienda" value={data.vendor.email} />
              <Field label="Dirección" value={data.vendor.companyAddress} />
              <Field label="Dónde vendía" value={data.vendor.locations.join(" | ")} />
              <Field label="Plan y moneda" value={`${data.vendor.planType} · ${data.vendor.currency ?? ""}`} />
              <Field label="Productos" value={String(data.vendor.products)} />
              <Field label="Pedidos" value={String(data.vendor.orders)} />
            </dl>
          </Section>

          <VendorHistorySections data={data} />
        </>
      )}
    </div>
  );
}

// Quién creó la tienda y desde dónde, con qué dispositivos entró y todo lo que pasó en ella. Se usa en la ficha de una tienda
// eliminada y en la pestaña Historial de Gestionar tienda (AdminVendorManage.jsx).
export function VendorHistorySections({ data }) {
  return (
    <>
    <Section icon={UserIcon} title="Quién la creó">
      {data.owner ? (
        <dl className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nombre" value={data.owner.fullName} />
          <Field label="Correo de la cuenta" value={data.owner.email} />
          <Field label="Teléfono" value={data.owner.phone} />
          <Field label="Cuenta creada" value={fmtDateTime(data.owner.registeredAt)} />
          <Field label="Último acceso" value={fmtDateTime(data.owner.lastLoginAt)} />
        </dl>
      ) : (
        <p className="mb-4 text-[13px] text-on-surface-variant">Sin datos de la cuenta.</p>
      )}
      <h3 className="mb-2 text-[13.5px] font-bold text-on-surface">Desde dónde creó la tienda</h3>
      <ContextFields ctx={data.created?.context} />
    </Section>

    <Section icon={Smartphone} title="Dispositivos con los que entró">
      {data.devices.length ? (
        <ul className="divide-y divide-surface-container">
          {data.devices.map((d, i) => (
            <li key={i} className="py-2.5 text-[13px] text-on-surface">
              <span className="font-semibold">{d.browser}</span> en {d.os} · {d.device}
              <span className="block text-[12px] text-outline">Primer acceso {fmtDateTime(d.firstSeen)} · Último {fmtDateTime(d.lastSeen)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-on-surface-variant">Sin inicios de sesión guardados.</p>
      )}
    </Section>

    <Section icon={Clock} title="Todo lo que pasó en la tienda">
      {data.timeline.length ? (
        // Con mucha actividad la lista se desliza dentro de su tarjeta en vez de alargar la página sin fin.
        <ol className="max-h-[60dvh] space-y-3 overflow-y-auto overscroll-contain pr-1">
          {data.timeline.map((e) => (
            <li key={e.id} className="border-l-2 border-surface-container-high pl-3">
              <p className="text-[12px] text-outline">
                {fmtDateTime(e.at)}
                {e.who ? ` · ${e.who}` : ""}
                {e.context?.ip ? ` · IP ${e.context.ip}` : ""}
              </p>
              <p className="break-words text-[13.5px] text-on-surface">{e.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-on-surface-variant">No hay actividad guardada.</p>
      )}
    </Section>
    </>
  );
}
