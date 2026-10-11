import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { HelpCircle, Plus, Pencil, Trash2, X, FileCode2 } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

const AUDIENCE_LABEL = { CUSTOMER: "Clientes", VENDOR: "Vendedores" };

const BATCH_EXAMPLE = `<details>
  <summary>¿Cómo pago mi pedido?</summary>
  <p>Pagas al recibirlo o por transferencia, según lo que acepte cada tienda.</p>
</details>

<h2>¿Cuánto tarda la entrega?</h2>
<p>Depende de la tienda y de tu municipio. El tiempo aparece antes de confirmar.</p>`;

// Respuesta con formato (HTML ya sanitizado en el servidor) o texto simple.
export function isRichAnswer(text) {
  return /<\/?[a-z][^>]*>/i.test(text ?? "");
}

// Agregar muchas preguntas de una vez pegando HTML. Primero se revisa qué se detecta y después se guarda.
function FaqBatchModal({ defaultAudience, onClose, onSaved }) {
  const [audience, setAudience] = useState(defaultAudience);
  const [html, setHtml] = useState("");
  const [preview, setPreview] = useState(null);

  const run = useMutation({
    mutationFn: async (commit) => (await api.post("/admin/faq/batch", { audience, html, commit })).data,
    onSuccess: (data, commit) => {
      if (commit) {
        toast.success(`${data.created} ${data.created === 1 ? "pregunta agregada" : "preguntas agregadas"}.`);
        onSaved();
      } else {
        setPreview(data);
      }
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo procesar el HTML."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-3 sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface-container-lowest p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Agregar preguntas por lote"
      >
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <h3 className="text-title-lg text-on-surface">Agregar preguntas por lote</h3>
          <button onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="mb-3 grid grid-cols-2 gap-2.5">
            {["CUSTOMER", "VENDOR"].map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAudience(a)}
                className={`min-h-11 rounded-xl border-2 text-[12.5px] font-bold ${
                  audience === a ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant"
                }`}
              >
                Para {AUDIENCE_LABEL[a].toLowerCase()}
              </button>
            ))}
          </div>

          <p className="mb-2 text-[12.5px] leading-5 text-outline">
            Pega el HTML. Cada pregunta puede ir en un bloque <code>&lt;details&gt;</code> con su <code>&lt;summary&gt;</code>, o como un
            título (<code>h1</code> a <code>h4</code>) seguido de su respuesta. Se sacan scripts y atributos de evento. Máximo 100 por lote.
          </p>
          <textarea
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              setPreview(null);
            }}
            rows={9}
            placeholder={BATCH_EXAMPLE}
            aria-label="HTML con las preguntas"
            className="min-h-[160px] w-full resize-y rounded-lg border border-outline-variant bg-surface-container-lowest p-3 font-mono text-[12.5px] outline-none focus:border-tertiary-accent"
          />
          <button
            type="button"
            onClick={() => {
              setHtml(BATCH_EXAMPLE);
              setPreview(null);
            }}
            className="mt-1 flex min-h-11 items-center text-[12.5px] font-semibold text-tertiary-accent hover:underline"
          >
            Usar un ejemplo
          </button>

          {preview && (
            <div className="mt-2 rounded-xl border border-outline-variant p-3" aria-live="polite">
              <p className="mb-2 text-[13px] font-bold text-on-surface">
                {preview.items.length} {preview.items.length === 1 ? "pregunta detectada" : "preguntas detectadas"}
                {preview.skipped.length > 0 && `, ${preview.skipped.length} se omiten`}
              </p>
              {preview.items.length === 0 && <p className="text-[12.5px] text-on-surface-variant">No se encontró ninguna pregunta con respuesta. Revisa el formato.</p>}
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-[12.5px] text-on-surface">
                {preview.items.map((i, n) => (
                  <li key={n}>{i.question}</li>
                ))}
              </ol>
              {preview.skipped.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 border-t border-surface-container pt-2 text-[12px] text-error">
                  {preview.skipped.map((s, n) => (
                    <li key={n}>
                      {s.question}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 grid shrink-0 grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="outline" disabled={run.isPending || html.trim().length < 10} onClick={() => run.mutate(false)}>
            {run.isPending && !preview ? "Revisando..." : "Revisar"}
          </Button>
          <Button type="button" disabled={run.isPending || !preview || preview.items.length === 0} onClick={() => run.mutate(true)}>
            {preview ? `Agregar ${preview.items.length}` : "Agregar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FaqFormModal({ item, defaultAudience, onClose, onSaved }) {
  const isEdit = !!item;
  const [audience, setAudience] = useState(item?.audience ?? defaultAudience);
  const [question, setQuestion] = useState(item?.question ?? "");
  const [answer, setAnswer] = useState(item?.answer ?? "");

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): mismo patrón de snapshot-en-ref que
  // ProductModal (VendorProducts.jsx).
  const initialSnapshot = useRef(JSON.stringify({ audience, question, answer }));
  const isDirty = JSON.stringify({ audience, question, answer }) !== initialSnapshot.current;

  const save = useMutation({
    mutationFn: async () => {
      const payload = { audience, question: question.trim(), answer: answer.trim() };
      if (isEdit) return (await api.patch(`/admin/faq/${item.id}`, payload)).data;
      return (await api.post("/admin/faq", payload)).data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Pregunta actualizada." : "Pregunta agregada.");
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  // Bloque 196: misma condición que ya deshabilita el botón de submit más
  // abajo (sin save.isPending).
  const canSaveNow = !!question.trim() && !!answer.trim();
  const dirtyModal = useDirtyModal({
    isDirty,
    onClose,
    onSave: canSaveNow ? () => save.mutateAsync() : undefined,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">{isEdit ? "Editar pregunta" : "Nueva pregunta"}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-col gap-3.5"
        >
          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Público</span>
            <div className="grid grid-cols-2 gap-2.5">
              {["CUSTOMER", "VENDOR"].map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAudience(a)}
                  className={`rounded-xl border-2 py-2.5 text-[12.5px] font-bold ${
                    audience === a ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant"
                  }`}
                >
                  {AUDIENCE_LABEL[a]}
                </button>
              ))}
            </div>
          </div>

          <Input label="Pregunta" required value={question} onChange={(e) => setQuestion(e.target.value)} />

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Respuesta</span>
            <textarea
              required
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
              className="w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13.5px] outline-none focus:border-tertiary-accent"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={save.isPending || !question.trim() || !answer.trim()}>
              {save.isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Agregar pregunta"}
            </Button>
          </div>
        </form>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </div>
  );
}

// Bloque 53: sección propia con CRUD real — antes las preguntas eran copy
// hardcodeado en Faq.jsx, ahora viven en la tabla FaqItem. Cada pregunta
// pertenece a un único público (cliente o vendedor); el FAQ público (single-
// open accordion) muestra la lista que corresponda según la pestaña activa.
export default function AdminFaq() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("CUSTOMER");
  const [formTarget, setFormTarget] = useState(null); // null cerrado, {} crear, item editar
  const [batchOpen, setBatchOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ["admin-faq"],
    queryFn: async () => (await api.get("/admin/faq")).data.items,
  });

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/admin/faq/${id}`)).data,
    onSuccess: () => {
      toast.success("Pregunta eliminada.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-faq"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar.");
      setDeleteTarget(null);
    },
  });

  const filtered = items?.filter((i) => i.audience === tab) ?? [];

  function handleSaved() {
    setFormTarget(null);
    queryClient.invalidateQueries({ queryKey: ["admin-faq"] });
  }

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconCircle icon={HelpCircle} tone="teal" />
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Preguntas frecuentes</h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="outline" className="rounded-xl font-bold" onClick={() => setBatchOpen(true)}>
            <FileCode2 className="mr-1 h-4 w-4" /> Agregar por lote
          </Button>
          <Button className="rounded-xl font-bold" onClick={() => setFormTarget({})}>
            <Plus className="mr-1 h-4 w-4" /> Agregar pregunta
          </Button>
        </div>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">
        Se muestran en /faq — el cliente ve una pestaña "Para clientes" y otra "Para vendedores", con una sola
        respuesta abierta a la vez.
      </p>

      <div className="mb-5 flex gap-2">
        {["CUSTOMER", "VENDOR"].map((a) => (
          <button
            key={a}
            onClick={() => setTab(a)}
            className={`rounded-full px-4 py-2 text-[13px] font-bold ${
              tab === a ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"
            }`}
          >
            {AUDIENCE_LABEL[a]} ({items?.filter((i) => i.audience === a).length ?? 0})
          </button>
        ))}
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon={HelpCircle}
          title={`Todavía no hay preguntas para ${AUDIENCE_LABEL[tab].toLowerCase()}`}
          description="Agrega la primera con el botón de arriba."
        />
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((item) => (
          <div key={item.id} className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-4">
            <div className="mb-1.5 text-[14px] font-bold text-on-surface">{item.question}</div>
            {isRichAnswer(item.answer) ? (
              <div className="faq-rich mb-3 text-[13px] leading-5 text-on-surface-variant" dangerouslySetInnerHTML={{ __html: item.answer }} />
            ) : (
              <p className="mb-3 whitespace-pre-line text-[13px] leading-5 text-on-surface-variant">{item.answer}</p>
            )}
            <div className="flex items-center gap-3.5 border-t border-surface-container pt-2.5">
              <button
                onClick={() => setFormTarget(item)}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-tertiary-accent hover:underline"
              >
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
              <button
                onClick={() => setDeleteTarget(item)}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-error hover:underline"
              >
                <Trash2 className="h-3.5 w-3.5" /> Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {batchOpen && (
        <FaqBatchModal
          defaultAudience={tab}
          onClose={() => setBatchOpen(false)}
          onSaved={() => {
            setBatchOpen(false);
            queryClient.invalidateQueries({ queryKey: ["admin-faq"] });
          }}
        />
      )}

      {formTarget && (
        <FaqFormModal
          item={formTarget.id ? formTarget : null}
          defaultAudience={tab}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="¿Eliminar esta pregunta?"
        message="Se borra por completo de la página pública de FAQ."
        confirmLabel={remove.isPending ? "Eliminando..." : "Eliminar"}
        danger
        confirmDisabled={remove.isPending}
        onConfirm={() => remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
