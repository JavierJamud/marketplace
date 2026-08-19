import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { HelpCircle, Plus, Pencil, Trash2, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

const AUDIENCE_LABEL = { CUSTOMER: "Clientes", VENDOR: "Vendedores" };

function FaqFormModal({ item, defaultAudience, onClose, onSaved }) {
  const isEdit = !!item;
  const [audience, setAudience] = useState(item?.audience ?? defaultAudience);
  const [question, setQuestion] = useState(item?.question ?? "");
  const [answer, setAnswer] = useState(item?.answer ?? "");

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
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
        <h1 className="font-display text-[25px] font-bold text-on-surface">Preguntas frecuentes</h1>
        <Button className="rounded-xl font-bold" onClick={() => setFormTarget({})}>
          <Plus className="mr-1 h-4 w-4" /> Agregar pregunta
        </Button>
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
          <div key={item.id} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-4">
            <div className="mb-1.5 text-[14px] font-bold text-on-surface">{item.question}</div>
            <p className="mb-3 text-[13px] leading-5 text-on-surface-variant">{item.answer}</p>
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
