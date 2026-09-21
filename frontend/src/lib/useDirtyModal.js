import { useState } from "react";

// Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
// mostrado como ventana o popup en el panel debe cerrarse automáticamente,
// y si necesita que guarden datos debe preguntar si desea guardar o
// descartar antes de cerrar"): un solo hook para TODOS los modales del
// panel con formulario propio.
//
// `isDirty` es SIEMPRE responsabilidad de quien llama (comparar el draft
// actual contra el snapshot con el que se abrió el modal) — este hook no
// adivina qué cambió, solo decide qué hacer una vez que ya sabe si hay algo
// sin guardar.
//
// Uso típico:
//   const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: handleSubmit });
//   <div className="fixed inset-0 ..." onClick={dirtyModal.handleBackdropClick}>
//     ...
//   </div>
//   <UnsavedChangesModal open={dirtyModal.confirming} saving={dirtyModal.saving}
//     onSave={dirtyModal.handleSaveAndClose} onDiscard={dirtyModal.handleDiscard}
//     onCancel={dirtyModal.handleKeepEditing} />
export function useDirtyModal({ isDirty, onClose, onSave }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  function requestClose() {
    if (isDirty) setConfirming(true);
    else onClose();
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) requestClose();
  }

  async function handleSaveAndClose() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave();
      setConfirming(false);
      onClose();
    } catch {
      // El propio `onSave` ya avisa el error (toast, misma mutación que usa
      // el botón "Guardar" normal del formulario) — acá solo se evita que
      // quede como una excepción sin atrapar; el diálogo se queda abierto
      // para que el vendedor pueda reintentar o descartar.
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setConfirming(false);
    onClose();
  }

  function handleKeepEditing() {
    setConfirming(false);
  }

  return { confirming, saving, requestClose, handleBackdropClick, handleSaveAndClose, handleDiscard, handleKeepEditing };
}
