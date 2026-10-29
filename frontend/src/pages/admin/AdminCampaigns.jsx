import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Pencil, RotateCcw, Trash2, Image as ImageIcon, MousePointerClick, X, Megaphone } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { ImageCropUploader } from "../../components/ImageCropUploader.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

// Los ids no cambian porque las campañas guardadas los usan: "regular_vendors" = tiendas del plan por defecto (bandera
// isDefault, ya no la clave REGULAR) y "business_vendors" = tiendas en cualquier plan de pago. El nombre del plan por
// defecto sale de la base (/settings), nunca escrito aquí.
function defaultPlanOf(siteSettings) {
  return siteSettings?.plans?.find((p) => p.isDefault && !p.archivedAt) ?? null;
}

// Además de los cuatro públicos de siempre, uno por cada plan no archivado (su clave, ej. "PLAN_RESTAURANTE"), que el
// servidor ya acepta (lib/planSegments.js). El plan por defecto no se repite: ya está en "regular_vendors". `extra` es el
// público guardado de una campaña que ya no está entre las opciones (un plan archivado después): sin esa opción el select
// mostraría la primera y, al guardar, se cambiaría el público sin avisar.
function campaignSegments(siteSettings, extra = null) {
  const defaultName = defaultPlanOf(siteSettings)?.displayName;
  const planOptions = [...(siteSettings?.plans ?? [])]
    .filter((p) => !p.archivedAt && !p.isDefault)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((p) => ({ id: p.planType, label: `Tiendas del plan ${p.displayName}${p.isPublic === false ? " (oculto)" : ""}` }));
  const list = [
    { id: "all_customers", label: "Todos los clientes" },
    { id: "all_vendors", label: "Todos los vendedores" },
    { id: "regular_vendors", label: defaultName ? `Tiendas del plan ${defaultName}` : "Tiendas del plan por defecto" },
    { id: "business_vendors", label: "Tiendas con plan de pago" },
    ...planOptions,
  ];
  if (extra?.id && !list.some((s) => s.id === extra.id)) list.push({ id: extra.id, label: extra.label ?? extra.id });
  return list;
}

