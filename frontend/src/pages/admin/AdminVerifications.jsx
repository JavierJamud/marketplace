import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { User, FileText, Receipt, Check, Bot, UserCheck, CreditCard, Landmark, Clock, Eye, AlertTriangle, Ban, Archive, X, Pencil, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { PrivateDocument } from "../../components/PrivateDocument.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";

// Bloque 64: fuente única de verdad — las pestañas agrupan Vendor.verificationStatus
// (PENDING_DOCS+IN_REVIEW comparten pestaña porque las 2 son "esperando que
// un admin decida sobre los documentos"; PAYMENT_FAILED+SUSPENDED comparten
// "problemas de cobro" porque las 2 implican que la tienda YA estuvo
// verificada y perdió el badge por el cobro recurrente, no por documentos).
const TABS = [
  { key: "PENDING_DOCS,IN_REVIEW", label: "Documentos pendientes" },
  { key: "PENDING_PAYMENT", label: "Pago pendiente" },
  { key: "PAYMENT_FAILED,SUSPENDED", label: "Problemas de cobro" },
  { key: "REJECTED", label: "Rechazadas" },
  { key: "VERIFIED", label: "Verificadas" },
];

const PAYMENT_METHOD_LABEL = { CARD: "Tarjeta", CUP_TRANSFER: "Transferencia CUP" };
const ID_DOCUMENT_TYPE_LABEL = { NATIONAL_ID: "Carné de identidad", PASSPORT: "Pasaporte", INTERNATIONAL_ID: "Carné de extranjería" };

const STATUS_BADGE = {
  PENDING_DOCS: { label: "Documentos enviados", className: "bg-secondary/10 text-secondary" },
  IN_REVIEW: { label: "En revisión", className: "bg-secondary/10 text-secondary" },
  PENDING_PAYMENT: { label: "Pago pendiente", className: "bg-tertiary-accent/10 text-tertiary-accent" },
  VERIFIED: { label: "Verificada", className: "bg-verified/10 text-verified-dark" },
  PAYMENT_FAILED: { label: "Pago fallido", className: "bg-error/10 text-error" },
  SUSPENDED: { label: "Suspendida", className: "bg-error/10 text-error" },
  REJECTED: { label: "Rechazada", className: "bg-error/10 text-error" },
};

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ARCHIVE_FIELDS = [
  { key: "companyName", label: "Nombre de la empresa" },
  { key: "ownerName", label: "Responsable" },
  { key: "ownerIdNumber", label: "ID del propietario" },
  { key: "companyTaxId", label: "ID fiscal de la empresa" },
  { key: "companyAddress", label: "Dirección" },
  { key: "fullName", label: "Nombre completo (KYC)" },
  { key: "idNumber", label: "Número de documento" },
  { key: "registrationCountryName", label: "País de registro" },
  { key: "legalProvinceName", label: "Provincia legal" },
  { key: "legalMunicipalityName", label: "Municipio legal" },
];

// Bloque 72 (pedido explícito): una rama = una verificación exitosa
// archivada para siempre. Editable (corrige datos mal cargados), pero solo
// eliminable si la tienda YA NO está verificada (gate real en el backend —
// acá solo se refleja para no ofrecer un botón que va a rechazar el server).
function ArchiveBranch({ archive, vendorId, canDelete, onDeleted }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(archive);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { companyName, ownerName, ownerIdNumber, companyTaxId, companyAddress, description, fullName, idNumber, registrationCountryName, legalProvinceName, legalMunicipalityName, notes } = form;
      return (
        await api.patch(`/admin/verification-archive/${archive.id}`, {
          companyName, ownerName, ownerIdNumber, companyTaxId, companyAddress, description,
          fullName, idNumber, registrationCountryName, legalProvinceName, legalMunicipalityName, notes,
        })
      ).data;
    },
    onSuccess: () => {
      toast.success("Rama actualizada.");
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["verification-archive", vendorId] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/admin/verification-archive/${archive.id}`)).data,
    onSuccess: () => {
      toast.success("Rama eliminada.");
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["verification-archive", vendorId] });
      onDeleted?.();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar.");
      setConfirmDelete(false);
    },
  });

  return (
    <div className="rounded-md border border-surface-container-high p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] font-bold text-on-surface">Archivada el {fmtDateTime(archive.archivedAt)}</div>
        <div className="flex gap-2">
          <button
            onClick={() => (editing ? save.mutate() : setEditing(true))}
            disabled={save.isPending}
            className="flex items-center gap-1 rounded-md border border-outline-variant px-2.5 py-1 text-[11.5px] font-semibold text-on-surface-variant disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" /> {editing ? (save.isPending ? "Guardando..." : "Guardar") : "Editar"}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={!canDelete}
            title={!canDelete ? "No se puede eliminar mientras la tienda siga verificada" : undefined}
            className="flex items-center gap-1 rounded-md border border-error/30 px-2.5 py-1 text-[11.5px] font-semibold text-error disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Trash2 className="h-3 w-3" /> Eliminar
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-2">
        {ARCHIVE_FIELDS.map((f) =>
          editing ? (
            <Input key={f.key} label={f.label} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
          ) : (
            <div key={f.key}>
              {f.label}: <span className="font-semibold text-on-surface">{archive[f.key] ?? "—"}</span>
            </div>
          )
        )}
      </div>

      {editing ? (
        <div className="mb-3">
          <span className="mb-1 block text-label-md text-on-surface-variant">Descripción del negocio</span>
          <textarea
            rows={2}
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded border border-outline-variant bg-surface-container-lowest p-2.5 text-[12.5px] outline-none focus:border-tertiary-accent"
          />
          <span className="mb-1 mt-2 block text-label-md text-on-surface-variant">Notas del admin</span>
          <textarea
            rows={2}
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded border border-outline-variant bg-surface-container-lowest p-2.5 text-[12.5px] outline-none focus:border-tertiary-accent"
          />
        </div>
      ) : (
        <>
          {archive.description && <p className="mb-2 text-[12px] text-on-surface-variant">Descripción: {archive.description}</p>}
          {archive.notes && <p className="mb-2 text-[12px] italic text-outline">Notas: {archive.notes}</p>}
        </>
      )}

      <div className="mb-3 text-[11.5px] text-outline">
        Enviado: {fmtDateTime(archive.submittedAt)} · Revisado: {fmtDateTime(archive.reviewedAt)}
        {archive.reviewedBy && ` por ${archive.reviewedBy.fullName ?? archive.reviewedBy.email}`}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PrivateDocument
          vendorId={vendorId}
          type="selfie"
          label="Foto del responsable"
          Icon={User}
          available={!!archive.selfieUrl}
          endpoint={`/admin/verification-archive/${archive.id}/file/selfie`}
          downloadable
        />
        <PrivateDocument
          vendorId={vendorId}
          type="id"
          label="Documento (frente)"
          Icon={FileText}
          available={!!archive.idPhotoFrontUrl}
          endpoint={`/admin/verification-archive/${archive.id}/file/id`}
          downloadable
        />
        {archive.idPhotoBackUrl && (
          <PrivateDocument
            vendorId={vendorId}
            type="idBack"
            label="Documento (dorso)"
            Icon={FileText}
            available
            endpoint={`/admin/verification-archive/${archive.id}/file/idBack`}
            downloadable
          />
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="¿Eliminar esta rama del archivo?"
        message="Se borra por completo, para siempre — no se puede deshacer."
        confirmLabel={remove.isPending ? "Eliminando..." : "Sí, eliminar"}
        danger
        confirmDisabled={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

// Bloque 72 (pedido explícito): "poder acceder... y verla todo archivado
// correctamente" — modal con TODAS las ramas de verificación exitosa de
// esta tienda, la más reciente primero. Se puede abrir desde cualquier
// pestaña (una tienda hoy suspendida/rechazada puede tener ramas viejas de
// cuando SÍ estuvo verificada) — el gate de borrado real vive en el
// backend, `canDelete` acá solo evita ofrecer un botón que el server
// rechazaría.
function VerificationArchiveModal({ vendor, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["verification-archive", vendor.vendorId],
    queryFn: async () => (await api.get(`/admin/vendors/${vendor.vendorId}/verification-archive`)).data.archives,
  });

  const canDelete = vendor.verificationStatus !== "VERIFIED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-[720px] overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-title-lg font-bold text-on-surface">
            <Archive className="h-5 w-5 text-tertiary-accent" /> Archivo de verificación — {vendor.companyName}
          </h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          {canDelete
            ? "La tienda sigue verificada — ninguna rama se puede eliminar mientras tanto."
            : "La tienda ya no está verificada — se puede eliminar una rama a mano si hace falta (nunca automático)."}
        </p>

        {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && !data?.length && (
          <p className="text-body-md text-on-surface-variant">Esta tienda todavía no tiene ninguna verificación archivada.</p>
        )}

        <div className="flex flex-col gap-3.5">
          {data?.map((archive) => (
            <ArchiveBranch key={archive.id} archive={archive} vendorId={vendor.vendorId} canDelete={canDelete} />
          ))}
        </div>

        <Button variant="outline" className="mt-5 w-full" onClick={onClose}>Cerrar</Button>
      </div>
    </div>
  );
}

export default function AdminVerifications() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(TABS[0].key);
  const [rejectTarget, setRejectTarget] = useState(null); // id de la verificación a rechazar
  const [rejectReason, setRejectReason] = useState("");
  // Bloque 72 (pedido explícito): { vendorId, companyName, verificationStatus }
  // de la tienda cuyo archivo de documentación se está viendo, o null.
  const [archiveVendor, setArchiveVendor] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-verifications", tab],
    queryFn: async () => (await api.get("/admin/verifications", { params: { status: tab } })).data.verifications,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-verifications"] });

  const decide = useMutation({
    mutationFn: async ({ id, decision, notes }) => (await api.patch(`/admin/verifications/${id}`, { decision, notes })).data,
    onSuccess: () => {
      toast.success("Solicitud actualizada.");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo procesar la solicitud."),
  });

  const startReview = useMutation({
    mutationFn: async (id) => (await api.post(`/admin/verifications/${id}/start-review`)).data,
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo abrir la solicitud."),
  });

  const confirmCup = useMutation({
    mutationFn: async (id) => (await api.patch(`/admin/verifications/${id}/confirm-payment`)).data,
    onSuccess: () => {
      toast.success("Pago confirmado — tienda verificada.");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo confirmar el pago."),
  });

  return (
    <div className="max-w-[900px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Verificaciones y cobro de suscripción</h1>
      <p className="mb-2 text-[13.5px] text-outline">
        Fase 1: revisa la identidad del responsable y aprueba o rechaza los documentos. Fase 2: resuelve el cobro de la
        suscripción para activar el badge. El cobro es recurrente — una tienda ya verificada puede volver acá si el pago falla.
      </p>
      <div className="mb-4 rounded-md border border-error/20 bg-error/[0.06] px-3.5 py-2.5 text-[12px] text-on-error-container">
        🔒 Datos sensibles: no compartas ni descargues estas imágenes fuera del panel.
      </div>

      <div className="mb-[22px] flex flex-wrap gap-1.5 border-b border-surface-container-high">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-[13.5px] font-bold transition-colors ${
              tab === t.key ? "border-b-2 border-secondary text-on-surface" : "text-outline hover:text-on-surface"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && data?.length === 0 && <p className="text-body-md text-on-surface-variant">No hay solicitudes en esta pestaña.</p>}

      <div className="flex flex-col gap-4">
        {data?.map((v) => {
          const badge = STATUS_BADGE[v.verificationStatus];
          const autoConfirmed = v.verificationStatus === "VERIFIED" && v.paymentMethod === "CARD" && !v.paymentConfirmedById;
          const docsComplete = !!(v.selfieUrl && v.idPhotoFrontUrl);
          // Bloque 66 (bug real reportado en vivo): antes esto incluía
          // PENDING_DOCS también, así que los documentos y los botones
          // Aprobar/Rechazar YA se veían ahí mismo — clickear "Abrir para
          // revisar" (que solo cambia el estado a IN_REVIEW) no producía
          // ningún cambio visible. Ahora PENDING_DOCS muestra SOLO el botón
          // de abrir; documentos + acciones recién aparecen en IN_REVIEW.
          const isPendingOpen = v.verificationStatus === "PENDING_DOCS";
          const showDocsReview = v.verificationStatus === "IN_REVIEW";
          const showLegalData = showDocsReview || v.verificationStatus === "REJECTED";
          const showCupConfirm = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(v.verificationStatus) && v.paymentMethod === "CUP_TRANSFER";
          const showCardInfo = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(v.verificationStatus) && v.paymentMethod === "CARD";
          const noMethodYet = v.verificationStatus === "PENDING_PAYMENT" && !v.paymentMethod;

          return (
            <div key={v.id} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-[11px] font-display text-base font-bold text-white"
                    style={{ background: v.vendor.color ?? "#232F3E" }}
                  >
                    {v.vendor.companyName[0]}
                  </div>
                  <div>
                    <div className="text-[15px] font-bold text-on-surface">{v.vendor.companyName}</div>
                    <div className="text-[12.5px] text-outline">
                      {v.fullName ?? "Responsable sin nombre registrado"} · {v.vendor.locations?.[0]?.province?.name ?? "Cuba"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {v.verificationStatus === "VERIFIED" && (
                    <span
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-bold ${
                        autoConfirmed ? "bg-tertiary-accent/10 text-tertiary-accent" : "bg-verified/10 text-verified-dark"
                      }`}
                    >
                      {autoConfirmed ? <Bot className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      {autoConfirmed ? "Pago automático" : "Confirmado a mano"}
                    </span>
                  )}
                  <span className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold ${badge?.className ?? "bg-secondary/10 text-secondary"}`}>
                    {badge?.label ?? v.verificationStatus}
                  </span>
                  <button
                    onClick={() => setArchiveVendor({ vendorId: v.vendorId, companyName: v.vendor.companyName, verificationStatus: v.verificationStatus })}
                    title="Ver archivo de documentación de verificación"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant text-on-surface-variant hover:bg-surface-container"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {v.verificationStatus === "REJECTED" && v.notes && (
                <p className="mb-4 rounded-md bg-surface-container px-3 py-2 text-[12px] text-outline">Motivo: {v.notes}</p>
              )}

              {isPendingOpen && (
                <button
                  onClick={() => startReview.mutate(v.id)}
                  disabled={startReview.isPending}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-outline-variant py-2.5 text-[13px] font-semibold text-on-surface-variant disabled:opacity-50"
                >
                  <Eye className="h-4 w-4" /> Abrir para revisar
                </button>
              )}

              {showLegalData && (
                <div className="mb-4 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-md bg-surface-container px-3.5 py-3 text-[12px] text-on-surface-variant sm:grid-cols-2">
                  <div>Documento: <span className="font-semibold text-on-surface">{ID_DOCUMENT_TYPE_LABEL[v.idDocumentType] ?? "—"}</span></div>
                  <div>ID fiscal / propietario: <span className="font-semibold text-on-surface">{v.vendor.companyTaxId ?? v.vendor.ownerIdNumber ?? "—"}</span></div>
                  <div>País de registro: <span className="font-semibold text-on-surface">{v.vendor.registrationCountry ?? "—"}</span></div>
                  <div>Provincia/municipio legal: <span className="font-semibold text-on-surface">
                    {[v.vendor.legalProvince, v.vendor.legalMunicipality].filter(Boolean).join(" / ") || "—"}
                  </span></div>
                  <div className="sm:col-span-2">Dirección: <span className="font-semibold text-on-surface">{v.vendor.companyAddress ?? "—"}</span></div>
                  <div className="sm:col-span-2">Descripción del negocio: <span className="font-semibold text-on-surface">{v.vendor.description ?? "—"}</span></div>
                </div>
              )}

              {(showDocsReview || v.verificationStatus === "REJECTED") && (
                <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <PrivateDocument vendorId={v.vendorId} type="selfie" label="Foto del responsable" Icon={User} available={!!v.selfieUrl} />
                  <PrivateDocument vendorId={v.vendorId} type="id" label="Documento de identidad" Icon={FileText} available={!!v.idPhotoFrontUrl} />
                </div>
              )}

              {showDocsReview && (
                <div className="flex gap-2.5">
                  <button
                    onClick={() => decide.mutate({ id: v.id, decision: "approve" })}
                    disabled={decide.isPending || !docsComplete}
                    title={!docsComplete ? "Faltan documentos — no se puede aprobar" : undefined}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-verified py-3 text-[14px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Check className="h-4 w-4" strokeWidth={3} /> Aprobar documentos
                  </button>
                  <button
                    onClick={() => {
                      setRejectTarget(v.id);
                      setRejectReason("");
                    }}
                    disabled={decide.isPending}
                    className="flex-1 rounded-md border border-error py-3 text-[14px] font-bold text-error disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                </div>
              )}

              {noMethodYet && (
                <p className="rounded-md border border-surface-container-high p-4 text-[12.5px] text-outline">
                  Esperando que el vendedor elija un método de pago desde su panel.
                </p>
              )}

              {showCardInfo && (
                <div className="rounded-md border border-surface-container-high p-4">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                    <CreditCard className="h-4 w-4 text-tertiary-accent" /> Pago con tarjeta (Stripe)
                  </div>
                  {v.verificationStatus === "PAYMENT_FAILED" && (
                    <p className="flex items-center gap-1.5 text-[12.5px] text-outline">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-error" /> Stripe está reintentando el cobro automáticamente.
                    </p>
                  )}
                  {v.verificationStatus === "SUSPENDED" && (
                    <p className="flex items-center gap-1.5 text-[12.5px] text-outline">
                      <Ban className="h-3.5 w-3.5 flex-shrink-0 text-error" /> La suscripción de Stripe se canceló — esperando que el
                      vendedor inicie una nueva desde su panel.
                    </p>
                  )}
                  {v.verificationStatus === "PENDING_PAYMENT" && (
                    <p className="flex items-center gap-1.5 text-[12.5px] text-outline">
                      <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                      {v.stripeCheckoutUrl
                        ? v.stripeCheckoutExpiresAt && new Date(v.stripeCheckoutExpiresAt) < new Date()
                          ? "El link que se le generó ya venció — el vendedor puede pedir uno nuevo desde su panel."
                          : "Esperando que el vendedor complete el pago en Stripe."
                        : "Todavía no generó su link de pago desde su panel."}
                    </p>
                  )}
                  <p className="mt-2 text-[11.5px] text-outline">La activación es 100% automática — no hay nada para hacer acá.</p>
                </div>
              )}

              {showCupConfirm && (
                <div className="rounded-md border border-surface-container-high p-4">
                  <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                    <Landmark className="h-4 w-4 text-tertiary-accent" /> Transferencia CUP
                  </div>
                  {!v.paymentClaimedAt ? (
                    <p className="flex items-center gap-1.5 text-[12.5px] text-outline">
                      <Clock className="h-3.5 w-3.5 flex-shrink-0" /> Esperando que el vendedor avise "Ya pagué" desde su panel.
                    </p>
                  ) : (
                    <>
                      {/* Bloque 66: el comprobante quedó opcional — puede no
                          haber ninguno, esto solo se muestra si adjuntó uno. */}
                      {v.paymentProofUrl && (
                        <div className="mb-3.5 max-w-[220px]">
                          <PrivateDocument vendorId={v.vendorId} type="proof" label="Comprobante" Icon={Receipt} available />
                        </div>
                      )}
                      <button
                        onClick={() => confirmCup.mutate(v.id)}
                        disabled={confirmCup.isPending}
                        className="flex items-center gap-1.5 rounded-md bg-verified px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" strokeWidth={3} />
                        {v.verificationStatus === "VERIFIED" ? "Confirmar pago recibido" : "Confirmar pago recibido y activar"}
                      </button>
                    </>
                  )}
                </div>
              )}

              {v.verificationStatus === "VERIFIED" && (
                <p className="text-[12px] text-outline">
                  {v.paymentMethod && `Paga por ${PAYMENT_METHOD_LABEL[v.paymentMethod]}. `}
                  {v.nextPaymentDueDate && `Próximo vencimiento: ${fmtDate(v.nextPaymentDueDate)}.`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={!!rejectTarget}
        title="¿Rechazar esta solicitud de verificación?"
        message="Se le avisa al vendedor por correo con el motivo que escribas abajo. Va a poder volver a enviar sus documentos, pero esta revisión queda marcada como rechazada."
        confirmLabel={decide.isPending ? "Rechazando..." : "Sí, rechazar"}
        danger
        confirmDisabled={!rejectReason.trim() || decide.isPending}
        onConfirm={() =>
          decide.mutate(
            { id: rejectTarget, decision: "reject", notes: rejectReason.trim() },
            { onSuccess: () => setRejectTarget(null) }
          )
        }
        onCancel={() => setRejectTarget(null)}
      >
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Motivo del rechazo (obligatorio, se envía al vendedor)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>

      {archiveVendor && <VerificationArchiveModal vendor={archiveVendor} onClose={() => setArchiveVendor(null)} />}
    </div>
  );
}
