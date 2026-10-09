import { useEffect, useState } from "react";
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
import { LocationPicker } from "../../components/LocationPicker.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";
import { capturePartnerRef, getPartnerCode, clearPartnerRef } from "../../lib/partnerRef.js";

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
  admin: {
    headline: "Panel de administración",
    subtitle: "Acceso exclusivo para el equipo — inicia sesión con tu cuenta de administrador.",
    showStats: false,
  },
};

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
            <Button type="button" size="lg" className="w-full rounded-xl" onClick={start} disabled={starting}>
              {starting ? "Preparando..." : "Activar también con aplicación"}
            </Button>
            <Button type="button" variant="outline" size="lg" className="w-full rounded-xl" onClick={onDone}>
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
          <OtpInput label="Código de la aplicación" autoFocus autoSubmit value={code} onChange={(v) => { setCode(v); setCodeError(""); }} error={codeError || undefined} />
          <Button type="submit" size="lg" className="w-full rounded-xl" disabled={code.length !== 6 || checking}>
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

function AccountShell({ provinceCount, mode = "customer", children }) {
  const { siteName, logoUrl } = usePlatformSettings();
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
            <BrandStat value={provinceCount ?? "…"} label="provincias" />
            {/* comisión y vendedores: todavía no hay un endpoint de estadísticas
                públicas — valores de referencia, conectar a datos reales cuando exista. */}
            <BrandStat value="0%" label="comisión por venta" />
            <BrandStat value="300+" label="vendedores" />
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
export default function Account({ mode = "customer" }) {
  // Enlace de socio que llegó directo a esta pantalla (…/vendedor/ingresar?socio=CODIGO).
  useEffect(() => capturePartnerRef(), []);
  const { login, verifyTwoFactor, register, verifyRegistration, refreshRole, logout } = useAuth();
  const { siteName } = usePlatformSettings();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Nunca hay que elegir — está implícito en qué URL se usó para llegar acá.
  const accountType = mode === "vendor" ? "vendor" : "customer";
  // Bloque 294: toda tienda nueva empieza en el plan Regular; su tope de mesas lo fija el admin.
  const { maxTablesByPlan } = usePlatformSettings();
  const maxTables = maxTablesByPlan?.REGULAR ?? null;
  const canRegister = mode !== "admin";

  // "login" | "register" | "register-verify" | "forgot-email" | "forgot-code" | "forgot-newpass" | "two-factor"
  const [view, setView] = useState(mode === "admin" ? "login" : searchParams.get("tab") === "registro" ? "register" : "login");
  const [twoFactorEmail, setTwoFactorEmail] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // Bloque 46 (pedido explícito — "vamos a corregir que en el inicio de
  // sesión... agregar un botón de reenviar código... y la espera de
  // vencimiento... se mostrará como un contador regresivo, si llega a cero
  // se habilita un botón enviar código nuevamente"): timestamp real que
  // manda el backend (auth.controller.js) — nunca "5 minutos" fijo acá, así
  // la cuenta regresiva sigue siendo exacta después de un reenvío.
  const [twoFactorExpiresAt, setTwoFactorExpiresAt] = useState(null);
  // Bloque 273: "totp" = el código sale de la app autenticadora; "email" = llega al correo.
  const [twoFactorMethod, setTwoFactorMethod] = useState("email");
  // Mensaje "código incorrecto" que se muestra debajo de las casillas (los 3 pasos de código).
  const [codeError, setCodeError] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const twoFactorSecondsLeft = useCountdownSeconds(twoFactorExpiresAt);
  // Bloque 59: código de verificación de correo (segundo paso del registro)
  // — el email pendiente de verificar es siempre form.email, no hace falta
  // duplicarlo en un estado propio.
  const [registerCode, setRegisterCode] = useState("");
  const [resendingCode, setResendingCode] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [form, setForm] = useState(emptyRegisterForm);
  const [storeForm, setStoreForm] = useState(emptyStoreForm);
  const [showPlanModal, setShowPlanModal] = useState(false);

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

  // Bloque 20: siempre habilitada (no solo para el paso de ubicación) — el
  // panel de marca usa provinces.length como stat real de "provincias".
  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

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
  const selectedBusinessCategory = businessCategories?.find((c) => c.id === storeForm.businessCategoryId);

  function switchView(next) {
    setView(next);
    setStep(1);
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
    return role === "ADMIN" ? "/admin" : role === "VENDOR" || role === "VENDOR_STAFF" ? "/vendedor" : "/cuenta/panel";
  }

  // /cuenta (mode="customer") acepta cualquier rol (comportamiento de
  // siempre) — /vendedor/ingresar y /admin/ingresar exigen que el rol
  // devuelto coincida con la URL usada.
  function roleAllowedForMode(role) {
    if (mode === "admin") return role === "ADMIN";
    if (mode === "vendor") return role === "VENDOR" || role === "VENDOR_STAFF";
    return true;
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await withMinDelay(async () => {
        const result = await login(loginForm.email, loginForm.password, mode === "admin" || mode === "vendor" ? mode : undefined);
        // Bloque 47: 2FA opt-in — en vez de navegar, muestra el paso de
        // "ingresa el código" (mismo patrón visual que forgot-code).
        if (result?.requiresTwoFactor) {
          setTwoFactorEmail(result.email);
          setTwoFactorCode("");
          setTwoFactorExpiresAt(result.twoFactorExpiresAt);
          setTwoFactorMethod(result.method ?? "email");
          setChallengeToken(result.challengeToken ?? "");
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
        toast.success("¡Bienvenido de vuelta!");
        navigate(destinationAfterLogin(result.role));
      });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "Algo salió mal. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyTwoFactor(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await withMinDelay(async () => {
        const user = await verifyTwoFactor(twoFactorEmail, twoFactorCode, mode === "admin" || mode === "vendor" ? mode : undefined);
        if (!roleAllowedForMode(user.role)) {
          logout();
          toast.error("Credenciales inválidas.");
          setView("login");
          return;
        }
        toast.success("¡Bienvenido de vuelta!");
        navigate(destinationAfterLogin(user.role));
      });
    } catch (err) {
      // El código se borra para volver a escribirlo y se explica debajo de las casillas.
      setTwoFactorCode("");
      setCodeError(err.response?.data?.error ?? "Código incorrecto o vencido.");
    } finally {
      setLoading(false);
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
        toast.error(`Con el plan gratis puedes tener hasta ${maxTables} mesas. Escribe ${maxTables} o menos.`);
        return;
      }
      if (!storeForm.businessCategoryId) {
        toast.error("Elige el tipo de negocio de tu tienda.");
        return;
      }
    }
    setLoading(true);
    try {
      await withMinDelay(async () => {
        await register(buildRegisterPayload());
        setRegisterCode("");
        setView("register-verify");
        toast.success("Te mandamos un código de verificación a tu correo.");
      });
    } catch (err) {
      // Bloque 59: correo ya registrado — en vez de un error seco, se manda
      // directo al flujo de restablecer contraseña, con el código ya en
      // camino (tal como se pidió: "detectará y enviará directamente a
      // restablecer contraseña").
      if (err.response?.data?.details?.duplicate) {
        try {
          await api.post("/auth/forgot-password", { email: form.email });
        } catch {
          // best-effort — si este intento puntual falla, el cliente igual
          // puede pedir el código a mano desde la pantalla a la que lo mandamos.
        }
        toast.error("Ya existe una cuenta con este correo — te mandamos un código para restablecer tu contraseña.");
        setResetEmail(form.email);
        setResetCode("");
        setView("forgot-code");
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
  async function handleVerifyRegistration(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await withMinDelay(async () => {
        const { linkedOrdersCount } = await verifyRegistration(form.email, registerCode);

        if (accountType === "vendor") {
          await api.post("/vendors", {
            partnerCode: getPartnerCode(),
            companyName: storeForm.companyName,
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
          setShowPlanModal(true);
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
      setRegisterCode("");
      setCodeError(err.response?.data?.error ?? "Código incorrecto o vencido.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendRegistrationCode() {
    setResendingCode(true);
    try {
      await register(buildRegisterPayload());
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
      toast.success("Te enviamos un código a tu correo.");
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo enviar el código. Vuelve a iniciar sesión.");
    } finally {
      setResendingCode(false);
    }
  }

  async function handleResendTwoFactorCode() {
    if (challengeToken) return handleSendEmailCodeInstead();
    setResendingCode(true);
    try {
      const result = await login(loginForm.email, loginForm.password, mode === "admin" || mode === "vendor" ? mode : undefined);
      if (result?.requiresTwoFactor) {
        setTwoFactorExpiresAt(result.twoFactorExpiresAt);
        setTwoFactorCode("");
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
        toast.success(data.message ?? "Revisa tu correo.");
        setView("forgot-code");
      });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo procesar la solicitud.");
    } finally {
      setLoading(false);
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
    setShowPlanModal(false);
    navigate("/vendedor");
  }

  if (showPlanModal) {
    return <PlanComparisonModal onContinueRegular={closePlanModal} />;
  }

  // Bloque 47: segundo paso del login cuando la cuenta tiene 2FA activo —
  // mismo patrón visual que el paso "forgot-code" de abajo.
  if (view === "two-factor") {
    return (
      <AccountShell provinceCount={provinces?.length} mode={mode}>
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
            <OtpInput label="Código de verificación" required autoFocus autoSubmit value={twoFactorCode} onChange={(v) => { setTwoFactorCode(v); setCodeError(""); }} error={codeError || undefined} />
            <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading || twoFactorCode.length !== 6}>
              {loading ? (<><Spinner className="text-white" /> Verificando...</>) : "Verificar e ingresar"}
            </Button>
          </form>
          {twoFactorMethod === "totp" ? (
            <button type="button" onClick={handleSendEmailCodeInstead} disabled={resendingCode} className="mt-4 block text-label-md font-semibold text-tertiary-accent disabled:opacity-50">
              {resendingCode ? "Enviando..." : "No tengo acceso a mi app: enviar el código a mi correo"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleResendTwoFactorCode}
                disabled={twoFactorSecondsLeft > 0 || resendingCode}
                className="mt-4 block text-label-md font-semibold text-tertiary-accent disabled:opacity-50"
              >
                {resendingCode ? "Reenviando..." : "Enviar código nuevamente"}
              </button>
              {challengeToken && (
                <button type="button" onClick={() => { setTwoFactorMethod("totp"); setTwoFactorCode(""); }} className="mt-3 block text-label-md font-semibold text-tertiary-accent">
                  Usar el código de mi aplicación
                </button>
              )}
            </>
          )}
          <button onClick={() => switchView("login")} className="mt-4 text-label-md font-semibold text-tertiary-accent">
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
      <AccountShell provinceCount={provinces?.length} mode={mode}>
        <RegisterAppStep onDone={() => navigate(isSafeNextPath ? nextPath : "/cuenta/panel")} />
      </AccountShell>
    );
  }

  if (view === "register-verify") {
    return (
      <AccountShell provinceCount={provinces?.length} mode={mode}>
        <div key={view} className="animate-step-in">
          <h1 className="mb-2 text-headline-md text-on-surface">Confirma tu correo</h1>
          <p className="mb-6 text-body-md text-on-surface-variant">
            Te mandamos un código de 6 dígitos a <strong>{form.email}</strong>. Vence en 10 minutos.
          </p>
          <form onSubmit={handleVerifyRegistration} className="space-y-4">
            <OtpInput label="Código de verificación" required autoFocus autoSubmit value={registerCode} onChange={(v) => { setRegisterCode(v); setCodeError(""); }} error={codeError || undefined} />
            <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading || registerCode.length !== 6}>
              {loading ? (
                <>
                  <Spinner className="text-white" /> {accountType === "vendor" ? "Creando tu tienda..." : "Creando tu cuenta..."}
                </>
              ) : (
                "Verificar y crear cuenta"
              )}
            </Button>
          </form>
          <button
            type="button"
            onClick={handleResendRegistrationCode}
            disabled={resendingCode}
            className="mt-4 block text-label-md font-semibold text-tertiary-accent disabled:opacity-50"
          >
            {resendingCode ? "Reenviando..." : "Reenviar código"}
          </button>
          <button onClick={() => switchView("register")} className="mt-2 block text-label-md font-semibold text-outline">
            ← Volver a editar mis datos
          </button>
        </div>
      </AccountShell>
    );
  }

  if (view.startsWith("forgot-")) {
    return (
      <AccountShell provinceCount={provinces?.length} mode={mode}>
        <div key={view} className="animate-step-in">
          {view === "forgot-email" && (
            <>
              <h1 className="mb-2 text-headline-md text-on-surface">¿Olvidaste tu contraseña?</h1>
              <p className="mb-6 text-body-md text-on-surface-variant">Ingresa tu correo y te mandamos un código de verificación.</p>
              <form onSubmit={handleForgotEmail} className="space-y-4">
                <Input label="Correo" type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
                <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading}>
                  {loading ? (<><Spinner className="text-white" /> Enviando...</>) : "Enviar código"}
                </Button>
              </form>
              <button onClick={() => switchView("login")} className="mt-4 text-label-md font-semibold text-tertiary-accent">
                ← Volver al login
              </button>
            </>
          )}

          {view === "forgot-code" && (
            <>
              <h1 className="mb-2 text-headline-md text-on-surface">Ingresa el código</h1>
              <p className="mb-6 text-body-md text-on-surface-variant">
                Te mandamos un código de 6 dígitos a <strong>{resetEmail}</strong>. Vence en 15 minutos.
              </p>
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <OtpInput label="Código de verificación" required autoFocus autoSubmit value={resetCode} onChange={(v) => { setResetCode(v); setCodeError(""); }} error={codeError || undefined} />
                <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading || resetCode.length !== 6}>
                  {loading ? (<><Spinner className="text-white" /> Verificando...</>) : "Verificar código"}
                </Button>
              </form>
              <button onClick={() => setView("forgot-email")} className="mt-4 text-label-md font-semibold text-tertiary-accent">
                ← Volver a pedir el código
              </button>
            </>
          )}

          {view === "forgot-newpass" && (
            <>
              <h1 className="mb-2 text-headline-md text-on-surface">Nueva contraseña</h1>
              <p className="mb-6 text-body-md text-on-surface-variant">Escríbela dos veces para confirmar.</p>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <PasswordInput label="Nueva contraseña" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <PasswordInput label="Confirmar contraseña" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading}>
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
    <AccountShell provinceCount={provinces?.length} mode={mode}>
      {/* /admin/ingresar es la única que nunca ofrece registro (ver
          comentario arriba del componente) — ahí no tiene sentido mostrar
          este toggle. */}
      {canRegister && (
        <div className="mb-7 flex rounded-full bg-surface-container p-1">
          <button
            onClick={() => switchView("login")}
            className={`flex-1 rounded-full py-2.5 text-label-md font-semibold transition-colors duration-200 ${
              isLogin ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-outline"
            }`}
          >
            Iniciar sesión
          </button>
          <button
            onClick={() => switchView("register")}
            className={`flex-1 rounded-full py-2.5 text-label-md font-semibold transition-colors duration-200 ${
              !isLogin ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-outline"
            }`}
          >
            Crear cuenta
          </button>
        </div>
      )}

      <div key={view} className="animate-step-in">
        {isLogin ? (
          <>
            <h1 className="mb-1 text-headline-md text-on-surface">
              {mode === "admin" ? "Acceso de administrador" : mode === "vendor" ? "Ingresa a tu panel" : "Bienvenido de nuevo"}
            </h1>
            <p className="mb-6 text-body-md text-on-surface-variant">
              {mode === "admin"
                ? "Solo cuentas de administrador pueden entrar aquí."
                : mode === "vendor"
                ? "Ingresa con tu cuenta de vendedor para gestionar tu tienda."
                : "Ingresa para comprar o gestionar tu tienda."}
            </p>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input label="Correo" type="email" required value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
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
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              />
              <button type="button" onClick={() => setView("forgot-email")} className="block text-label-sm font-semibold text-tertiary-accent">
                ¿Olvidaste tu contraseña?
              </button>
              <Button type="submit" size="lg" className="w-full rounded-xl" disabled={loading}>
                {loading ? (<><Spinner className="text-white" /> Entrando...</>) : "Entrar"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="mb-1 text-headline-md text-on-surface">
              {mode === "vendor" ? `Crea tu tienda en ${siteName}` : `Crea tu cuenta ${siteName}`}
            </h1>
            <p className="mb-4 text-label-sm text-outline">
              Paso {step} de {totalSteps}
            </p>
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
              <div
                className="h-full rounded-full bg-secondary-container transition-all duration-300"
                style={{ width: `${(step / totalSteps) * 100}%` }}
              />
            </div>

            <form onSubmit={goNext} className="space-y-4">
              {step === 1 && (
                <div key="step-1" className="animate-step-in space-y-4">
                  {/* Bloque 114 (pedido explícito): nombre y apellidos por
                      separado, no un solo "Nombre completo". */}
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Nombre" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                    <Input label="Apellidos" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                  </div>
                  <Input label="Correo" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  <div>
                    <PhoneInput
                      label="Teléfono (WhatsApp)"
                      required
                      value={form.phone}
                      onChange={(phone) => setForm({ ...form, phone })}
                      onCountryChange={(country) => setForm({ ...form, country })}
                    />
                    <p className="mt-1.5 rounded-lg bg-surface-container px-3 py-2 text-label-sm text-on-surface-variant">
                      Este es el número por el que los clientes te contactarán para comprar productos o hacer preguntas.
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div key="step-2" className="animate-step-in space-y-4">
                  <PasswordInput label="Contraseña" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  <PasswordInput
                    label="Confirmar contraseña"
                    required
                    minLength={8}
                    value={form.confirmPassword}
                    onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
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
                    required
                    value={storeForm.companyName}
                    onChange={(e) => setStoreForm({ ...storeForm, companyName: e.target.value })}
                  />
                  {/* Bloque 113 (pedido explícito): ya no se pide de nuevo un
                      "nombre del responsable" — es el mismo nombre y
                      apellidos que ya cargó en el paso 1. Solo un aviso de
                      que debe coincidir con su identificación, ya que se
                      puede llegar a verificar más adelante (KYC). */}
                  <div className="rounded-lg border border-outline-variant bg-surface-container p-3.5">
                    <p className="text-label-sm font-semibold text-on-surface">
                      Responsable del negocio: <span className="font-bold">{`${form.firstName} ${form.lastName}`.trim() || "—"}</span>
                    </p>
                    <p className="mt-1 text-label-sm text-outline">
                      Este nombre debe coincidir con tu documento de identidad — se puede llegar a verificar más adelante, de ser necesario.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2.5">
                      <Select
                        label="Tipo de negocio"
                        required
                        value={storeForm.businessCategoryId}
                        onChange={(e) => setStoreForm({ ...storeForm, businessCategoryId: e.target.value })}
                        className="flex-1"
                      >
                        <option value="">Selecciona el rubro de tu tienda</option>
                        {businessCategories?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                      {selectedBusinessCategory && (
                        <div className="mt-6 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-tertiary-accent/10">
                          <CategoryIcon name={selectedBusinessCategory.icon} className="h-5 w-5 text-tertiary-accent" />
                        </div>
                      )}
                    </div>
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
                        {maxTables != null && ` Con el plan gratis puedes tener hasta ${maxTables} mesas.`}
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
                {step > 1 && (
                  <Button type="button" variant="outline" size="lg" onClick={() => setStep((s) => s - 1)} disabled={loading} className="rounded-xl">
                    Atrás
                  </Button>
                )}
                <Button type="submit" size="lg" className="flex-1 rounded-xl" disabled={loading}>
                  {loading ? (
                    <>
                      <Spinner className="text-white" />
                      {step === totalSteps ? "Enviando código..." : "Cargando..."}
                    </>
                  ) : step < totalSteps ? (
                    "Continuar"
                  ) : (
                    "Enviar código de verificación"
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
