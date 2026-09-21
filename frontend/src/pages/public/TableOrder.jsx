import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Plus, Minus, UtensilsCrossed, Clock, ChefHat, PartyPopper, XCircle, CheckCircle2, Store, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { StoreHeaderBanner } from "../../components/StoreHeaderBanner.jsx";
import { DigitalMenuProductCard, DIGITAL_MENU_GRID_CLASS } from "../../components/DigitalMenuProductCard.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Bloque 185 (pedido explícito — "después de marcar el estado de listo...
// cuando el vendedor marca el pedido como entregado a la mesa, el cliente
// puede ver el cambio del estado del pedido como pedido entregado en la
// mesa o pedido servido"): `deliveredAt` (columna aparte del enum
// KitchenStatus, ver markTableOrderDelivered en tables.controller.js) es
// lo que decide este 4º paso virtual — kitchenStatus se queda en READY para
// siempre después de "Listo" (no hay un valor DELIVERED en el enum), así
// que acá se resuelve el paso mostrado combinando los dos.
const KITCHEN_STEPS = [
  { status: "RECEIVED", label: "Recibido", icon: Clock, description: "El equipo ya lo vio — en breve lo confirman contigo en la mesa." },
  { status: "PREPARING", label: "Preparando", icon: ChefHat, description: "Tu pedido se está preparando." },
  { status: "READY", label: "¡Listo!", icon: PartyPopper, description: "Tu pedido está listo." },
  { status: "DELIVERED", label: "¡Servido en tu mesa!", icon: CheckCircle2, description: "Ya te lo llevaron a la mesa — ¡buen provecho!" },
];

function resolveDisplayStatus(activeOrder) {
  return activeOrder.deliveredAt ? "DELIVERED" : activeOrder.kitchenStatus;
}

// Bloque 190 (pedido explícito — "el cliente, ya servida su mesa y en
// espera del cierre de la cuenta, sigue agregando cosas... esos nuevos
// productos deben empezar en revisando pedido, luego preparando, y así
// cada paso, así que cada producto dentro de su pedido debe mostrar el
// estado"): mismo texto que ve el vendedor (ITEM_STATUS_LABEL,
// TableOrderDetailModal.jsx) para esta misma línea — sin `it.status`
// (pedidos viejos, de antes de este bloque) se asume el estado de toda la
// cuenta, la mejor estimación disponible.
const ITEM_STATUS_LABEL = { RECEIVED: "Revisando", PREPARING: "Preparando", READY: "Listo" };
const ITEM_STATUS_STYLE = {
  RECEIVED: "bg-error/10 text-error",
  PREPARING: "bg-tertiary-accent/15 text-tertiary-accent",
  READY: "bg-verified/15 text-verified-dark",
};

// Bloque 185 (pedido explícito — "en vez de ponerse la pantalla blanca al
// cliente, mejor mostrar una pantalla de agradecimiento... deseándole una
// feliz tarde o noche o día dependiendo la hora"): hora LOCAL del
// dispositivo del cliente (no la del servidor) — es quien está sentado en
// la mesa ahora mismo, tiene sentido que el saludo sea el suyo.
function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "¡Buenos días!";
  if (hour < 19) return "¡Buenas tardes!";
  return "¡Buenas noches!";
}

// Bloque 185: mismo criterio general que ItemSourceBadge (panel de
// vendedor, TableOrderDetailModal.jsx) — `item.source` viene del backend
// (makeOrderItem, tables.controller.js); ausente (pedidos viejos, de antes
// de este bloque) no muestra nada.
// Bloque 189 (pedido explícito — "el cliente no verá el nombre en la mesa,
// solo verá 'pedido agregado por el mesero'"): a propósito NUNCA recibe ni
// muestra `addedByName` — el nombre real de quién lo cargó es información
// interna del negocio (visible solo en su propio panel, con el primer
// nombre nada más), el cliente en la mesa siempre ve el mismo texto
// genérico sin importar quién fue.
function ItemSourceBadge({ source }) {
  if (source === "staff") {
    return (
      <span className="mt-1 flex w-fit items-center gap-1 rounded-full bg-secondary-container px-1.5 py-0.5 text-[9.5px] font-bold text-on-secondary-container">
        <Store className="h-2.5 w-2.5" /> Agregado por el mesero
      </span>
    );
  }
  if (source === "customer") {
    // Bloque 189 (pedido explícito — "el cliente también en su página, en
    // vez de ver 'Tu pedido', a los que va agregando dirán 'agregado por
    // el cliente'"): mismo texto que ve el vendedor en su panel para esta
    // misma línea (TableOrderDetailModal.jsx) — ya no personalizado en
    // segunda persona.
    return (
      <span className="mt-1 flex w-fit items-center gap-1 rounded-full bg-tertiary-accent/10 px-1.5 py-0.5 text-[9.5px] font-bold text-tertiary-accent">
        <UtensilsCrossed className="h-2.5 w-2.5" /> Agregado por el cliente
      </span>
    );
  }
  return null;
}

