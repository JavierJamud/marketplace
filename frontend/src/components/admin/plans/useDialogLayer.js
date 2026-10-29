import { useEffect, useRef } from "react";
import { lockPageScroll } from "../../../lib/scrollLock.js";

// Ventanas de la pantalla de planes (Configurar, Crear plan, Archivar, resumen de impacto): foco atrapado dentro, Escape
// cierra solo la de arriba y, al cerrar, el foco vuelve al botón que la abrió. Las ventanas se apilan (Configurar abre el
// resumen de impacto encima), por eso hay una pila común: cada tecla la atiende solo la última abierta.
// El modal del código de acción del admin (ActionCodeProvider) se abre por encima sin pasar por aquí: si el foco está en
// otra ventana que no es esta, no se toca nada, para no robarle el foco ni cerrarla con Escape.
const stack = [];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogLayer(ref, { open, onEscape }) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return undefined;
    const id = Symbol("plan-dialog");
    stack.push(id);
    const previous = document.activeElement;
    const unlock = lockPageScroll();
    const node = ref.current;
    (node?.querySelector("[data-autofocus]:not([disabled])") ?? node)?.focus({ preventScroll: true });

    function onKey(e) {
      if (stack[stack.length - 1] !== id) return;
      const container = ref.current;
      if (!container) return;
      const active = document.activeElement;
      if (active && active !== document.body && !container.contains(active) && active.closest?.("[role=dialog]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        escapeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = container.contains(active) && active !== container;
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
      unlock();
      if (previous && previous.isConnected && typeof previous.focus === "function") previous.focus({ preventScroll: true });
    };
    // ref es estable; solo importa abrir y cerrar.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
