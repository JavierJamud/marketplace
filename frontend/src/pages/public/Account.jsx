import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Store, User as UserIcon } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { PasswordInput } from "../../components/ui/PasswordInput.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { PlanComparisonModal } from "../../components/PlanComparisonModal.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";

function BrandStat({ value, label }) {
  return (
    <div>
      <div className="font-display text-2xl font-extrabold text-secondary-container">{value}</div>
      <div className="text-label-sm text-white/60">{label}</div>
    </div>
  );
}

// Bloque 20: contenedor visual de /cuenta (split marca + formulario), sobre
// el mock design_references/Account.dc.html. El formulario real (login,
// stepper de registro, recuperar contraseña) se pasa como children sin
// tocarse — esto solo cambia lo que lo envuelve.
function AccountShell({ provinceCount, children }) {
  const { siteName, logoUrl } = usePlatformSettings();
  return (
    <div className="min-h-screen animate-fade-up bg-background lg:grid lg:grid-cols-2">
      {/* Panel izquierdo — marca completa en desktop */}
      <div className="hidden flex-col justify-center overflow-hidden bg-gradient-to-br from-primary-container to-primary px-14 py-14 lg:flex">
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
        <h1 className="mb-4 max-w-md font-display text-headline-lg font-extrabold leading-tight text-white">
          El marketplace de Cuba, cerca tuyo.
        </h1>
        <p className="mb-8 max-w-sm text-body-md text-white/60">
          Compra a tiendas locales por WhatsApp o abre tu propia tienda gratis. Pagas solo si quieres verificarte.
        </p>
        <div className="flex gap-8">
          <BrandStat value={provinceCount ?? "…"} label="provincias" />
          {/* comisión y vendedores: todavía no hay un endpoint de estadísticas
              públicas — valores de referencia, conectar a datos reales cuando exista. */}
          <BrandStat value="0%" label="comisión por venta" />
          <BrandStat value="300+" label="vendedores" />
        </div>
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
        <p className="mt-1.5 text-label-sm text-white/70">El marketplace de Cuba, cerca tuyo.</p>
      </div>

      {/* Panel derecho — formulario real */}
      <div className="flex flex-col justify-center px-4 py-8 sm:px-8 lg:px-14">
        <div className="mx-auto w-full max-w-md">{children}</div>
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

const emptyRegisterForm = { fullName: "", email: "", phone: "", country: "CU", password: "", confirmPassword: "" };
const emptyStoreForm = {
  companyName: "",
  ownerName: "",
  description: "",
  whatsapp: "",
  storeEmail: "",
  provinceId: "",
  businessCategoryId: "",
  isRestaurant: false,
  tableCount: "",
};

export default function Account() {
  const { login, verifyTwoFactor, register, refreshRole } = useAuth();
  const { siteName } = usePlatformSettings();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // "login" | "register" | "forgot-email" | "forgot-code" | "forgot-newpass" | "two-factor"
  const [view, setView] = useState(searchParams.get("tab") === "vendedor" ? "register" : "login");
  const [twoFactorEmail, setTwoFactorEmail] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [accountType, setAccountType] = useState(searchParams.get("tab") === "vendedor" ? "vendor" : "customer");
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
  const totalSteps = accountType === "vendor" ? 3 : 2;

  // Bloque 20: siempre habilitada (no solo para el paso 3 de vendedor) — el
  // panel de marca usa provinces.length como stat real de "provincias".
  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  // Bloque 18: rubro obligatorio de la tienda.
  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
    enabled: !isLogin && accountType === "vendor",
  });
  const selectedBusinessCategory = businessCategories?.find((c) => c.id === storeForm.businessCategoryId);

  // Prellena el correo de la tienda con el correo personal recién cargado en
  // el paso 1 — el usuario puede reusarlo o cambiarlo antes de enviar.
  useEffect(() => {
    if (step === 3 && !storeForm.storeEmail) {
      setStoreForm((s) => ({ ...s, storeEmail: form.email }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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

  function destinationAfterLogin(role) {
    if (role === "CUSTOMER" && isSafeNextPath) return nextPath;
    return role === "ADMIN" ? "/admin" : role === "VENDOR" ? "/vendedor" : "/cuenta/panel";
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await withMinDelay(async () => {
        const result = await login(loginForm.email, loginForm.password);
        // Bloque 47: 2FA opt-in — en vez de navegar, muestra el paso de
        // "ingresa el código" (mismo patrón visual que forgot-code).
        if (result?.requiresTwoFactor) {
          setTwoFactorEmail(result.email);
          setTwoFactorCode("");
          setView("two-factor");
          toast.success("Te mandamos un código a tu correo.");
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
        const user = await verifyTwoFactor(twoFactorEmail, twoFactorCode);
        toast.success("¡Bienvenido de vuelta!");
        navigate(destinationAfterLogin(user.role));
      });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "Código inválido o vencido.");
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

  async function handleFinalSubmit() {
    if (accountType === "vendor" && storeForm.isRestaurant && !storeForm.tableCount) {
      toast.error("Indica la cantidad de mesas de tu restaurante.");
      return;
    }
    if (accountType === "vendor" && !storeForm.businessCategoryId) {
      toast.error("Elige el tipo de negocio de tu tienda.");
      return;
    }
    setLoading(true);
    try {
      await withMinDelay(async () => {
        await register({ email: form.email, password: form.password, fullName: form.fullName, phone: form.phone, country: form.country });

        if (accountType === "vendor") {
          await api.post("/vendors", {
            companyName: storeForm.companyName,
            ownerName: storeForm.ownerName,
            description: storeForm.description || undefined,
            whatsapp: storeForm.whatsapp,
            email: storeForm.storeEmail,
            isRestaurant: storeForm.isRestaurant,
            tableCount: storeForm.isRestaurant ? Number(storeForm.tableCount) : undefined,
            businessCategoryId: storeForm.businessCategoryId,
            locations: [{ provinceId: storeForm.provinceId }],
          });
          // El accessToken recién emitido por register() todavía dice role
          // CUSTOMER — sin refrescarlo, /vendedor/* devolvería 403 apenas
          // se cierre el modal y se navegue al panel.
          await refreshRole();
          setShowPlanModal(true);
        } else {
          toast.success("¡Cuenta creada!");
          navigate(isSafeNextPath ? nextPath : "/cuenta/panel");
        }
      });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "Algo salió mal. Intenta de nuevo.");
    } finally {
      setLoading(false);
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
      toast.error(err.response?.data?.error ?? "Código inválido o vencido.");
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
      <AccountShell provinceCount={provinces?.length}>
        <div key={view} className="animate-step-in">
          <h1 className="mb-2 text-headline-md text-on-surface">Verificación en dos pasos</h1>
          <p className="mb-6 text-body-md text-on-surface-variant">
            Te mandamos un código de 6 dígitos a <strong>{twoFactorEmail}</strong>. Vence en 10 minutos.
          </p>
          <form onSubmit={handleVerifyTwoFactor} className="space-y-4">
            <Input
              label="Código de verificación"
              required
              maxLength={6}
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-title-lg tracking-[0.4em]"
            />
            <Button type="submit" size="lg" className="w-full" disabled={loading || twoFactorCode.length !== 6}>
              {loading ? (<><Spinner className="text-white" /> Verificando...</>) : "Verificar e ingresar"}
            </Button>
          </form>
          <button onClick={() => switchView("login")} className="mt-4 text-label-md font-semibold text-tertiary-accent">
            ← Volver al login
          </button>
        </div>
      </AccountShell>
    );
  }

  if (view.startsWith("forgot-")) {
    return (
      <AccountShell provinceCount={provinces?.length}>
        <div key={view} className="animate-step-in">
          {view === "forgot-email" && (
            <>
              <h1 className="mb-2 text-headline-md text-on-surface">¿Olvidaste tu contraseña?</h1>
              <p className="mb-6 text-body-md text-on-surface-variant">Ingresa tu correo y te mandamos un código de verificación.</p>
              <form onSubmit={handleForgotEmail} className="space-y-4">
                <Input label="Correo" type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? (<><Spinner className="text-white" /> Enviando...</>) : "Enviar código"}
                </Button>
              </form>
            </>
          )}

          {view === "forgot-code" && (
            <>
              <h1 className="mb-2 text-headline-md text-on-surface">Ingresa el código</h1>
              <p className="mb-6 text-body-md text-on-surface-variant">
                Te mandamos un código de 6 dígitos a <strong>{resetEmail}</strong>. Vence en 15 minutos.
              </p>
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <Input
                  label="Código de verificación"
                  required
                  maxLength={6}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-title-lg tracking-[0.4em]"
                />
                <Button type="submit" size="lg" className="w-full" disabled={loading || resetCode.length !== 6}>
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
              <p className="mb-6 text-body-md text-on-surface-variant">Escribila dos veces para confirmar.</p>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <PasswordInput label="Nueva contraseña" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <PasswordInput label="Confirmar contraseña" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
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
    <AccountShell provinceCount={provinces?.length}>
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

      <div key={view} className="animate-step-in">
        {isLogin ? (
          <>
            <h1 className="mb-1 text-headline-md text-on-surface">Bienvenido de nuevo</h1>
            <p className="mb-6 text-body-md text-on-surface-variant">Ingresa para comprar o gestionar tu tienda.</p>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input label="Correo" type="email" required value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
              <PasswordInput
                label="Contraseña"
                required
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              />
              <button type="button" onClick={() => setView("forgot-email")} className="block text-label-sm font-semibold text-tertiary-accent">
                ¿Olvidaste tu contraseña?
              </button>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? (<><Spinner className="text-white" /> Entrando...</>) : "Entrar"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="mb-1 text-headline-md text-on-surface">Creá tu cuenta {siteName}</h1>
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
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setAccountType("customer")}
                      className={`flex flex-col items-center gap-1.5 rounded-md border-2 p-4 ${
                        accountType === "customer" ? "border-tertiary-accent bg-tertiary-accent/5" : "border-surface-container-high"
                      }`}
                    >
                      <UserIcon className="h-5 w-5 text-tertiary-accent" />
                      <span className="text-[13px] font-bold text-on-surface">Quiero comprar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccountType("vendor")}
                      className={`flex flex-col items-center gap-1.5 rounded-md border-2 p-4 ${
                        accountType === "vendor" ? "border-tertiary-accent bg-tertiary-accent/5" : "border-surface-container-high"
                      }`}
                    >
                      <Store className="h-5 w-5 text-tertiary-accent" />
                      <span className="text-[13px] font-bold text-on-surface">Quiero vender</span>
                    </button>
                  </div>

                  <Input label="Nombre completo" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                  <Input label="Correo" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  <PhoneInput
                    label="Teléfono (WhatsApp)"
                    required
                    value={form.phone}
                    onChange={(phone) => setForm({ ...form, phone })}
                    onCountryChange={(country) => setForm({ ...form, country })}
                  />
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

              {step === 3 && accountType === "vendor" && (
                <div key="step-3" className="animate-step-in space-y-4">
                  <Input
                    label="Nombre de la tienda (público)"
                    required
                    value={storeForm.companyName}
                    onChange={(e) => setStoreForm({ ...storeForm, companyName: e.target.value })}
                  />
                  <div>
                    <Input
                      label="Nombre del responsable del negocio"
                      required
                      value={storeForm.ownerName}
                      onChange={(e) => setStoreForm({ ...storeForm, ownerName: e.target.value })}
                    />
                    <p className="mt-1 text-label-sm text-outline">Privado — solo lo ven admin y tú.</p>
                  </div>
                  <Input
                    label="Correo de la tienda"
                    type="email"
                    required
                    value={storeForm.storeEmail}
                    onChange={(e) => setStoreForm({ ...storeForm, storeEmail: e.target.value })}
                  />
                  <p className="-mt-3 text-label-sm text-outline">Puedes usar el mismo correo de tu cuenta o uno distinto.</p>
                  <PhoneInput
                    label="WhatsApp de la tienda"
                    required
                    value={storeForm.whatsapp}
                    onChange={(whatsapp) => setStoreForm({ ...storeForm, whatsapp })}
                  />
                  <Select
                    label="Provincia donde prestas servicio"
                    required
                    value={storeForm.provinceId}
                    onChange={(e) => setStoreForm({ ...storeForm, provinceId: e.target.value })}
                  >
                    <option value="">Selecciona una provincia</option>
                    {provinces?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>

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
                        required
                        value={storeForm.tableCount}
                        onChange={(e) => setStoreForm({ ...storeForm, tableCount: e.target.value })}
                      />
                      <p className="mt-1 text-label-sm text-outline">
                        Generamos un código QR por cada mesa apenas creas la tienda. Los pedidos te van a llegar al panel de vendedor.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2.5">
                {step > 1 && (
                  <Button type="button" variant="outline" size="lg" onClick={() => setStep((s) => s - 1)} disabled={loading}>
                    Atrás
                  </Button>
                )}
                <Button type="submit" size="lg" className="flex-1" disabled={loading}>
                  {loading ? (
                    <>
                      <Spinner className="text-white" />
                      {accountType === "vendor" && step === totalSteps ? "Creando tu tienda..." : "Creando tu cuenta..."}
                    </>
                  ) : step < totalSteps ? (
                    "Continuar"
                  ) : (
                    "Crear cuenta"
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
