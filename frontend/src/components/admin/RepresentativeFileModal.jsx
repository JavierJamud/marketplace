import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, FileText, History, StickyNote, User, UserRound, Video, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { PrivateDocument } from "../PrivateDocument.jsx";
import { Spinner } from "../ui/Spinner.jsx";

// Bloque 277 (pedido explícito — "en la sección Tiendas del panel de administrador un botón para ver los
// datos del responsable de la tienda: las fotos, su récord, las notas puestas a la tienda y los
// incumplimientos"): ficha completa del responsable, solo para administradores. Junta lo que ya
// existía por separado: el registro verificado (datos y fotos privadas), el estado de la cuenta,
// los reportes y el historial de estados y de verificación de la tienda.

const STATUS_LABEL = {
  NOT_STARTED: "Sin iniciar", PENDING_DOCS: "Documentos subidos", IN_REVIEW: "En revisión", PENDING_PAYMENT: "Falta el pago", VERIFIED: "Verificada",
  PAYMENT_FAILED: "Pago fallido", SUSPENDED: "Suspendida", REJECTED: "Rechazada", ACTIVE: "Activa",
  PENDING: "Pendiente", EVIDENCE_REQUESTED: "Evidencia solicitada", RESOLVED: "Resuelto", DISMISSED: "Descartado", APPROVED: "Aprobada",
};
const label = (s) => STATUS_LABEL[s] ?? s ?? "";
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "short", year: "numeric" }) : null);