// Etiqueta de un público: la del servidor (segmentLabel, con el nombre del plan de la base, también de uno archivado) y,
// si no viene, la de las opciones; la clave cruda solo como último recurso.
function segmentLabelOf(campaign, segments) {
  return campaign?.segmentLabel ?? segments.find((s) => s.id === campaign?.segment)?.label ?? campaign?.segment ?? "";
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

// Bloque 67: imagen puede ser un archivo servido por este backend (ruta
// relativa) o un link externo pegado por el admin (ya absoluto).
function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Bloque 67 (pedido explícito): "más personalización" — imagen banner
// opcional (archivo o link externo) + botón de llamado a la acción
// opcional, además del asunto/mensaje ya existentes. Reusado tal cual por
// el composer de "Nueva campaña" y por el modal de edición de abajo.
function CampaignFieldset({
  subject,
  setSubject,
  segment,
  setSegment,
  provinceId,
  setProvinceId,
  content,
  setContent,
  imageBlob,
  setImageBlob,
  imageLink,
  setImageLink,
  existingImageUrl,
  onRemoveExistingImage,
  ctaLabel,
  setCtaLabel,
  ctaUrl,
  setCtaUrl,
  provinces,
  siteSettings,
  savedSegment = null,
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <label className="mb-1.5 block text-[12.5px] font-semibold text-on-surface-variant">Asunto</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Ej: Nuevas tiendas en tu provincia"
          className="h-11 w-full rounded-lg border border-outline-variant px-3.5 text-[14px] outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-on-surface-variant">Segmento</label>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none"
          >
            {campaignSegments(siteSettings, savedSegment).map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-on-surface-variant">Provincia</label>
          <select
            value={provinceId}
            onChange={(e) => setProvinceId(e.target.value)}
            className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none"
          >
            <option value="">Toda Cuba</option>
            {(provinces ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-[12.5px] font-semibold text-on-surface-variant">Mensaje</label>
        <AiGenerateButton kind="campaign" currentText={content} onGenerated={setContent} />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Escribe el contenido del correo..."
          className="min-h-[130px] w-full resize-y rounded-lg border border-outline-variant p-3.5 text-[14px] outline-none"
        />
      </div>

      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-on-surface-variant">
          <ImageIcon className="h-3.5 w-3.5" /> Imagen del correo (opcional)
        </label>
        {existingImageUrl && !imageBlob ? (
          <div className="mb-2 flex items-center gap-3">
            <img src={imgUrl(existingImageUrl)} alt="" className="h-16 w-28 rounded-md object-cover" />
            <button
              type="button"
              onClick={onRemoveExistingImage}
              className="flex items-center gap-1 text-[12px] font-semibold text-error hover:underline"
            >
              <X className="h-3.5 w-3.5" /> Quitar imagen
            </button>
          </div>
        ) : (
          <ImageCropUploader
            value={imageBlob ? URL.createObjectURL(imageBlob) : null}
            aspect={16 / 9}
            recommendedLabel="Tamaño recomendado: 1200×675px (horizontal) — se muestra arriba del mensaje."
            boxClassName="aspect-[16/9] w-full max-w-[320px]"
            onFileReady={(blob) => {
              setImageBlob(blob);
              setImageLink("");
            }}
          />
        )}
        {siteSettings?.allowProductImageLinks && !imageBlob && !existingImageUrl && (
          <input
            value={imageLink}
            onChange={(e) => {
              setImageLink(e.target.value);
              if (e.target.value) setImageBlob(null);
            }}
            placeholder="O pega el link de una imagen (https://...)"
            className="mt-2 h-9 w-full max-w-[320px] rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        )}
      </div>

      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-on-surface-variant">
          <MousePointerClick className="h-3.5 w-3.5" /> Botón de llamado a la acción (opcional)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <input
            value={ctaLabel}
            onChange={(e) => setCtaLabel(e.target.value)}
            placeholder="Texto — Ej: Ver ofertas"
            maxLength={40}
            className="h-10 w-full rounded-lg border border-outline-variant px-3 text-[13px] outline-none"
          />
          <input
            value={ctaUrl}
            onChange={(e) => setCtaUrl(e.target.value)}
            placeholder="Link — https://..."
            className="h-10 w-full rounded-lg border border-outline-variant px-3 text-[13px] outline-none"
          />
        </div>
        {!!ctaLabel !== !!ctaUrl && (
          <p className="mt-1.5 text-[11.5px] font-semibold text-error">Completa los dos campos del botón, o déjalos vacíos.</p>
        )}
      </div>
    </div>
  );
}

function CampaignEditModal({ campaign, provinces, siteSettings, onClose }) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(campaign.subject ?? "");
  const [segment, setSegment] = useState(campaign.segment);
  const [provinceId, setProvinceId] = useState(campaign.provinceId ?? "");
  const [content, setContent] = useState(campaign.content ?? "");
  const [imageBlob, setImageBlob] = useState(null);
  const [imageLink, setImageLink] = useState("");
  const [existingImageUrl, setExistingImageUrl] = useState(campaign.imageUrl ?? null);
  const [ctaLabel, setCtaLabel] = useState(campaign.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(campaign.ctaUrl ?? "");

  const ctaMismatch = !!ctaLabel !== !!ctaUrl;

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): mismo patrón de snapshot-en-ref que
  // ProductModal (VendorProducts.jsx). `imageBlob` es un File — no
  // serializa de forma útil con JSON.stringify — así que se compara solo
  // si HAY uno nuevo elegido (`!!imageBlob`), igual criterio que
  // OfferModal (AdminOffers.jsx) con su `customPreview`.
  const initialCampaignSnapshot = useRef(
    JSON.stringify({ subject, segment, provinceId, content, hasNewImage: !!imageBlob, imageLink, existingImageUrl, ctaLabel, ctaUrl })
  );
  const isDirty =
    JSON.stringify({ subject, segment, provinceId, content, hasNewImage: !!imageBlob, imageLink, existingImageUrl, ctaLabel, ctaUrl }) !==
    initialCampaignSnapshot.current;

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("subject", subject.trim());
      form.append("content", content.trim());
      form.append("segment", segment);
      if (provinceId) form.append("provinceId", provinceId);
      if (imageBlob) form.append("image", imageBlob, "campaign.jpg");
      else if (imageLink.trim()) form.append("imageUrl", imageLink.trim());
      else if (!existingImageUrl) form.append("removeImage", "true");
      if (ctaLabel.trim()) form.append("ctaLabel", ctaLabel.trim());
      if (ctaUrl.trim()) form.append("ctaUrl", ctaUrl.trim());
      return (await api.patch(`/admin/campaigns/${campaign.id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Campaña actualizada.");
      queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la campaña."),
  });

  // Bloque 196: misma condición que ya deshabilita "Guardar cambios" más
  // abajo (sin save.isPending).
  const canSaveNow = !!subject.trim() && !!content.trim() && !ctaMismatch;
  const dirtyModal = useDirtyModal({
    isDirty,
    onClose,
    onSave: canSaveNow ? () => save.mutateAsync() : undefined,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="modal-panel-6 w-full max-w-lg rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">Editar campaña</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        <CampaignFieldset
          subject={subject}
          setSubject={setSubject}
          segment={segment}
          setSegment={setSegment}
          provinceId={provinceId}
          setProvinceId={setProvinceId}
          content={content}
          setContent={setContent}
          imageBlob={imageBlob}
          setImageBlob={setImageBlob}
          imageLink={imageLink}
          setImageLink={setImageLink}
          existingImageUrl={existingImageUrl}
          onRemoveExistingImage={() => setExistingImageUrl(null)}
          ctaLabel={ctaLabel}
          setCtaLabel={setCtaLabel}
          ctaUrl={ctaUrl}
          setCtaUrl={setCtaUrl}
          provinces={provinces}
          siteSettings={siteSettings}
          savedSegment={{ id: campaign.segment, label: campaign.segmentLabel }}
        />

        <div className="mt-5 flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !subject.trim() || !content.trim() || ctaMismatch}
            className="flex-1 rounded-lg bg-tertiary-accent-light px-6 py-3 text-[14px] font-bold text-tertiary disabled:opacity-50"
          >
            {save.isPending ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
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

export default function AdminCampaigns() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [segment, setSegment] = useState("all_customers");
  const [provinceId, setProvinceId] = useState("");
  const [content, setContent] = useState("");
  const [imageBlob, setImageBlob] = useState(null);
  const [imageLink, setImageLink] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [justSent, setJustSent] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // campaña a editar, o null
  const [confirmTarget, setConfirmTarget] = useState(null); // { type: "delete"|"resend", campaign }

  const { data: provinces } = useQuery({
    queryKey: ["locations-provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });
  // Destinatarios: el servidor cuenta con el mismo criterio que el envío real (sin bajas de promociones ni cuentas que se
  // están borrando). Antes se estimaba con el total de /admin/customers y /admin/vendors, que no coincidía con el envío.
  const {
    data: estimate,
    isLoading: estimateLoading,
    isError: estimateError,
  } = useQuery({
    queryKey: ["admin-campaign-estimate", segment, provinceId],
    queryFn: async () => (await api.get("/admin/campaigns/estimate", { params: { segment, provinceId: provinceId || undefined } })).data,
  });
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const segments = campaignSegments(siteSettings);
  const { data: history } = useQuery({
    queryKey: ["admin-campaigns"],
    queryFn: async () => (await api.get("/admin/campaigns")).data.campaigns,
  });

  const provinceName = useMemo(() => Object.fromEntries((provinces ?? []).map((p) => [p.id, p.name])), [provinces]);


  const ctaMismatch = !!ctaLabel !== !!ctaUrl;

  const send = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("subject", subject.trim());
      form.append("content", content.trim());
      form.append("segment", segment);
      if (provinceId) form.append("provinceId", provinceId);
      if (imageBlob) form.append("image", imageBlob, "campaign.jpg");
      else if (imageLink.trim()) form.append("imageUrl", imageLink.trim());
      if (ctaLabel.trim()) form.append("ctaLabel", ctaLabel.trim());
      if (ctaUrl.trim()) form.append("ctaUrl", ctaUrl.trim());
      return (await api.post("/admin/campaigns", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (data) => {
      // Envío a medias (algún lote rechazado por Resend): la campaña queda enviada con los que sí salieron y se avisa
      // cuántos faltaron, para no reenviarla entera y duplicársela a quien ya la recibió.
      if (data?.warning) toast.error(data.warning);
      queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] });
      setJustSent(true);
      setSubject("");
      setContent("");
      setImageBlob(null);
      setImageLink("");
      setCtaLabel("");
      setCtaUrl("");
      setTimeout(() => setJustSent(false), 6000);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar la campaña."),
  });

  const resend = useMutation({
    mutationFn: async (id) => (await api.post(`/admin/campaigns/${id}/resend`)).data,
    onSuccess: (data) => {
      toast.success("Campaña reenviada.");
      if (data?.warning) toast.error(data.warning);
      queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] });
      setConfirmTarget(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo reenviar la campaña.");
      setConfirmTarget(null);
    },
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/campaigns/${id}`),
    onSuccess: () => {
      toast.success("Campaña eliminada.");
      queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] });
      setConfirmTarget(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar la campaña.");
      setConfirmTarget(null);
    },
  });

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Megaphone} tone="orange" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Campañas</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">Envía correos masivos (Resend) a clientes o vendedores segmentados.</p>

      <div className="grid grid-cols-1 items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6">
          <div className="mb-4 text-[15px] font-bold text-on-surface">Nueva campaña</div>
          <CampaignFieldset
            subject={subject}
            setSubject={setSubject}
            segment={segment}
            setSegment={setSegment}
            provinceId={provinceId}
            setProvinceId={setProvinceId}
            content={content}
            setContent={setContent}
            imageBlob={imageBlob}
            setImageBlob={setImageBlob}
            imageLink={imageLink}
            setImageLink={setImageLink}
            existingImageUrl={null}
            onRemoveExistingImage={() => {}}
            ctaLabel={ctaLabel}
            setCtaLabel={setCtaLabel}
            ctaUrl={ctaUrl}
            setCtaUrl={setCtaUrl}
            provinces={provinces}
            siteSettings={siteSettings}
          />
          <div className="mt-3.5 flex items-center justify-between pt-1.5">
            <span className="text-[12.5px] text-outline">
              {estimateLoading ? (
                "Calculando destinatarios..."
              ) : estimateError ? (
                <span className="text-error">No se pudo calcular a cuántos les llega.</span>
              ) : (
                <>
                  Destinatarios estimados: <strong className="text-on-surface">{(estimate?.recipients ?? 0).toLocaleString("es-CU")}</strong>
                  {estimate?.optedOut > 0 && (
                    <span className="block">
                      {estimate.optedOut.toLocaleString("es-CU")} {estimate.optedOut === 1 ? "se dio de baja" : "se dieron de baja"} de los correos de promoción y no lo {estimate.optedOut === 1 ? "recibirá" : "recibirán"}.
                    </span>
                  )}
                </>
              )}
            </span>
            <button
              onClick={() => send.mutate()}
              disabled={send.isPending || !subject || !content || ctaMismatch}
              className="rounded-lg bg-tertiary-accent-light px-6 py-3 text-[14px] font-bold text-tertiary disabled:opacity-50"
            >
              {send.isPending ? "Enviando..." : "Enviar campaña"}
            </button>
          </div>
          {justSent && (
            <div className="mt-3.5 rounded-[10px] bg-verified/10 px-4 py-3 text-[13px] font-semibold text-verified-dark">
              ✓ Campaña enviada vía Resend.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
          <div className="mb-3.5 text-[14px] font-bold text-on-surface">Campañas recientes</div>
          <div className="flex flex-col gap-3">
            {!history?.length && <p className="text-label-sm text-outline">Todavía no se envió ninguna campaña.</p>}
            {history?.map((h) => {
              const segLabel = segmentLabelOf(h, segments);
              const pct = h.sentCount > 0 && h.openCount > 0 ? Math.round((h.openCount / h.sentCount) * 100) : null;
              return (
                <div key={h.id} className="rounded-[10px] border border-surface-container-high p-3.5">
                  <div className="flex gap-3">
                    {h.imageUrl && (
                      <img src={imgUrl(h.imageUrl)} alt="" className="h-12 w-16 flex-shrink-0 rounded object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-on-surface">{h.subject ?? h.title}</div>
                      <div className="mt-0.5 text-[11.5px] text-outline">
                        {segLabel}
                        {h.provinceId && provinceName[h.provinceId] ? ` · ${provinceName[h.provinceId]}` : ""} · {fmtDate(h.sentAt ?? h.createdAt)}
                      </div>
                      {h.status === "SENT" ? (
                        <div className="mt-1 text-[11.5px] font-semibold text-verified-dark">
                          {h.sentCount.toLocaleString("es-CU")} enviados{pct !== null ? ` · ${pct}% abiertos` : ""}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11.5px] font-semibold text-outline">{h.status === "DRAFT" ? "Borrador" : h.status}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3.5 border-t border-surface-container-high pt-2.5">
                    <button
                      onClick={() => setEditTarget(h)}
                      className="flex items-center gap-1 text-[11.5px] font-semibold text-tertiary-accent hover:underline"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      onClick={() => setConfirmTarget({ type: "resend", campaign: h })}
                      className="flex items-center gap-1 text-[11.5px] font-semibold text-tertiary-accent hover:underline"
                    >
                      <RotateCcw className="h-3 w-3" /> Reenviar
                    </button>
                    <button
                      onClick={() => setConfirmTarget({ type: "delete", campaign: h })}
                      className="flex items-center gap-1 text-[11.5px] font-semibold text-error hover:underline"
                    >
                      <Trash2 className="h-3 w-3" /> Eliminar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editTarget && (
        <CampaignEditModal
          campaign={editTarget}
          provinces={provinces}
          siteSettings={siteSettings}
          onClose={() => setEditTarget(null)}
        />
      )}

      <ConfirmModal
        open={!!confirmTarget}
        title={confirmTarget?.type === "delete" ? "¿Eliminar esta campaña?" : "¿Reenviar esta campaña?"}
        message={
          confirmTarget?.type === "delete"
            ? "Se quita del historial. Esto no afecta los correos que ya llegaron a las bandejas de entrada."
            : `Se manda de nuevo, ahora mismo, a los destinatarios vigentes del segmento "${segmentLabelOf(confirmTarget?.campaign, segments)}". Queda como un envío nuevo en el historial.`
        }
        confirmLabel={
          confirmTarget?.type === "delete"
            ? remove.isPending ? "Eliminando..." : "Sí, eliminar"
            : resend.isPending ? "Reenviando..." : "Sí, reenviar"
        }
        danger={confirmTarget?.type === "delete"}
        onConfirm={() => {
          if (confirmTarget?.type === "delete") remove.mutate(confirmTarget.campaign.id);
          else resend.mutate(confirmTarget.campaign.id);
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
