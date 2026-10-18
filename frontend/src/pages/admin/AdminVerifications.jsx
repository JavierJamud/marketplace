import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { User, FileText, Receipt, Check, Bot, UserCheck, CreditCard, Landmark, Clock, Eye, Archive, X, Pencil, Trash2, RotateCcw, ShieldCheck, HandCoins, ChevronDown } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { PrivateDocument } from "../../components/PrivateDocument.jsx";
import { imgUrl } from "../../lib/imgUrl.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { NotifyVendorCheckbox } from "../../components/admin/NotifyVendorCheckbox.jsx";
import { useNotifyChoices } from "../../lib/notifyVendor.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";

// Bloque 64: fuente única de verdad — las pestañas agrupan Vendor.verificationStatus
// (PENDING_DOCS+IN_REVIEW comparten pestaña porque las 2 son "esperando que
// un admin decida sobre los documentos"; PAYMENT_FAILED+SUSPENDED comparten
// "problemas de cobro" porque las 2 implican que la tienda YA estuvo
// verificada y perdió el badge por el cobro recurrente, no por documentos).
// "Todas" es la vista de entrada: se cargan todas las solicitudes una sola vez y cada pestaña filtra esa misma lista (así una
// tienda nunca sale en dos pestañas y los números cuadran). `id` es el que va en la URL (?tab=pago) para que los avisos
// abran la pestaña exacta; `action` marca las pestañas con algo por hacer (su número se resalta).
const TABS = [
  { key: "ALL", id: "todas", label: "Todas" },
  { key: "PENDING_DOCS,IN_REVIEW", id: "docs", label: "Documentos pendientes", action: true },
  { key: "PENDING_PAYMENT", id: "pago", label: "Pago pendiente", action: true },
  { key: "PAYMENT_FAILED,SUSPENDED", id: "cobro", label: "Problemas de cobro", action: true },
  { key: "REJECTED", id: "rechazadas", label: "Rechazadas" },
  { key: "VERIFIED", id: "verificadas", label: "Verificadas" },
  // Bloque 153 (pedido explícito — "el admin debe aprobar los demás meses
  // pagos" / "se debe enviar la solicitud al admin"): 2 pestañas especiales
  // — no son un `verificationStatus`, así que se manejan aparte (otro
  // endpoint, otra lista) en vez de forzarlas en el mismo listado.
  { key: "RENEWALS", id: "renovaciones", label: "Renovaciones", action: true },
  { key: "CHANGE_REQUESTS", id: "cambios", label: "Cambios de datos", action: true },
];

const PAYMENT_METHOD_LABEL = { CARD: "Tarjeta", CUP_TRANSFER: "Transferencia CUP", MANUAL: "pago registrado por el equipo" };
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

