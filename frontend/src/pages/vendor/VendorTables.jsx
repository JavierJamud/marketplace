import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { Download, Pencil, RefreshCw, Trash2, Check, X, UtensilsCrossed } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { formatElapsed } from "../../lib/duration.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { TableOrderDetailModal } from "../../components/vendor/TableOrderDetailModal.jsx";
import { CreateManualOrderModal } from "../../components/vendor/CreateManualOrderModal.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

const KITCHEN_STATUS_LABEL = { RECEIVED: "Recibido", PREPARING: "Preparando", READY: "Listo" };

// Bloque 141 (pedido explícito, reemplaza el "QR" del Bloque anterior —
// ver el comentario que ya lo marcaba como deuda en VendorSettings.jsx:
// "el único 'QR' del proyecto, en VendorTables.jsx, era decorativo, no un
// QR de verdad"): paleta fija de colores para diferenciar mesas a simple
// vista en el panel — determinística por tableNumber (mismo color siempre
// para la misma mesa, sin persistir nada nuevo en la base de datos).
const TABLE_COLORS = ["#337475", "#8A5100", "#0A8F42", "#7B4FA6", "#B5442C", "#0E6BA8", "#A6437B", "#4F6B2E"];
function colorForTable(tableNumber) {
  return TABLE_COLORS[(tableNumber - 1) % TABLE_COLORS.length];
}

// Compone el logo de la tienda dentro de un círculo con borde negro —
// pedido explícito ("el QR tendrá el logotipo encerrado en un círculo, con
// borde de línea negro, chico y responsivo") — se genera UNA vez por
// vendedor (mismo logo para todas las mesas) y se reusa como
// `imageSettings.src` del QR. Si el logo falla (CORS de un link externo,
// 404, etc.) se resuelve `null` — el QR se muestra igual, sin logo en el
// centro, nunca rompe la pantalla por esto.
function buildCircularLogoDataUrl(logoUrl, size = 160) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const radius = size / 2;

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(radius, radius, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.arc(radius, radius, radius - 4, 0, Math.PI * 2);
        ctx.clip();
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, radius - w / 2, radius - h / 2, w, h);
        ctx.restore();

        ctx.strokeStyle = "#0e1a28";
        ctx.lineWidth = size * 0.035;
        ctx.beginPath();
        ctx.arc(radius, radius, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.stroke();

        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });
}

