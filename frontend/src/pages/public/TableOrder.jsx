import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Plus, Minus, UtensilsCrossed, Clock, ChefHat, PartyPopper, XCircle, CheckCircle2, Store, Sparkles, WifiOff } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { StoreHeaderBanner } from "../../components/StoreHeaderBanner.jsx";
import { DigitalMenuProductCard, DigitalMenuGridSkeleton, DIGITAL_MENU_GRID_CLASS } from "../../components/DigitalMenuProductCard.jsx";
import { Skeleton } from "../../components/ui/Skeleton.jsx";
import { formatPrice } from "../../lib/format.js";

// Cada plato tiene su propia moneda (Product.currency). Antes todo se pintaba con " CUP" fijo, así que un plato de 5 USD
// salía como "5 CUP" y el total sumaba monedas distintas en un solo número. No hay tipo de cambio en el sistema: el total
// va con una línea por moneda, igual que el carrito (formatMixedTotal en lib/format.js).
function totalsByCurrency(lines) {
  const byCurrency = new Map();
  for (const { amount, currency } of lines) byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
  return [...byCurrency.entries()];
}

// Total en una o varias líneas (una por moneda). Sin líneas muestra 0 en la moneda de la tienda.
function CurrencyTotals({ totals, fallbackCurrency }) {
  const rows = totals.length ? totals : [[fallbackCurrency, 0]];
  return (
    <div className="flex flex-col items-end">
      {rows.map(([currency, amount]) => (
        <p key={currency} className="text-headline-md text-primary">
          {formatPrice(amount, currency)}
        </p>
      ))}
    </div>
  );
}

// Lo que StoreHeaderBanner y la moneda de la cuenta necesitan de la tienda. Si table.vendor (GET /tables/qr/:token) no
// trae todas estas claves, se completan con GET /vendors/:slug.
const TABLE_VENDOR_BANNER_FIELDS = ["isOpenNow", "isVerified", "socialLinks", "businessCategory", "currency"];

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
  { status: "RECEIVED", label: "Recibido", icon: Clock, description: "El equipo ya lo vio. En breve lo confirman contigo en la mesa." },
  { status: "PREPARING", label: "Preparando", icon: ChefHat, description: "Tu pedido se está preparando." },
  { status: "READY", label: "¡Listo!", icon: PartyPopper, description: "Tu pedido está listo." },
  { status: "DELIVERED", label: "¡Servido en tu mesa!", icon: CheckCircle2, description: "Ya te lo llevaron a la mesa. ¡Buen provecho!" },
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
// `currencyOf(item)` resuelve la moneda de cada línea (ver TableOrder): las líneas guardadas no traen la suya.
function ActiveOrderView({ activeOrder, vendorName, currencyOf }) {
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
                  <p className="text-[11px] text-outline">{formatPrice(it.price, currencyOf(it))} c/u</p>
                </div>
                <span className="flex-shrink-0 text-label-md font-semibold text-on-surface-variant">{formatPrice(it.price * it.quantity, currencyOf(it))}</span>
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

      {/* Se suma por moneda desde las líneas (activeOrder.total del servidor es la suma de todas sin distinguir moneda;
          con una sola moneda da lo mismo). */}
      <div className="mt-4 flex items-start justify-between gap-3 border-t border-surface-container-high pt-4">
        <p className="text-title-lg text-on-surface">Total</p>
        <CurrencyTotals
          totals={totalsByCurrency(activeOrder.items.map((it) => ({ amount: Number(it.price) * it.quantity, currency: currencyOf(it) })))}
          fallbackCurrency={currencyOf({})}
        />
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
      <p className="mb-1 text-body-md font-semibold text-on-surface">Fue un placer atenderte.</p>
      <p className="mb-6 max-w-sm text-[13px] text-on-surface-variant">Gracias por visitar {vendorName}. Esperamos verte pronto.</p>
      <Button size="lg" onClick={onContinue}>
        Seguir ordenando en esta mesa
      </Button>
    </div>
  );
}

