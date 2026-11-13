import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Smartphone } from "lucide-react";
import { api, getErrorMessage } from "../../lib/api.js";
import toast from "../../lib/toast.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
import { SearchBox } from "../../components/ui/SearchBox.jsx";
import { Chip, ChipRow } from "../../components/ui/Chip.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import ToggleSwitch from "../../components/admin/ToggleSwitch.jsx";
import { StorePicker } from "../../components/admin/StorePicker.jsx";

// Admin > WhatsApp. La conexión la lleva un proceso aparte en el servidor (npm run whatsapp); esta página solo pide
// vincular o desvincular, muestra el QR que ese proceso genera y lee el historial de mensajes.

const STATUS_KEY = ["admin-whatsapp"];
const CARD = "rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 shadow-sm sm:p-6";
const H2 = "mb-1 text-[17px] font-bold leading-snug text-on-surface";

const LAST_ERROR = {
  LOGGED_OUT: "La sesión se cerró desde el teléfono (Dispositivos vinculados). Vuelve a vincular para seguir enviando.",
  BLOCKED: "WhatsApp rechazó la conexión. El número puede estar bloqueado o restringido: revísalo en el teléfono antes de vincular de nuevo.",
};

const MESSAGE_STATUS = [
  { id: "", label: "Todos" },
  { id: "SENT", label: "Enviados" },
  { id: "PENDING", label: "En cola" },
  { id: "FAILED", label: "Fallidos" },
  { id: "SKIPPED", label: "Omitidos" },
  { id: "EXPIRED", label: "Vencidos" },
];
const STATUS_TEXT = { SENT: "Enviado", PENDING: "En cola", SENDING: "Enviando", FAILED: "Falló", SKIPPED: "Omitido", EXPIRED: "Venció" };
const STATUS_STYLE = {
  SENT: "bg-verified/15 text-verified-dark",
  FAILED: "bg-error/10 text-error",
};
const SKIP_REASON = { NO_WHATSAPP: "El número no tiene WhatsApp", OPT_OUT: "Pidió no recibir avisos", PAUSED: "Envíos en pausa", KIND_OFF: "Ese tipo de aviso está apagado", CANCELLED: "Envío detenido por el admin" };
const KIND_LABEL = { verify: "Código", test: "Prueba", optout: "Respuesta a BAJA" };
// Los avisos se guardan como "VENDOR:orders"; el nombre legible sale de la lista de tipos que manda el servidor.
const kindLabel = (kind, kinds) => KIND_LABEL[kind] ?? kinds.find((k) => k.key === kind)?.label ?? kind;
// El texto lleva el formato de WhatsApp (*negrita*): en la lista se muestra sin los asteriscos.
const plainBody = (body) => body.replace(/\*([^*\n]+)\*/g, "$1");

// Mismos rangos que valida el servidor (adminWhatsapp.controller.js).
const LIMITS = [
  ["hourlyLimit", "Avisos por hora", 300],
  ["dailyLimit", "Avisos por día", 3000],
  ["minDelaySec", "Pausa mínima entre mensajes (segundos)", 120],
  ["maxDelaySec", "Pausa máxima entre mensajes (segundos)", 300],
];

const dateTime = (value) =>
  value ? new Date(value).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