// Rectángulo redondeado manual — Canvas2D `roundRect()` es nativo en
// navegadores recientes, pero no en todos (Safari lo suma recién en 2023),
// así que se dibuja a mano para no depender de eso.
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Bloque 141 (pedido explícito — "al descargar el QR, debajo, una línea
// que sale desde el mismo QR con un contenedor que muestre 'Mesa N', con
// el mismo nombre configurado en el panel"): compone en un canvas nuevo,
// más alto, el QR + una línea vertical + una etiqueta redondeada con el
// nombre de la mesa, y dispara la descarga como PNG — todo en un solo
// archivo, listo para imprimir.
function downloadTableQr(qrCanvasEl, label) {
  const qrSize = qrCanvasEl.width;
  const padding = 32;
  const lineLength = 36;
  const labelHeight = 56;
  const canvas = document.createElement("canvas");
  canvas.width = qrSize + padding * 2;
  canvas.height = qrSize + padding * 2 + lineLength + labelHeight + 12;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(qrCanvasEl, padding, padding);

  const cx = canvas.width / 2;
  const lineTop = padding + qrSize;
  const lineBottom = lineTop + lineLength;
  ctx.strokeStyle = "#0e1a28";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, lineTop);
  ctx.lineTo(cx, lineBottom);
  ctx.stroke();

  ctx.font = "bold 26px Arial, sans-serif";
  const textWidth = ctx.measureText(label).width;
  const boxW = Math.max(textWidth + 56, 120);
  const boxX = cx - boxW / 2;
  const boxY = lineBottom;
  ctx.fillStyle = "#0e1a28";
  roundRectPath(ctx, boxX, boxY, boxW, labelHeight, 14);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, boxY + labelHeight / 2 + 1);

  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `${label.toLowerCase().replace(/\s+/g, "-")}-qr.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function TableCard({ table, logoDataUrl, tableUrl, canManageTable, canManageOrders }) {
  const queryClient = useQueryClient();
  const canvasRef = useRef(null);
  const [renaming, setRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState(table.label ?? "");
  const [confirmAction, setConfirmAction] = useState(null); // "regenerate" | "delete" | null
  // Bloque 168 (pedido explícito — "las mesas ocupadas deben mostrar un
  // botón de ver pedido de la mesa y se mostrará una ventana emergente"):
  // guarda CUÁL de los pedidos de esta mesa se está viendo en detalle (o
  // null si el modal está cerrado) — una mesa puede tener más de uno.
  const [viewingOrderId, setViewingOrderId] = useState(null);
  // Bloque 173 (pedido explícito — "el camarero puede crear un nuevo
  // pedido asignado para una mesa en específico ya que a lo mejor nadie
  // pide escaneando el código"): solo tiene sentido ofrecerlo cuando la
  // mesa está libre (occupied más abajo) — si ya hay una cuenta abierta,
  // el camino es "Ver pedido" → "Agregar consumo" (TableOrderDetailModal).
  const [creatingOrder, setCreatingOrder] = useState(false);
  // Bloque 164 (pedido explícito — "debe mostrar todos los detalles como
  // qué tiempo lleva el cliente en mesa"): forzar un re-render cada 30s es
  // lo único que hace falta para que el texto de tiempo transcurrido siga
  // corriendo solo, sin depender de que la query de "my-tables" se
  // refetchee (createdAt no cambia, formatElapsed sí necesita "ahora").
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const label = table.label || `Mesa ${table.tableNumber}`;
  const color = colorForTable(table.tableNumber);
  const openOrder = table.tableOrders[0];
  const occupied = table.tableOrders.length > 0;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["my-tables"] });

  const saveLabel = useMutation({
    mutationFn: async () => (await api.patch(`/tables/me/${table.id}`, { label: labelDraft.trim() || null })).data,
    onSuccess: () => {
      toast.success("Mesa renombrada.");
      setRenaming(false);
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo renombrar la mesa."),
  });

  const regenerateQr = useMutation({
    mutationFn: async () => (await api.post(`/tables/me/${table.id}/regenerate-qr`)).data,
    onSuccess: () => {
      toast.success("QR regenerado — el anterior dejó de funcionar. Reimprimí el nuevo.");
      setConfirmAction(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo regenerar el QR.");
      setConfirmAction(null);
    },
  });

  const deleteTable = useMutation({
    mutationFn: async () => api.delete(`/tables/me/${table.id}`),
    onSuccess: () => {
      toast.success("Mesa eliminada.");
      setConfirmAction(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar la mesa.");
      setConfirmAction(null);
    },
  });

  return (
    <div
      className="rounded-lg border-t-[3px] bg-surface-container-lowest p-4 text-center shadow-sm sm:p-5"
      style={{ borderTopColor: color }}
    >
      <div className="mb-3.5 flex items-center justify-between gap-2">
        {renaming ? (
          <div className="flex flex-1 items-center gap-1">
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder={`Mesa ${table.tableNumber}`}
              maxLength={40}
              className="h-8 min-w-0 flex-1 rounded border border-outline-variant px-2 text-[13px] outline-none focus:border-tertiary-accent"
            />
            <button onClick={() => saveLabel.mutate()} disabled={saveLabel.isPending} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-verified hover:bg-verified/10">
              <Check className="h-4 w-4" />
            </button>
            <button onClick={() => { setRenaming(false); setLabelDraft(table.label ?? ""); }} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-outline hover:bg-surface-container">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : canManageTable ? (
          <button onClick={() => setRenaming(true)} className="flex items-center gap-1.5 font-display text-base font-bold text-on-surface hover:text-tertiary-accent" title="Renombrar mesa">
            <span style={{ color }}>●</span> {label} <Pencil className="h-3 w-3 opacity-50" />
          </button>
        ) : (
          <span className="flex items-center gap-1.5 font-display text-base font-bold text-on-surface">
            <span style={{ color }}>●</span> {label}
          </span>
        )}
        <span
          className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
          style={occupied ? { background: "rgba(138,81,0,0.12)", color: "#8A5100" } : { background: "rgba(12,174,83,0.12)", color: "#0A8F42" }}
        >
          {occupied ? "Ocupada" : "Libre"}
        </span>
      </div>

      {/* Bloque 141: pedido de verdad recibido en esta mesa (RECEIVED, sin
          liberar) — muestra el nombre del cliente acá mismo, para que el
          vendedor sepa a quién buscar antes de ir a "Pedidos" a
          verificarlo/aceptarlo. */}
      {/* Bloque 164 (pedido explícito — "debe salir el monto a pagar en
          todo momento, debe mostrar todos los detalles como qué tiempo
          lleva el cliente en mesa"): mismo bloque de arriba, ahora con el
          monto del pedido activo y hace cuánto está sentada la mesa (desde
          que se hizo ESE pedido — si hubo varios sin liberar, desde el más
          reciente, que es justo `openOrder`). */}
      {openOrder && (
        // Bloque 185 (bug real reportado en vivo, con captura — "donde
        // muestra el pedido muestra la información muy desorganizada"): antes
        // "Monto" y "En mesa" iban en una sola fila flex-justify-between que
        // se apretaba/envolvía feo en tarjetas angostas (grid de 4 columnas
        // en desktop, o el nombre del cliente largo empujando todo). Grid de
        // 2 columnas con label arriba/valor abajo — cada dato tiene su
        // propio espacio fijo, nunca compite por línea con el de al lado.
        <div className="mb-3 rounded-md bg-surface-container p-2.5 text-on-surface-variant">
          {openOrder.customerName && (
            <p className="mb-1.5 truncate text-[11.5px] font-semibold">
              Pidió: <span className="font-bold text-on-surface">{openOrder.customerName}</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 border-t border-surface-container-high pt-1.5">
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-wide text-outline">Monto</p>
              <p className="text-[13px] font-bold text-primary">{fmtCUP(openOrder.total)}</p>
            </div>
            <div className="text-right">
              <p className="text-[9.5px] font-bold uppercase tracking-wide text-outline">En mesa</p>
              <p className="text-[13px] font-bold text-on-surface">{formatElapsed(openOrder.createdAt)}</p>
            </div>
          </div>
          {/* Bloque 186 (bug real reportado en vivo, con captura — "hay dos
              botones de ver pedido en la tarjeta del QR, solo debe quedar
              el primero... cuando se hace clic en el primer botón de ver
              pedido debe mostrarse el mismo pedido que se muestra al hacer
              clic en el botón de ver pedido de la sección de Pedidos"):
              reemplaza el paso intermedio de "Ver el pedido" (que solo
              desplegaba un resumen con OTRO botón "Ver pedido →" adentro)
              — ahora un solo clic abre directo TableOrderDetailModal, el
              MISMO componente que usa VendorOrders.jsx (Bloque 175), así
              que muestra exactamente la misma información sin duplicar
              nada. Un botón por pedido sin liberar de esta mesa — lo
              normal es que haya uno solo. */}
          <div className="mt-2 flex flex-col gap-1.5">
            {table.tableOrders.map((o) => (
              <button
                key={o.id}
                onClick={() => setViewingOrderId(o.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md bg-surface-container-lowest px-2.5 py-1.5 text-left text-[11px] font-bold text-tertiary-accent hover:underline"
              >
                <span className="truncate text-on-surface">
                  Pedido #{o.orderNumber} · {KITCHEN_STATUS_LABEL[o.kitchenStatus] ?? o.kitchenStatus}
                </span>
                <span className="flex-shrink-0">Ver pedido →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!occupied && canManageOrders && (
        <button
          onClick={() => setCreatingOrder(true)}
          className="mb-3 w-full rounded-md bg-tertiary-accent/10 py-1.5 text-[11.5px] font-bold text-tertiary-accent hover:bg-tertiary-accent/20"
        >
          + Crear pedido en esta mesa
        </button>
      )}

      <div className="mx-auto mb-3 flex aspect-square w-full max-w-[150px] items-center justify-center rounded-md border border-surface-container-high bg-white p-2">
        <QRCodeCanvas
          ref={canvasRef}
          value={tableUrl}
          size={512}
          level="H"
          fgColor="#0e1a28"
          style={{ width: "100%", height: "100%" }}
          imageSettings={
            logoDataUrl
              ? { src: logoDataUrl, height: 512 * 0.22, width: 512 * 0.22, excavate: true }
              : undefined
          }
        />
      </div>

      <div className="mb-2.5 flex gap-2">
        <Link to={`/mesa/${table.qrToken}`} target="_blank" className="flex-1 rounded-[7px] bg-primary-container py-2 text-[12px] font-semibold text-white">
          Ver menú
        </Link>
        <button
          onClick={() => downloadTableQr(canvasRef.current, label)}
          className="flex flex-1 items-center justify-center gap-1 rounded-[7px] bg-secondary-container py-2 text-[12px] font-semibold text-on-secondary-container"
        >
          <Download className="h-3.5 w-3.5" /> Descargar
        </button>
      </div>
      {canManageTable && (
        <div className="flex gap-2">
          <button
            onClick={() => setConfirmAction("regenerate")}
            className="flex flex-1 items-center justify-center gap-1 rounded-[7px] bg-surface-container py-2 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container-high"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Nuevo QR
          </button>
          <button
            onClick={() => setConfirmAction("delete")}
            className="flex flex-1 items-center justify-center gap-1 rounded-[7px] bg-error/10 py-2 text-[12px] font-semibold text-error hover:bg-error/20"
          >
            <Trash2 className="h-3.5 w-3.5" /> Eliminar
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmAction === "regenerate"}
        title={`¿Regenerar el QR de ${label}?`}
        message="El QR impreso que tiene esta mesa ahora mismo va a dejar de funcionar de inmediato. Vas a tener que descargar e imprimir el nuevo."
        confirmLabel={regenerateQr.isPending ? "Regenerando..." : "Regenerar"}
        confirmDisabled={regenerateQr.isPending}
        onConfirm={() => regenerateQr.mutate()}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmModal
        open={confirmAction === "delete"}
        title={`¿Eliminar ${label}?`}
        message="Esta acción no se puede deshacer. Si la mesa tiene un pedido sin liberar todavía, no se va a poder eliminar."
        confirmLabel={deleteTable.isPending ? "Eliminando..." : "Eliminar"}
        confirmDisabled={deleteTable.isPending}
        danger
        onConfirm={() => deleteTable.mutate()}
        onCancel={() => setConfirmAction(null)}
      />

      {viewingOrderId && (
        <TableOrderDetailModal orderId={viewingOrderId} tableLabel={label} onClose={() => setViewingOrderId(null)} />
      )}
      {creatingOrder && (
        <CreateManualOrderModal
          tableId={table.id}
          tableLabel={label}
          onClose={() => setCreatingOrder(false)}
          onCreated={(order) => setViewingOrderId(order.id)}
        />
      )}
    </div>
  );
}

export default function VendorTables() {
  const queryClient = useQueryClient();
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  // Bloque 185: null para dueño/admin (sin restricción) — un usuario de
  // sistema en "solo lectura" en mesas/pedidos puede seguir viendo esta
  // pantalla en vivo, pero sin ningún botón de acción real.
  const { staffSectionPermissions } = useOutletContext() ?? {};
  const canManageTable = canWriteSection(staffSectionPermissions, "mesas");
  const canManageOrders = canWriteSection(staffSectionPermissions, "mesas") || canWriteSection(staffSectionPermissions, "pedidos");

  const { data, isLoading } = useQuery({
    queryKey: ["my-tables"],
    queryFn: async () => (await api.get("/tables/me")).data.tables,
    // Bloque 168 (pedido explícito — "los cambios de los estados de los
    // pedidos y de las mesas ocupadas o liberadas deben ser en tiempo
    // real sin tener que recargar el sistema"): antes esta lista solo se
    // refrescaba cuando ESTE mismo vendedor hacía una acción propia — un
    // pedido nuevo de un cliente, o un cambio hecho desde otra sesión/
    // camarero, se quedaba invisible hasta un F5 manual. Bloque 185: bajado
    // de 8000 a 4000 ("todo será en tiempo real") — sigue siendo polling,
    // pero a la mitad del intervalo.
    refetchInterval: 4000,
  });

  const { data: vendor } = useQuery({
    queryKey: ["my-vendor-settings"],
    queryFn: async () => (await api.get("/vendors/me")).data.vendor,
  });

  // Bloque 141: el logo se resuelve UNA vez por vendedor (no por mesa) y se
  // reusa en todos los QR — mismo criterio de absoluta/relativa que el
  // resto del sitio (imgUrl-style).
  useEffect(() => {
    if (!vendor?.logoUrl) {
      setLogoDataUrl(null);
      return;
    }
    const url = /^https?:\/\//.test(vendor.logoUrl) ? vendor.logoUrl : `${api.defaults.baseURL}${vendor.logoUrl}`;
    let cancelled = false;
    buildCircularLogoDataUrl(url).then((dataUrl) => {
      if (!cancelled) setLogoDataUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [vendor?.logoUrl]);

  // Bloque 168 (bug real reportado en vivo — "se agregan pero no muestra
  // nada indicando que se creó un nuevo QR para una mesa"): la mesa se
  // agregaba de verdad (al final de la lista, la próxima en número) pero
  // sin ningún aviso — quedaba en el vendedor adivinar si de verdad pasó
  // algo con solo mirar si apareció una tarjeta más.
  const addTable = useMutation({
    mutationFn: async () => (await api.post("/tables/me")).data,
    onSuccess: ({ table }) => {
      toast.success(`Se agregó la mesa #${table.tableNumber} con su propio QR.`);
      queryClient.invalidateQueries({ queryKey: ["my-tables"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo agregar la mesa."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando mesas...</p>;

  return (
    <div>
      <div className="mb-[22px] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconCircle icon={UtensilsCrossed} tone="teal" />
          <div>
            <h1 className="mb-1 font-display text-[22px] font-extrabold tracking-tight text-on-surface sm:text-[26px]">Mesas y códigos QR</h1>
            <p className="text-[13px] text-outline sm:text-[13.5px]">
              Cada mesa tiene un QR único y real — el cliente lo escanea, ve el menú y pide sin necesitar cuenta.
            </p>
          </div>
        </div>
        {canManageTable && (
          <button
            onClick={() => addTable.mutate()}
            disabled={addTable.isPending}
            className="flex-shrink-0 rounded-full bg-secondary-container px-[18px] py-2.5 text-[13.5px] font-bold text-on-secondary-container"
          >
            + Agregar mesa
          </button>
        )}
      </div>

      {/* Bloque 141 (pedido explícito — "busca alguna alternativa para
          cuando le hacen una foto al QR y lo usan desde afuera"): la
          defensa real es "Nuevo QR" en cada mesa (invalida el anterior de
          una) — se explica acá arriba, una sola vez, en vez de repetirlo
          en cada tarjeta. */}
      <div className="mb-5 rounded-lg bg-tertiary-accent/10 px-4 py-3 text-[12.5px] text-tertiary-accent">
        💡 Si sospechas que alguien fotografió y está usando el QR de una mesa desde afuera del local, toca "Nuevo QR"
        en esa mesa — el código viejo deja de funcionar al instante y puedes imprimir uno nuevo.
      </div>

      {/* Bloque 175 (pedido explícito — "quiero que la sección de mesas QR
          sea más responsiva"): antes arrancaba en 2 columnas incluso en un
          celular angosto (~360-390px) — el QR de 150px fijo + el padding de
          la tarjeta no entraban bien 2 al hilo. Ahora 1 columna hasta sm,
          y el QR pasa a ser responsivo (max-w-[150px] en vez de w-[150px]
          fijo, ver TableCard) en vez de desbordar. */}
      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 sm:gap-[18px] md:grid-cols-3 lg:grid-cols-4">
        {data?.map((t) => (
          <TableCard
            key={t.id}
            table={t}
            logoDataUrl={logoDataUrl}
            // Bloque 161: VITE_LAN_ORIGIN (solo en .env.development, ver ese
            // archivo) fuerza una IP de la red local en vez de
            // window.location.origin — únicamente para poder escanear el QR
            // de verdad desde un celular en el mismo WiFi durante pruebas.
            tableUrl={`${import.meta.env.VITE_LAN_ORIGIN || window.location.origin}/mesa/${t.qrToken}`}
            canManageTable={canManageTable}
            canManageOrders={canManageOrders}
          />
        ))}
      </div>
      {data?.length === 0 && <p className="text-body-md text-on-surface-variant">Todavía no agregaste ninguna mesa.</p>}
    </div>
  );
}
