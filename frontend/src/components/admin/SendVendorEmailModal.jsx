import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Sparkles } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { Spinner } from "../ui/Spinner.jsx";

// Correo del equipo a una tienda desde Gestionar tienda: el mismo envío que Mensajes > Correo directo (POST /admin/emails,
// plantilla adminDirectEmail), sin tener que buscar la tienda. Va al correo de la tienda.
// "Redactar con IA" escribe el mensaje a partir del asunto, de lo que ya haya en el mensaje (como ideas) y de los datos reales
// de la tienda (POST /admin/emails/draft). Solo llena el campo: el admin lo revisa y lo envía él.
const SUBJECT_MAX = 150;
const EMAIL_MAX = 5000;

export function SendVendorEmailModal({ vendor, onClose }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const dirty = !!(subject.trim() || message.trim());

  const send = useMutation({
    mutationFn: async () => (await api.post("/admin/emails", { recipientType: "vendor", recipientId: vendor.id, subject: subject.trim(), message: message.trim() })).data,
    onSuccess: () => {
      toast.success("Correo enviado", `Le llegó a ${vendor.email}.`);
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el correo."),
  });

  const draft = useMutation({
    mutationFn: async () => (await api.post("/admin/emails/draft", { vendorId: vendor.id, subject: subject.trim(), notes: message.trim() })).data,
    onSuccess: (data) => setMessage(data.message),
    onError: (err) => toast.error(err.response?.data?.error ?? "La IA no pudo redactar el mensaje. Prueba de nuevo."),
  });
  const canDraft = subject.trim().length >= 2 && !draft.isPending && !send.isPending;

  // Tocar fuera con algo escrito no lo cierra: se perdería el mensaje.
  const close = () => !send.isPending && !draft.isPending && !dirty && onClose();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="vendor-email-title" className="modal-panel-6 w-full max-w-md rounded-xl bg-surface-container-lowest p-6" onClick={(e) => e.stopPropagation()}>
        <h2 id="vendor-email-title" className="mb-1 text-title-lg font-bold text-on-surface">Enviar correo a la tienda</h2>
        <p className="mb-4 text-[13px] text-on-surface-variant">
          {vendor.email ? (
            <>
              Lo recibe <strong className="text-on-surface">{vendor.companyName}</strong> en <strong className="text-on-surface">{vendor.email}</strong>, como un aviso del equipo de soporte.
            </>
          ) : (
            "Esta tienda no tiene un correo cargado. Agrégalo en Editar antes de escribirle."
          )}
        </p>
        <label htmlFor="vendor-email-subject" className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">
          Asunto
        </label>
        <input
          id="vendor-email-subject"
          maxLength={SUBJECT_MAX}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="mb-3.5 h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 text-[14px] outline-none focus:border-tertiary-accent"
        />
        <div className="mb-0.5 flex items-center justify-between gap-3">
          <label htmlFor="vendor-email-message" className="text-[12.5px] font-semibold text-on-surface-variant">
            Mensaje
          </label>
          <button
            type="button"
            onClick={() => draft.mutate()}
            disabled={!canDraft}
            title={subject.trim().length < 2 ? "Escribe primero el asunto" : undefined}
            className="-mr-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-[12.5px] font-bold text-tertiary-accent hover:underline disabled:cursor-not-allowed disabled:text-outline disabled:no-underline"
          >
            {draft.isPending ? <Spinner className="h-3.5 w-3.5 text-tertiary-accent" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            {draft.isPending ? "Redactando..." : "Redactar con IA"}
          </button>
        </div>
        <textarea
          id="vendor-email-message"
          maxLength={EMAIL_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={draft.isPending}
          placeholder="Escribe el mensaje, o pon el asunto y unas ideas y toca Redactar con IA."
          className="min-h-[150px] w-full resize-y rounded-lg border border-outline-variant bg-surface-container-lowest p-3.5 text-[14px] outline-none focus:border-tertiary-accent"
        />
        <p className="mt-1 text-right text-[11.5px] text-outline">{message.length} de {EMAIL_MAX}</p>
        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} disabled={send.isPending} className="min-h-11 flex-1 rounded-full border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant">
            Cancelar
          </button>
          <Button className="min-h-11 flex-1" onClick={() => send.mutate()} disabled={!vendor.email || !subject.trim() || !message.trim() || send.isPending || draft.isPending}>
            {send.isPending ? (<><Spinner className="text-white" /> Enviando...</>) : (<><Send className="h-4 w-4" aria-hidden="true" /> Enviar</>)}
          </Button>
        </div>
      </div>
    </div>
  );
}
