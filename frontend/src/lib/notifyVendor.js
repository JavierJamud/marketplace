import { useCallback, useState } from "react";

// "Avisar a la tienda" en las acciones del admin. Cada acción lleva su propia casilla, sin marcar: la tienda recibe el aviso
// en el celular y en su panel solo si el admin la marca en ese momento (el backend lo lee de la cabecera X-Notify-Vendor).
export const notifyVendorConfig = (on) => ({ headers: { "X-Notify-Vendor": on ? "1" : "0" } });

// Varias casillas en una lista (una por tienda o solicitud), guardadas por id.
export function useNotifyChoices() {
  const [chosen, setChosen] = useState(() => new Set());
  const isOn = useCallback((id) => chosen.has(id), [chosen]);
  const set = useCallback((id, on) => setChosen((prev) => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  }), []);
  return { isOn, set, config: (id) => notifyVendorConfig(chosen.has(id)) };
}
