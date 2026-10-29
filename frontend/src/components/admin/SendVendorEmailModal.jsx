import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { Spinner } from "../ui/Spinner.jsx";

// Correo del equipo a una tienda desde Gestionar tienda: el mismo envío que Mensajes > Correo directo (POST /admin/emails,
// plantilla adminDirectEmail), sin tener que buscar la tienda. Va al correo de la tienda.
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

  // Tocar fuera con algo escrito no lo cierra: se perdería el mensaje.
  const close = () => !send.isPending && !dirty && onClose();

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
        <label htmlFor="vendor-email-message" className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">
          Mensaje
        </label>
        <textarea
          id="vendor-email-message"
          maxLength={EMAIL_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-[150px] w-full resize-y rounded-lg border border-outline-variant bg-surface-container-lowest p-3.5 text-[14px] outline-none focus:border-tertiary-accent"
        />
        <p className="mt-1 text-right text-[11.5px] text-outline">{message.length} de {EMAIL_MAX}</p>
        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} disabled={send.isPending} className="min-h-11 flex-1 rounded-full border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant">
            Cancelar
          </button>
          <Button className="min-h-11 flex-1" onClick={() => send.mutate()} disabled={!vendor.email || !subject.trim() || !message.trim() || send.isPending}>
            {send.isPending ? (<><Spinner className="text-white" /> Enviando...</>) : (<><Send className="h-4 w-4" aria-hidden="true" /> Enviar</>)}
          </Button>
        </div>
      </div>
    </div>
  );
}
