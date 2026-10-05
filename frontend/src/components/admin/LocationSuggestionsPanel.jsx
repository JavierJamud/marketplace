import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { MapPinned, Users, Store } from "lucide-react";
import { api } from "../../lib/api.js";
import { CARD } from "../dashboard/DashboardCard.jsx";
import { ConfirmModal } from "../ConfirmModal.jsx";
import { Input } from "../ui/Input.jsx";
import { Select } from "../ui/Select.jsx";
import { Button } from "../ui/Button.jsx";
import { exactDate } from "../../lib/relativeTime.js";

// Bloque 244 (pedido explícito — "si el cliente no encuentra su país o
// provincia, la escribe a mano y el admin la revisa y la agrega"): lista de
// países y provincias escritos a mano en el registro. Cada solicitud muestra
// cuántas personas y tiendas hay detrás, y se resuelve de tres formas:
// aprobar (se crea el país o la provincia real y se enlaza a todos los que la
// escribieron), fusionar (se enlaza a una que ya existía, útil para errores
// de escritura) o rechazar (se cierra sin crear nada; lo que escribió cada
// persona se conserva).

const KIND_LABEL = { COUNTRY: "País", PROVINCE: "Provincia o estado" };
const STATUS_LABEL = { APPROVED: "Aprobada", MERGED: "Fusionada", REJECTED: "Rechazada" };

function Chip({ icon: Icon, children, title }) {
  return (
    <span title={title} className="flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 text-[11.5px] font-semibold text-on-surface-variant">
      {Icon && <Icon className="h-3 w-3" />} {children}
    </span>
  );
}

function SuggestionRow({ s, onApprove, onMerge, onReject }) {
  const pending = s.status === "PENDING";
  return (
    <div className="flex flex-col gap-3 border-b border-surface-container px-4 py-3.5 last:border-b-0 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px] font-bold text-on-surface">{s.name}</span>
          <span className="rounded-full bg-tertiary-accent/10 px-2 py-0.5 text-[10.5px] font-bold text-tertiary-accent">{KIND_LABEL[s.kind]}</span>
          {!pending && (
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10.5px] font-bold text-on-surface-variant">{STATUS_LABEL[s.status]}</span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-outline">
          {s.kind === "PROVINCE" && s.country ? `En ${s.country.name} · ` : ""}
          Primera vez: {exactDate(s.createdAt)}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip title="Veces que alguien la escribió al registrarse">{s.mentionCount} {s.mentionCount === 1 ? "mención" : "menciones"}</Chip>
          {pending && (
            <>
              <Chip icon={Users} title="Personas que hoy la tienen escrita a mano">{s.people} {s.people === 1 ? "persona" : "personas"}</Chip>
              <Chip icon={Store} title="Tiendas que hoy la tienen escrita a mano">{s.stores} {s.stores === 1 ? "tienda" : "tiendas"}</Chip>
            </>
          )}
        </div>
      </div>
      {pending && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onApprove} className="!h-11 md:!h-9">
            Aprobar
          </Button>
          <Button size="sm" variant="outline" onClick={onMerge} className="!h-11 md:!h-9">
            Fusionar
          </Button>
          <button
            type="button"
            onClick={onReject}
            className="h-11 rounded border border-error/40 px-3 text-label-sm font-semibold text-error hover:bg-error/5 md:h-9"
          >
            Rechazar
          </button>
        </div>
      )}
    </div>
  );
}