function Section({ icon: Icon, title, children, tone }) {
  return (
    <section className="mt-5">
      <h3 className={`mb-2 flex items-center gap-2 text-[14px] font-bold ${tone === "danger" ? "text-error" : "text-on-surface"}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ name, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-on-surface-variant">{name}</dt>
      <dd className="break-words text-[13.5px] font-semibold text-on-surface">{value || "No registrado"}</dd>
    </div>
  );
}

function Empty({ children }) {
  return <p className="rounded-xl bg-surface-container px-3.5 py-3 text-[13px] text-on-surface-variant">{children}</p>;
}

export function RepresentativeFileModal({ vendor, onClose }) {
  const vendorId = vendor.id ?? vendor.vendorId;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["representative-file", vendorId],
    queryFn: async () => (await api.get(`/admin/vendors/${vendorId}/representative-file`)).data,
    staleTime: 0,
  });
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const v = data?.vendor;
  const a = data ? data.archives.find((x) => x.id === data.currentArchiveId) ?? data.archives[0] : null;
  const notes = data
    ? [
        a?.notes && { from: "Notas del archivo de verificación", text: a.notes },
        data.requestNotes && { from: "Notas de la revisión", text: data.requestNotes },
        v?.blockReason && { from: "Motivo del bloqueo", text: v.blockReason },
        v?.suspensionReason && { from: "Motivo de la suspensión", text: v.suspensionReason },
        v?.reactivationReason && { from: "Motivo de la reactivación", text: v.reactivationReason },
        ...data.changeRequests.filter((c) => c.adminNotes).map((c) => ({ from: `Cambio de datos del ${fmt(c.createdAt)}`, text: c.adminNotes })),
      ].filter(Boolean)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="rep-file-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[88vh] w-full max-w-[760px] overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="rep-file-title" className="flex items-center gap-2 text-title-lg font-bold text-on-surface">
              <UserRound className="h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
              <span className="truncate">Responsable de {vendor.companyName || data?.vendor.companyName || "la tienda"}</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-outline">Ficha solo para administradores. Incluye datos y fotos privadas: no la compartas.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 -mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-outline hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}
        {isError && <p className="py-8 text-center text-[13.5px] text-error">No se pudo cargar la ficha. Cierra e inténtalo de nuevo.</p>}

        {data && (
          <>
            <div className="mt-4 flex flex-wrap gap-2 text-[12px] font-semibold">
              <span className="rounded-full bg-surface-container px-2.5 py-1 text-on-surface">Verificación: {label(v.verificationStatus)}</span>
              <span className="rounded-full bg-surface-container px-2.5 py-1 text-on-surface">Plan: {v.planType === "BUSINESS" ? "Business" : "Regular"}</span>
              <span className={`rounded-full px-2.5 py-1 ${v.isBlocked || v.status === "SUSPENDED" ? "bg-error/10 text-error" : "bg-[#0CAE53]/15 text-[#087A38]"}`}>
                {v.adminDeletionRequestedAt ? "Eliminación pendiente" : v.isBlocked ? "Bloqueada" : v.status === "SUSPENDED" ? "Suspendida" : "Activa"}
              </span>
              <span className="rounded-full bg-surface-container px-2.5 py-1 text-on-surface">Tienda creada el {fmt(v.createdAt)}</span>
            </div>

            <Section icon={User} title="Datos del responsable en el registro">
              {a ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field name="Nombre completo (documento)" value={a.fullName?.trim()} />
                  <Field name="Responsable de la tienda" value={a.ownerName?.trim()} />
                  <Field name="Tipo de documento" value={a.idDocumentType} />
                  <Field name="Número de documento" value={a.idNumber} />
                  <Field name="ID del propietario" value={a.ownerIdNumber} />
                  <Field name="ID fiscal de la empresa" value={a.companyTaxId} />
                  <Field name="Nombre de la empresa" value={a.companyName} />
                  <Field name="Dirección de la empresa" value={a.companyAddress} />
                  <Field name="País" value={a.registrationCountryName} />
                  <Field name="Provincia" value={a.legalProvinceName} />
                  <Field name="Municipio" value={a.legalMunicipalityName} />
                  <Field name="Descripción" value={a.description} />
                  <Field name="Documentos enviados" value={fmt(a.submittedAt)} />
                  <Field name="Revisado" value={a.reviewedAt ? `${fmt(a.reviewedAt)}${a.reviewedBy?.fullName ? ` por ${a.reviewedBy.fullName}` : ""}` : null} />
                  <Field name="Verificado" value={fmt(a.verifiedAt)} />
                  <Field name="Rechazado" value={fmt(a.rejectedAt)} />
                </dl>
              ) : (
                <Empty>Esta tienda todavía no envió documentos de verificación, así que no hay datos del responsable ni fotos.</Empty>
              )}
            </Section>

            {a && (
              <Section icon={FileText} title="Fotos y documentos subidos">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <PrivateDocument vendorId={vendorId} type="selfie" label="Foto del responsable" Icon={User} available={!!a.selfieUrl} endpoint={`/admin/verification-archive/${a.id}/file/selfie`} downloadable />
                  <PrivateDocument vendorId={vendorId} type="id" label="Documento (frente)" Icon={FileText} available={!!a.idPhotoFrontUrl} endpoint={`/admin/verification-archive/${a.id}/file/id`} downloadable />
                  <PrivateDocument vendorId={vendorId} type="idBack" label="Documento (reverso)" Icon={FileText} available={!!a.idPhotoBackUrl} endpoint={`/admin/verification-archive/${a.id}/file/idBack`} downloadable />
                  {a.selfieVideoUrl && <PrivateDocument vendorId={vendorId} type="video" label="Video de verificación" Icon={Video} available kind="video" endpoint={`/admin/verification-archive/${a.id}/file/video`} downloadable />}
                </div>
              </Section>
            )}

            <Section icon={User} title="Cuenta del dueño">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field name="Nombre" value={v.user?.fullName} />
                <Field name="Correo" value={v.user?.email} />
                <Field name="Teléfono" value={v.user?.phone} />
                <Field name="WhatsApp de la tienda" value={v.whatsapp} />
                <Field name="Último acceso" value={fmt(v.user?.lastLoginAt)} />
                <Field name="Cuenta creada" value={fmt(v.user?.createdAt)} />
              </dl>
            </Section>

            <Section icon={AlertTriangle} title={`Incumplimientos y reportes (${data.reports.length})`} tone={data.reports.length ? "danger" : undefined}>
              {data.reports.length === 0 ? (
                <Empty>Sin reportes ni incumplimientos registrados.</Empty>
              ) : (
                <ul className="space-y-2">
                  {data.reports.map((r) => (
                    <li key={r.id} className="rounded-xl border border-surface-container-high px-3.5 py-2.5 text-[13px]">
                      <p className="font-semibold text-on-surface">
                        {fmt(r.createdAt)} · {label(r.status)}
                        {r.product?.name ? ` · ${r.product.name}` : ""}
                      </p>
                      {r.message && <p className="mt-0.5 text-on-surface-variant">{r.message}</p>}
                      {r.resolutionNote && <p className="mt-0.5 text-on-surface-variant">Resolución: {r.resolutionNote}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section icon={StickyNote} title="Notas sobre la tienda">
              {notes.length === 0 ? (
                <Empty>No hay notas puestas a esta tienda.</Empty>
              ) : (
                <ul className="space-y-2">
                  {notes.map((n, i) => (
                    <li key={i} className="rounded-xl bg-surface-container px-3.5 py-2.5 text-[13px]">
                      <p className="text-[11.5px] font-semibold text-on-surface-variant">{n.from}</p>
                      <p className="text-on-surface">{n.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section icon={History} title="Récord de la tienda">
              {data.statusLog.length + data.verificationLog.length === 0 ? (
                <Empty>Todavía no hay cambios de estado registrados.</Empty>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {[...data.statusLog.map((s) => ({ ...s, kind: "Tienda" })), ...data.verificationLog.map((s) => ({ ...s, kind: "Verificación" }))]
                    .sort((x, y) => new Date(y.at) - new Date(x.at))
                    .slice(0, 20)
                    .map((s, i) => (
                      <li key={i} className="flex flex-wrap gap-x-2 border-b border-surface-container-high py-1.5 last:border-0">
                        <span className="w-[92px] flex-shrink-0 text-on-surface-variant">{fmt(s.at)}</span>
                        <span className="font-semibold text-on-surface">
                          {s.kind}: {label(s.fromStatus)} a {label(s.toStatus)}
                        </span>
                        {(s.byAdmin?.fullName || s.actor?.fullName) && <span className="text-on-surface-variant">por {s.byAdmin?.fullName ?? s.actor?.fullName}</span>}
                        {s.reason && <span className="w-full text-on-surface-variant sm:w-auto">({s.reason})</span>}
                      </li>
                    ))}
                </ul>
              )}
            </Section>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                to={`/admin/verificaciones?archivo=${vendorId}`}
                onClick={onClose}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface transition hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                Ver todo el archivo de verificación{data.archives.length > 1 ? ` (${data.archives.length} envíos)` : ""}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
