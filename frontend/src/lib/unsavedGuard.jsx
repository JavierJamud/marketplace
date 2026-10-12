import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { UnsavedChangesModal } from "../components/UnsavedChangesModal.jsx";

// Aviso de cambios sin guardar al cambiar de pantalla. Cada pantalla con un formulario declara con useUnsavedGuard si tiene
// cambios y cómo guardarlos. Si la persona navega a otra sección (menú lateral, enlaces, botones) con cambios pendientes, se
// pregunta si quiere guardar, descartar o seguir editando. También avisa el navegador al recargar o cerrar la pestaña.
//
// Funciona envolviendo push/replace del navegador de React Router (la app usa BrowserRouter, que no trae bloqueo propio).
// El botón "atrás" del navegador no se puede interceptar de forma fiable; para eso queda el aviso nativo de cierre.

const GuardContext = createContext(null);

export function UnsavedGuardProvider({ children }) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const entry = useRef(null); // { dirty: boolean, save?: () => Promise<unknown> }
  const [pending, setPending] = useState(null); // { go: () => void }
  const [saving, setSaving] = useState(false);
  const bypass = useRef(false);

  const register = useCallback((value) => {
    entry.current = value;
  }, []);
  const unregister = useCallback((value) => {
    if (entry.current === value) entry.current = null;
  }, []);

  useEffect(() => {
    const originalPush = navigator.push;
    const originalReplace = navigator.replace;
    const wrap = (original) =>
      function guarded(...args) {
        if (!bypass.current && entry.current?.dirty) {
          setPending({ go: () => original.apply(navigator, args) });
          return;
        }
        return original.apply(navigator, args);
      };
    navigator.push = wrap(originalPush);
    navigator.replace = wrap(originalReplace);
    return () => {
      navigator.push = originalPush;
      navigator.replace = originalReplace;
    };
  }, [navigator]);

  useEffect(() => {
    function onBeforeUnload(e) {
      if (!entry.current?.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function proceed() {
    const go = pending?.go;
    setPending(null);
    bypass.current = true;
    try {
      go?.();
    } finally {
      // Se mantiene el permiso un instante: algunas pantallas redirigen otra vez al llegar.
      setTimeout(() => (bypass.current = false), 300);
    }
  }

  async function saveAndGo() {
    const save = entry.current?.save;
    if (!save) return proceed();
    setSaving(true);
    try {
      await save();
      proceed();
    } catch {
      // El propio guardado ya avisa el error; el diálogo se queda abierto para reintentar o descartar.
    } finally {
      setSaving(false);
    }
  }

  return (
    <GuardContext.Provider value={{ register, unregister }}>
      {children}
      <UnsavedChangesModal
        open={!!pending}
        saving={saving}
        onSave={entry.current?.save ? saveAndGo : undefined}
        onDiscard={proceed}
        onCancel={() => setPending(null)}
      />
    </GuardContext.Provider>
  );
}

// dirty: ¿hay cambios sin guardar?  save: función que los guarda (debe devolver una promesa y lanzar si falla).
export function useUnsavedGuard(dirty, save) {
  const ctx = useContext(GuardContext);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!ctx) return undefined;
    const value = { dirty: !!dirty, save: save ? () => saveRef.current() : undefined };
    ctx.register(value);
    return () => ctx.unregister(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, !!dirty, !!save]);
}