// Bloque 72 (pedido explícito): una rama = un ciclo de verificación
// archivado para siempre, desde que se envían los documentos (Bloque 150).
// Editable (corrige datos mal cargados), pero solo eliminable si NO es la
// rama del ciclo VIGENTE de la tienda (gate real en el backend — acá solo
// se refleja para no ofrecer un botón que va a rechazar el server).
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
            className="flex items-center gap-1 rounded-full border border-outline-variant px-2.5 py-1 text-[11.5px] font-semibold text-on-surface-variant disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" /> {editing ? (save.isPending ? "Guardando..." : "Guardar") : "Editar"}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={!canDelete}
            title={!canDelete ? "No se puede eliminar: es la rama del ciclo vigente de la tienda" : undefined}
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

      {/* Bloque 150 (pedido explícito — "debe quedar archivado todo el
          historial de todo lo que la tienda ha enviado, y toda actividad
          con hora y fecha"): antes esta rama solo guardaba los documentos de
          identidad — ahora también el ciclo de pago completo (método,
          meses, quién pagó, cuándo se reclamó/confirmó, y cómo terminó). */}
      {archive.paymentMethod && (
        <div className="mb-3 rounded-md bg-surface-container px-3.5 py-2.5 text-[11.5px] text-outline">
          <div className="mb-1 font-semibold text-on-surface">
            Pago: {PAYMENT_METHOD_LABEL[archive.paymentMethod] ?? archive.paymentMethod}
            {archive.paymentMonths && ` · ${archive.paymentMonths} ${archive.paymentMonths === 1 ? "mes" : "meses"}`}
            {archive.paymentAmount != null && ` · declaró ${Number(archive.paymentAmount).toLocaleString("es-CU")} ${archive.paymentCurrency ?? ""}`}
          </div>
          {archive.payerName && <div>Pagó: {archive.payerName}</div>}
          {archive.paymentClaimedAt && <div>Reclamado ("Ya pagué"): {fmtDateTime(archive.paymentClaimedAt)}</div>}
          {archive.stripePaidAt && <div>Stripe confirmó el cobro: {fmtDateTime(archive.stripePaidAt)}</div>}
          {archive.paymentConfirmedAt && <div>Confirmado por el admin: {fmtDateTime(archive.paymentConfirmedAt)}</div>}
          {archive.verifiedAt && <div className="font-semibold text-verified-dark">Verificada: {fmtDateTime(archive.verifiedAt)}</div>}
          {archive.rejectedAt && <div className="font-semibold text-error">Rechazada: {fmtDateTime(archive.rejectedAt)}</div>}
        </div>
      )}

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
        {archive.selfieVideoUrl && (
          <PrivateDocument
            vendorId={vendorId}
            type="video"
            kind="video"
            label="Video (giro de cabeza)"
            Icon={User}
            available
            endpoint={`/admin/verification-archive/${archive.id}/file/video`}
            downloadable
          />
        )}
        {archive.paymentProofUrl && (
          <PrivateDocument
            vendorId={vendorId}
            type="proof"
            label="Comprobante de pago"
            Icon={Receipt}
            available
            endpoint={`/admin/verification-archive/${archive.id}/file/proof`}
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
// correctamente" — modal con TODAS las ramas de verificación de esta
// tienda, la más reciente primero. Bloque 150 (pedido explícito — "se pueda
// consultar desde que la tienda está en revisión... y siempre se pueda
// consultar"): ahora incluye ramas de ciclos EN CURSO o rechazados, no solo
// verificaciones exitosas — se puede abrir desde cualquier pestaña. El gate
// de borrado real vive en el backend (`currentArchiveId`, la rama del ciclo
// vigente nunca se puede borrar) — acá solo se refleja para no ofrecer un
// botón que el server va a rechazar.
function VerificationArchiveModal({ vendor, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["verification-archive", vendor.vendorId],
    queryFn: async () => (await api.get(`/admin/vendors/${vendor.vendorId}/verification-archive`)).data,
  });
  const archives = data?.archives;
  const currentArchiveId = data?.currentArchiveId;

  return (
    // Bloque 196: cada rama tiene su propio "Editar"/"Guardar" inmediato
    // (ver ArchiveBranch) — este contenedor en sí no tiene un borrador
    // propio que perder, así que cierra directo al hacer clic afuera.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[85vh] w-full max-w-[720px] overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-title-lg font-bold text-on-surface">
            <Archive className="h-5 w-5 text-tertiary-accent" /> Archivo de verificación: {vendor.companyName || archives?.[0]?.companyName || "tienda"}
          </h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Cada rama es un ciclo completo, desde que la tienda envió sus documentos. La rama del ciclo vigente (en curso, o el más
          reciente ya cerrado) nunca se puede eliminar; las anteriores sí, a mano.
        </p>

        {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && !archives?.length && (
          <p className="text-body-md text-on-surface-variant">Esta tienda todavía no tiene ninguna verificación archivada.</p>
        )}

        <div className="flex flex-col gap-3.5">
          {archives?.map((archive) => (
            <ArchiveBranch key={archive.id} archive={archive} vendorId={vendor.vendorId} canDelete={archive.id !== currentArchiveId} />
          ))}
        </div>

        <Button variant="outline" className="mt-5 w-full" onClick={onClose}>Cerrar</Button>
      </div>
    </div>
  );
}

// Bloque 153 (pedido explícito — "el admin debe aprobar los demás meses
// pagos"): renovaciones (SubscriptionPayment) reclamadas y esperando
// confirmación — mismo patrón que la pestaña "Pago pendiente" de arriba,
// pero para una tienda que YA está VERIFIED y pagó meses extra.
function RenewalsList() {
  const queryClient = useQueryClient();
  const notify = useNotifyChoices();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-pending-renewals"],
    queryFn: async () => (await api.get("/admin/subscription-payments/pending")).data.payments,
    refetchOnMount: "always",
  });

  const confirm = useMutation({
    mutationFn: async (id) => (await api.patch(`/admin/subscription-payments/${id}/confirm`, {}, notify.config(id))).data,
    onSuccess: () => {
      toast.success("Renovación confirmada.");
      queryClient.invalidateQueries({ queryKey: ["admin-pending-renewals"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo confirmar la renovación."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;
  if (!data?.length) return <p className="text-body-md text-on-surface-variant">No hay renovaciones esperando confirmación.</p>;

  return (
    <div className="flex flex-col gap-4">
      {data.map((p) => (
        <div key={p.id} className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-[22px]">
          <div className="mb-3 flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-[11px] font-display text-base font-bold text-white"
              style={{ background: p.vendor.color ?? "#232F3E" }}
            >
              {p.vendor.companyName[0]}
            </div>
            <div>
              <div className="text-[15px] font-bold text-on-surface">{p.vendor.companyName}</div>
              <div className="text-[11.5px] text-outline/80">{p.vendor.email ?? "sin correo"} · {p.vendor.whatsapp ?? "sin WhatsApp"}</div>
            </div>
          </div>
          <div className="mb-3 rounded-md bg-surface-container px-3.5 py-3 text-[12.5px] text-on-surface-variant">
            <div>
              {p.paymentMethod === "CARD" ? "Tarjeta" : "Transferencia CUP"} · {p.months} {p.months === 1 ? "mes" : "meses"} ·{" "}
              declaró {p.amount != null ? `${Number(p.amount).toLocaleString("es-CU")} ${p.currency}` : "—"}
            </div>
            <div className="mt-1">Pagó: {p.payerName ?? "—"}</div>
            {p.paymentMethod === "CUP_TRANSFER" ? (
              <div className="mt-1">Cuenta: {p.payerAccountNumber ?? "—"} · Teléfono: {p.payerPhone ?? "—"}</div>
            ) : (
              p.proofUnavailable && (
                <div className="mt-1">
                  Sin captura — teléfono {p.payerPhone ?? "—"}, dirección {p.payerAddress ?? "—"}, país {p.payerCountry ?? "—"}
                  {p.payerCardLast4 && <>, tarjeta terminada en {p.payerCardLast4}</>}
                </div>
              )
            )}
            <div className="mt-1">Reclamó "Ya pagué": {fmtDateTime(p.claimedAt)}</div>
          </div>
          {p.proofUrl && (
            <div className="mb-3.5 max-w-[220px]">
              <PrivateDocument
                vendorId={p.vendorId}
                type="proof"
                label="Comprobante"
                Icon={Receipt}
                available
                endpoint={`/verification/subscription-payment/${p.id}/file`}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              onClick={() => confirm.mutate(p.id)}
              disabled={confirm.isPending}
              className="flex items-center gap-1.5 rounded-md bg-verified px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              <Check className="h-4 w-4" strokeWidth={3} /> Confirmar renovación
            </button>
            <NotifyVendorCheckbox checked={notify.isOn(p.id)} onChange={(on) => notify.set(p.id, on)} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Bloque 153 (pedido explícito — "si se desea cambiar el nombre o algo o
// responsable se debe enviar la solicitud al admin para prevenir
// fraudes"): solicitudes de cambio de identidad de tiendas ya verificadas.
function ChangeRequestsList() {
  const queryClient = useQueryClient();
  const notify = useNotifyChoices();
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-change-requests"],
    queryFn: async () => (await api.get("/admin/change-requests")).data.requests,
    refetchOnMount: "always",
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision, notes }) => (await api.patch(`/admin/change-requests/${id}`, { decision, notes }, notify.config(id))).data,
    onSuccess: () => {
      toast.success("Solicitud resuelta.");
      queryClient.invalidateQueries({ queryKey: ["admin-change-requests"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo procesar la solicitud."),
  });

  const CHANGE_FIELDS = [
    { key: "companyName", label: "Nombre de la tienda" },
    { key: "ownerName", label: "Responsable" },
    { key: "ownerIdNumber", label: "ID del responsable" },
    { key: "companyAddress", label: "Dirección" },
  ];

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;
  if (!data?.length) return <p className="text-body-md text-on-surface-variant">No hay solicitudes de cambio esperando revisión.</p>;

  return (
    <div className="flex flex-col gap-4">
      {data.map((r) => (
        <div key={r.id} className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-[22px]">
          <div className="mb-3 flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-[11px] font-display text-base font-bold text-white"
              style={{ background: r.vendor.color ?? "#232F3E" }}
            >
              {r.vendor.companyName[0]}
            </div>
            <div>
              <div className="text-[15px] font-bold text-on-surface">{r.vendor.companyName}</div>
              <div className="text-[11.5px] text-outline/80">{r.vendor.email ?? "sin correo"} · {r.vendor.whatsapp ?? "sin WhatsApp"}</div>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-1 gap-1.5 rounded-md bg-surface-container px-3.5 py-3 text-[12.5px] text-on-surface-variant sm:grid-cols-2">
            {CHANGE_FIELDS.filter((f) => r[f.key]).map((f) => (
              <div key={f.key}>
                {f.label}: <span className="font-semibold text-on-surface">{r[f.key]}</span>
              </div>
            ))}
            {r.reason && <div className="sm:col-span-2">Motivo: {r.reason}</div>}
          </div>
          {(r.newOwnerSelfieUrl || r.newOwnerIdPhotoUrl) && (
            <div className="mb-3.5 grid grid-cols-2 gap-3 sm:w-[300px]">
              {r.newOwnerSelfieUrl && (
                <PrivateDocument
                  vendorId={r.vendorId}
                  type="selfie"
                  label="Nuevo responsable"
                  Icon={User}
                  available
                  endpoint={`/vendors/change-request/${r.id}/file/selfie`}
                />
              )}
              {r.newOwnerIdPhotoUrl && (
                <PrivateDocument
                  vendorId={r.vendorId}
                  type="id"
                  label="Su identificación"
                  Icon={FileText}
                  available
                  endpoint={`/vendors/change-request/${r.id}/file/id`}
                />
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => decide.mutate({ id: r.id, decision: "approve" })}
              disabled={decide.isPending}
              className="flex items-center gap-1.5 rounded-md bg-verified px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              <Check className="h-4 w-4" strokeWidth={3} /> Aprobar y aplicar
            </button>
            <button
              onClick={() => {
                setRejectTarget(r.id);
                setRejectReason("");
              }}
              disabled={decide.isPending}
              className="rounded-md border border-error px-4 py-2.5 text-[13px] font-bold text-error disabled:opacity-50"
            >
              Rechazar
            </button>
            <NotifyVendorCheckbox checked={notify.isOn(r.id)} onChange={(on) => notify.set(r.id, on)} />
          </div>
        </div>
      ))}

      <ConfirmModal
        open={!!rejectTarget}
        title="¿Rechazar esta solicitud de cambio?"
        message="Se le avisa a la tienda por correo con el motivo que escribas abajo — sus datos actuales no cambian."
        confirmLabel={decide.isPending ? "Rechazando..." : "Sí, rechazar"}
        danger
        confirmDisabled={!rejectReason.trim() || decide.isPending}
        onConfirm={() =>
          decide.mutate({ id: rejectTarget, decision: "reject", notes: rejectReason.trim() }, { onSuccess: () => setRejectTarget(null) })
        }
        onCancel={() => setRejectTarget(null)}
      >
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Motivo del rechazo (obligatorio, se envía a la tienda)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}

export default function AdminVerifications() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === searchParams.get("tab")) ?? TABS[0]).key;
  const setTab = (key) => {
    const next = new URLSearchParams(searchParams);
    const id = TABS.find((t) => t.key === key)?.id;
    if (id && id !== "todas") next.set("tab", id);
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  };
  const [search, setSearch] = useState("");
  const [rejectTarget, setRejectTarget] = useState(null); // id de la verificación a rechazar
  const [rejectReason, setRejectReason] = useState("");
  // Bloque 72 (pedido explícito): { vendorId, companyName, verificationStatus }
  // de la tienda cuyo archivo de documentación se está viendo, o null.
  const [archiveVendor, setArchiveVendor] = useState(null);
  // Bloque 276: el asistente de negocio enlaza al perfil archivado de una tienda con
  // /admin/verificaciones?archivo=<tienda>; al llegar con ese parámetro se abre el archivo.
  const archiveParam = searchParams.get("archivo");
  useEffect(() => {
    if (archiveParam) setArchiveVendor({ vendorId: archiveParam, companyName: "", verificationStatus: null });
  }, [archiveParam]);

  // Bloque 144: mismo criterio que ["my-verification"]/["my-vendor"] del
  // lado del vendedor — el admin necesita ver el estado REAL de cada
  // solicitud, nunca uno de hasta 5 minutos de viejo (Bloque 136).
  // Bloque 153: "Renovaciones" y "Cambios de datos" son pestañas especiales
  // — no filtran por `verificationStatus`, así que esta consulta se apaga
  // en esos 2 casos (cada una trae su propia lista, ver RenewalsList/
  // ChangeRequestsList más abajo).
  const isSpecialTab = tab === "RENEWALS" || tab === "CHANGE_REQUESTS";
  const { data: all, isLoading } = useQuery({
    queryKey: ["admin-verifications", "ALL"],
    queryFn: async () => (await api.get("/admin/verifications", { params: { status: "ALL" } })).data.verifications,
    refetchOnMount: "always",
  });
  // Renovaciones y cambios de datos no son un estado de la tienda: sus números vienen del contador de secciones.
  const { data: sectionCounts } = useQuery({
    queryKey: ["admin-section-counts"],
    queryFn: async () => (await api.get("/admin/section-counts")).data,
    refetchInterval: 30000,
  });
  const inTab = (t, v) => t.key === "ALL" || t.key.split(",").includes(v.verificationStatus);
  const tabCount = (t) =>
    t.key === "RENEWALS" ? sectionCounts?.verificaciones?.tabs?.renovaciones ?? 0 : t.key === "CHANGE_REQUESTS" ? sectionCounts?.verificaciones?.tabs?.cambios ?? 0 : (all ?? []).filter((v) => inTab(t, v)).length;
  const q = search.trim().toLowerCase();
  const currentTab = TABS.find((t) => t.key === tab);
  const data = (all ?? []).filter(
    (v) => inTab(currentTab, v) && (!q || [v.vendor?.companyName, v.vendor?.ownerName, v.fullName, v.vendor?.user?.email, v.vendor?.email, v.vendor?.whatsapp].some((x) => String(x ?? "").toLowerCase().includes(q)))
  );

  // Bloque 150: precios por mes (CUP/USD) — solo para mostrar el monto
  // ESPERADO junto al declarado por el vendedor, nunca se usan para validar
  // nada acá (esa cuenta la hace el admin a ojo antes de confirmar).
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const cupPricePerMonth = settings?.cupSubscriptionPriceCup ?? 2500;
  const cardPricePerMonthUsd = settings?.cardSubscriptionPriceUsd ?? 25;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-verifications"] });
    queryClient.invalidateQueries({ queryKey: ["admin-section-counts"] });
  };
  const notify = useNotifyChoices();

  const decide = useMutation({
    mutationFn: async ({ id, decision, notes }) => (await api.patch(`/admin/verifications/${id}`, { decision, notes }, notify.config(id))).data,
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

  // Bloque 150: generalizado — antes solo CUP_TRANSFER (confirmCup), ahora
  // confirma cualquiera de los 2 métodos (mismo endpoint, el backend ya
  // acepta ambos — ver confirmSubscriptionPayment en admin.controller.js).
  const confirmPayment = useMutation({
    mutationFn: async (id) => (await api.patch(`/admin/verifications/${id}/confirm-payment`, {}, notify.config(id))).data,
    onSuccess: () => {
      toast.success("Pago confirmado — tienda verificada.");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo confirmar el pago."),
  });

  const [manualTarget, setManualTarget] = useState(null); // solicitud a la que se le registra un pago a mano
  const manualPayment = useMutation({
    mutationFn: async ({ id, payload }) => (await api.post(`/admin/verifications/${id}/manual-payment`, payload, notify.config(id))).data,
    onSuccess: (d) => {
      toast.success("Pago registrado", `La tienda queda verificada con Premium hasta el ${fmtDate(d.periodEnd)}.`);
      setManualTarget(null);
      invalidate();
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo registrar el pago.");
    },
  });

  // Bloque 151 (pedido explícito — "también se podrá cambiar desde el panel
  // de administrador... cambiarle el método de pago o restablecerlo para
  // que él pueda seleccionar otro diferente"): limpia el método elegido —
  // el vendedor vuelve a ver el selector de método+meses en su panel.
  const resetPaymentMethod = useMutation({
    mutationFn: async (id) => (await api.patch(`/admin/verifications/${id}/reset-payment-method`, {}, notify.config(id))).data,
    onSuccess: () => {
      toast.success("Método de pago restablecido.");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo restablecer el método de pago."),
  });

  return (
    <div className="max-w-[900px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={ShieldCheck} tone="green" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Verificaciones y cobro de suscripción</h1>
      </div>
      <p className="mb-2 text-[13.5px] text-outline">
        Fase 1: revisa la identidad del responsable y aprueba o rechaza los documentos. Fase 2: resuelve el cobro de la
        suscripción para activar el badge. El cobro es recurrente — una tienda ya verificada puede volver aquí si el pago falla.
      </p>
      <div className="mb-4 rounded-md border border-error/20 bg-error/[0.06] px-3.5 py-2.5 text-[12px] text-on-error-container">
        🔒 Datos sensibles: no compartas ni descargues estas imágenes fuera del panel.
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-surface-container-high" role="tablist" aria-label="Filtrar solicitudes">
        {TABS.map((t) => {
          const n = tabCount(t);
          const urgent = t.action && n > 0;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex min-h-11 items-center gap-1.5 px-3.5 py-2.5 text-[13.5px] font-bold transition-colors ${
                tab === t.key ? "border-b-2 border-secondary text-on-surface" : "text-outline hover:text-on-surface"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-extrabold ${urgent ? "bg-error text-white" : "bg-surface-container text-on-surface-variant"}`}
                aria-label={urgent ? `${n} por atender` : `${n}`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>
      {!isSpecialTab && (
        <div className="mb-5">
          <Input
            label="Buscar tienda"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre de la tienda, responsable, correo o teléfono"
          />
        </div>
      )}

      {tab === "RENEWALS" && <RenewalsList />}
      {tab === "CHANGE_REQUESTS" && <ChangeRequestsList />}

      {!isSpecialTab && (
        <>
      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && data?.length === 0 && (
        <p className="text-body-md text-on-surface-variant">{q ? `Ninguna solicitud coincide con "${search.trim()}".` : "No hay solicitudes con este filtro."}</p>
      )}

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
          // Bloque 150 (pedido explícito — "el administrador reciba
          // correctamente el documento... con registro de hora y fecha...
          // y de allí pueda concluir y finalizar la aprobación"): CARD y
          // CUP_TRANSFER comparten el mismo desenlace desde acá — antes CARD
          // se activaba solo con el webhook de Stripe y este panel solo
          // mostraba un texto informativo (showCardInfo); ahora, apenas el
          // vendedor reclama el pago (paymentClaimedAt), aparece EL MISMO
          // bloque de revisión+confirmar que ya usaba CUP, con los datos que
          // corresponda a cada método.
          const inPaymentPhase = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(v.verificationStatus);
          const showAwaitingClaim = inPaymentPhase && !!v.paymentMethod && !v.paymentClaimedAt;
          const showPaymentConfirm = inPaymentPhase && !!v.paymentMethod && !!v.paymentClaimedAt;
          const noMethodYet = v.verificationStatus === "PENDING_PAYMENT" && !v.paymentMethod;
          const expectedAmount = v.paymentMonths ? (v.paymentMethod === "CARD" ? cardPricePerMonthUsd : cupPricePerMonth) * v.paymentMonths : null;

          return (
            <div key={v.id} className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-[22px]">
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
                    {/* Bloque 145 (pedido explícito — "recopilar más
                        información"): contacto directo de la tienda, antes
                        no se veía en esta pantalla sin ir a buscarlo a otro
                        lado del panel. */}
                    <div className="text-[11.5px] text-outline/80">
                      {v.vendor.email ?? "sin correo"} · {v.vendor.whatsapp ?? "sin WhatsApp"}
                    </div>
                    {/* Bloque 153 (pedido explícito — "debe salir desde
                        cuándo está activa o verificada esa tienda... desde
                        cuándo se creó y desde cuándo se verificó"). */}
                    <div className="text-[11px] text-outline/70">
                      Registrada: {fmtDate(v.vendorCreatedAt)}
                      {v.verifiedSince && <> · Verificada desde: {fmtDate(v.verifiedSince)}</>}
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
                  className="flex w-full items-center justify-center gap-1.5 rounded-full border border-outline-variant py-2.5 text-[13px] font-semibold text-on-surface-variant disabled:opacity-50"
                >
                  <Eye className="h-4 w-4" /> Abrir para revisar
                </button>
              )}

              {!isPendingOpen && <SubmittedData v={v} open={showLegalData} withDocuments={!(showDocsReview || v.verificationStatus === "REJECTED")} />}

              {(showDocsReview || v.verificationStatus === "REJECTED") && (
                <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <PrivateDocument vendorId={v.vendorId} type="selfie" label="Foto del responsable" Icon={User} available={!!v.selfieUrl} />
                  <PrivateDocument vendorId={v.vendorId} type="id" label={v.idPhotoBackUrl ? "Documento (frente)" : "Documento de identidad"} Icon={FileText} available={!!v.idPhotoFrontUrl} />
                  {v.idPhotoBackUrl && <PrivateDocument vendorId={v.vendorId} type="idBack" label="Documento (reverso)" Icon={FileText} available />}
                  {/* Bloque 146: solo aparece si el vendedor lo capturó
                      (navegador con soporte) — nunca obligatorio. */}
                  {v.selfieVideoUrl && (
                    <PrivateDocument vendorId={v.vendorId} type="video" kind="video" label="Video (giro de cabeza)" Icon={User} available />
                  )}
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
                  {/* Bloque 145 (pedido explícito): visible acá también, no
                      solo del lado del vendedor — mismo cálculo real
                      (paymentDeadlineAt, ver listVerifications). */}
                  {v.paymentDeadlineAt && (
                    <>
                      {" "}
                      Vence el <strong className="text-on-surface">{fmtDateTime(v.paymentDeadlineAt)}</strong> — después de eso,
                      la solicitud pasa a Rechazadas automáticamente.
                    </>
                  )}
                </p>
              )}

              {/* Bloque 150: mientras el vendedor todavía no reclamó el pago
                  ("Ya pagué") — para CARD distingue si Stripe ya confirmó el
                  cobro (stripePaidAt) o si sigue esperando que pague. */}
              {showAwaitingClaim && (
                <div className="rounded-md border border-surface-container-high p-4">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                    {v.paymentMethod === "CARD" ? (
                      <>
                        <CreditCard className="h-4 w-4 text-tertiary-accent" /> Pago con tarjeta (Stripe)
                      </>
                    ) : (
                      <>
                        <Landmark className="h-4 w-4 text-tertiary-accent" /> Transferencia CUP
                      </>
                    )}
                    {v.paymentMonths && (
                      <span className="ml-auto text-[11px] font-semibold text-outline">
                        {v.paymentMonths} {v.paymentMonths === 1 ? "mes" : "meses"}
                      </span>
                    )}
                  </div>
                  {v.paymentMethod === "CARD" ? (
                    v.stripePaidAt ? (
                      <p className="flex items-center gap-1.5 text-[12.5px] text-outline">
                        <Clock className="h-3.5 w-3.5 flex-shrink-0" /> Stripe confirmó el pago el{" "}
                        <strong className="text-on-surface">{fmtDateTime(v.stripePaidAt)}</strong> — esperando que el vendedor suba
                        su comprobante desde su panel.
                      </p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-[12.5px] text-outline">
                        <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                        {v.stripeCheckoutUrl
                          ? v.stripeCheckoutExpiresAt && new Date(v.stripeCheckoutExpiresAt) < new Date()
                            ? "El link que se le generó ya venció — el vendedor puede pedir uno nuevo desde su panel."
                            : "Esperando que el vendedor complete el pago en Stripe."
                          : "Todavía no generó su link de pago desde su panel."}
                      </p>
                    )
                  ) : (
                    <p className="flex items-center gap-1.5 text-[12.5px] text-outline">
                      <Clock className="h-3.5 w-3.5 flex-shrink-0" /> Esperando que el vendedor avise "Ya pagué" desde su panel.
                    </p>
                  )}
                  {/* Bloque 151 (pedido explícito): el admin puede
                      restablecer el método elegido — la tienda vuelve a ver
                      el selector en su panel, por si se arrepintió o eligió
                      mal. */}
                  <button
                    onClick={() => resetPaymentMethod.mutate(v.id)}
                    disabled={resetPaymentMethod.isPending}
                    className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-tertiary-accent hover:underline disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> Restablecer método de pago
                  </button>
                </div>
              )}

              {/* Bloque 150 (pedido explícito — "el administrador reciba
                  correctamente el documento... con registro de hora y
                  fecha... y de allí pueda concluir y finalizar la
                  aprobación"): mismo bloque para CARD y CUP_TRANSFER — antes
                  CARD se activaba solo con el webhook de Stripe (nunca
                  llegaba a este panel); ahora los 2 pasan por acá con los
                  datos que el vendedor declaró al reclamar el pago. */}
              {showPaymentConfirm && (
                <div className="rounded-md border border-surface-container-high p-4">
                  <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                    {v.paymentMethod === "CARD" ? (
                      <>
                        <CreditCard className="h-4 w-4 text-tertiary-accent" /> Pago con tarjeta
                      </>
                    ) : (
                      <>
                        <Landmark className="h-4 w-4 text-tertiary-accent" /> Transferencia CUP
                      </>
                    )}
                    {v.paymentMonths && (
                      <span className="ml-auto text-[11px] font-semibold text-outline">
                        {v.paymentMonths} {v.paymentMonths === 1 ? "mes" : "meses"} · esperado{" "}
                        {expectedAmount != null ? `${expectedAmount.toLocaleString("es-CU")} ${v.paymentCurrency}` : "—"}
                      </span>
                    )}
                  </div>
                  {/* Bloque 145/150: registro de hora y fecha de cuándo se
                      hizo el movimiento de dinero — paymentClaimedAt. */}
                  <p className="mb-1.5 text-[12px] text-outline">
                    Avisó "Ya pagué" el <strong className="text-on-surface">{fmtDateTime(v.paymentClaimedAt)}</strong>.
                  </p>
                  {v.payerName && (
                    <p className="mb-1 text-[12px] text-outline">
                      Pagó: <strong className="text-on-surface">{v.payerName}</strong>
                      {v.paymentAmount != null && (
                        <>
                          {" "}
                          — declaró <strong className="text-on-surface">{Number(v.paymentAmount).toLocaleString("es-CU")} {v.paymentCurrency}</strong>
                        </>
                      )}
                    </p>
                  )}
                  {v.paymentMethod === "CUP_TRANSFER" ? (
                    <p className="mb-2 text-[12px] text-outline">
                      Cuenta: <strong className="text-on-surface">{v.payerAccountNumber ?? "—"}</strong> · Teléfono:{" "}
                      <strong className="text-on-surface">{v.payerPhone ?? "—"}</strong>
                    </p>
                  ) : (
                    v.paymentProofUnavailable && (
                      <p className="mb-2 text-[12px] text-outline">
                        Sin captura — datos de respaldo: teléfono <strong className="text-on-surface">{v.payerPhone ?? "—"}</strong>,
                        dirección <strong className="text-on-surface">{v.payerAddress ?? "—"}</strong>, país{" "}
                        <strong className="text-on-surface">{v.payerCountry ?? "—"}</strong>
                        {v.payerCardLast4 && (
                          <>
                            {" "}
                            , tarjeta terminada en <strong className="text-on-surface">{v.payerCardLast4}</strong>
                          </>
                        )}
                        .
                      </p>
                    )
                  )}
                  {/* Bloque 66: el comprobante de CUP siempre fue opcional;
                      el de CARD también (con proofUnavailable + datos de
                      respaldo arriba) — esto solo se muestra si hay uno. */}
                  {v.paymentProofUrl && (
                    <div className="mb-3.5 max-w-[220px]">
                      <PrivateDocument vendorId={v.vendorId} type="proof" label="Comprobante" Icon={Receipt} available />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      onClick={() => confirmPayment.mutate(v.id)}
                      disabled={confirmPayment.isPending}
                      className="flex items-center gap-1.5 rounded-md bg-verified px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" strokeWidth={3} />
                      {v.verificationStatus === "VERIFIED" ? "Confirmar pago recibido" : "Confirmar pago recibido y activar"}
                    </button>
                    {/* Bloque 151 (pedido explícito): por si el vendedor
                        reclamó mal (método/monto equivocado) — restablecer
                        en vez de tener que rechazar la solicitud entera. */}
                    <button
                      onClick={() => resetPaymentMethod.mutate(v.id)}
                      disabled={resetPaymentMethod.isPending}
                      className="flex items-center gap-1.5 rounded-full border border-outline-variant px-3.5 py-2.5 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restablecer método
                    </button>
                  </div>
                </div>
              )}

              {inPaymentPhase && (
                <div className="mt-3 flex flex-col items-stretch gap-2 rounded-md border border-dashed border-outline-variant p-3 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-[12.5px] text-on-surface-variant">
                    ¿Pagó por fuera de la plataforma o quieres activarla tú? Registra el pago a mano con los meses que quedan pagados.
                  </p>
                  <button
                    type="button"
                    onClick={() => setManualTarget(v)}
                    className="flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-bold text-white"
                  >
                    <HandCoins className="h-4 w-4" aria-hidden="true" /> Registrar pago manual
                  </button>
                </div>
              )}

              {(showDocsReview || showAwaitingClaim || showPaymentConfirm || inPaymentPhase) && (
                <NotifyVendorCheckbox className="mt-1" checked={notify.isOn(v.id)} onChange={(on) => notify.set(v.id, on)} />
              )}

              {v.verificationStatus === "VERIFIED" && (
                <p className="text-[12px] text-outline">
                  {v.paymentMethod && v.paymentMethod !== "MANUAL" && `Paga por ${PAYMENT_METHOD_LABEL[v.paymentMethod]}. `}
                  {v.paymentMethod === "MANUAL" && `Pago registrado por el equipo${v.paymentMonths ? ` (${v.paymentMonths} ${v.paymentMonths === 1 ? "mes" : "meses"})` : ""}${v.paymentNote ? `: ${v.paymentNote}` : ""}. `}
                  {v.nextPaymentDueDate && `Próximo vencimiento: ${fmtDate(v.nextPaymentDueDate)}.`}
                </p>
              )}
            </div>
          );
        })}
      </div>
        </>
      )}

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

      {manualTarget && (
        <ManualPaymentModal
          verification={manualTarget}
          pending={manualPayment.isPending}
          onCancel={() => setManualTarget(null)}
          onConfirm={(payload) => manualPayment.mutate({ id: manualTarget.id, payload })}
        />
      )}

      {archiveVendor && (
        <VerificationArchiveModal
          vendor={archiveVendor}
          onClose={() => {
            setArchiveVendor(null);
            if (archiveParam) setSearchParams({}, { replace: true });
          }}
        />
      )}
    </div>
  );
}


// Todo lo que la tienda envió para verificarse, en un solo lugar: el responsable y su documento, la empresa y su ubicación
// legal, los datos de la tienda y la cuenta, y las fotos. Abierto mientras se revisan los documentos; en los demás estados,
// plegado para no alargar la lista.
function SubmittedData({ v, open, withDocuments }) {
  const d = v.vendor;
  const rows = [
    ["Responsable (según el documento)", v.fullName],
    ["Responsable en el perfil", d.ownerName],
    ["Tipo de documento", ID_DOCUMENT_TYPE_LABEL[v.idDocumentType]],
    ["Número de documento", v.idNumber ?? d.ownerIdNumber],
    ["ID fiscal de la empresa", d.companyTaxId],
    ["País de registro legal", d.registrationCountry],
    ["Provincia y municipio legal", [d.legalProvince, d.legalMunicipality].filter(Boolean).join(" / ")],
    ["Dirección legal", d.companyAddress],
    ["Tipo de negocio", d.businessCategory],
    ["Dónde opera", d.operatesIn?.join(", ")],
    ["Productos publicados", d.products != null ? String(d.products) : null],
    ["WhatsApp de la tienda", d.whatsapp],
    ["Correo de la tienda", d.email],
    ["Cuenta (quien entra al panel)", [d.accountName, d.accountEmail, d.accountPhone].filter(Boolean).join(" · ")],
    ["Solicitud enviada", fmtDateTime(v.createdAt)],
  ];
  return (
    <details open={open} className="group mb-4 rounded-md bg-surface-container px-3.5 py-3">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-[12.5px] font-bold text-on-surface">
        Datos que envió la tienda
        <ChevronDown className="h-4 w-4 text-outline transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      {d.legalWrittenByHand?.length > 0 && (
        <p className="mt-1 rounded bg-secondary-container/25 px-2.5 py-1.5 text-[12px] text-on-surface">
          Escribió a mano (no estaba en el catálogo): {d.legalWrittenByHand.join(", ")}. Revísalo con cuidado.
        </p>
      )}
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12px] text-on-surface-variant sm:grid-cols-2">
        {rows.map(([k, val]) => (
          <div key={k} className="min-w-0">
            <dt className="inline">{k}: </dt>
            <dd className="inline break-words font-semibold text-on-surface">{val || "Sin dato"}</dd>
          </div>
        ))}
        <div className="min-w-0 sm:col-span-2">
          <dt className="inline">Descripción del negocio: </dt>
          <dd className="inline break-words font-semibold text-on-surface">{d.description || "Sin dato"}</dd>
        </div>
      </dl>
      {d.logoUrl && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-on-surface-variant">
          Logo: <img src={imgUrl(d.logoUrl)} alt={`Logo de ${d.companyName}`} className="h-10 w-10 rounded-lg border border-surface-container-high bg-white object-contain" />
        </div>
      )}
      {withDocuments && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PrivateDocument vendorId={v.vendorId} type="selfie" label="Foto del responsable" Icon={User} available={!!v.selfieUrl} />
          <PrivateDocument vendorId={v.vendorId} type="id" label={v.idPhotoBackUrl ? "Documento (frente)" : "Documento de identidad"} Icon={FileText} available={!!v.idPhotoFrontUrl} />
          {v.idPhotoBackUrl && <PrivateDocument vendorId={v.vendorId} type="idBack" label="Documento (reverso)" Icon={FileText} available />}
          {v.selfieVideoUrl && <PrivateDocument vendorId={v.vendorId} type="video" kind="video" label="Video (giro de cabeza)" Icon={User} available />}
        </div>
      )}
    </details>
  );
}

// Registrar un pago a mano: meses pagados (1 a 24), motivo obligatorio y, si se sabe, monto, moneda y referencia. Al
// confirmar se pide el código de seguridad del admin (igual que para confirmar un pago).
function ManualPaymentModal({ verification, pending, onCancel, onConfirm }) {
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reference, setReference] = useState("");
  const until = new Date(Math.max(Date.now(), verification.nextPaymentDueDate ? new Date(verification.nextPaymentDueDate).getTime() : 0) + months * 30 * 24 * 60 * 60 * 1000);
  const valid = reason.trim().length >= 5 && (amount === "" || Number(amount) >= 0);
  const field = "min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-tertiary-accent";
  return (
    <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onClick={() => !pending && onCancel()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-payment-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || pending) return;
          onConfirm({ months, reason: reason.trim(), ...(amount !== "" ? { amount: Number(amount), currency } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}) });
        }}
        className="flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface-container-lowest p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="manual-payment-title" className="text-[16px] font-bold text-on-surface">
            Registrar pago manual de {verification.vendor.companyName}
          </h2>
          <button type="button" onClick={onCancel} aria-label="Cerrar" className="-mr-2 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[12.5px] text-on-surface-variant">
          La tienda queda verificada con Premium como si hubiera pagado. Queda registrado quién lo hizo, cuándo, los meses y el motivo, y la tienda recibe el aviso.
        </p>
        <label className="text-[12.5px] font-semibold text-on-surface" htmlFor="mp-months">
          Meses pagados
        </label>
        <select id="mp-months" value={months} onChange={(e) => setMonths(Number(e.target.value))} className={field}>
          {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "mes" : "meses"}
            </option>
          ))}
        </select>
        <p className="-mt-1 text-[12px] text-on-surface-variant">Premium hasta el {fmtDate(until.toISOString())}.</p>
        <label className="text-[12.5px] font-semibold text-on-surface" htmlFor="mp-reason">
          Motivo (obligatorio)
        </label>
        <textarea id="mp-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Por ejemplo: pagó en efectivo en la oficina, o tienda de prueba del equipo." className={`${field} py-2`} />
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
          <div>
            <label className="mb-1 block text-[12.5px] font-semibold text-on-surface" htmlFor="mp-amount">
              Monto (opcional)
            </label>
            <input id="mp-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-[12.5px] font-semibold text-on-surface" htmlFor="mp-currency">
              Moneda
            </label>
            <select id="mp-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
              <option value="USD">USD</option>
              <option value="CUP">CUP</option>
            </select>
          </div>
        </div>
        <label className="text-[12.5px] font-semibold text-on-surface" htmlFor="mp-ref">
          Referencia (opcional)
        </label>
        <input id="mp-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Número de transferencia, recibo..." className={field} />
        <div className="mt-1 flex gap-2">
          <button type="button" onClick={onCancel} disabled={pending} className="min-h-11 flex-1 rounded-xl border border-outline-variant text-[13.5px] font-semibold text-on-surface">
            Cancelar
          </button>
          <button type="submit" disabled={!valid || pending} className="min-h-11 flex-1 rounded-xl bg-verified-dark text-[13.5px] font-bold text-white disabled:opacity-50">
            {pending ? "Registrando..." : "Registrar y activar"}
          </button>
        </div>
      </form>
    </div>
  );
}
