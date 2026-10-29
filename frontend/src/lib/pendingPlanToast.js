import toast from "./toast.jsx";

// El servidor responde `pending: true` cuando a la tienda le faltan requisitos de la verificación: el plan quedó asignado
// pero no se activa (ni la insignia ni sus funciones) hasta que la tienda los complete. Devuelve true si mostró el aviso.
export function showPendingPlanToast(data, planName) {
  if (!data?.pending) return false;
  const missing = data.missing?.length ? data.missing.join(", ") : "los requisitos de la verificación";
  toast.warning(
    `Plan ${data.planName ?? planName ?? ""} pendiente`.replace("  ", " "),
    `A la tienda le falta: ${missing}. Le avisamos por correo y en su panel. El plan, con su insignia, se activa solo cuando lo complete.`
  );
  return true;
}