// Vincular, cancelar y desvincular: el código de acción, si hace falta, lo pide el panel solo (ActionCodeProvider).
function useSessionAction(path, done) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/admin/whatsapp/${path}`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      if (done) toast.success(done);
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo completar.")),
  });
}

function ConnectionCard({ data }) {
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const link = useSessionAction("link");
  const cancel = useSessionAction("cancel");
  const unlink = useSessionAction("unlink", "Número desvinculado");
  const test = useMutation({
    mutationFn: () => api.post("/admin/whatsapp/test", { phone: testPhone }).then((r) => r.data),
    onSuccess: (r) => toast.success("Mensaje de prueba en camino", `Referencia ${r.ref}. Lo ves en el historial de abajo.`),
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo enviar la prueba.")),
  });

  const { status, workerAlive } = data;
  let content;
  if (status === "CONNECTED") {
    content = (
      <>
        <p className="flex items-start gap-2 text-[14px] text-on-surface">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-verified-dark" aria-hidden="true" />
          <span>
            Vinculado al <span className="font-semibold">{data.phone}</span>
            {data.pushName ? ` (${data.pushName})` : ""}
            {data.connectedAt ? `, conectado desde el ${dateTime(data.connectedAt)}` : ""}.
          </span>
        </p>
        <form
          className="mt-5 border-t border-surface-container-high pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (testPhone) test.mutate();
          }}
        >
          <h3 className="mb-2 text-[14px] font-bold text-on-surface">Mensaje de prueba</h3>
          <PhoneInput label="Número que lo recibe" value={testPhone} onChange={setTestPhone} anyCountry />
          <Button type="submit" variant="outline" className="mt-3" disabled={!testPhone || test.isPending}>
            {test.isPending ? "Enviando..." : "Enviar prueba"}
          </Button>
        </form>
        <div className="mt-5 border-t border-surface-container-high pt-4">
          <Button variant="outline" className="border-error text-error" onClick={() => setConfirmUnlink(true)}>Desvincular número</Button>
        </div>
      </>
    );
  } else if (status === "QR" && data.qr) {
    content = (
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="self-center rounded-xl bg-white p-3 sm:self-start">
          <QRCodeSVG value={data.qr} size={220} level="M" title="Código QR para vincular WhatsApp" />
        </div>
        <div className="min-w-0">
          <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] text-on-surface">
            <li>Abre WhatsApp en el teléfono del número de la plataforma.</li>
            <li>Ve a Ajustes, Dispositivos vinculados, Vincular un dispositivo.</li>
            <li>Escanea este código. Cambia cada poco tiempo: si no funciona, espera al siguiente.</li>
          </ol>
          <Button variant="ghost" className="mt-4" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancelar</Button>
        </div>
      </div>
    );
  } else if (status === "CONNECTING" || (data.desired === "ON" && workerAlive)) {
    content = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[14px] text-on-surface">Conectando con WhatsApp...</p>
        <Button variant="ghost" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancelar</Button>
      </div>
    );
  } else {
    content = (
      <>
        {data.lastError && LAST_ERROR[data.lastError] && (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[13px] text-error">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" /> {LAST_ERROR[data.lastError]}
          </p>
        )}
        <p className="mb-4 text-[13.5px] text-on-surface-variant">
          Sin número vinculado no salen códigos ni avisos por WhatsApp. El resto de avisos (panel, notificaciones y correo) sigue igual.
        </p>
        <Button onClick={() => link.mutate()} disabled={!workerAlive || link.isPending}>
          {link.isPending ? "Pidiendo el QR..." : "Vincular con QR"}
        </Button>
      </>
    );
  }

  return (
    <section className={CARD}>
      <h2 className={H2}>Número de la plataforma</h2>
      {!workerAlive && (
        <p className="mb-4 mt-2 flex items-start gap-2 rounded-lg bg-secondary/10 px-3 py-2 text-[13px] text-on-surface">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-secondary" aria-hidden="true" />
          El proceso de WhatsApp no está en marcha en el servidor. Mientras siga así no sale nada; los avisos esperan en cola. Se arranca con npm run whatsapp.
        </p>
      )}
      <div className="mt-3">{content}</div>
      <ConfirmModal
        open={confirmUnlink}
        title="¿Desvincular el número?"
        message="Dejan de salir los códigos y los avisos por WhatsApp hasta que vuelvas a escanear un QR. Los números ya confirmados siguen confirmados."
        confirmLabel="Desvincular"
        danger
        onCancel={() => setConfirmUnlink(false)}
        onConfirm={() => {
          setConfirmUnlink(false);
          unlink.mutate();
        }}
      />
    </section>
  );
}

// Por qué no le llegan los avisos a quien mira la página. El motivo lo calcula el servidor (adminNoticeBlock en outbox.js).
const OWN_BLOCK = {
  NO_PHONE: () => "Falta tu número. El de arriba es el que envía; el tuyo, el que recibe, se pone y se confirma en Mi perfil.",
  NOT_CONFIRMED: (phone) => `Tu número ${phone} está guardado pero sin confirmar. Pide el código en Mi perfil y escríbelo ahí.`,
  PHONE_CHANGED: (phone) => `Cambiaste tu número a ${phone} y el nuevo está sin confirmar. Confírmalo en Mi perfil.`,
  SAME_AS_PLATFORM: () => "Tu número es el mismo que el de la plataforma. Un mensaje del número a sí mismo no hace sonar el teléfono: pon tu número personal en Mi perfil.",
  OPT_OUT: (phone) => `Tu número ${phone} respondió BAJA y dejó de recibir avisos. Confírmalo de nuevo en Mi perfil para volver a recibirlos.`,
};

// Vincular el número de la plataforma no activa los avisos del admin: son dos pasos distintos y este cuadro dice cómo va el segundo.
function OwnNoticesCard({ data }) {
  const navigate = useNavigate();
  const { ready, reason, phone } = data.adminNotices;
  const off = data.kinds.filter((kind) => kind.key.startsWith("ADMIN:") && !kind.enabled).map((kind) => kind.label.replace("Admin: ", ""));
  return (
    <section className={CARD}>
      <h2 className={H2}>Tus avisos</h2>
      {ready ? (
        <p className="mt-3 flex items-start gap-2 text-[14px] text-on-surface">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-verified-dark" aria-hidden="true" />
          <span>Te llegan al <span className="font-semibold">{phone}</span>.</span>
        </p>
      ) : (
        <>
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[13.5px] text-error">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span><span className="font-semibold">No te llega ningún aviso por WhatsApp.</span> {(OWN_BLOCK[reason] ?? OWN_BLOCK.NO_PHONE)(phone)}</span>
          </p>
          <p className="mt-3 text-[13px] text-on-surface-variant">
            Los avisos te siguen llegando a la campana del panel, y las tiendas nuevas también al correo.
          </p>
          <Button className="mt-4" onClick={() => navigate("/admin/perfil")}>Ir a Mi perfil</Button>
        </>
      )}
      {ready && data.paused && (
        <p className="mt-3 text-[13px] text-on-surface-variant">Los avisos están en pausa: no sale ninguno hasta que quites la pausa en Qué se envía.</p>
      )}
      {ready && off.length > 0 && (
        <p className="mt-3 text-[13px] text-on-surface-variant">Apagados en Qué se envía: {off.join("; ")}.</p>
      )}
    </section>
  );
}

function Numbers({ data }) {
  const items = [
    ["Avisos enviados en la última hora", data.counts.sentHour],
    ["Avisos enviados en 24 horas", data.counts.sentDay],
    ["En cola", data.counts.pending],
    ["Fallidos en 24 horas", data.counts.failedDay],
    ["Clientes con WhatsApp confirmado", data.confirmed.users],
    ["Tiendas con WhatsApp confirmado", data.confirmed.vendors],
    ["Números que respondieron BAJA", data.confirmed.optOuts],
  ];
  return (
    <section className={CARD}>
      <h2 className={H2}>Números</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-surface-container-high py-2.5 last:border-0">
            <dt className="text-[13px] text-on-surface-variant">{label}</dt>
            <dd className="text-[15px] font-bold tabular-nums text-on-surface">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SettingsCard({ data }) {
  const queryClient = useQueryClient();
  const [limits, setLimits] = useState(data.limits);
  useEffect(() => setLimits(data.limits), [data.limits.hourlyLimit, data.limits.dailyLimit, data.limits.minDelaySec, data.limits.maxDelaySec]);
  const save = useMutation({
    mutationFn: (body) => api.patch("/admin/whatsapp/settings", body).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo guardar.")),
  });
  const limitsDirty = Object.keys(limits).some((k) => Number(limits[k]) !== data.limits[k]);
  const field = (key, label, hint) => (
    <div key={key}>
      <Input
        label={label}
        type="number"
        inputMode="numeric"
        min={1}
        value={limits[key]}
        onChange={(e) => setLimits((l) => ({ ...l, [key]: e.target.value }))}
      />
      <p className="mt-1 text-[12px] text-on-surface-variant">{hint}</p>
    </div>
  );

  return (
    <section className={CARD}>
      <h2 className={H2}>Qué se envía</h2>
      <div className="mt-2 flex items-center justify-between gap-3 border-b border-surface-container-high pb-3">
        <div>
          <p className="text-[14px] font-semibold text-on-surface">Pausar los avisos</p>
          <p className="text-[12.5px] text-on-surface-variant">Los avisos esperan en cola. Los códigos de confirmación siguen saliendo.</p>
        </div>
        <ToggleSwitch isActive={data.paused} label="Pausar los avisos" disabled={save.isPending} onToggle={() => save.mutate({ paused: !data.paused })} />
      </div>
      <ul>
        {data.kinds.map((kind) => (
          <li key={kind.key} className="flex items-center justify-between gap-3 border-b border-surface-container-high py-2.5 last:border-0">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-on-surface">{kind.label}</p>
              {kind.hint && <p className="text-[12.5px] text-on-surface-variant">{kind.hint}</p>}
            </div>
            <ToggleSwitch
              isActive={kind.enabled}
              label={kind.label}
              disabled={save.isPending}
              onToggle={() => save.mutate({ enabledKinds: { [kind.key]: !kind.enabled } })}
            />
          </li>
        ))}
      </ul>

      <h2 className={`${H2} mt-6`}>Ritmo de envío</h2>
      <p className="mb-4 text-[12.5px] text-on-surface-variant">
        Un número nuevo que de golpe envía muchos mensajes iguales es el que WhatsApp bloquea. Empieza con topes bajos y súbelos poco a poco.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LIMITS.map(([key, label, max]) => field(key, label, `Entre 1 y ${max}.`))}
      </div>
      <Button
        className="mt-4"
        disabled={!limitsDirty || save.isPending}
        onClick={() => {
          const bad = LIMITS.find(([key, , max]) => {
            const n = Number(limits[key]);
            return !Number.isInteger(n) || n < 1 || n > max;
          });
          if (bad) {
            toast.error(`${bad[1]}: escribe un número entero entre 1 y ${bad[2]}.`);
            return;
          }
          save.mutate(
            Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, Number(v)])),
            { onSuccess: () => toast.success("Ritmo de envío guardado") }
          );
        }}
      >
        {save.isPending ? "Guardando..." : "Guardar ritmo"}
      </Button>
    </section>
  );
}

const VENDOR_STATE = {
  ON: { label: "Activos", cls: "bg-verified/15 text-verified-dark" },
  OFF: { label: "Sin activar", cls: "bg-surface-container text-on-surface-variant" },
  CHANGED: { label: "Cambió de número", cls: "bg-secondary/15 text-on-surface" },
  OPTED_OUT: { label: "Respondió BAJA", cls: "bg-error/10 text-error" },
};
const VENDOR_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "on", label: "Con WhatsApp" },
  { id: "off", label: "Sin activar" },
];

// Qué tiendas reciben avisos por WhatsApp, y activarlos o apagarlos a mano (por ejemplo, si la tienda lo pide por teléfono).
function VendorsCard() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null); // { vendor, action }
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [q]);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-whatsapp-vendors", filter, query, page],
    queryFn: () => api.get("/admin/whatsapp/vendors", { params: { filter, q: query || undefined, page } }).then((r) => r.data),
    placeholderData: (previous) => previous,
  });
  const change = useMutation({
    mutationFn: ({ vendor, action }) => api.post(`/admin/whatsapp/vendors/${vendor.id}/${action}`).then((r) => r.data),
    onSuccess: (_, { vendor, action }) => {
      toast.success(action === "activate" ? `Avisos activados para ${vendor.companyName}` : `Avisos apagados para ${vendor.companyName}`);
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-vendors"] });
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo cambiar.")),
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section id="tiendas" className={`${CARD} scroll-mt-24`}>
      <h2 className={H2}>Tiendas</h2>
      <p className="mb-3 text-[12.5px] text-on-surface-variant">
        {data ? `${data.totals.on} de ${data.totals.all} tiendas reciben avisos por WhatsApp. ` : ""}
        Si activas una a mano, le llega un mensaje de bienvenida que le explica cómo apagarlos.
      </p>
      <SearchBox value={q} onChange={setQ} label="Buscar tienda" placeholder="Nombre o WhatsApp de la tienda" className="mb-3" />
      <ChipRow className="mb-4">
        {VENDOR_FILTERS.map((f) => (
          <Chip key={f.id} size="sm" active={filter === f.id} onClick={() => { setFilter(f.id); setPage(1); }}>{f.label}</Chip>
        ))}
      </ChipRow>
      {isLoading ? (
        <ListSkeleton rows={4} avatar={false} label="Cargando tiendas" />
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-on-surface-variant">
          No se pudieron cargar las tiendas.
          <Button size="sm" variant="outline" onClick={() => refetch()}>Reintentar</Button>
        </div>
      ) : data.vendors.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] text-on-surface-variant">Ninguna tienda coincide.</p>
      ) : (
        <>
          <ul className="divide-y divide-surface-container-high">
            {data.vendors.map((v) => {
              const state = VENDOR_STATE[v.state];
              return (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="break-words text-[14px] font-semibold text-on-surface">{v.companyName}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-on-surface-variant">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${state.cls}`}>{state.label}</span>
                      <span>{v.whatsapp}</span>
                      {v.state === "ON" && v.verifiedAt && <span>desde el {dateTime(v.verifiedAt)}</span>}
                      {v.noticesSent > 0 && <span>{v.noticesSent} {v.noticesSent === 1 ? "aviso enviado" : "avisos enviados"}</span>}
                    </p>
                  </div>
                  {v.state === "ON" ? (
                    <Button size="sm" variant="outline" disabled={change.isPending} onClick={() => setConfirm({ vendor: v, action: "deactivate" })}>Apagar</Button>
                  ) : v.state === "OPTED_OUT" ? null : (
                    <Button size="sm" disabled={change.isPending} onClick={() => setConfirm({ vendor: v, action: "activate" })}>Activar</Button>
                  )}
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-on-surface-variant">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anteriores</Button>
              <span className="tabular-nums">Página {page} de {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguientes</Button>
            </div>
          )}
        </>
      )}
      <ConfirmModal
        open={Boolean(confirm)}
        title={confirm?.action === "activate" ? `¿Activar los avisos de ${confirm?.vendor.companyName}?` : `¿Apagar los avisos de ${confirm?.vendor.companyName}?`}
        message={
          confirm?.action === "activate"
            ? `Los pedidos nuevos, el stock bajo, los mensajes y el resumen semanal le llegarán al ${confirm?.vendor.whatsapp} sin que confirme un código. Hazlo solo si la tienda te lo pidió.`
            : "Deja de recibir avisos por WhatsApp. Puede volver a activarlos desde su perfil con un código."
        }
        confirmLabel={confirm?.action === "activate" ? "Activar" : "Apagar"}
        danger={confirm?.action === "deactivate"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          change.mutate(confirm);
          setConfirm(null);
        }}
      />
    </section>
  );
}