export function LocationSuggestionsPanel() {
  const queryClient = useQueryClient();
  const [view, setView] = useState("PENDING");
  const [approving, setApproving] = useState(null);
  const [merging, setMerging] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [approveName, setApproveName] = useState("");
  const [approveCode, setApproveCode] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-list-location-suggestions", view],
    queryFn: async () => (await api.get("/admin/location-suggestions", { params: { status: view === "PENDING" ? "PENDING" : "ALL" } })).data.suggestions,
  });
  const rows = view === "PENDING" ? data : data?.filter((s) => s.status !== "PENDING");

  // Opciones para fusionar: los países del catálogo, o las provincias del país
  // de la solicitud.
  const { data: countryOptions } = useQuery({
    queryKey: ["admin-countries"],
    queryFn: async () => (await api.get("/admin/locations/countries")).data.countries,
    enabled: merging?.kind === "COUNTRY",
  });
  const { data: provinceOptions } = useQuery({
    queryKey: ["provinces-for-country", merging?.country?.id],
    queryFn: async () => (await api.get(`/locations/countries/${merging.country.id}/provinces`)).data.provinces,
    enabled: merging?.kind === "PROVINCE" && !!merging?.country?.id,
  });
  const mergeOptions = merging?.kind === "COUNTRY" ? countryOptions ?? [] : provinceOptions ?? [];

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["admin-list-location-suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["admin-location-suggestions-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-countries"] });
    queryClient.invalidateQueries({ queryKey: ["admin-provinces"] });
    queryClient.invalidateQueries({ queryKey: ["active-countries-all"] });
    queryClient.invalidateQueries({ queryKey: ["provinces-for-country"] });
    queryClient.invalidateQueries({ queryKey: ["provinces"] });
  }
  const onError = (err) => toast.error(err.response?.data?.error ?? "No se pudo completar la acción.");
  const linkedText = (l) => `Se enlazaron ${l.people} ${l.people === 1 ? "persona" : "personas"} y ${l.stores} ${l.stores === 1 ? "tienda" : "tiendas"}.`;

  const approve = useMutation({
    mutationFn: async () =>
      (await api.post(`/admin/location-suggestions/${approving.id}/approve`, { name: approveName.trim() || undefined, code: approveCode.trim() || undefined })).data,
    onSuccess: (res) => {
      toast.success(`${approving.kind === "COUNTRY" ? "País" : "Provincia"} creado. ${linkedText(res.linked)}`);
      setApproving(null);
      refresh();
    },
    onError,
  });
  const merge = useMutation({
    mutationFn: async () => (await api.post(`/admin/location-suggestions/${merging.id}/merge`, { targetId: mergeTarget })).data,
    onSuccess: (res) => {
      toast.success(`Fusionada. ${linkedText(res.linked)}`);
      setMerging(null);
      refresh();
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: async () => (await api.post(`/admin/location-suggestions/${rejecting.id}/reject`)).data,
    onSuccess: () => {
      toast.success("Solicitud rechazada.");
      setRejecting(null);
      refresh();
    },
    onError,
  });

  return (
    <div>
      <p className="mb-4 max-w-[760px] text-[13.5px] text-outline">
        Países y provincias que alguien escribió a mano al registrarse porque no los encontró en tus listas. Su cuenta o tienda ya funciona;
        al aprobarlos se crean y quedan enlazados a todos los que los escribieron.
      </p>

      <div className="mb-4 flex gap-2">
        {[
          ["PENDING", "Pendientes"],
          ["DONE", "Resueltas"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={`h-11 rounded-full border px-4 text-[13px] font-semibold md:h-9 ${
              view === id ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={CARD}>
        {isLoading && <p className="p-6 text-body-md text-on-surface-variant">Cargando solicitudes...</p>}
        {isError && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-body-md text-error">No se pudieron cargar las solicitudes.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        )}
        {rows?.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <MapPinned className="h-7 w-7 text-outline" />
            <p className="text-body-md text-on-surface-variant">
              {view === "PENDING" ? "No hay solicitudes pendientes." : "Todavía no resolviste ninguna solicitud."}
            </p>
            {view === "PENDING" && (
              <p className="max-w-sm text-[12.5px] text-outline">Cuando alguien escriba a mano su país o provincia al registrarse, aparecerá acá.</p>
            )}
          </div>
        )}
        {rows?.map((s) => (
          <SuggestionRow
            key={s.id}
            s={s}
            onApprove={() => {
              setApproveName(s.name);
              setApproveCode("");
              setApproving(s);
            }}
            onMerge={() => {
              setMergeTarget("");
              setMerging(s);
            }}
            onReject={() => setRejecting(s)}
          />
        ))}
      </div>

      <ConfirmModal
        open={!!approving}
        title={`Aprobar ${approving?.kind === "COUNTRY" ? "el país" : "la provincia"} "${approving?.name}"`}
        message={
          approving?.kind === "COUNTRY"
            ? "Se crea el país, queda disponible en la lista de registro y se enlaza a las personas y tiendas que lo escribieron."
            : `Se crea la provincia en ${approving?.country?.name ?? "su país"}, queda disponible en la lista y se enlaza a quienes la escribieron.`
        }
        confirmLabel={approve.isPending ? "Creando..." : "Aprobar y crear"}
        confirmDisabled={approve.isPending || approveName.trim().length < 2 || (approving?.kind === "COUNTRY" && !/^[A-Za-z]{2,3}$/.test(approveCode.trim()))}
        onConfirm={() => approve.mutate()}
        onCancel={() => setApproving(null)}
      >
        <div className="flex flex-col gap-3">
          <Input label="Nombre" value={approveName} maxLength={80} onChange={(e) => setApproveName(e.target.value)} />
          {approving?.kind === "COUNTRY" && (
            <div>
              <Input label="Código del país (2 o 3 letras)" value={approveCode} maxLength={3} onChange={(e) => setApproveCode(e.target.value.toUpperCase())} placeholder="Ej. PA" />
              <p className="mt-1 text-label-sm text-outline">Código ISO del país (PA para Panamá, MX para México).</p>
            </div>
          )}
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={!!merging}
        title={`Fusionar "${merging?.name}"`}
        message={`Elige ${merging?.kind === "COUNTRY" ? "el país" : "la provincia"} que ya existe y a la que corresponde. Se enlaza a todos los que lo escribieron, sin crear nada nuevo.`}
        confirmLabel={merge.isPending ? "Fusionando..." : "Fusionar"}
        confirmDisabled={merge.isPending || !mergeTarget}
        onConfirm={() => merge.mutate()}
        onCancel={() => setMerging(null)}
      >
        <Select label={merging?.kind === "COUNTRY" ? "País existente" : "Provincia existente"} value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
          <option value="">Selecciona...</option>
          {mergeOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </ConfirmModal>

      <ConfirmModal
        open={!!rejecting}
        title={`¿Rechazar "${rejecting?.name}"?`}
        message="La solicitud se cierra sin crear nada. Lo que escribió cada persona se conserva tal cual, y si otra persona lo vuelve a escribir no te volvemos a avisar."
        confirmLabel={reject.isPending ? "Rechazando..." : "Sí, rechazar"}
        danger
        onConfirm={() => reject.mutate()}
        onCancel={() => setRejecting(null)}
      />
    </div>
  );
}