// Pedido hecho en la caja del local y mandado a mesa: el cliente escribe aquí el número de 4 caracteres que le dieron y el
// pedido pasa a la cuenta de esta mesa.
function PosClaim({ qrToken, onClaimed }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const claim = useMutation({
    mutationFn: async () => (await api.post(`/tables/qr/${qrToken}/claim-pos`, { code: code.trim().toUpperCase() })).data,
    onSuccess: () => {
      toast.success("Pedido sumado a tu mesa");
      setCode("");
      setOpen(false);
      onClaimed();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo sumar el pedido."),
  });
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mb-4 min-h-11 text-[13px] font-bold text-tertiary-accent underline">
        ¿Pediste en caja? Escribe tu número
      </button>
    );
  }
  return (
    <form
      className="mb-5 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim().length === 4) claim.mutate();
      }}
    >
      <input
        autoFocus
        aria-label="Número de tu pedido en caja"
        placeholder="Ej.: K7MP"
        maxLength={4}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        className="h-11 w-32 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-center text-[16px] font-bold tracking-[0.2em] outline-none focus:border-tertiary-accent"
      />
      <Button type="submit" disabled={code.trim().length !== 4 || claim.isPending}>{claim.isPending ? "Sumando..." : "Sumar a mi mesa"}</Button>
    </form>
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
  const { data: table, isLoading, error: tableError, refetch: refetchTable, isRefetching: tableRefetching } = useQuery({
    queryKey: ["table", qrToken],
    queryFn: async () => (await api.get(`/tables/qr/${qrToken}`)).data.table,
    refetchInterval: 5000,
  });

  // El banner (sello, descripción, redes, abierto o cerrado) salía SOLO de /vendors/:slug, y ese endpoint devuelve una
  // forma reducida (sin horario ni sello, con hasPublishedProducts:false) justo para los restaurantes con el menú solo por
  // QR: no tienen productos públicos. Además, si fallaba, la pantalla se quedaba en el esqueleto para siempre. Ahora la
  // base es table.vendor (lo que trae el propio QR) y /vendors/:slug solo la completa cuando trae la forma completa.
  // La consulta extra se salta solo si el QR ya trae TODO lo que usa el banner: con mirar solo isOpenNow, el día que el
  // servidor mandara el horario sin el sello, las redes o la moneda, el banner los perdería sin que nada avisara.
  // Se mira la clave y no el valor: isOpenNow llega null cuando la tienda no cargó horario, y eso también es una respuesta.
  const tableVendorHasBanner = !!table?.vendor && TABLE_VENDOR_BANNER_FIELDS.every((field) => field in table.vendor);
  const { data: vendorFull, isLoading: vendorLoading } = useQuery({
    queryKey: ["vendor", table?.vendor?.slug],
    queryFn: async () => (await api.get(`/vendors/${table.vendor.slug}`)).data.vendor,
    enabled: !!table?.vendor?.slug && !tableVendorHasBanner,
    retry: 1,
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
  // Se compara contra `?? null`: antes era `activeOrder?.id` (undefined sin cuenta) contra el null guardado, nunca
  // coincidían y al cerrarse la cuenta cada render volvía a llamar setHadOrderId: "Too many re-renders" y la pantalla caía.
  const [hadOrderId, setHadOrderId] = useState(undefined);
  const currentOrderId = activeOrder?.id ?? null;
  if (currentOrderId !== hadOrderId) {
    if (hadOrderId && !activeOrder) setJustClosed(true);
    setHadOrderId(currentOrderId);
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

  if (isLoading) return <div className="container-app py-8"><Skeleton width={200} height={26} className="mb-5" /><DigitalMenuGridSkeleton /></div>;

  // Antes cualquier fallo (sin señal, un 500) caía en "Mesa no encontrada" y el cliente creía que el QR estaba mal. Solo
  // un 404 lo es; lo demás se puede reintentar. Si la mesa ya había cargado y falla un sondeo, se sigue mostrando lo último.
  if (!table) {
    if (tableError && tableError.response?.status !== 404) {
      return (
        <div className="container-app py-14">
          <EmptyState
            icon={WifiOff}
            title="No pudimos cargar la mesa"
            description="Revisa tu conexión y vuelve a intentarlo."
            action={
              <Button className="min-h-11" onClick={() => refetchTable()} disabled={tableRefetching}>
                {tableRefetching ? "Cargando..." : "Reintentar"}
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="container-app py-14">
        <EmptyState icon={UtensilsCrossed} title="Mesa no encontrada" description="Este código QR no corresponde a ninguna mesa activa." />
      </div>
    );
  }

  // Solo se espera a /vendors/:slug mientras carga; si falla o trae la forma reducida, se sigue con table.vendor.
  if (!tableVendorHasBanner && vendorLoading) return <div className="container-app py-8"><Skeleton width={200} height={26} className="mb-5" /><DigitalMenuGridSkeleton /></div>;

  const usableVendorFull = !tableVendorHasBanner && vendorFull && vendorFull.hasPublishedProducts !== false ? vendorFull : null;
  // table.vendor gana en lo que trae (sus productos son los del menú de ESTA mesa); vendorFull solo suma lo que falta.
  const vendor = { ...(usableVendorFull ?? {}), ...table.vendor };
  // Moneda de cada plato del menú y, para las líneas que ya no están en el menú (o las que cargó el mesero a mano), la
  // moneda principal de la tienda si se conoce. Product.currency y Vendor.currency valen "CUP" por defecto en la base.
  const storeCurrency = vendor.currency ?? "CUP";
  const productCurrency = new Map(table.vendor.products.map((p) => [p.id, p.currency ?? storeCurrency]));
  const currencyOf = (item) => item.currency ?? (item.productId && productCurrency.get(item.productId)) ?? storeCurrency;

  const cartTotals = totalsByCurrency(
    Object.entries(cart).flatMap(([productId, qty]) => {
      const product = table.vendor.products.find((p) => p.id === productId);
      return product && qty > 0 ? [{ amount: Number(product.price) * qty, currency: product.currency ?? storeCurrency }] : [];
    })
  );
  // Igual que antes con el total único: sin nada que cobrar no se envía (el servidor rechaza precios en 0).
  const cartHasItems = cartTotals.some(([, amount]) => amount > 0);
  const validName = customerName.trim().length > 0;
  // Sin isOpenNow (forma reducida o consulta fallida) no se sabe si está abierto: no se bloquea aquí y el servidor, que
  // sí revisa el horario al recibir el pedido (createTableOrder), responde con el motivo si está cerrado.
  const isClosed = vendor.isOpenNow === false;
  // La mesa no recibe pedidos por el QR (la tienda dejó de ser restaurante, su plan no trae mesas con QR o tiene el cobro
  // atrasado; lo calcula getTableByToken con las mismas reglas que createTableOrder). Antes el cliente armaba el carrito,
  // escribía su nombre y recién al enviar le salía el error: ahora ve el menú sin carrito y el aviso de pedir al personal.
  // `!== false`: si el servidor no manda el dato, se deja pedir como antes y el servidor responde si no corresponde.
  const acceptsOrders = table.acceptsOrders !== false;
  // Bloque 172: mientras el pedido de la mesa sigue RECEIVED (todavía sin
  // que el mesero lo confirme), no se puede mandar otro — evita 2 cuentas
  // sueltas a la vez sobre la misma mesa.
  const blockedByPendingApproval = activeOrder?.kitchenStatus === "RECEIVED";

  return (
    <div>
      <StoreHeaderBanner vendor={vendor} tableLabel={table.label || `Mesa ${table.tableNumber}`} minimal underHeader={false} />

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
            <ActiveOrderView activeOrder={activeOrder} vendorName={table.vendor.companyName} currencyOf={currencyOf} />
          </div>
        )}

        {blockedByPendingApproval ? null : (
          <>
            {/* Sumar un pedido de caja también pasa por el QR (claimForTable pide mesas con QR en el plan): sin pedidos
                por aquí, ese paso lo hace el personal desde su panel. */}
            {acceptsOrders && (
              <PosClaim qrToken={qrToken} onClaimed={() => queryClient.invalidateQueries({ queryKey: ["table", qrToken] })} />
            )}
            {activeOrder && acceptsOrders && (
              <h3 className="mb-3 font-display text-title-md text-on-surface">Agregar a la cuenta</h3>
            )}

            {!acceptsOrders ? (
              <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-4 text-center">
                <p className="font-bold text-error">Esta mesa no recibe pedidos por aquí ahora</p>
                <p className="mt-1.5 text-[13px] text-on-surface-variant">Puedes ver el menú. Para pedir, llama al personal.</p>
              </div>
            ) : isClosed && (
              <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-4 text-center">
                <p className="font-bold text-error">Este local está cerrado ahora</p>
                {vendor.nextOpenLabel && <p className="mt-0.5 text-[13px] text-on-surface-variant">{vendor.nextOpenLabel}</p>}
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
                    price={formatPrice(p.price, p.currency ?? storeCurrency)}
                    oldPrice={p.oldPrice ? formatPrice(p.oldPrice, p.currency ?? storeCurrency) : null}
                    discountPercent={p.oldPrice ? Math.round(100 - (Number(p.price) / Number(p.oldPrice)) * 100) : null}
                    action={
                      acceptsOrders && !outOfStock ? (
                        // Botones de 44px (antes unos 28px, difíciles de tocar con el dedo) y con nombre para el lector de pantalla.
                        // Contador y separación al mínimo: a 390px la fila del precio comparte unos 226px con este bloque, y
                        // cada píxel de más se lo quita a precios largos como "1,250,000 CUP".
                        <div className="flex flex-shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            aria-label={`Quitar uno de ${p.name}`}
                            className="flex h-11 w-11 items-center justify-center rounded border border-outline-variant"
                            onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))}
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-5 text-center" aria-live="polite">{cart[p.id] ?? 0}</span>
                          <button
                            type="button"
                            aria-label={`Agregar uno de ${p.name}`}
                            className="flex h-11 w-11 items-center justify-center rounded border border-outline-variant disabled:cursor-not-allowed disabled:opacity-40"
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
                      ) : null
                    }
                  />
                );
              })}
              {table.vendor.products.length === 0 && (
                <p className="text-body-md text-on-surface-variant">Este restaurante todavía no habilitó productos para el menú QR.</p>
              )}
            </div>

            {acceptsOrders && (
              <>
            <div className="mt-6 flex items-start justify-between gap-3 border-t border-surface-container-high pt-4">
              <p className="text-title-lg text-on-surface">Total</p>
              <CurrencyTotals totals={cartTotals} fallbackCurrency={storeCurrency} />
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
              disabled={!cartHasItems || (!activeOrder && !validName) || placeOrder.isPending || isClosed}
              onClick={() => placeOrder.mutate()}
            >
              {placeOrder.isPending ? "Enviando..." : isClosed ? "Cerrado ahora" : activeOrder ? "Agregar a la cuenta" : "Enviar pedido a cocina"}
            </Button>
              </>
            )}
          </>
        )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
