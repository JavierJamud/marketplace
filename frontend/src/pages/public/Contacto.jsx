import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { MessageCircle, Mail, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { useStaticPage } from "../../lib/useStaticPage.js";
import { Breadcrumbs } from "../../components/Breadcrumbs.jsx";
import { Skeleton } from "../../components/ui/Skeleton.jsx";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

// Topes del formulario. El servidor todavía no los aplica (contactSchema en contact.controller.js no tiene .max() en name
// ni en message): queda pendiente ahí, porque un POST directo a /contact se salta estos límites.
const MAX_NAME = 100;
const MAX_MESSAGE = 2000;

// Bloque 48: nueva página (sumada a Términos/Privacidad/FAQ/Ayuda). El
// formulario manda un correo real al admin (GET /contact, reusa la misma
// infraestructura de Resend que el resto del proyecto) — sin tabla de
// mensajes propia, ver la decisión del bloque.
export default function Contacto() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Un enlace desde el registro puede traer el mensaje ya escrito (por ejemplo, pedir que activen un país).
  const [params] = useSearchParams();
  const [message, setMessage] = useState(() => params.get("mensaje")?.slice(0, MAX_MESSAGE) ?? "");

  const send = useMutation({
    mutationFn: async () => (await api.post("/contact", { name, email, message })).data,
    onSuccess: () => {
      toast.success("Mensaje enviado. Te respondemos pronto.");
      setName("");
      setEmail("");
      setMessage("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el mensaje."),
  });

  const { htmlContent } = useStaticPage("contacto");
  // Los canales salen de Admin → Marca, no del código: antes había un WhatsApp y un correo escritos aquí (el correo, de
  // la marca vieja) que nadie podía cambiar sin tocar el código. supportEmail todavía no existe (falta la columna en
  // SiteSettings, el campo en Admin → Marca, el GET /settings y usePlatformSettings): hoy siempre llega vacío y su tarjeta
  // no se muestra; aparece sola cuando eso se agregue. plansLoading es el estado de la misma consulta de /settings.
  const { supportWhatsapp, supportEmail, plansLoading: settingsLoading } = usePlatformSettings();
  const whatsappDigits = String(supportWhatsapp ?? "").replace(/\D/g, "");

  return (
    <div className="container-app max-w-[960px] py-14">
      <Breadcrumbs className="mb-2" items={[{ label: "Contacto" }]} />
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Contacto</h1>
      <p className="mb-10 text-body-md text-on-surface-variant">Escríbenos y te respondemos por correo.</p>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.3fr]">
        {/* Bloque 48: a diferencia de Terms/Privacy/Faq/Ayuda, acá SOLO se
            reemplaza esta columna informativa — el formulario de al lado
            sigue siempre funcional, nunca a merced de un HTML pegado (el
            admin no puede editar/romper la única forma real de mandar un
            mensaje desde esta página). */}
        {htmlContent ? (
          <div className="prose-static" dangerouslySetInnerHTML={{ __html: htmlContent }} />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Cada tarjeta es un enlace que se toca desde el celular (wa.me abre WhatsApp, mailto el correo) y solo aparece si
                el admin cargó ese dato. Si se carga contenido en /admin/contacto, toda esta columna se reemplaza por ese HTML. */}
            {settingsLoading ? (
              <Skeleton height={72} borderRadius={8} />
            ) : (
              whatsappDigits && (
                <a
                  href={`https://wa.me/${whatsappDigits}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-start gap-3 rounded-lg border border-surface-container-high bg-surface-container-lowest p-4 transition-colors hover:border-outline-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-whatsapp/10">
                    <MessageCircle className="h-5 w-5 text-whatsapp" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold text-on-surface">WhatsApp</div>
                    <div className="break-all text-[13px] text-on-surface-variant">{supportWhatsapp}</div>
                  </div>
                </a>
              )
            )}
            {!settingsLoading && supportEmail && (
              <a
                href={`mailto:${supportEmail}`}
                className="flex min-h-11 items-start gap-3 rounded-lg border border-surface-container-high bg-surface-container-lowest p-4 transition-colors hover:border-outline-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-tertiary-accent/10">
                  <Mail className="h-5 w-5 text-tertiary-accent" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-on-surface">Correo</div>
                  <div className="break-all text-[13px] text-on-surface-variant">{supportEmail}</div>
                </div>
              </a>
            )}
            <div className="flex items-start gap-3 rounded-lg border border-surface-container-high bg-surface-container-lowest p-4">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-secondary-container/15">
                <Clock className="h-5 w-5 text-secondary" />
              </span>
              <div>
                <div className="text-[13.5px] font-bold text-on-surface">Horario de atención</div>
                <div className="text-[13px] text-on-surface-variant">Lunes a sábado, 9:00–18:00 (hora de Cuba)</div>
              </div>
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
          className="order-first flex flex-col gap-3.5 self-start rounded-lg border border-surface-container-high bg-surface-container-lowest p-5 sm:p-6 lg:order-none lg:sticky lg:top-24"
        >
          <Input label="Nombre" required maxLength={MAX_NAME} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Correo" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div>
            {/* label con htmlFor (antes un span suelto): el lector de pantalla anuncia "Mensaje" al llegar al campo. */}
            <label htmlFor="contacto-mensaje" className="mb-1 block text-label-md text-on-surface-variant">
              Mensaje<span className="text-error"> *</span>
            </label>
            <textarea
              id="contacto-mensaje"
              required
              rows={5}
              maxLength={MAX_MESSAGE}
              aria-describedby="contacto-mensaje-cuenta"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Cuéntanos en qué te podemos ayudar..."
              className="w-full rounded border border-outline-variant bg-surface-container-lowest p-3.5 text-[14px] outline-none focus:border-tertiary-accent"
            />
            <p id="contacto-mensaje-cuenta" className="mt-1 text-right text-label-sm text-on-surface-variant">
              {message.length}/{MAX_MESSAGE}
            </p>
          </div>
          <Button type="submit" size="lg" disabled={send.isPending}>
            {send.isPending ? "Enviando..." : "Enviar mensaje"}
          </Button>
        </form>
      </div>
    </div>
  );
}
