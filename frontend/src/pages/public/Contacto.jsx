import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessageCircle, Mail, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { useStaticPage } from "../../lib/useStaticPage.js";

// Bloque 48: nueva página (sumada a Términos/Privacidad/FAQ/Ayuda). El
// formulario manda un correo real al admin (GET /contact, reusa la misma
// infraestructura de Resend que el resto del proyecto) — sin tabla de
// mensajes propia, ver la decisión del bloque.
export default function Contacto() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const send = useMutation({
    mutationFn: async () => (await api.post("/contact", { name, email, message })).data,
    onSuccess: () => {
      toast.success("Mensaje enviado — te respondemos pronto.");
      setName("");
      setEmail("");
      setMessage("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el mensaje."),
  });

  const { htmlContent } = useStaticPage("contacto");

  return (
    <div className="container-app max-w-[960px] py-14">
      <p className="mb-1.5 text-label-sm font-semibold uppercase tracking-wide text-tertiary-accent">Ayuda</p>
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Contacto</h1>
      <p className="mb-10 text-body-md text-on-surface-variant">Escribinos y te respondemos por correo.</p>

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
            {/* Canales reales confirmados por el equipo de ZeuDin
                (2026-08-07) — siguen siendo el fallback: si se carga
                contenido en /admin/contacto, esta tarjeta se reemplaza por
                completo y pasa a ser editable desde ahí. */}
            <div className="flex items-start gap-3 rounded-lg border border-surface-container-high bg-surface-container-lowest p-4">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#25D366]/10">
                <MessageCircle className="h-5 w-5 text-[#25D366]" />
              </span>
              <div>
                <div className="text-[13.5px] font-bold text-on-surface">WhatsApp</div>
                <div className="text-[13px] text-on-surface-variant">+1 469 507 4046</div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-surface-container-high bg-surface-container-lowest p-4">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-tertiary-accent/10">
                <Mail className="h-5 w-5 text-tertiary-accent" />
              </span>
              <div>
                <div className="text-[13.5px] font-bold text-on-surface">Correo</div>
                <div className="text-[13px] text-on-surface-variant">soporte@zeudin.com</div>
              </div>
            </div>
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
          className="flex flex-col gap-3.5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6"
        >
          <Input label="Nombre" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Correo" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Mensaje</span>
            <textarea
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Cuéntanos en qué te podemos ayudar..."
              className="w-full rounded border border-outline-variant bg-surface-container-lowest p-3.5 text-[14px] outline-none focus:border-tertiary-accent"
            />
          </div>
          <Button type="submit" size="lg" disabled={send.isPending}>
            {send.isPending ? "Enviando..." : "Enviar mensaje"}
          </Button>
        </form>
      </div>
    </div>
  );
}