// Mensaje por WhatsApp a varias tiendas a la vez. Las reglas contra el bloqueo del número viven en el servidor
// (adminWhatsapp.controller.js): aquí solo se muestran para que el admin sepa qué va a pasar antes de enviar.
const BROADCAST_MAX = 700;
const BROADCAST_AUDIENCE = [
  { id: "ALL", label: "Todas con WhatsApp activo" },
  { id: "SELECTED", label: "Elegir tiendas" },
];

function BroadcastCard() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState("ALL");
  const [stores, setStores] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(null);
  const [draft, setDraft] = useState({ message: "", url: "", audience: "ALL", vendorIds: [] });

  // La vista previa se pide medio segundo después de dejar de escribir.
  useEffect(() => {
    const id = setTimeout(() => setDraft({ message: message.trim(), url: url.trim(), audience, vendorIds: stores.map((s) => s.id) }), 500);
    return () => clearTimeout(id);
  }, [message, url, audience, stores]);

  const preview = useQuery({
    queryKey: ["admin-whatsapp-broadcast-preview", draft],
    queryFn: () => api.post("/admin/whatsapp/broadcast/preview", draft).then((r) => r.data),
    enabled: draft.audience === "ALL" || draft.vendorIds.length > 0,
    placeholderData: (previous) => previous,
  });
  const history = useQuery({
    queryKey: ["admin-whatsapp-broadcasts"],
    queryFn: () => api.get("/admin/whatsapp/broadcasts").then((r) => r.data.broadcasts),
    refetchInterval: (query) => (query.state.data?.some((b) => b.pending > 0) ? 20_000 : false),
  });

  const send = useMutation({
    mutationFn: () => api.post("/admin/whatsapp/broadcast", { message: message.trim(), url: url.trim(), audience, vendorIds: stores.map((s) => s.id) }).then((r) => r.data),
    onSuccess: (r) => {
      toast.success(`Mensaje en cola para ${r.queued} ${r.queued === 1 ? "tienda" : "tiendas"}.`);
      setMessage("");
      setUrl("");
      setStores([]);
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-broadcasts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-broadcast-preview"] });
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo enviar el mensaje.")),
  });
  const stop = useMutation({
    mutationFn: (batch) => api.post(`/admin/whatsapp/broadcasts/${batch}/cancel`).then((r) => r.data),
    onSuccess: (r) => {
      toast.success(r.cancelled ? `Se detuvieron ${r.cancelled} mensajes sin enviar.` : "Ya no quedaban mensajes por enviar.");
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-broadcasts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-broadcast-preview"] });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo detener.")),
  });

  const p = preview.data;
  const tooShort = message.trim().length < 10;
  const blocker = !p
    ? null
    : !p.linked
      ? "El WhatsApp de la plataforma está apagado. Vincúlalo arriba antes de enviar."
      : !p.enabled
        ? "Los mensajes masivos están apagados en \"Qué se envía\", más abajo."
        : p.nextAllowedAt
          ? `Ya se envió un mensaje masivo en las últimas 24 horas. El próximo, desde el ${dateTime(p.nextAllowedAt)}.`
          : p.recipients === 0
            ? audience === "SELECTED" ? "Ninguna de las tiendas elegidas tiene los avisos por WhatsApp activos." : "Todavía ninguna tienda tiene los avisos por WhatsApp activos."
            : p.tooMany
              ? `Son ${p.recipients} tiendas y con tus topes salen unas ${p.capacity} en 48 horas. Elige menos tiendas o sube los topes.`
              : null;
  const canSend = !tooShort && p && !blocker && (audience === "ALL" || stores.length > 0) && !send.isPending;
  const duration = p && p.recipients > 0 ? (p.hours <= 1 ? "menos de una hora" : p.hours <= 13 ? `unas ${p.hours} horas` : `unos ${Math.ceil(p.recipients / p.perDay)} días`) : null;

  return (
    <section id="mensaje" className={`${CARD} scroll-mt-24`} aria-labelledby="broadcast-title">
      <h2 id="broadcast-title" className={H2}>Mensaje a tiendas</h2>
      <p className="mb-4 text-[12.5px] text-on-surface-variant">
        Llega solo a las tiendas que confirmaron su WhatsApp, empieza con el nombre de cada una y sale despacio, de 8:00 a 21:00 de Cuba,
        después de los avisos de pedidos. Uno cada 24 horas como mucho, para que WhatsApp no bloquee el número.
      </p>
      <div className="flex flex-col gap-4">
        <ChipRow>
          {BROADCAST_AUDIENCE.map((a) => (
            <Chip key={a.id} size="sm" active={audience === a.id} onClick={() => setAudience(a.id)}>{a.label}</Chip>
          ))}
        </ChipRow>
        {audience === "SELECTED" && <StorePicker value={stores} onChange={setStores} filter="on" />}
        <label className="block">
          <span className="mb-1 block text-label-md text-on-surface-variant">Mensaje <span className="text-error">*</span></span>
          <textarea
            rows={5}
            maxLength={BROADCAST_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escribe algo útil y corto: una novedad, un cambio o algo que deban hacer."
            className="w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[14px] leading-6 outline-none focus:border-tertiary-accent"
          />
          <span className="mt-1 flex flex-wrap justify-between gap-2 text-[12px] text-on-surface-variant">
            <span>*Negrita* y _cursiva_ como en WhatsApp.</span>
            <span className="tabular-nums">{message.length} / {BROADCAST_MAX}</span>
          </span>
        </label>
        <Input label="Enlace (opcional)" maxLength={300} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/vendedor/perfil" />

        {p?.sample && !tooShort && (
          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Así lo verá {audience === "SELECTED" && stores[0] ? stores[0].companyName : "la primera tienda"}</span>
            <div className="max-w-[420px] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-surface-container p-3.5 text-[13.5px] leading-6 text-on-surface">
              {plainBody(p.sample).replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1$2")}
            </div>
          </div>
        )}

        <div className="text-[13px] text-on-surface-variant" aria-live="polite">
          {audience === "SELECTED" && stores.length === 0 ? (
            "Elige al menos una tienda."
          ) : !p ? (
            preview.isError ? "No se pudo calcular a cuántas tiendas llega." : "Calculando a cuántas tiendas llega..."
          ) : (
            <>
              <p>
                Llega a <strong className="text-on-surface">{p.recipients} {p.recipients === 1 ? "tienda" : "tiendas"}</strong>
                {duration ? `, en ${duration}` : ""}.
                {p.skipped > 0 ? ` ${p.skipped} de las elegidas no lo recibirán porque no tienen WhatsApp activo o respondieron BAJA.` : ""}
              </p>
              {blocker && <p role="alert" className="mt-1 font-semibold text-error">{blocker}</p>}
            </>
          )}
        </div>
        <div>
          <Button disabled={!canSend} onClick={() => setConfirming(true)}>Enviar mensaje</Button>
        </div>
      </div>

      {history.data?.length > 0 && (
        <div className="mt-6 border-t border-surface-container-high pt-4">
          <h3 className="mb-2 text-[14px] font-bold text-on-surface">Enviados antes</h3>
          <ul className="divide-y divide-surface-container-high">
            {history.data.map((b) => (
              <li key={b.batch} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-[13px] text-on-surface">{plainBody(b.sample).split("\n").slice(2).filter((line) => line && !line.startsWith("_")).join(" ").slice(0, 160)}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-on-surface-variant">
                    <span>{dateTime(b.createdAt)}</span>
                    <span>{b.sent} de {b.total} enviados</span>
                    {b.pending > 0 && <span>{b.pending} en cola</span>}
                    {b.notSent > 0 && <span>{b.notSent} no salieron</span>}
                  </p>
                </div>
                {b.pending > 0 && (
                  <Button size="sm" variant="outline" disabled={stop.isPending} onClick={() => setStopping(b)}>Detener</Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmModal
        open={confirming}
        title={`¿Enviar el mensaje a ${p?.recipients ?? 0} ${p?.recipients === 1 ? "tienda" : "tiendas"}?`}
        message="Lo que ya salga no se puede borrar de su WhatsApp. Lo que siga en cola lo puedes detener desde aquí."
        confirmLabel="Enviar"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          send.mutate();
        }}
      />
      <ConfirmModal
        open={Boolean(stopping)}
        title="¿Detener lo que falta por enviar?"
        message={`Quedan ${stopping?.pending ?? 0} mensajes en cola. Los que ya salieron no cambian.`}
        confirmLabel="Detener"
        danger
        onCancel={() => setStopping(null)}
        onConfirm={() => {
          stop.mutate(stopping.batch);
          setStopping(null);
        }}
      />
    </section>
  );
}

function History({ kinds }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [q]);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-whatsapp-messages", status, query, page],
    queryFn: () => api.get("/admin/whatsapp/messages", { params: { status: status || undefined, q: query || undefined, page } }).then((r) => r.data),
    refetchInterval: 10_000,
    placeholderData: (previous) => previous,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className={CARD}>
      <h2 className={H2}>Historial</h2>
      <p className="mb-3 text-[12.5px] text-on-surface-variant">
        Últimos 30 días. Cada aviso lleva al pie una referencia (Ref.) que puedes buscar aquí. Los códigos de confirmación no se muestran.
      </p>
      <SearchBox value={q} onChange={setQ} label="Buscar en el historial" placeholder="Referencia o teléfono" className="mb-3" />
      <ChipRow className="mb-4">
        {MESSAGE_STATUS.map((s) => (
          <Chip key={s.id || "all"} size="sm" active={status === s.id} onClick={() => { setStatus(s.id); setPage(1); }}>
            {s.label}
          </Chip>
        ))}
      </ChipRow>
      {isLoading ? (
        <ListSkeleton rows={4} avatar={false} label="Cargando historial" />
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-on-surface-variant">
          No se pudo cargar el historial.
          <Button size="sm" variant="outline" onClick={() => refetch()}>Reintentar</Button>
        </div>
      ) : data.messages.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] text-on-surface-variant">{query || status ? "Nada coincide con la búsqueda." : "Todavía no se envió ningún mensaje."}</p>
      ) : (
        <>
          <ul className="divide-y divide-surface-container-high">
            {data.messages.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLE[m.status] ?? "bg-surface-container text-on-surface-variant"}`}>
                    {STATUS_TEXT[m.status] ?? m.status}
                  </span>
                  <span className="font-semibold text-on-surface">{m.phone}</span>
                  <span className="text-on-surface-variant">{kindLabel(m.kind, kinds)}</span>
                  <span className="font-mono text-on-surface-variant">Ref. {m.ref}</span>
                  <span className="text-on-surface-variant">{dateTime(m.sentAt ?? m.createdAt)}</span>
                </div>
                <p className="mt-1.5 line-clamp-3 whitespace-pre-line break-words text-[13px] text-on-surface">{plainBody(m.body)}</p>
                {m.lastError && m.status !== "SENT" && (
                  <p className="mt-1 text-[12px] text-on-surface-variant">{SKIP_REASON[m.lastError] ?? `Motivo: ${m.lastError}`}{m.attempts > 1 ? ` (${m.attempts} intentos)` : ""}</p>
                )}
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-on-surface-variant">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anteriores</Button>
              <span className="tabular-nums">Página {page} de {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguientes</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function AdminWhatsapp() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api.get("/admin/whatsapp").then((r) => r.data),
    // Mientras se vincula, el QR cambia cada pocos segundos.
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.status === "QR" || d.status === "CONNECTING" || d.desired !== (d.status === "CONNECTED" ? "ON" : "OFF")) ? 2500 : 15_000;
    },
  });
  const location = useLocation();
  // El buscador del admin lleva a /admin/whatsapp#tiendas: se baja a esa parte cuando ya cargó.
  useEffect(() => {
    const target = { "#tiendas": "tiendas", "#mensaje": "mensaje" }[location.hash];
    if (!data || !target) return undefined;
    const id = setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    return () => clearTimeout(id);
  }, [Boolean(data), location.hash]);

  return (
    <div className="max-w-[860px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Smartphone} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">WhatsApp</h1>
      </div>
      <p className="mb-6 text-body-md text-on-surface-variant">
        El número de la plataforma envía los códigos para confirmar números y los avisos a tiendas, clientes y admins que confirmaron el suyo.
        Tu número para recibir avisos se pone en Mi perfil.
      </p>
      {isLoading ? (
        <ListSkeleton rows={3} avatar={false} label="Cargando WhatsApp" />
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-3 text-[13.5px] text-on-surface-variant">
          No se pudo cargar el estado de WhatsApp.
          <Button size="sm" variant="outline" onClick={() => refetch()}>Reintentar</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <ConnectionCard data={data} />
          {data.status === "CONNECTED" && <OwnNoticesCard data={data} />}
          <Numbers data={data} />
          <VendorsCard />
          <BroadcastCard />
          <SettingsCard data={data} />
          <History kinds={data.kinds} />
        </div>
      )}
    </div>
  );
}
