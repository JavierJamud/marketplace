import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { User, FileText, Receipt, Check, Bot, UserCheck, CreditCard, Landmark, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { PrivateDocument } from "../../components/PrivateDocument.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

const TABS = [
  { key: "pending_review", label: "Documentos pendientes" },
  { key: "pending_payment", label: "Pago pendiente" },
  { key: "rejected", label: "Rechazadas" },
  { key: "approved", label: "Verificadas" },
];

const PAYMENT_METHOD_LABEL = { CARD: "Tarjeta", CUP_TRANSFER: "Transferencia CUP" };

export default function AdminVerifications() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("pending_review");
  const [rejectTarget, setRejectTarget] = useState(null); // id de la verificación a rechazar
  const [rejectReason, setRejectReason] = useState("");

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
        suscripción para activar el badge.
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
          const autoConfirmed = v.status === "APPROVED" && v.paymentMethod === "CARD" && !v.paymentConfirmedById;

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
                  {tab === "approved" && (
                    <span
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-bold ${
                        autoConfirmed ? "bg-tertiary-accent/10 text-tertiary-accent" : "bg-verified/10 text-verified-dark"
                      }`}
                    >
                      {autoConfirmed ? <Bot className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      {autoConfirmed ? "Pago automático" : "Confirmado a mano"}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold ${
                      tab === "approved"
                        ? "bg-verified/10 text-verified-dark"
                        : tab === "rejected"
                          ? "bg-error/10 text-error"
                          : tab === "pending_payment"
                            ? "bg-tertiary-accent/10 text-tertiary-accent"
                            : "bg-secondary/10 text-secondary"
                    }`}
                  >
                    {tab === "approved" ? "Verificada" : tab === "rejected" ? "Rechazada" : tab === "pending_payment" ? "Pago pendiente" : "Pendiente"}
                  </span>
                </div>
              </div>

              {tab === "rejected" && v.notes && (
                <p className="mb-4 rounded-md bg-surface-container px-3 py-2 text-[12px] text-outline">Motivo: {v.notes}</p>
              )}

              {tab === "pending_review" || tab === "rejected" ? (
                <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <PrivateDocument vendorId={v.vendor.id} type="selfie" label="Foto del responsable" Icon={User} available={!!v.selfieUrl} />
                  <PrivateDocument vendorId={v.vendor.id} type="id" label="Documento de identidad" Icon={FileText} available={!!v.idPhotoFrontUrl} />
                </div>
              ) : null}

              {tab === "pending_review" && (
                <div className="flex gap-2.5">
                  <button
                    onClick={() => decide.mutate({ id: v.id, decision: "approve" })}
                    disabled={decide.isPending}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-verified py-3 text-[14px] font-bold text-white disabled:opacity-50"
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

              {tab === "pending_payment" && (
                <div className="rounded-md border border-surface-container-high p-4">
                  {!v.paymentMethod && (
                    <p className="text-[12.5px] text-outline">Esperando que el vendedor elija un método de pago desde su panel.</p>
                  )}

                  {/* Bloque 25: sin acciones manuales acá — el sistema genera el
                      Checkout Session de Stripe solo apenas el vendedor elige
                      esta opción (ver VendorVerification.jsx), y el webhook
                      activa la cuenta solo cuando Stripe confirma el pago. Este
                      panel es de solo lectura para este método. */}
                  {v.paymentMethod === "CARD" && (
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                        <CreditCard className="h-4 w-4 text-tertiary-accent" /> Pago con tarjeta (Stripe)
                      </div>
                      {v.stripeCheckoutUrl ? (
                        <p className="flex items-center gap-1.5 text-[12.5px] text-outline">
                          <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                          {v.stripeCheckoutExpiresAt && new Date(v.stripeCheckoutExpiresAt) < new Date()
                            ? "El link que se le generó ya venció — el vendedor puede pedir uno nuevo desde su panel."
                            : "Esperando que el vendedor complete el pago en Stripe."}
                        </p>
                      ) : (
                        <p className="text-[12.5px] text-outline">Todavía no generó su link de pago desde su panel.</p>
                      )}
                      <p className="mt-2 text-[11.5px] text-outline">La activación es 100% automática — no hay nada para hacer acá.</p>
                    </div>
                  )}

                  {v.paymentMethod === "CUP_TRANSFER" && (
                    <div>
                      <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                        <Landmark className="h-4 w-4 text-tertiary-accent" /> Transferencia CUP
                      </div>
                      <div className="mb-3.5 max-w-[220px]">
                        <PrivateDocument vendorId={v.vendor.id} type="proof" label="Comprobante" Icon={Receipt} available={!!v.paymentProofUrl} />
                      </div>
                      <button
                        onClick={() => confirmCup.mutate(v.id)}
                        disabled={confirmCup.isPending}
                        className="flex items-center gap-1.5 rounded-md bg-verified px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" strokeWidth={3} /> Confirmar pago recibido y activar
                      </button>
                    </div>
                  )}
                </div>
              )}

              {tab === "approved" && v.paymentMethod && (
                <p className="text-[12px] text-outline">Pagó por {PAYMENT_METHOD_LABEL[v.paymentMethod]}.</p>
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
    </div>
  );
}
