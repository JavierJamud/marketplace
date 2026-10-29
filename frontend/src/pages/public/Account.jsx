import { clientInfo } from "../../lib/clientInfo.js";
import { ComboSelect } from "../../components/ui/ComboSelect.jsx";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import toast from "../../lib/toast.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { OtpInput } from "../../components/ui/OtpInput.jsx";
import { PasswordInput } from "../../components/ui/PasswordInput.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { PlanComparisonModal } from "../../components/PlanComparisonModal.jsx";
import { enterpriseWhatsappLink, isBadgeUpgrade, suggestedUpgradePlan } from "../../components/plans/PlansCatalog.jsx";
import { PLAN_KEY_PATTERN } from "../../lib/planStatus.js";
import { LocationPicker } from "../../components/LocationPicker.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";
import { capturePartnerRef, getPartnerCode, clearPartnerRef } from "../../lib/partnerRef.js";
import { preloadPanel } from "../../lib/panelPreload.js";
import { UsernameField } from "../../components/UsernameField.jsx";
import { ShoppingBag, Store, ChevronRight } from "lucide-react";

// "¿Cómo quieres crear tu cuenta?": lo primero que ve quien toca "Crear cuenta". Muchos dueños de negocio entraban por
// "Mi cuenta", creaban una cuenta de cliente creyendo que abrían su tienda y no encontraban dónde vender (pedido del dueño).
// Cada opción explica para qué sirve; la de la otra pantalla lleva a su registro (cliente en /cuenta, tienda en
// /vendedor/ingresar), y la de esta pantalla sigue aquí mismo.
function AccountTypePicker({ onPick }) {
  const OPTIONS = [
    {
      id: "customer",
      icon: ShoppingBag,
      title: "Como cliente",
      text: "Para comprar productos, encontrar tiendas cerca de ti o en todo el país, guardar favoritos y seguir tus pedidos.",
    },
    {
      id: "vendor",
      icon: Store,
      title: "Como vendedor",
      text: "Para abrir tu tienda en línea: publica tus productos, recibe pedidos y administra tu negocio desde tu panel.",
    },
  ];
  return (
    <>
      <h1 className="mb-1 text-headline-md text-on-surface">¿Cómo quieres crear tu cuenta?</h1>
      <p className="mb-6 text-body-md text-on-surface-variant">Elige una opción. Si después quieres abrir tu tienda, puedes hacerlo con esta misma cuenta.</p>
      <div className="grid gap-3">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className="flex min-h-11 w-full items-center gap-3.5 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 text-left transition-colors hover:border-tertiary-accent hover:bg-tertiary-accent/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
            >
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10 text-tertiary-accent">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold text-on-surface">{o.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-on-surface-variant">{o.text}</span>
              </span>
              <ChevronRight className="h-5 w-5 flex-shrink-0 text-outline" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </>
  );
}

// PLAN_KEY_PATTERN (lib/planStatus.js, copia del de backend/src/lib/planConfig.js) solo filtra basura del enlace: si la
// clave no es de un plan publicado, se ignora más abajo.

// Adónde va una tienda recién creada según el plan que eligió en /planes (?plan=CLAVE). `plans` es la lista pública
// (GET /settings/plans) y `supportWhatsapp` el número de soporte que viene en esa misma respuesta; el papel de cada plan
// sale de sus banderas, nunca de su clave.
//  - Plan con insignia que se paga: la comparación de bienvenida con ese plan, como siempre fue. Su botón lleva a la
//    verificación con el plan marcado y "Continuar con" deja la tienda en el plan de inicio.
//  - Cualquier otro plan que no es el de inicio (a medida, cobrado sin insignia o uno gratis distinto del de inicio): se pide al equipo, así que
//    vuelve a /planes con un aviso. La verificación y la comparación solo cobran planes con insignia, y Mensajes le muestra
//    un candado a toda tienda sin verificar (VendorChat.jsx), que es lo que es una tienda recién creada. En /planes el botón
//    de ese plan ya resuelve por dónde pedirlo: WhatsApp de soporte, /contacto o Mensajes (requestPlanLink y EnterpriseCta).
//  - Plan de inicio, plan desconocido o sin plan elegido: la comparación con el plan que sugiere suggestedUpgradePlan
//    (PlansCatalog.jsx). Si no hay ninguno que se pague con la verificación, al panel.
// Devuelve { go, note? } o { modal: plan }. `note` es el texto del aviso al llegar.
function afterSignupStep(plans, chosenKey, supportWhatsapp) {
  const chosen = chosenKey ? plans.find((p) => p.planType === chosenKey) : null;
  if (isBadgeUpgrade(chosen)) return { modal: chosen };
  if (chosen && !chosen.isDefault) {
    // Mismo texto que el botón que verá en la tarjeta del plan (Plans.jsx y EnterpriseCta en PlansCatalog.jsx).
    const button = chosen.contactOnly ? (enterpriseWhatsappLink(supportWhatsapp, chosen.name) ? "Hablar por WhatsApp" : "Escríbenos") : "Pedir este plan";
    return { go: "/planes", note: `Toca «${button}» en el plan ${chosen.name} para pedírselo al equipo.` };
  }
  const offer = suggestedUpgradePlan(plans);
  return offer ? { modal: offer } : { go: "/vendedor" };
}

function BrandStat({ value, label }) {
  return (
    <div>
      <div className="font-display text-2xl font-extrabold text-secondary-container">{value}</div>
      <div className="text-label-sm text-white/60">{label}</div>
    </div>
  );
}

// Auditoría de seguridad: copy propio para /vendedor/ingresar y
// /admin/ingresar — nunca el pitch de marketing "abre tu tienda gratis"
// (pensado para un visitante nuevo) en la pantalla de login de alguien que
// ya tiene cuenta, y sin la fila de stats de adquisición de clientes
// (irrelevante para un panel interno).
const SHELL_COPY = {
  customer: {
    headline: "El marketplace de Cuba, cerca de ti.",
    subtitle: "Compra a tiendas locales por WhatsApp o abre tu propia tienda gratis. Pagas solo si quieres verificarte.",
    showStats: true,
  },
  vendor: {
    headline: "Panel de vendedor",
    subtitle: "Ingresa para gestionar tu tienda, tus productos y tus pedidos.",
    showStats: false,
  },
  partner: {
    headline: "Panel del socio",
    subtitle: "Mira cómo usa tu sitio la API de Baznova: solicitudes, errores, credencial, cuotas y planes.",
    showStats: false,
  },
  admin: {
    headline: "Panel de administración",
    subtitle: "Acceso exclusivo para el equipo. Inicia sesión con tu cuenta de administrador.",
    showStats: false,
  },
};

// Botones grandes de esta pantalla. Button size="lg" tiene alto fijo (h-12) y letra de 20px: un texto largo como
// "Reintentar crear mi tienda", o el botón de enviar al lado de "Atrás", pasa a dos líneas a 390px y se salía del botón.
// Con esto crece en vez de desbordar; min-h-12 conserva el alto de siempre cuando cabe en una línea. h-auto le gana a
// h-12 porque Tailwind genera h-auto después en el CSS.
const LG_FIT = "h-auto min-h-12 py-2 leading-tight";
// Botones de solo texto (reenviar código, volver, olvidé mi contraseña): medían unos 20px de alto, poco para tocarlos con
// el dedo. min-h-11 les da los 44px y text-left alinea el texto si se parte en dos líneas.
const TEXT_BTN = "flex min-h-11 items-center text-left text-label-md font-semibold";

// Bloque 20: contenedor visual de /cuenta (split marca + formulario), sobre
// el mock design_references/Account.dc.html. El formulario real (login,
// stepper de registro, recuperar contraseña) se pasa como children sin
// tocarse — esto solo cambia lo que lo envuelve.
// Bloque 275 (pedido explícito — "al crear la cuenta el cliente elige: solo correo, o también la
// app; si elige la app se muestra el QR para escanearlo y verificarlo; también puede omitirlo"):
// paso opcional que se muestra justo después de verificar el correo. La cuenta ya existe y la
// sesión está abierta, así que usa los mismos endpoints de la tarjeta de seguridad del perfil.
function RegisterAppStep({ onDone }) {
  const [setup, setSetup] = useState(null);
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [checking, setChecking] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  async function start() {
    setStarting(true);
    try {
      setSetup((await api.post("/auth/2fa/app/setup")).data);
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo iniciar la activación.");
    } finally {
      setStarting(false);
    }
  }

  async function verify(e) {
    e?.preventDefault();
    if (code.length !== 6 || checking) return;
    setChecking(true);
    try {
      await api.post("/auth/2fa/app/enable", { code });
      toast.success("Verificación en dos pasos activada.");
      onDone();
    } catch (err) {
      setCode("");
      setCodeError(err.response?.data?.error ?? "El código no coincide. Inténtalo de nuevo.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="animate-step-in">
      <h1 className="mb-2 text-headline-md text-on-surface">Protege tu cuenta</h1>
      {!setup ? (
        <>
          <p className="mb-5 text-body-md text-on-surface-variant">
            Por defecto, al iniciar sesión te enviamos un código a tu correo. Si quieres, puedes usar además una aplicación de autenticación (Google Authenticator, Microsoft Authenticator o Authy) que genera el código en tu teléfono.
          </p>
          <div className="space-y-3">
            <Button type="button" size="lg" className={`w-full rounded-xl ${LG_FIT}`} onClick={start} disabled={starting}>
              {starting ? "Preparando..." : "Activar también con aplicación"}
            </Button>
            <Button type="button" variant="outline" size="lg" className={`w-full rounded-xl ${LG_FIT}`} onClick={onDone}>
              Solo por correo, omitir
            </Button>
          </div>
          <p className="mt-4 text-label-md text-outline">Puedes activarla o quitarla cuando quieras desde tu perfil.</p>
        </>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-body-md text-on-surface-variant">
            <li>Abre tu aplicación y elige agregar una cuenta.</li>
            <li>Escanea este código QR.</li>
            <li>Escribe el código de 6 dígitos que muestra la aplicación.</li>
          </ol>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={setup.otpauthUrl} size={168} level="M" title="Código QR para tu aplicación de autenticación" />
            </div>
            <button type="button" onClick={() => setShowSecret((v) => !v)} className="min-h-11 text-label-md font-semibold text-tertiary-accent">
              {showSecret ? "Ocultar la clave" : "No puedo escanear: ver la clave"}
            </button>
            {showSecret && <p className="select-all break-all rounded-lg bg-surface-container px-3 py-2 font-mono text-[13px] tracking-wider text-on-surface">{setup.secret}</p>}
          </div>
          <OtpInput label="Código de la aplicación" autoFocus value={code} onChange={(v) => { setCode(v); setCodeError(""); }} error={codeError || undefined} />
          <Button type="submit" size="lg" className={`w-full rounded-xl ${LG_FIT}`} disabled={code.length !== 6 || checking}>
            {checking ? "Verificando..." : "Verificar y activar"}
          </Button>
          <button type="button" onClick={onDone} className="block min-h-11 text-label-md font-semibold text-outline">
            Omitir y usar solo el correo
          </button>
        </form>
      )}
    </div>
  );
}

function AccountShell({ mode = "customer", children }) {
  const { siteName, logoUrl } = usePlatformSettings();
  // Cifras reales (backend getPublicStats): países activos en el admin y categorías para abrir tiendas y comprar.
  const { data: stats } = useQuery({ queryKey: ["public-stats"], queryFn: async () => (await api.get("/settings/stats")).data, staleTime: 5 * 60 * 1000 });
  const copy = SHELL_COPY[mode];
  return (
    <div className="min-h-dvh animate-fade-up bg-background lg:grid lg:grid-cols-2">
      {/* Panel izquierdo — marca completa en desktop */}
      {/* Bloque 293 (pedido explícito — "el lado izquierdo no debe ampliarse ni estirarse con el formulario"):
          el panel de marca queda fijo a la altura de la pantalla y solo se desplaza el formulario. */}
      <div className="hidden flex-col justify-center overflow-hidden bg-gradient-to-br from-primary-container to-primary px-14 py-14 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start">
        <Link to="/" className="mb-9 flex items-center gap-2.5">
          {logoUrl ? (
            <img src={logoUrl} alt={siteName} className="h-8 w-8 flex-shrink-0 rounded-md object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary-container font-display text-base font-extrabold text-primary">
              {siteName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-display text-lg font-bold text-white">{siteName}</span>
        </Link>
        <h1 className="mb-4 max-w-md font-display text-headline-lg font-extrabold leading-tight text-white">{copy.headline}</h1>
        <p className="mb-8 max-w-sm text-body-md text-white/60">{copy.subtitle}</p>
        {copy.showStats && (
          <div className="flex gap-8">
            <BrandStat value={stats?.countries ?? "…"} label={stats?.countries === 1 ? "país" : "países"} />
            <BrandStat value="0%" label="comisión por venta" />
            <BrandStat value={stats?.categories ?? "…"} label={stats?.categories === 1 ? "categoría" : "categorías"} />
          </div>
        )}
      </div>

      {/* Barra de marca compacta — mobile únicamente */}
      <div className="bg-gradient-to-br from-primary-container to-primary px-5 py-5 lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt={siteName} className="h-7 w-7 flex-shrink-0 rounded-md object-cover" />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary-container font-display text-sm font-extrabold text-primary">
              {siteName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-display text-base font-bold text-white">{siteName}</span>
        </Link>
        <p className="mt-1.5 text-label-sm text-white/70">{copy.headline}</p>
      </div>

      {/* Panel derecho — formulario real. Tarjeta con esquinas redondeadas y
          sombra suave (antes flotaba directo sobre el fondo, sin borde) —
          `[&_input]:rounded-xl [&_select]:rounded-xl` redondea los campos de
          ESTA pantalla nada más, sin tocar los componentes compartidos
          Input/Select/PhoneInput que se usan en el resto del sitio. */}
      <div className="flex flex-col justify-center px-4 py-8 sm:px-8 lg:px-14">
        <div className="mx-auto w-full max-w-md rounded-[28px] border border-surface-container-high bg-surface-container-lowest p-7 shadow-[0_8px_40px_-12px_rgba(20,20,30,0.12)] [&_input]:rounded-xl [&_select]:rounded-xl sm:p-9">
          {children}
        </div>
      </div>
    </div>
  );
}

const MIN_LOADING_MS = 500;

// Garantiza que el spinner de carga dure al menos MIN_LOADING_MS aunque el
// backend responda instantáneo — evita el parpadeo de un botón que cambia de
// estado en 20ms, sin agregar un delay artificial fijo cuando la request
// real tarda más que eso.
async function withMinDelay(fn) {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed < MIN_LOADING_MS) await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
  }
}

// Bloque 46 (pedido explícito): cuenta regresiva real para el vencimiento
// de un código de un solo uso (2FA por ahora) — recibe el timestamp real
// que manda el backend, nunca un contador fijo local que se desincroniza
// del real. Retorna segundos restantes (0 cuando ya venció, nunca
// negativo) y se re-renderiza cada segundo mientras `expiresAt` esté seteado.
function useCountdownSeconds(expiresAt) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(0);
      return;
    }
    function tick() {
      setSecondsLeft(Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return secondsLeft;
}

// Bloque 114 (pedido explícito): "Nombre completo" se separa en Nombre +
// Apellidos (se concatenan recién al mandar el registro, ver
// buildRegisterPayload — el backend sigue guardando un solo fullName, no
// hace falta duplicar la columna). país/provincia/municipio DE LA PERSONA
// (dónde vive) solo aplica al CLIENTE (ver step === 3 más abajo) —
// registrationCountryId (del catálogo real del admin) O
// registrationCountryOther (texto libre, si su país todavía no está
// cargado); con Cuba, provinceId/municipalityId (catálogo); con cualquier
// otro país real, stateOther/address (texto libre — el admin ya no necesita
// cargar provincias/estados de otros países para que el registro funcione).
const emptyRegisterForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  country: "CU",
  password: "",
  confirmPassword: "",
  registrationCountryId: "",
  registrationCountryOther: "",
  provinceId: "",
  municipalityId: "",
  // Bloque 247: municipio escrito a mano cuando no está en la lista.
  municipalityOther: "",
  stateOther: "",
  address: "",
};
// Bloque 113/114: ownerName/storeEmail/whatsapp se sacan de acá — pedido
// explícito de no repetir lo que la persona ya cargó en el paso 1
// (firstName+lastName/email/phone respectivos) — ver handleVerifyRegistration,
// que arma el POST /vendors con esos valores de `form`, no de `storeForm`.
// countryId/provinceId/municipalityId/stateOther son la ubicación REAL de la
// tienda (dónde presta servicio) — con Cuba, provincia+municipio del
// catálogo; con cualquier otro país real, estado de texto libre +
// companyAddress como dirección. Nunca admite "otro país" (la tienda tiene
// que poder listarse/entregarse en un lugar real del catálogo). Bloque 114
// (pedido explícito): este es ahora el ÚNICO lugar donde un vendedor elige
// su ubicación — ya no hay un paso previo separado de "tu ubicación como
// persona" (redundante con esta), esta misma respuesta se manda también
// como la ubicación de registro de la persona (ver buildRegisterPayload).
const emptyStoreForm = {
  companyName: "",
  // Nombre de usuario = enlace de la tienda (UsernameField).
  username: "",
  description: "",
  countryId: "",
  // Bloque 244: país escrito a mano cuando no está en la lista del admin.
  countryOther: "",
  provinceId: "",
  municipalityId: "",
  municipalityOther: "",
  stateOther: "",
  // Solo se pide cuando no hay un municipio real con el que ubicar la tienda
  // (ver LocationPicker.computeLocationStatus).
  companyAddress: "",
  businessCategoryId: "",
  isRestaurant: false,
  tableCount: "",
};

// Auditoría de seguridad: 3 URLs de entrada distintas para el mismo
// POST /auth/login (nunca se separó la tabla User ni el endpoint — ver
// discusión en el prompt de auditoría). `mode` decide copy/branding, y qué
// tipo de cuenta se crea desde acá: /cuenta (mode="customer") SOLO crea
// clientes — crear una tienda se movió por completo a /vendedor/ingresar
// (mode="vendor"), que ofrece login Y registro, siempre como vendedor, sin
// el selector "quiero comprar/vender" de antes. /admin/ingresar (mode="admin")
// es el único que nunca ofrece registro (un admin no se autocrea). Los 3
// rechazan el login con un error genérico si el rol devuelto no corresponde
// a la URL usada — nunca revelan que el email existe con otro rol (ver
// roleAllowedForMode/handleLogin más abajo).
// Paso del código de ingreso guardado en el navegador. En el celular, ir a la app del correo a buscar el código deja esta
// pestaña en segundo plano y el navegador (Firefox sobre todo) puede descargarla y recargarla al volver: sin esto la persona
// caía otra vez en el formulario de ingreso y el código que acababa de recibir ya no tenía dónde escribirse. Se guarda solo lo
// necesario para mostrar ese paso (nunca la contraseña) y vence con el código (10 minutos como máximo).
const PENDING_2FA_MAX_MS = 10 * 60 * 1000;
const pending2faKey = (mode) => `zeudin_pending_2fa:${mode}`;

function readPending2fa(mode) {
  try {
    const saved = JSON.parse(localStorage.getItem(pending2faKey(mode)) || "null");
    if (!saved?.email) return null;
    const expires = saved.expiresAt ? new Date(saved.expiresAt).getTime() : saved.savedAt + PENDING_2FA_MAX_MS;
    if (Date.now() > Math.min(expires, saved.savedAt + PENDING_2FA_MAX_MS)) {
      localStorage.removeItem(pending2faKey(mode));
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function clearPending2fa(mode) {
  try {
    localStorage.removeItem(pending2faKey(mode));
  } catch {
    /* sin almacenamiento */
  }
}

export default function Account({ mode = "customer" }) {
  // Enlace de socio que llegó directo a esta pantalla (…/vendedor/ingresar?socio=CODIGO).
  useEffect(() => capturePartnerRef(), []);
  const { user: sessionUser, login, verifyTwoFactor, register, verifyRegistration, refreshRole, logout } = useAuth();
  const { siteName } = usePlatformSettings();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Nunca hay que elegir — está implícito en qué URL se usó para llegar acá.
  const accountType = mode === "vendor" ? "vendor" : "customer";
  // Bloque 294: toda tienda nueva empieza en el plan por defecto (bandera isDefault, lo elige el admin); su tope de mesas
  // también lo fija el admin. Antes se leía siempre el de "REGULAR".
  // El plan por defecto y su tope salen de la misma consulta (/settings): así el tope no espera a otra respuesta y la
  // validación del número de mesas no se salta mientras carga /settings/plans.
  const { maxTablesByPlan, defaultPlanKey, defaultPlanName } = usePlatformSettings();
  const maxTables = defaultPlanKey ? maxTablesByPlan?.[defaultPlanKey] ?? null : null;
  const tablesLimitText = maxTables != null ? `${defaultPlanName ? `Con el plan ${defaultPlanName}` : "Con tu plan"} puedes tener hasta ${maxTables} ${maxTables === 1 ? "mesa" : "mesas"}.` : "";
  // Misma consulta y clave que usePublicPlans (PlansCatalog.jsx), pero solo en el ingreso de vendedor: el login de
  // clientes, admin y socios no necesita los planes. Solo la usa afterSignupStep, al terminar de crear la tienda.
  const { data: publicPlansData } = useQuery({
    queryKey: ["public-plans"],
    queryFn: async () => (await api.get("/settings/plans")).data,
    enabled: mode === "vendor",
  });
  // Plan elegido en /planes (?plan=CLAVE). Se guarda al entrar: es el que la persona quiere al terminar el registro,
  // aunque después cambie de paso o de pestaña dentro de esta pantalla.
  const [chosenPlanKey] = useState(() => {
    const key = searchParams.get("plan");
    return key && PLAN_KEY_PATTERN.test(key) ? key : null;
  });
  const canRegister = mode !== "admin" && mode !== "partner";

  // "login" | "register" | "register-verify" | "forgot-email" | "forgot-code" | "forgot-newpass" | "two-factor"
  // Si la pestaña se recargó mientras la persona buscaba el código en su correo, se vuelve directo a ese paso.
  const [pending2fa] = useState(() => readPending2fa(mode));
  const [view, setView] = useState(pending2fa ? "two-factor" : mode === "admin" || mode === "partner" ? "login" : searchParams.get("tab") === "registro" ? "register" : "login");
  // Ya eligió cómo crear su cuenta (AccountTypePicker): por los botones "Crear mi tienda" / "Abrir tienda" del sitio (llegan
  // a /vendedor/ingresar?tab=registro, la intención ya es clara) o por ?como= al pasar de una pantalla a la otra.
  const [typeChosen, setTypeChosen] = useState(() => !!searchParams.get("como") || (mode === "vendor" && searchParams.get("tab") === "registro"));
  const [twoFactorEmail, setTwoFactorEmail] = useState(pending2fa?.email ?? "");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // Bloque 46 (pedido explícito — "vamos a corregir que en el inicio de
  // sesión... agregar un botón de reenviar código... y la espera de
  // vencimiento... se mostrará como un contador regresivo, si llega a cero
  // se habilita un botón enviar código nuevamente"): timestamp real que
  // manda el backend (auth.controller.js) — nunca "5 minutos" fijo acá, así
  // la cuenta regresiva sigue siendo exacta después de un reenvío.
  const [twoFactorExpiresAt, setTwoFactorExpiresAt] = useState(pending2fa?.expiresAt ?? null);
  // Bloque 273: "totp" = el código sale de la app autenticadora; "email" = llega al correo.
  const [twoFactorMethod, setTwoFactorMethod] = useState(pending2fa?.method ?? "email");
  // Mensaje "código incorrecto" que se muestra debajo de las casillas (los 3 pasos de código).
  const [codeError, setCodeError] = useState("");
  const [challengeToken, setChallengeToken] = useState(pending2fa?.challengeToken ?? "");
  const twoFactorSecondsLeft = useCountdownSeconds(twoFactorExpiresAt);
  // Mientras se está en el paso del código, se guarda (y se actualiza si se reenvía o cambia de método); al salir de él, se borra.
  useEffect(() => {
    try {
      if (view === "two-factor" && twoFactorEmail) {
        const savedAt = readPending2fa(mode)?.savedAt ?? Date.now();
        localStorage.setItem(pending2faKey(mode), JSON.stringify({ email: twoFactorEmail, method: twoFactorMethod, expiresAt: twoFactorExpiresAt, challengeToken, savedAt }));
      } else {
        clearPending2fa(mode);
      }
    } catch {
      /* sin almacenamiento: el paso funciona igual mientras la pestaña no se recargue */
    }
  }, [view, twoFactorEmail, twoFactorMethod, twoFactorExpiresAt, challengeToken, mode]);
  // Bloque 59: código de verificación de correo (segundo paso del registro)
  // — el email pendiente de verificar es siempre form.email, no hace falta
  // duplicarlo en un estado propio.
  const [registerCode, setRegisterCode] = useState("");
  // Cuándo vence el código enviado (lo manda el servidor) y cuenta regresiva para poder pedir otro.
  const [registerExpiresAt, setRegisterExpiresAt] = useState(null);
  const [resetExpiresAt, setResetExpiresAt] = useState(null);
  // El correo ya quedó verificado y la cuenta creada, pero la tienda aún no: se puede reintentar sin pedir otro código.
  const [accountCreated, setAccountCreated] = useState(false);
  const [vendorError, setVendorError] = useState("");
  // Una cuenta de cliente que aún no tiene tienda y la está terminando de crear (salta los pasos de datos personales y contraseña).
  const [completingStore, setCompletingStore] = useState(false);
  const registerSecondsLeft = useCountdownSeconds(registerExpiresAt);
  const resetSecondsLeft = useCountdownSeconds(resetExpiresAt);
  const [resendingCode, setResendingCode] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  // Sesión ya aceptada y bajando el panel: el formulario sigue bloqueado hasta que el panel aparece.
  const [entering, setEntering] = useState(false);
  const enteringRef = useRef(false);
  // Pestañas "Iniciar sesión" y "Crear cuenta": al cambiar con las flechas, el foco pasa a la pestaña nueva.
  const loginTabRef = useRef(null);
  const registerTabRef = useRef(null);

  const [loginForm, setLoginForm] = useState({ email: pending2fa?.email ?? "", password: "" });
  const [form, setForm] = useState(emptyRegisterForm);
  // Cambia un campo del registro sobre el estado más reciente, nunca sobre una copia vieja de `form`. El valor se lee
  // del evento antes de encolar la actualización, porque React puede aplicar la función más tarde.
  const setFormField = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };
  const [storeForm, setStoreForm] = useState(emptyStoreForm);
  // Plan que se ofrece en la comparación de bienvenida al crear la tienda (null = sin comparación). Ver afterSignupStep.
  const [planModalOffer, setPlanModalOffer] = useState(null);

  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const isLogin = view === "login";
  // Bloque 114 (pedido explícito): 3 pasos para los dos tipos de cuenta — el
  // paso 3 del vendedor ("configuración de la tienda") reemplaza de una a
  // los 2 pasos que había antes (ubicación de la persona + datos de la
  // tienda, redundantes entre sí); el del cliente sigue siendo su propia
  // ubicación.
  // Bloque 293: la tienda se registra en 4 pasos (datos, contraseña, tienda, ubicación) para que el formulario no sea tan largo.
  const totalSteps = accountType === "vendor" ? 4 : 3;

  // Bloque 244: los selectores de país → provincia → municipio (y el texto
  // manual cuando no aparece el suyo) viven en LocationPicker, compartido por
  // el registro del cliente y el de la tienda. `locStatus` es lo que el
  // selector reporta hacia arriba (si falta algo y si hace falta dirección)
  // para validar antes de enviar.
  const [locStatus, setLocStatus] = useState({ error: null, needsAddress: false });

  // Bloque 18: rubro obligatorio de la tienda.
  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
    enabled: !isLogin && accountType === "vendor",
  });
  const businessCategoryOptions = (businessCategories ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    icon: <CategoryIcon name={c.icon} className="h-5 w-5 text-tertiary-accent" />,
  }));

  // codeError lo comparten los tres pasos de código (2FA, verificar el correo y recuperar la contraseña): se limpia en
  // cada entrada a uno de ellos para que el "código incorrecto" de un paso no aparezca en el siguiente.
  function switchView(next) {
    // Al tocar la pestaña "Crear cuenta" se vuelve a preguntar cómo quiere crearla.
    if (next === "register" && view !== "register") setTypeChosen(false);
    setView(next);
    setStep(1);
    setCompletingStore(false);
    setCodeError("");
  }

  // Respuesta de "¿Cómo quieres crear tu cuenta?". La opción de esta pantalla sigue aquí; la otra lleva a su registro con
  // ?como= para no volver a preguntar (y conserva ?plan= y ?socio= si llegaron).
  function pickAccountType(type) {
    if (type === accountType) {
      setTypeChosen(true);
      return;
    }
    const next = new URLSearchParams();
    next.set("tab", "registro");
    next.set("como", type === "vendor" ? "vendedor" : "cliente");
    for (const k of ["plan", "socio"]) if (searchParams.get(k)) next.set(k, searchParams.get(k));
    navigate(`${type === "vendor" ? "/vendedor/ingresar" : "/cuenta"}?${next.toString()}`);
  }

  // Cuenta de cliente sin tienda: se precargan sus datos y se pasa directo a "Tu tienda".
  function startStoreCompletion(u) {
    const parts = String(u?.fullName ?? "").trim().split(/\s+/).filter(Boolean);
    setForm((f) => ({ ...f, firstName: parts[0] ?? "", lastName: parts.slice(1).join(" "), email: u?.email ?? f.email, phone: u?.phone ?? f.phone, country: u?.country ?? f.country }));
    setCompletingStore(true);
    setStep(3);
    setView("register");
  }

  // Bloque 52: "?next=/tienda/:slug" — usado por el flujo de "inicia sesión
  // para reseñar" (Store.jsx redirige acá y vuelve exactamente a donde
  // estaba). Solo se respeta para clientes (rutas propias de vendedor/admin
  // siempre van a su panel, sin importar `next`) y solo un path relativo
  // propio del sitio — nunca una URL externa.
  const nextPath = searchParams.get("next");
  const isSafeNextPath = nextPath?.startsWith("/") && !nextPath.startsWith("//");

  // Bloque 183: un usuario de sistema (VENDOR_STAFF) entra por la MISMA
  // puerta que el dueño — mismo destino /vendedor (VendorLayout.jsx decide
  // qué ve adentro según su rol/secciones, nunca esto de acá).
  function destinationAfterLogin(role) {
    if (role === "CUSTOMER" && isSafeNextPath) return nextPath;
    return role === "ADMIN" ? "/admin" : role === "PARTNER" ? "/socio" : role === "VENDOR" || role === "VENDOR_STAFF" ? "/vendedor" : "/cuenta/panel";
  }

  // /cuenta (mode="customer") acepta cualquier rol (comportamiento de
  // siempre) — /vendedor/ingresar y /admin/ingresar exigen que el rol
  // devuelto coincida con la URL usada.
  function roleAllowedForMode(role) {
    if (mode === "admin") return role === "ADMIN";
    if (mode === "partner") return role === "PARTNER";
    // Una cuenta de cliente sin tienda también entra por aquí: se le lleva a terminar de crearla (ver startStoreCompletion).
    if (mode === "vendor") return role === "VENDOR" || role === "VENDOR_STAFF" || role === "CUSTOMER";
    return true;
  }

  // El panel se pide antes de cambiar de página y el aviso de bienvenida sale cuando ya está en pantalla, no antes.
  async function enterPanel(role) {
    enteringRef.current = true;
    setEntering(true);
    if (!(role === "CUSTOMER" && isSafeNextPath)) await preloadPanel(role);
    navigate(destinationAfterLogin(role));
    requestAnimationFrame(() => requestAnimationFrame(() => toast.success("¡Bienvenido de vuelta!")));
  }

  function panelRoleForMode() {
    return mode === "admin" ? "ADMIN" : mode === "vendor" ? "VENDOR" : mode === "partner" ? "PARTNER" : "CUSTOMER";
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    // Se empieza a bajar el panel mientras el servidor revisa la contraseña: así casi siempre ya está listo al terminar.
    preloadPanel(panelRoleForMode());
    try {
      await withMinDelay(async () => {
        const result = await login(loginForm.email, loginForm.password, mode === "admin" || mode === "vendor" || mode === "partner" ? mode : undefined);
        // Bloque 47: 2FA opt-in — en vez de navegar, muestra el paso de
        // "ingresa el código" (mismo patrón visual que forgot-code).
        if (result?.requiresTwoFactor) {
          setTwoFactorEmail(result.email);
          setTwoFactorCode("");
          setTwoFactorExpiresAt(result.twoFactorExpiresAt);
          setTwoFactorMethod(result.method ?? "email");
          setChallengeToken(result.challengeToken ?? "");
          setCodeError("");
          clearPending2fa(mode);
          setView("two-factor");
          if ((result.method ?? "email") === "email") toast.success("Te enviamos un código a tu correo.");
          return;
        }
        // Bloque 183 (pedido explícito — primer ingreso de un usuario de
        // sistema sin contraseña todavía: "el sistema automáticamente
        // detecte... se le enviará un código... podrá ingresar su nueva
        // contraseña dos veces"): el backend YA mandó el código en esta
        // misma llamada (login() reusa forgotPassword internamente) — se
        // salta derecho a "forgot-code" (nunca a "forgot-email", que
        // volvería a pedir un correo que ya tenemos) con ese mismo correo.
        if (result?.requiresPasswordSetup) {
          setResetEmail(result.email);
          setResetCode("");
          setCodeError("");
          setView("forgot-code");
          toast.success("Es tu primera vez por aquí: te mandamos un código para crear tu contraseña.");
          return;
        }
        // login() ya emitió tokens y seteó el user antes de que podamos
        // revisar el rol — si no corresponde a esta URL, hay que deshacer
        // esa sesión (logout) y nunca revelar que el email existe con otro
        // rol: mismo mensaje genérico que una contraseña incorrecta.
        if (!roleAllowedForMode(result.role)) {
          logout();
          toast.error("Credenciales inválidas.");
          return;
        }
        if (mode === "vendor" && result.role === "CUSTOMER") {
          toast.success("Tu cuenta todavía no tiene tienda. Termina de crearla aquí.");
          startStoreCompletion(result);
          return;
        }
        await enterPanel(result.role);
      });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "Algo salió mal. Intenta de nuevo.");
    } finally {
      if (!enteringRef.current) setLoading(false);
    }
  }

  async function handleVerifyTwoFactor(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    preloadPanel(panelRoleForMode());
    try {
      await withMinDelay(async () => {
        const user = await verifyTwoFactor(twoFactorEmail, twoFactorCode, mode === "admin" || mode === "vendor" || mode === "partner" ? mode : undefined, challengeToken);
        clearPending2fa(mode);
        if (!roleAllowedForMode(user.role)) {
          logout();
          toast.error("Credenciales inválidas.");
          setView("login");
          return;
        }
        if (mode === "vendor" && user.role === "CUSTOMER") {
          toast.success("Tu cuenta todavía no tiene tienda. Termina de crearla aquí.");
          startStoreCompletion(user);
          return;
        }
        await enterPanel(user.role);
      });
    } catch (err) {
      // El código se borra para volver a escribirlo y se explica debajo de las casillas.
      setTwoFactorCode("");
      setCodeError(err.response?.data?.error ?? "Código incorrecto o vencido.");
    } finally {
      if (!enteringRef.current) setLoading(false);
    }
  }

  function goNext(e) {
    e.preventDefault();
    if (step === 2 && form.password !== form.confirmPassword) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }
    if (step < totalSteps) {
      setStep((s) => s + 1);
      return;
    }
    handleFinalSubmit();
  }

  // Bloque 114 (pedido explícito): arma el payload de POST /auth/register
  // según el tipo de cuenta — el cliente manda SU propia ubicación
  // (form.*, admite "otro país"); el vendedor manda la ubicación de SU
  // TIENDA como si fuera la de la persona (storeForm.*, nunca "otro país")
  // en vez de preguntarla dos veces. `fullName` se arma acá, uniendo
  // Nombre+Apellidos — el backend sigue guardando un solo campo.
  function buildRegisterPayload() {
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
    const base = { email: form.email, password: form.password, fullName, phone: form.phone, country: form.country };
    if (accountType === "vendor") {
      return {
        ...base,
        // Con el correo de su cuenta de cliente, la tienda se une a esa cuenta al verificar el código.
        forStore: true,
        registrationCountryId: storeForm.countryId || undefined,
        registrationCountryOther: storeForm.countryOther.trim() || undefined,
        provinceId: storeForm.provinceId || undefined,
        municipalityId: storeForm.municipalityId || undefined,
        municipalityOther: storeForm.municipalityOther.trim() || undefined,
        stateOther: storeForm.stateOther.trim() || undefined,
        address: storeForm.companyAddress.trim() || undefined,
      };
    }
    return {
      ...base,
      registrationCountryId: form.registrationCountryId || undefined,
      registrationCountryOther: form.registrationCountryOther.trim() || undefined,
      provinceId: form.provinceId || undefined,
      municipalityId: form.municipalityId || undefined,
      municipalityOther: form.municipalityOther.trim() || undefined,
      stateOther: form.stateOther.trim() || undefined,
      address: form.address.trim() || undefined,
    };
  }

  // Bloque 59 (pedido explícito): ya no crea la cuenta acá — manda el código
  // de verificación de correo y pasa al paso de "ingresa el código"
  // (handleVerifyRegistration, abajo, es quien de verdad crea la cuenta y,
  // si es vendedor, la tienda).
  async function handleFinalSubmit() {
    // Bloque 114 (pedido explícito): paso 3, distinto según el tipo de
    // cuenta — "tu ubicación" (cliente) o "configuración de la tienda"
    // (vendedor, incluye su propia ubicación — no se pregunta 2 veces).
    // Bloque 244: la ubicación (país, provincia o estado, municipio y
    // dirección cuando hace falta) la valida LocationPicker y reporta su estado
    // en locStatus — igual para el cliente y para la tienda. Lo escrito a
    // mano es válido: llega al admin como solicitud para revisar.
    if (locStatus.error) {
      toast.error(locStatus.error);
      return;
    }
    if (locStatus.needsAddress && !(accountType === "customer" ? form.address : storeForm.companyAddress).trim()) {
      toast.error(accountType === "customer" ? "Indica tu dirección." : "Indica la dirección de tu tienda.");
      return;
    }
    if (accountType === "vendor") {
      if (storeForm.isRestaurant && !storeForm.tableCount) {
        toast.error("Indica la cantidad de mesas de tu restaurante.");
        return;
      }
      if (storeForm.isRestaurant && maxTables != null && Number(storeForm.tableCount) > maxTables) {
        toast.error(`${tablesLimitText} Escribe ${maxTables} o menos.`);
        return;
      }
      if (!storeForm.businessCategoryId) {
        toast.error("Elige el tipo de negocio de tu tienda.");
        return;
      }
      // Antes de crear la cuenta: si el nombre, el WhatsApp o el correo ya son de otra tienda, se avisa aquí y no se sigue.
      try {
        const { data } = await api.post("/vendors/check-availability", { companyName: storeForm.companyName, whatsapp: form.phone, email: form.email, username: storeForm.username || undefined });
        // Correo de una cuenta que ya existe: no se le pide iniciar sesión. El registro sigue y, si es una cuenta de cliente,
        // al verificar el código la tienda queda en esa misma cuenta (forStore en register). Si es de otro tipo, el servidor
        // responde "duplicate" y se lleva a iniciar sesión (catch de abajo).
        // Ese número es el de una cuenta de cliente con otro correo: no se puede unir sin probar que el número es suyo, así que
        // se le muestra una pista del correo de esa cuenta para que lo use.
        if (data.phoneAccountExists && !completingStore) {
          toast.warning(
            "Ese número ya está en una cuenta de cliente",
            data.phoneAccountEmailHint
              ? `Si es tuya, escribe su correo (${data.phoneAccountEmailHint}) y tu tienda quedará en esa misma cuenta, con tus compras y anuncios.`
              : "Si es tuya, escribe el correo de esa cuenta y tu tienda quedará en ella."
          );
          setStep(1);
          return;
        }
        const first = Object.values(data.conflicts ?? {})[0];
        if (first) {
          toast.error(first);
          return;
        }
      } catch {
        /* si la comprobación falla, el servidor vuelve a comprobarlo al crear la tienda */
      }
    }
    if (completingStore) {
      // La cuenta ya existe y tiene sesión: solo falta crear la tienda.
      setLoading(true);
      try {
        await withMinDelay(createVendorFromForm);
      } catch (err) {
        toast.error(err.response?.data?.error ?? "No se pudo crear tu tienda. Revisa tu conexión e inténtalo de nuevo.");
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      await withMinDelay(async () => {
        const sent = await register(buildRegisterPayload());
        setRegisterExpiresAt(sent.codeExpiresAt);
        setAccountCreated(false);
        setVendorError("");
        setRegisterCode("");
        setCodeError("");
        setView("register-verify");
        toast.success("Te mandamos un código de verificación a tu correo.");
      });
    } catch (err) {
      // Correo ya registrado: no se crea otra cuenta ni se cambia la contraseña. Se avisa y se lleva a iniciar sesión con el
      // correo ya escrito (antes mandaba solo un código para restablecer la contraseña y parecía que el registro la cambiaba;
      // cambiarla es cosa de "¿Olvidaste tu contraseña?" o de Mi perfil, a pedido de la persona).
      if (err.response?.data?.details?.duplicate) {
        toast.warning("Ya tienes una cuenta con este correo", "Inicia sesión. Si no recuerdas la contraseña, toca «¿Olvidaste tu contraseña?».");
        setLoginForm((f) => ({ ...f, email: form.email, password: "" }));
        setView("login");
        return;
      }
      toast.error(err.response?.data?.error ?? "Algo salió mal. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  // Segundo paso del registro — recién acá se crea la cuenta de verdad. Si
  // es vendedor, retoma exactamente donde handleFinalSubmit la dejaba antes
  // de este bloque (crear la tienda, refrescar el rol, mostrar el modal de planes).
  // Crea la tienda con los datos del formulario. Se separa de la verificación del correo para poder reintentarla sola si falla.
  async function createVendorFromForm() {
    await api.post("/vendors", {
      // Zona horaria, pantalla e idioma del navegador: quedan en el historial de la tienda que ve el admin.
      clientInfo: clientInfo(),
      partnerCode: getPartnerCode(),
      companyName: storeForm.companyName,
      username: storeForm.username || undefined,
      // Bloque 113/114 (pedido explícito): ya no se piden de nuevo en
      // el paso de la tienda — son los mismos que la persona cargó en
      // el paso 1 (Nombre+Apellidos/email/phone), con el aviso de que
      // el nombre debe coincidir con su identificación.
      ownerName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
      description: storeForm.description || undefined,
      whatsapp: form.phone,
      email: form.email,
      companyAddress: storeForm.companyAddress.trim() || undefined,
      isRestaurant: storeForm.isRestaurant,
      tableCount: storeForm.isRestaurant ? Number(storeForm.tableCount) : undefined,
      businessCategoryId: storeForm.businessCategoryId,
      // Bloque 114: countryId siempre real (nunca "otro país");
      // provinceId/municipalityId solo con Cuba, stateOther solo con
      // cualquier otro país real.
      locations: [
        {
          countryId: storeForm.countryId || undefined,
          countryOther: storeForm.countryOther.trim() || undefined,
          provinceId: storeForm.provinceId || undefined,
          municipalityId: storeForm.municipalityId || undefined,
          municipalityOther: storeForm.municipalityOther.trim() || undefined,
          stateOther: storeForm.stateOther.trim() || undefined,
        },
      ],
    });
    // El accessToken recién emitido por verifyRegistration() todavía
    // dice role CUSTOMER — sin refrescarlo, /vendedor/* devolvería 403
    // apenas se cierre el modal y se navegue al panel.
    await refreshRole();
    clearPartnerRef();
    // La tienda ya existe: lo que sigue depende del plan elegido en /planes. La lista de planes casi siempre ya está en
    // caché; si no, se pide aquí. Si tampoco llega, con un plan elegido se va a la verificación (esa pantalla ignora una
    // clave que no sea de pago) y sin plan, al panel. Nada de esto debe hacer fallar el alta: la tienda ya se creó.
    let plansData = publicPlansData?.plans ? publicPlansData : null;
    if (!plansData) {
      try {
        const { data } = await api.get("/settings/plans");
        plansData = { ...data, plans: data.plans ?? [] };
      } catch {
        plansData = null;
      }
    }
    // `next` y no `step`: `step` es el paso del formulario (useState de arriba) y aquí no se toca.
    const next = plansData
      ? afterSignupStep(plansData.plans, chosenPlanKey, plansData.supportWhatsapp)
      : { go: chosenPlanKey ? `/vendedor/verificacion?plan=${encodeURIComponent(chosenPlanKey)}` : "/vendedor" };
    if (next.modal) {
      setPlanModalOffer(next.modal);
      return;
    }
    if (next.note) toast.success("¡Tu tienda ya existe!", next.note);
    else toast.success("¡Tu tienda ya existe!");
    navigate(next.go);
  }

  // Segundo paso del registro — recién acá se crea la cuenta de verdad. Si es vendedor, después crea la tienda. Si la tienda
  // falla, la cuenta ya existe y el correo ya está verificado: se avisa con el motivo real (no como "código incorrecto") y se
  // puede reintentar sin pedir otro código. Antes un fallo aquí dejaba una cuenta de cliente sin tienda, y al entrar como
  // vendedor decía "Esta cuenta no es de vendedor".
  async function handleVerifyRegistration(e) {
    e.preventDefault();
    setLoading(true);
    setVendorError("");
    try {
      await withMinDelay(async () => {
        let linkedOrdersCount = 0;
        let mergedIntoCustomer = false;
        if (!accountCreated) {
          ({ linkedOrdersCount, mergedIntoCustomer } = await verifyRegistration(form.email, registerCode));
          if (mergedIntoCustomer) toast.success("Unimos tu tienda a tu cuenta de cliente", "Tus compras, favoritos y anuncios siguen ahí. Desde ahora entras con la contraseña que acabas de elegir.");
          setAccountCreated(true);
        }

        if (accountType === "vendor") {
          try {
            await createVendorFromForm();
          } catch (err) {
            err.vendorStep = true;
            throw err;
          }
        } else {
          // Bloque 59 (pedido explícito): si ya había comprado como
          // invitado con este correo, esos pedidos quedaron vinculados a la
          // cuenta recién creada — se lo hacemos saber.
          toast.success(
            linkedOrdersCount > 0
              ? `¡Cuenta creada! Vinculamos ${linkedOrdersCount} ${linkedOrdersCount === 1 ? "pedido anterior" : "pedidos anteriores"} a tu cuenta.`
              : "¡Cuenta creada!"
          );
          // Paso opcional: elegir si además se activa la app autenticadora.
          setView("register-app");
        }
      });
    } catch (err) {
      if (err.vendorStep) {
        const message = err.response?.data?.error ?? "No se pudo crear tu tienda. Revisa tu conexión e inténtalo de nuevo.";
        setVendorError(message);
        toast.error(message);
      } else {
        setRegisterCode("");
        setCodeError(err.response?.data?.error ?? "Código incorrecto o vencido.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendRegistrationCode() {
    setResendingCode(true);
    try {
      const sent = await register(buildRegisterPayload());
      setRegisterExpiresAt(sent.codeExpiresAt);
      setRegisterCode("");
      setCodeError("");
      toast.success("Te mandamos un nuevo código.");
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo reenviar el código.");
    } finally {
      setResendingCode(false);
    }
  }

  // Bloque 46 (pedido explícito — "agregar un botón de reenviar código de
  // autenticación para todos los roles"): mismo endpoint de login de
  // siempre — el backend YA genera y manda un código nuevo en CADA llamada
  // (ver auth.controller.js), así que reenviar es simplemente repetir el
  // mismo login con las credenciales que ya están en el formulario.
  // Bloque 273: "no tengo acceso a mi app": el código se envía al correo (con el token que
  // entregó el login tras validar la contraseña).
  async function handleSendEmailCodeInstead() {
    setResendingCode(true);
    try {
      const { data } = await api.post("/auth/2fa/email-code", { challengeToken });
      setTwoFactorMethod("email");
      setTwoFactorExpiresAt(data.twoFactorExpiresAt);
      setTwoFactorCode("");
      setCodeError("");
      toast.success("Te enviamos un código a tu correo.");
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo enviar el código. Vuelve a iniciar sesión.");
    } finally {
      setResendingCode(false);
    }
  }

  async function handleResendTwoFactorCode() {
    if (challengeToken) return handleSendEmailCodeInstead();
    // Tras una recarga de la pestaña la contraseña ya no está (nunca se guarda): para un código nuevo hay que volver a ponerla.
    if (!loginForm.password) {
      toast.error("Para recibir otro código, vuelve a escribir tu contraseña.");
      setView("login");
      return;
    }
    setResendingCode(true);
    try {
      const result = await login(loginForm.email, loginForm.password, mode === "admin" || mode === "vendor" || mode === "partner" ? mode : undefined);
      if (result?.requiresTwoFactor) {
        setTwoFactorExpiresAt(result.twoFactorExpiresAt);
        setTwoFactorCode("");
        setCodeError("");
        toast.success("Te mandamos un nuevo código.");
      }
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo reenviar el código.");
    } finally {
      setResendingCode(false);
    }
  }

  async function handleForgotEmail(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await withMinDelay(async () => {
        const { data } = await api.post("/auth/forgot-password", { email: resetEmail });
        setResetExpiresAt(data.codeExpiresAt);
        setResetCode("");
        setCodeError("");
        toast.success(data.message ?? "Revisa tu correo.");
        setView("forgot-code");
      });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo procesar la solicitud.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendResetCode() {
    setResendingCode(true);
    try {
      const { data } = await api.post("/auth/forgot-password", { email: resetEmail });
      setResetExpiresAt(data.codeExpiresAt);
      setResetCode("");
      setCodeError("");
      toast.success("Te mandamos un nuevo código.");
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo reenviar el código.");
    } finally {
      setResendingCode(false);
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await withMinDelay(async () => {
        await api.post("/auth/verify-reset-code", { email: resetEmail, code: resetCode });
        setView("forgot-newpass");
      });
    } catch (err) {
      setResetCode("");
      setCodeError(err.response?.data?.error ?? "Código incorrecto o vencido.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await withMinDelay(async () => {
        await api.post("/auth/reset-password", { email: resetEmail, code: resetCode, newPassword, confirmPassword });
        toast.success("Contraseña actualizada. Ya puedes entrar.");
        setLoginForm({ email: resetEmail, password: "" });
        setResetEmail("");
        setResetCode("");
        setNewPassword("");
        setConfirmPassword("");
        setView("login");
      });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo restablecer la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  function closePlanModal() {
    setPlanModalOffer(null);
    navigate("/vendedor");
  }

  if (planModalOffer) {
    // Comparación de bienvenida con el plan que sugiere afterSignupStep: siempre uno con insignia que se paga con la
    // verificación (un plan a medida o sin insignia ya no llega aquí, ver afterSignupStep).
    const key = planModalOffer.planType;
    return <PlanComparisonModal onContinueRegular={closePlanModal} planType={key} businessHref={`/vendedor/verificacion?plan=${encodeURIComponent(key)}`} />;
  }

  // Bloque 47: segundo paso del login cuando la cuenta tiene 2FA activo —
  // mismo patrón visual que el paso "forgot-code" de abajo.
  if (view === "two-factor") {
    return (
      <AccountShell mode={mode}>
        <div key={view} className="animate-step-in">
          <h1 className="mb-2 text-headline-md text-on-surface">Verificación en dos pasos</h1>
          {twoFactorMethod === "totp" ? (
            <p className="mb-6 text-body-md text-on-surface-variant">
              Abre tu aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Authy...) e ingresa el código de 6 dígitos que muestra para esta cuenta.
            </p>
          ) : (
            <p className="mb-6 text-body-md text-on-surface-variant">
              Te mandamos un código de 6 dígitos a <strong>{twoFactorEmail}</strong>.{" "}
              {twoFactorSecondsLeft > 0 ? (
                <>
                  Vence en{" "}
                  <strong className="tabular-nums">
                    {String(Math.floor(twoFactorSecondsLeft / 60)).padStart(2, "0")}:
                    {String(twoFactorSecondsLeft % 60).padStart(2, "0")}
                  </strong>
                  .
                </>
              ) : (
                "El código venció."
              )}
            </p>
          )}
          <form onSubmit={handleVerifyTwoFactor} className="space-y-4">
            <OtpInput label="Código de verificación" required autoFocus value={twoFactorCode} onChange={(v) => { setTwoFactorCode(v); setCodeError(""); }} error={codeError || undefined} />
            <Button type="submit" size="lg" className={`w-full rounded-xl ${LG_FIT}`} disabled={loading || twoFactorCode.length !== 6}>
              {loading ? (<><Spinner className="text-white" /> {entering ? "Abriendo tu panel..." : "Verificando..."}</>) : "Verificar e ingresar"}
            </Button>
          </form>
          {twoFactorMethod === "totp" ? (
            <button type="button" onClick={handleSendEmailCodeInstead} disabled={resendingCode} className={`mt-2 ${TEXT_BTN} text-tertiary-accent disabled:opacity-50`}>
              {resendingCode ? "Enviando..." : "No tengo acceso a mi app: enviar el código a mi correo"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleResendTwoFactorCode}
                disabled={twoFactorSecondsLeft > 0 || resendingCode}
                className={`mt-2 ${TEXT_BTN} text-tertiary-accent disabled:opacity-50`}
              >
                {resendingCode ? "Reenviando..." : "Enviar código nuevamente"}
              </button>
              {challengeToken && (
                <button type="button" onClick={() => { setTwoFactorMethod("totp"); setTwoFactorCode(""); setCodeError(""); }} className={`${TEXT_BTN} text-tertiary-accent`}>
                  Usar el código de mi aplicación
                </button>
              )}
            </>
          )}
          <button type="button" onClick={() => switchView("login")} className={`${TEXT_BTN} text-tertiary-accent`}>
            ← Volver al login
          </button>
        </div>
      </AccountShell>
    );
  }

  // Bloque 59: segundo paso del registro (verificación de correo) — mismo
  // patrón visual que "two-factor"/"forgot-code" de arriba/abajo.
  if (view === "register-app") {
    return (
      <AccountShell mode={mode}>
        <RegisterAppStep onDone={() => navigate(isSafeNextPath ? nextPath : "/cuenta/panel")} />
      </AccountShell>
    );
  }

  if (view === "register-verify") {
    return (
      <AccountShell mode={mode}>
        <div key={view} className="animate-step-in">
          <h1 className="mb-2 text-headline-md text-on-surface">{accountCreated ? "Falta crear tu tienda" : "Confirma tu correo"}</h1>
          {accountCreated ? (
            <p className="mb-4 text-body-md text-on-surface-variant">
              Tu correo <strong>{form.email}</strong> ya está verificado y tu cuenta creada, pero la tienda no se pudo terminar de crear.
              {vendorError ? ` Motivo: ${vendorError}` : ""} Puedes reintentarlo ahora sin pedir otro código.
            </p>
          ) : (
            <p className="mb-6 text-body-md text-on-surface-variant">
              Te mandamos un código de 6 dígitos a <strong>{form.email}</strong>.{" "}
              {registerSecondsLeft > 0 ? (
                <>
                  Vence en{" "}
                  <strong className="tabular-nums">
                    {String(Math.floor(registerSecondsLeft / 60)).padStart(2, "0")}:{String(registerSecondsLeft % 60).padStart(2, "0")}
                  </strong>
                  .
                </>
              ) : (
                "El código venció: pide uno nuevo."
              )}
            </p>
          )}
          <form onSubmit={handleVerifyRegistration} className="space-y-4">
            {!accountCreated && (
              <OtpInput label="Código de verificación" required autoFocus value={registerCode} onChange={(v) => { setRegisterCode(v); setCodeError(""); }} error={codeError || undefined} />
            )}
            <Button type="submit" size="lg" className={`w-full rounded-xl ${LG_FIT}`} disabled={loading || (!accountCreated && registerCode.length !== 6)}>
              {loading ? (
                <>
                  <Spinner className="text-white" /> {accountType === "vendor" ? "Creando tu tienda..." : "Creando tu cuenta..."}
                </>
              ) : accountCreated ? (
                "Reintentar crear mi tienda"
              ) : (
                "Verificar y crear cuenta"
              )}
            </Button>
          </form>
          {!accountCreated && (
            <>
              <button
                type="button"
                onClick={handleResendRegistrationCode}
                disabled={resendingCode || registerSecondsLeft > 0}
                className={`mt-2 ${TEXT_BTN} text-tertiary-accent disabled:opacity-50`}
              >
                {resendingCode ? "Reenviando..." : "Enviar código nuevamente"}
              </button>
              <button type="button" onClick={() => switchView("register")} className={`${TEXT_BTN} text-outline`}>
                ← Volver a editar mis datos
              </button>
            </>
          )}
        </div>
      </AccountShell>
    );
  }

  if (view.startsWith("forgot-")) {
    return (
      <AccountShell mode={mode}>
        <div key={view} className="animate-step-in">
          {view === "forgot-email" && (
            <>
              <h1 className="mb-2 text-headline-md text-on-surface">¿Olvidaste tu contraseña?</h1>
              <p className="mb-6 text-body-md text-on-surface-variant">Ingresa tu correo y te mandamos un código de verificación.</p>
              <form onSubmit={handleForgotEmail} className="space-y-4">
                <Input label="Correo" type="email" autoComplete="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
                <Button type="submit" size="lg" className={`w-full rounded-xl ${LG_FIT}`} disabled={loading}>
                  {loading ? (<><Spinner className="text-white" /> Enviando...</>) : "Enviar código"}
                </Button>
              </form>
              <button type="button" onClick={() => switchView("login")} className={`mt-2 ${TEXT_BTN} text-tertiary-accent`}>
                ← Volver al login
              </button>
            </>
          )}

          {view === "forgot-code" && (
            <>
              <h1 className="mb-2 text-headline-md text-on-surface">Ingresa el código</h1>
              <p className="mb-6 text-body-md text-on-surface-variant">
                Te mandamos un código de 6 dígitos a <strong>{resetEmail}</strong>.{" "}
                {resetSecondsLeft > 0 ? (
                  <>
                    Vence en{" "}
                    <strong className="tabular-nums">
                      {String(Math.floor(resetSecondsLeft / 60)).padStart(2, "0")}:{String(resetSecondsLeft % 60).padStart(2, "0")}
                    </strong>
                    .
                  </>
                ) : (
                  "El código venció: pide uno nuevo."
                )}
              </p>
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <OtpInput label="Código de verificación" required autoFocus value={resetCode} onChange={(v) => { setResetCode(v); setCodeError(""); }} error={codeError || undefined} />
                <Button type="submit" size="lg" className={`w-full rounded-xl ${LG_FIT}`} disabled={loading || resetCode.length !== 6}>
                  {loading ? (<><Spinner className="text-white" /> Verificando...</>) : "Verificar código"}
                </Button>
              </form>
              <button type="button" onClick={handleResendResetCode} disabled={resetSecondsLeft > 0 || resendingCode} className={`mt-2 ${TEXT_BTN} text-tertiary-accent disabled:opacity-50`}>
                {resendingCode ? "Reenviando..." : "Enviar código nuevamente"}
              </button>
              <button type="button" onClick={() => setView("forgot-email")} className={`${TEXT_BTN} text-outline`}>
                ← Cambiar el correo
              </button>
            </>
          )}

          {view === "forgot-newpass" && (
            <>
              <h1 className="mb-2 text-headline-md text-on-surface">Nueva contraseña</h1>
              <p className="mb-6 text-body-md text-on-surface-variant">Escríbela dos veces para confirmar.</p>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <PasswordInput label="Nueva contraseña" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <PasswordInput label="Confirmar contraseña" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                <Button type="submit" size="lg" className={`w-full rounded-xl ${LG_FIT}`} disabled={loading}>
                  {loading ? (<><Spinner className="text-white" /> Guardando...</>) : "Restablecer contraseña"}
                </Button>
              </form>
            </>
          )}
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell mode={mode}>
      {/* /admin/ingresar es la única que nunca ofrece registro (ver
          comentario arriba del componente) — ahí no tiene sentido mostrar
          este toggle. */}
      {canRegister && (
        // Pestañas accesibles: el lector de pantalla anuncia cuál está elegida, y con las flechas se cambia de una a otra
        // (la elegida es la única que recibe el foco con Tab, como piden las pestañas de ARIA). min-h-11: antes medían 40px.
        <div
          role="tablist"
          aria-label="Iniciar sesión o crear cuenta"
          className="mb-7 flex rounded-full bg-surface-container p-1"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const next = e.key === "Home" ? "login" : e.key === "End" ? "register" : isLogin ? "register" : "login";
            switchView(next);
            (next === "login" ? loginTabRef : registerTabRef).current?.focus();
          }}
        >
          <button
            ref={loginTabRef}
            type="button"
            role="tab"
            id="cuenta-tab-login"
            aria-selected={isLogin}
            aria-controls="cuenta-panel"
            tabIndex={isLogin ? 0 : -1}
            onClick={() => switchView("login")}
            className={`min-h-11 flex-1 rounded-full py-2.5 text-label-md font-semibold transition-colors duration-200 ${
              isLogin ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-outline"
            }`}
          >
            Iniciar sesión
          </button>
          <button
            ref={registerTabRef}
            type="button"
            role="tab"
            id="cuenta-tab-registro"
            aria-selected={!isLogin}
            aria-controls="cuenta-panel"
            tabIndex={isLogin ? -1 : 0}
            onClick={() => switchView("register")}
            className={`min-h-11 flex-1 rounded-full py-2.5 text-label-md font-semibold transition-colors duration-200 ${
              !isLogin ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-outline"
            }`}
          >
            Crear cuenta
          </button>
        </div>
      )}

      <div
        key={view}
        id="cuenta-panel"
        {...(canRegister ? { role: "tabpanel", "aria-labelledby": isLogin ? "cuenta-tab-login" : "cuenta-tab-registro" } : {})}
        className="animate-step-in"
      >
        {isLogin ? (
          <>
            <h1 className="mb-1 text-headline-md text-on-surface">
              {mode === "admin" ? "Acceso de administrador" : mode === "partner" ? "Acceso de socios" : mode === "vendor" ? "Ingresa a tu panel" : "Bienvenido de nuevo"}
            </h1>
            <p className="mb-6 text-body-md text-on-surface-variant">
              {mode === "admin"
                ? "Solo cuentas de administrador pueden entrar aquí."
                : mode === "partner"
                ? "Ingresa con tu cuenta de socio para ver el uso de tu API."
                : mode === "vendor"
                ? "Ingresa con tu cuenta de vendedor para gestionar tu tienda."
                : "Ingresa para comprar o gestionar tu tienda."}
            </p>
            <form onSubmit={handleLogin} aria-busy={loading}>
              {/* Mientras se revisa la cuenta y se abre el panel no se puede escribir ni volver a enviar. */}
              <fieldset disabled={loading} className="space-y-4 disabled:opacity-90">
              {/* autoComplete: el celular y los gestores de contraseñas ofrecen rellenar la cuenta guardada. "username" (no "email")
                  es lo que buscan para asociar el correo con su contraseña en un formulario de ingreso. */}
              <Input label="Correo" type="email" autoComplete="username" required value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
              {/* Bloque 183 (pedido explícito — "el usuario podrá solo
                  ingresar su correo... el sistema automáticamente detecte
                  que ese usuario no tiene una contraseña válida aún"): sin
                  `required` a propósito — un usuario de sistema recién
                  creado legítimamente no tiene ninguna contraseña que
                  escribir todavía, y la validación nativa del navegador
                  bloquearía el submit antes de que handleLogin() llegue a
                  detectar ese caso. El backend sigue pidiendo la
                  contraseña igual para cualquier cuenta que sí la tenga
                  (login(), auth.controller.js). */}
              <PasswordInput
                label="Contraseña"
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              />
              <button type="button" onClick={() => setView("forgot-email")} className="flex min-h-11 items-center text-left text-label-sm font-semibold text-tertiary-accent">
                ¿Olvidaste tu contraseña?
              </button>
              <Button type="submit" size="lg" className={`w-full rounded-xl ${LG_FIT}`} disabled={loading}>
                {loading ? (<><Spinner className="text-white" /> {entering ? "Abriendo tu panel..." : "Verificando..."}</>) : "Entrar"}
              </Button>
              {mode === "partner" && (
                <p className="text-center text-label-sm text-outline">
                  ¿Aún no tienes cuenta de socio? <Link to="/socios/solicitar" className="font-semibold text-tertiary-accent hover:underline">Solicita acceso a la API</Link>
                </p>
              )}
              </fieldset>
            </form>
          </>
        ) : !typeChosen && !completingStore ? (
          <AccountTypePicker onPick={pickAccountType} />
        ) : (
          <>
            <h1 className="mb-1 text-headline-md text-on-surface">
              {completingStore ? "Termina de crear tu tienda" : mode === "vendor" ? `Crea tu tienda en ${siteName}` : `Crea tu cuenta ${siteName}`}
            </h1>
            <p className="mb-4 text-label-sm text-outline">
              {completingStore ? `Paso ${step - 2} de 2 · cuenta ${form.email}` : `Paso ${step} de ${totalSteps}`}
            </p>
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
              <div
                className="h-full rounded-full bg-secondary-container transition-all duration-300"
                style={{ width: `${completingStore ? ((step - 2) / 2) * 100 : (step / totalSteps) * 100}%` }}
              />
            </div>
            {/* Quien ya tiene sesión de cliente puede abrir su tienda con esa misma cuenta, sin registrarse otra vez. */}
            {mode === "vendor" && !completingStore && step === 1 && sessionUser?.role === "CUSTOMER" && (
              <div className="mb-5 rounded-xl border border-tertiary-accent/40 bg-tertiary-accent/5 p-3.5">
                <p className="text-label-md text-on-surface">
                  Ya iniciaste sesión como <strong>{sessionUser.fullName}</strong>. Puedes crear tu tienda con esta misma cuenta.
                </p>
                <Button type="button" size="md" className="mt-2.5 w-full rounded-xl" onClick={() => startStoreCompletion(sessionUser)}>
                  Crear mi tienda con esta cuenta
                </Button>
              </div>
            )}

            <form onSubmit={goNext} className="space-y-4">
              {step === 1 && (
                <div key="step-1" className="animate-step-in space-y-4">
                  {/* Bloque 114 (pedido explícito): nombre y apellidos por
                      separado, no un solo "Nombre completo". */}
                  <div className="grid grid-cols-2 gap-3">
                    <Input data-guard="name" label="Nombre" autoComplete="given-name" required value={form.firstName} onChange={setFormField("firstName")} />
                    <Input data-guard="name" label="Apellidos" autoComplete="family-name" required value={form.lastName} onChange={setFormField("lastName")} />
                  </div>
                  <Input label="Correo" type="email" autoComplete="email" required value={form.email} onChange={setFormField("email")} />
                  <div>
                    {/* Forma con función a propósito: PhoneInput avisa número y país en el mismo evento, y con
                        { ...form } el segundo setForm devolvía el número viejo (el país no se podía cambiar). */}
                    <PhoneInput
                      label="Teléfono (WhatsApp)"
                      required
                      value={form.phone}
                      onChange={(phone) => setForm((f) => ({ ...f, phone }))}
                      onCountryChange={(country) => setForm((f) => ({ ...f, country }))}
                    />
                    {/* El paso 1 es el mismo para cliente y tienda: el aviso cambia según quién se registra. El del cliente
                        sale de Checkout.jsx, que rellena con este número el teléfono del pedido que recibe la tienda. */}
                    <p className="mt-1.5 rounded-lg bg-surface-container px-3 py-2 text-label-sm text-on-surface-variant">
                      {accountType === "vendor"
                        ? "Este es el número por el que los clientes te contactarán para comprar productos o hacer preguntas."
                        : "Lo usan las tiendas para coordinar tus pedidos contigo."}
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div key="step-2" className="animate-step-in space-y-4">
                  {/* new-password: el navegador ofrece una contraseña segura y la guarda junto al correo del paso 1. */}
                  <PasswordInput label="Contraseña" autoComplete="new-password" required minLength={8} value={form.password} onChange={setFormField("password")} />
                  <PasswordInput
                    label="Confirmar contraseña"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={form.confirmPassword}
                    onChange={setFormField("confirmPassword")}
                  />
                </div>
              )}

              {/* Bloque 114 (pedido explícito): país/provincia/municipio DE
                  LA PERSONA — SOLO cliente (el vendedor manda directo al
                  paso de la tienda, ver abajo, sin preguntarle su ubicación
                  dos veces). Con Cuba: provincia+municipio del catálogo; con
                  cualquier otro país real: estado+dirección de texto libre
                  (ya no un select de provincia que podía quedar vacío); con
                  "otro país", solo el nombre escrito a mano — nunca se le
                  exige elegir un país que no es el suyo. */}
              {step === 3 && accountType === "customer" && (
                <div key="step-3" className="animate-step-in space-y-4">
                  {/* Bloque 244: mismo selector que la tienda — catálogo del
                      admin primero, texto manual solo si no aparece. */}
                  <LocationPicker
                    value={{
                      countryId: form.registrationCountryId,
                      countryOther: form.registrationCountryOther,
                      provinceId: form.provinceId,
                      municipalityId: form.municipalityId,
                      municipalityOther: form.municipalityOther,
                      stateOther: form.stateOther,
                    }}
                    onChange={(patch) =>
                      setForm((prev) => {
                        const next = { ...prev };
                        if ("countryId" in patch) next.registrationCountryId = patch.countryId;
                        if ("countryOther" in patch) next.registrationCountryOther = patch.countryOther;
                        if ("provinceId" in patch) next.provinceId = patch.provinceId;
                        if ("municipalityId" in patch) next.municipalityId = patch.municipalityId;
                        if ("municipalityOther" in patch) next.municipalityOther = patch.municipalityOther;
                        if ("stateOther" in patch) next.stateOther = patch.stateOther;
                        return next;
                      })
                    }
                    address={form.address}
                    onAddressChange={(address) => setForm((prev) => ({ ...prev, address }))}
                    onStatus={setLocStatus}
                    labels={{ country: "País", province: "Provincia o estado" }}
                    addressLabel="Dirección"
                  />
                </div>
              )}

              {/* Bloque 114 (pedido explícito): "configuración de la
                  tienda" del vendedor — un solo paso que junta lo que antes
                  eran 2 (su propia ubicación + la de la tienda, redundantes
                  entre sí). País/provincia/municipio de acá se manda a la
                  vez como la ubicación de registro de la PERSONA (ver
                  buildRegisterPayload) y como VendorLocation — nunca se
                  pregunta dos veces. */}
              {step === 3 && accountType === "vendor" && (
                <div key="step-3" className="animate-step-in space-y-4">
                  <h2 className="text-title-lg font-bold text-on-surface">Tu tienda</h2>
                  <Input
                    label="Nombre de la tienda (público)"
                    autoComplete="organization"
                    required
                    value={storeForm.companyName}
                    onChange={(e) => setStoreForm({ ...storeForm, companyName: e.target.value })}
                  />
                  <UsernameField
                    value={storeForm.username}
                    suggestFrom={storeForm.companyName}
                    onChange={(username) => setStoreForm((f) => ({ ...f, username }))}
                  />
                  {/* Bloque 113 (pedido explícito): ya no se pide de nuevo un
                      "nombre del responsable" — es el mismo nombre y
                      apellidos que ya cargó en el paso 1. Solo un aviso de
                      que debe coincidir con su identificación, ya que se
                      puede llegar a verificar más adelante (KYC). */}
                  {/* Sin nombre (una cuenta vieja sin nombre completo) no se muestra la línea del responsable: antes salía
                      "Responsable del negocio: —". */}
                  <div className="rounded-lg border border-outline-variant bg-surface-container p-3.5">
                    {`${form.firstName} ${form.lastName}`.trim() && (
                      <p className="mb-1 text-label-sm font-semibold text-on-surface">
                        Responsable del negocio: <span className="font-bold">{`${form.firstName} ${form.lastName}`.trim()}</span>
                      </p>
                    )}
                    <p className="text-label-sm text-outline">
                      El nombre del responsable debe coincidir con tu documento de identidad, por si más adelante hace falta verificarlo.
                    </p>
                  </div>

                  <div>
                    <ComboSelect
                      label="Tipo de negocio"
                      required
                      value={storeForm.businessCategoryId}
                      onChange={(v) => setStoreForm({ ...storeForm, businessCategoryId: v })}
                      options={businessCategoryOptions}
                      placeholder="Escribe y elige el rubro de tu tienda"
                      emptyText="Ningún tipo de negocio coincide. Prueba con otra palabra."
                    />
                    <p className="mt-1 text-label-sm text-outline">Puedes cambiarlo después desde tu panel.</p>
                  </div>

                  <label className="flex items-center gap-2 text-body-md text-on-surface">
                    <input
                      type="checkbox"
                      checked={storeForm.isRestaurant}
                      onChange={(e) => setStoreForm({ ...storeForm, isRestaurant: e.target.checked })}
                    />
                    Soy un restaurante / cafetería / bar
                  </label>

                  {storeForm.isRestaurant && (
                    <div>
                      <Input
                        label="Número de mesas"
                        type="number"
                        min={1}
                        max={maxTables ?? undefined}
                        required
                        value={storeForm.tableCount}
                        onChange={(e) => setStoreForm({ ...storeForm, tableCount: e.target.value })}
                      />
                      <p className="mt-1 text-label-sm text-outline">
                        Generamos un código QR por cada mesa apenas creas la tienda. Los pedidos te van a llegar al panel de vendedor.
                        {maxTables != null && ` ${tablesLimitText}`}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {step === 4 && accountType === "vendor" && (
                <div key="step-4" className="animate-step-in space-y-4">
                  <h2 className="text-title-lg font-bold text-on-surface">Dónde está tu tienda</h2>
                  {/* Bloque 244 (pedido explícito): país, provincia y municipio
                      salen del catálogo del admin; si no están, se escriben a
                      mano y el admin los revisa (LocationPicker). La dirección
                      de la tienda se pide cuando no hay un municipio real. */}
                  <LocationPicker
                    value={{
                      countryId: storeForm.countryId,
                      countryOther: storeForm.countryOther,
                      provinceId: storeForm.provinceId,
                      municipalityId: storeForm.municipalityId,
                      municipalityOther: storeForm.municipalityOther,
                      stateOther: storeForm.stateOther,
                    }}
                    onChange={(patch) => setStoreForm((prev) => ({ ...prev, ...patch }))}
                    address={storeForm.companyAddress}
                    onAddressChange={(companyAddress) => setStoreForm((prev) => ({ ...prev, companyAddress }))}
                    onStatus={setLocStatus}
                    labels={{
                      country: "País donde va a operar tu tienda",
                      countryOther: "Escribe el país donde va a operar tu tienda",
                      province: "Provincia o estado donde prestas servicio",
                      provinceOther: "Escribe la provincia o estado donde prestas servicio",
                      municipality: "Municipio donde prestas servicio",
                    }}
                    addressLabel="Dirección de la tienda"
                  />
                </div>
              )}

              <div className="flex gap-2.5">
                {step > (completingStore ? 3 : 1) && (
                  <Button type="button" variant="outline" size="lg" onClick={() => setStep((s) => s - 1)} disabled={loading} className={`rounded-xl ${LG_FIT}`}>
                    Atrás
                  </Button>
                )}
                <Button type="submit" size="lg" className={`flex-1 rounded-xl ${LG_FIT}`} disabled={loading}>
                  {loading ? (
                    <>
                      <Spinner className="text-white" />
                      {step === totalSteps ? (completingStore ? "Creando tu tienda..." : "Enviando código...") : "Cargando..."}
                    </>
                  ) : step < totalSteps ? (
                    "Continuar"
                  ) : completingStore ? (
                    "Crear mi tienda"
                  ) : (
                    // Corto a propósito: comparte la fila con "Atrás" y a 390px el texto largo no cabía en una línea.
                    "Enviar código"
                  )}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </AccountShell>
  );
}