// Bloque 172 (pedido explícito — "todos los que escaneen el QR de la mesa
// podrán ver la cuenta de la mesa en tiempo real mientras están en la
// mesa"): reemplaza por completo el modelo anterior (localStorage por
// dispositivo + recuperación por número de pedido/nombre) — ahora la cuenta
// es de LA MESA, no de quien la pidió, y este componente solo refleja lo
// que trae getTableByToken (table.activeOrder), con polling propio para
// verse en vivo sin recargar. No guarda nada en localStorage.
function ActiveOrderView({ activeOrder, vendorName }) {
  const displayStatus = resolveDisplayStatus(activeOrder);
  const stepIndex = KITCHEN_STEPS.findIndex((s) => s.status === displayStatus);
  const currentStep = KITCHEN_STEPS[stepIndex] ?? KITCHEN_STEPS[0];
  const canOrderMore = activeOrder.kitchenStatus !== "RECEIVED";

  return (
    <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
      <h2 className="mb-3 font-display text-title-lg text-on-surface">Cuenta de la mesa</h2>

      <div className="mb-4 flex items-center justify-between rounded-lg bg-surface-container p-4">
        <div className="flex items-center gap-2.5">
          <currentStep.icon className="h-5 w-5 flex-shrink-0 text-primary" />
          <div>
            <p className="text-body-md font-bold text-on-surface">{currentStep.label}</p>
            <p className="text-label-sm text-outline">{currentStep.description}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {activeOrder.items.map((it, i) => {
          // Bloque 190: sin `it.status` (pedidos viejos) se asume el
          // estado de toda la cuenta.
          const itemStatus = it.status ?? activeOrder.kitchenStatus;
          return (
            <div key={it.id ?? i} className="rounded-md border border-surface-container-high bg-surface-container px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-body-md text-on-surface">
                    {it.quantity} × {it.name}
                  </span>
                  {/* Bloque 185 (pedido explícito — "el cliente... podrá ver
                      en la cuenta de la mesa el precio por unidad de cada
                      producto"). */}
                  <p className="text-[11px] text-outline">{fmtCUP(it.price)} c/u</p>
                </div>
                <span className="flex-shrink-0 text-label-md font-semibold text-on-surface-variant">{fmtCUP(it.price * it.quantity)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {it.source && <ItemSourceBadge source={it.source} />}
                {/* Bloque 190 (pedido explícito — "cada producto dentro de
                    su pedido debe mostrar el estado"): por si el cliente
                    sigue agregando cosas a una cuenta ya servida — cada
                    ronda avanza sola, sin depender del resto de la
                    cuenta. */}
                <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${ITEM_STATUS_STYLE[itemStatus] ?? ITEM_STATUS_STYLE.RECEIVED}`}>
                  {ITEM_STATUS_LABEL[itemStatus] ?? itemStatus}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-surface-container-high pt-4">
        <p className="text-title-lg text-on-surface">Total</p>
        <p className="text-headline-md text-primary">{fmtCUP(activeOrder.total)}</p>
      </div>

      {!canOrderMore && (
        <p className="mt-3 text-[12px] text-outline">
          En cuanto {vendorName} confirme el pedido vas a poder agregar más productos a esta misma cuenta.
        </p>
      )}
    </div>
  );
}

// Bloque 185 (bug/pedido explícito — "cuando se marque el pedido como
// cobrado y liberar mesa, en vez de ponerse la pantalla blanca al cliente,
// mejor mostrar una pantalla de agradecimiento por visitar nuestro local,
// deseándole una feliz tarde o noche o día dependiendo la hora, y un botón
// para seguir ordenando en la mesa"): pantalla dedicada de verdad — oculta
// el resto de la página (no un simple cartel arriba del formulario) hasta
// que el cliente elige seguir pidiendo; recién ahí aparece el menú de
// nuevo, como si escaneara el QR por primera vez.
function ThankYouScreen({ vendorName, onContinue }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-verified/30 bg-verified/5 px-6 py-10 text-center">
      <Sparkles className="mb-3 h-9 w-9 text-verified" />
      <h2 className="mb-1.5 font-display text-title-lg text-on-surface">{timeOfDayGreeting()}</h2>
      <p className="mb-1 text-body-md font-semibold text-on-surface">Ha sido un placer atenderle.</p>
      <p className="mb-6 max-w-sm text-[13px] text-on-surface-variant">Gracias por visitar {vendorName} — esperamos verlo pronto de nuevo.</p>
      <Button size="lg" onClick={onContinue}>
        Seguir ordenando en esta mesa
      </Button>
    </div>
  );
}

export default function TableOrder() {
  const { qrToken } = useParams();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState({}); // { productId: quantity }
  const [customerName, setCustomerName] = useState("");
  const [justClosed, setJustClosed] = useState(false);

  // Bloque 172: única fuente de verdad — trae table.activeOrder (o null si
  // la mesa no tiene ninguna cuenta abierta ahora mismo). Polling propio
  // para que el cambio de estado/consumo se vea solo, sin recargar.
  const { data: table, isLoading } = useQuery({
    queryKey: ["table", qrToken],
    queryFn: async () => (await api.get(`/tables/qr/${qrToken}`)).data.table,
    refetchInterval: 5000,
  });

  const { data: vendorFull } = useQuery({
    queryKey: ["vendor", table?.vendor?.slug],
    queryFn: async () => (await api.get(`/vendors/${table.vendor.slug}`)).data.vendor,
    enabled: !!table?.vendor?.slug,
  });

  const activeOrder = table?.activeOrder ?? null;
  // Bloque 197 (bug real reportado en vivo — el motivo de cancelación nunca
  // se veía salvo que la pestaña siguiera abierta en el instante exacto del
  // cambio, porque `activeOrder` del backend EXCLUYE a propósito los
  // pedidos cancelados): campo aparte que el backend solo llena cuando el
  // pedido más reciente de la mesa es justo el cancelado — sobrevive un
  // refresh de página, a diferencia de justClosed/hadOrderId de abajo.
  const lastCancelledOrder = table?.lastCancelledOrder ?? null;

  // Bloque 172 (pedido explícito — "una vez se cierre la cuenta... si vuelve
  // a escanear es como crear una cuenta nueva... la página del cliente se
  // recarga y se empieza un nuevo pedido"): detecta la transición de "había
  // una cuenta activa" a "ya no hay ninguna" (se cobró/liberó, o se
  // canceló) puramente a partir de lo que ya trae el polling — sin guardar
  // nada propio, sin re-fetch extra. justClosed solo dispara un cartel
  // breve antes de caer sola al formulario de pedir en blanco.
  const [hadOrderId, setHadOrderId] = useState(undefined);
  if (activeOrder?.id !== hadOrderId) {
    if (hadOrderId && !activeOrder) setJustClosed(true);
    setHadOrderId(activeOrder?.id ?? null);
  }

  const placeOrder = useMutation({
    mutationFn: async () => {
      const items = Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([productId, quantity]) => {
          const product = table.vendor.products.find((p) => p.id === productId);
          return { productId, name: product.name, quantity, price: Number(product.price) };
        });
      return (await api.post(`/tables/qr/${qrToken}/order`, { items, customerName: customerName.trim() })).data;
    },
    onSuccess: () => {
      setCart({});
      setCustomerName("");
      setJustClosed(false);
      toast.success("¡Pedido enviado!");
      queryClient.invalidateQueries({ queryKey: ["table", qrToken] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el pedido."),
  });

  if (isLoading) return <div className="container-app py-14 text-center text-body-md text-on-surface-variant">Cargando menú...</div>;

  if (!table) {
    return (
      <div className="container-app py-14">
        <EmptyState icon={UtensilsCrossed} title="Mesa no encontrada" description="Este código QR no corresponde a ninguna mesa activa." />
      </div>
    );
  }

  if (!vendorFull) return <div className="container-app py-14 text-center text-body-md text-on-surface-variant">Cargando menú...</div>;

  const total = Object.entries(cart).reduce((sum, [productId, qty]) => {
    const product = table.vendor.products.find((p) => p.id === productId);
    return sum + (product ? Number(product.price) * qty : 0);
  }, 0);
  const validName = customerName.trim().length > 0;
  const isClosed = vendorFull.isOpenNow === false;
  // Bloque 172: mientras el pedido de la mesa sigue RECEIVED (todavía sin
  // que el mesero lo confirme), no se puede mandar otro — evita 2 cuentas
  // sueltas a la vez sobre la misma mesa.
  const blockedByPendingApproval = activeOrder?.kitchenStatus === "RECEIVED";

  return (
    <div>
      <StoreHeaderBanner vendor={vendorFull} tableLabel={table.label || `Mesa ${table.tableNumber}`} minimal />

      {/* Misma "hoja" que Store.jsx — ver el comentario largo ahí:
          -mt-10/rounded-t-[40px] superpuesto sobre el "colchón" de color
          vacío que el banner reserva de más en su zona superior (modo
          minimal, StoreHeaderBanner.jsx), nunca sobre contenido real. */}
      <div className="relative -mt-10 rounded-t-[40px] bg-background">
      <div className="container-app max-w-lg py-8">
        {justClosed && !activeOrder && !lastCancelledOrder ? (
          <ThankYouScreen vendorName={table.vendor.companyName} onContinue={() => setJustClosed(false)} />
        ) : (
          <>
        {lastCancelledOrder && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/5 p-4">
            <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" />
            <div>
              <p className="font-bold text-error">Este pedido fue cancelado</p>
              {lastCancelledOrder.cancelReason && <p className="text-[13px] text-on-surface-variant">{lastCancelledOrder.cancelReason}</p>}
            </div>
          </div>
        )}

        {activeOrder && (
          <div className="mb-5">
            <ActiveOrderView activeOrder={activeOrder} vendorName={table.vendor.companyName} />
          </div>
        )}

        {blockedByPendingApproval ? null : (
          <>
            {activeOrder && (
              <h3 className="mb-3 font-display text-title-md text-on-surface">Agregar a la cuenta</h3>
            )}

            {isClosed && (
              <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-4 text-center">
                <p className="font-bold text-error">Este local está cerrado ahora</p>
                {vendorFull.nextOpenLabel && <p className="mt-0.5 text-[13px] text-on-surface-variant">{vendorFull.nextOpenLabel}</p>}
                <p className="mt-1.5 text-[12px] text-outline">Puedes ver el menú, pero no se puede enviar un pedido hasta que abra.</p>
              </div>
            )}

            <div className={DIGITAL_MENU_GRID_CLASS}>
              {table.vendor.products.map((p) => {
                const outOfStock = !p.unlimitedStock && Number(p.stock) === 0;
                const atStockLimit = !p.unlimitedStock && (cart[p.id] ?? 0) >= p.stock;
                return (
                  <DigitalMenuProductCard
                    key={p.id}
                    image={imgUrl(p.images?.[0])}
                    imageAlt={p.name}
                    name={p.name}
                    description={p.description}
                    rating={Number(p.rating)}
                    reviewCount={p.reviewCount}
                    grayscale={outOfStock}
                    badge={
                      outOfStock ? (
                        <span className="flex-shrink-0 rounded-full bg-error/10 px-2 py-0.5 text-[10px] font-bold text-error">Sin stock</span>
                      ) : null
                    }
                    price={fmtCUP(p.price)}
                    oldPrice={p.oldPrice ? fmtCUP(p.oldPrice) : null}
                    discountPercent={p.oldPrice ? Math.round(100 - (Number(p.price) / Number(p.oldPrice)) * 100) : null}
                    action={
                      !outOfStock && (
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <button
                            className="rounded border border-outline-variant p-1.5"
                            onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))}
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-6 text-center">{cart[p.id] ?? 0}</span>
                          <button
                            className="rounded border border-outline-variant p-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={atStockLimit}
                            title={atStockLimit ? "No hay más stock disponible" : undefined}
                            onClick={() =>
                              setCart((c) => {
                                const current = c[p.id] ?? 0;
                                if (!p.unlimitedStock && current >= p.stock) return c;
                                return { ...c, [p.id]: current + 1 };
                              })
                            }
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    }
                  />
                );
              })}
              {table.vendor.products.length === 0 && (
                <p className="text-body-md text-on-surface-variant">Este restaurante todavía no habilitó productos para el menú QR.</p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-surface-container-high pt-4">
              <p className="text-title-lg text-on-surface">Total</p>
              <p className="text-headline-md text-primary">{fmtCUP(total)}</p>
            </div>

            {!activeOrder && (
              <div className="mt-4">
                <Input
                  label="Tu nombre"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="¿Cómo te llamas?"
                  maxLength={60}
                  required
                />
              </div>
            )}

            <Button
              size="lg"
              className="mt-4 w-full"
              disabled={total === 0 || (!activeOrder && !validName) || placeOrder.isPending || isClosed}
              onClick={() => placeOrder.mutate()}
            >
              {placeOrder.isPending ? "Enviando..." : isClosed ? "Cerrado ahora" : activeOrder ? "Agregar a la cuenta" : "Enviar pedido a cocina"}
            </Button>
          </>
        )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
