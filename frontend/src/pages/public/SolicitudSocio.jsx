import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { Input } from "../../components/ui/Input.jsx";
import { PasswordInput } from "../../components/ui/PasswordInput.jsx";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
import { Button } from "../../components/ui/Button.jsx";

// Solicitud para usar la API de socios. Quien la envía crea al mismo tiempo su contraseña; un administrador la revisa
// y, si la aprueba, le crea la cuenta de socio y le manda la credencial de la API por correo. Hasta entonces no
// puede entrar al panel.
const EMPTY = { firstName: "", lastName: "", phone: "", email: "", companyName: "", website: "", description: "", password: "", confirm: "", acceptTerms: false };

export default function SolicitudSocio() {
  const { siteName } = usePlatformSettings();
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post("/partner-applications", {
          firstName: f.firstName,
          lastName: f.lastName,
          phone: f.phone,
          email: f.email,
          companyName: f.companyName,
          website: f.website.trim() || undefined,
          description: f.description,
          password: f.password,
          acceptTerms: f.acceptTerms,
        })
      ).data,
    onError: (err) => {
      const issues = err.response?.data?.details?.issues ?? err.response?.data?.issues;
      setError(Array.isArray(issues) && issues[0]?.message ? issues[0].message : (err.response?.data?.error ?? "No se pudo enviar la solicitud. Intenta de nuevo."));
    },
  });

  function submit(e) {
    e.preventDefault();
    setError("");
    if (f.password !== f.confirm) return setError("Las contraseñas no coinciden.");
    if (!f.acceptTerms) return setError("Debes aceptar los términos de uso de la API.");
    send.mutate();
  }

  if (send.isSuccess) {
    return (
      <div className="mx-auto max-w-[560px] px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-verified" aria-hidden="true" />
        <h1 className="mb-2 font-display text-[26px] font-extrabold text-on-surface">Recibimos tu solicitud</h1>
        <p className="mb-6 text-[14.5px] text-on-surface-variant">
          Revisaremos tus datos y te escribiremos a <b>{f.email}</b> con la respuesta. Si la aprobamos, ese correo te llevará tu credencial de la API y podrás entrar a tu panel de socio con la contraseña que elegiste.
        </p>
        <Link to="/api-socios" className="font-semibold text-tertiary-accent hover:underline">Volver a la documentación</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[620px] px-4 py-10">
      <h1 className="mb-2 font-display text-[30px] font-extrabold tracking-tight text-on-surface">Solicita usar la API de {siteName}</h1>
      <p className="mb-6 text-[14.5px] text-on-surface-variant">
        Cuéntanos quién eres y para qué la quieres. Un administrador revisa cada solicitud; si la aprueba, recibirás tu credencial por correo. ¿Ya tienes cuenta de socio? <Link to="/socio/ingresar" className="font-semibold text-tertiary-accent hover:underline">Entra a tu panel</Link>.
      </p>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 shadow-sm" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Nombre" required value={f.firstName} onChange={set("firstName")} autoComplete="given-name" />
          <Input label="Apellido" required value={f.lastName} onChange={set("lastName")} autoComplete="family-name" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Correo electrónico" type="email" required value={f.email} onChange={set("email")} autoComplete="email" />
          <PhoneInput label="Teléfono" required value={f.phone} onChange={(v) => setF((s) => ({ ...s, phone: v }))} />
        </div>
        <Input label="Nombre de tu negocio o sitio" required value={f.companyName} onChange={set("companyName")} autoComplete="organization" />
        <Input label="Sitio web (opcional)" type="url" placeholder="https://" value={f.website} onChange={set("website")} autoComplete="url" />
        <div>
          <label htmlFor="desc" className="mb-1 block text-label-sm font-semibold text-on-surface">¿Para qué usarás la API?</label>
          <textarea id="desc" required minLength={20} rows={4} value={f.description} onChange={set("description")} className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[14px] text-on-surface focus:border-tertiary-accent focus:outline-none focus:ring-2 focus:ring-tertiary-accent/30" placeholder="Qué vas a mostrar, a quiénes les vendes y cómo piensas conectarla." />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PasswordInput label="Contraseña" required minLength={8} value={f.password} onChange={set("password")} autoComplete="new-password" />
          <PasswordInput label="Repite la contraseña" required minLength={8} value={f.confirm} onChange={set("confirm")} autoComplete="new-password" />
        </div>
        <p className="text-[12px] text-outline">Mínimo 8 caracteres, con letras y números. Es la que usarás para entrar a tu panel cuando aprobemos la solicitud.</p>
        <label className="flex min-h-11 items-start gap-3 text-[13px] text-on-surface">
          <input type="checkbox" className="mt-0.5 h-5 w-5 flex-shrink-0" checked={f.acceptTerms} onChange={(e) => setF((s) => ({ ...s, acceptTerms: e.target.checked }))} />
          <span>Acepto usar la API solo para mostrar y vender productos de {siteName} con mi credencial, sin compartirla.</span>
        </label>
        {error && <p role="alert" className="rounded-xl bg-error/10 p-3 text-[13px] font-semibold text-error">{error}</p>}
        <Button type="submit" size="lg" className="w-full rounded-xl" disabled={send.isPending}>{send.isPending ? "Enviando..." : "Enviar solicitud"}</Button>
      </form>
    </div>
  );
}
