/**
 * toast.jsx — Drop-in wrapper de react-hot-toast con toast visual premium.
 *
 * Duración adaptativa:
 *   - Solo título     → 2800 ms
 *   - Título + descripción → 5000 ms
 *   - Loading          → Infinito (se descarta manualmente con toast.dismiss)
 *
 * API (compatible con todos los call sites existentes):
 *
 *   import toast from "../lib/toast.jsx";
 *
 *   toast.success("Guardado.");
 *   toast.error("No se pudo guardar.");
 *   toast.warning("Revisa tu conexión.");
 *   toast.info("Proceso iniciado.");
 *   toast.loading("Cargando...");
 *
 *   // Con descripción
 *   toast.success("Producto agregado", "Revisa tu carrito.");
 *
 *   // Con ícono contextual
 *   toast.success("Agregado", null, { icon: "cart" });
 *   toast.error("Eliminado", "No se puede deshacer.", { icon: "delete" });
 *   toast.success("Pago recibido", null, { icon: "payment" });
 *
 *   // Íconos disponibles:
 *   // cart · delete · trash · save · user · payment · card · upload
 *   // download · star · review · message · chat · copy · link · mail
 *   // email · bell · order · store · favorite · heart · shield · lock
 *   // phone · settings · image · calendar · location · package · shipping · check
 *
 *   toast.dismiss(id);
 */

import { toast as hotToast } from "react-hot-toast";
import React from "react";
import { Toast } from "../components/ui/Toast.jsx";

// ─── Duración adaptativa según contenido ─────────────────────────────────────
const DURATION_TITLE    = 2800;  // solo título
const DURATION_WITH_DESC = 5000; // título + descripción

// ─── Normaliza argumentos (2.ª arg puede ser string o options) ───────────────
function parseArgs(title, second, third) {
  if (second == null || typeof second === "string") {
    return { description: second ?? undefined, options: third ?? {} };
  }
  return { description: undefined, options: second ?? {} };
}

// ─── Función interna ──────────────────────────────────────────────────────────
function showToast(type, title, description, opts = {}) {
  const { icon, duration: customDuration, ...restOpts } = opts;
  const duration =
    customDuration ??
    (type === "loading"
      ? Infinity
      : description
      ? DURATION_WITH_DESC
      : DURATION_TITLE);

  return hotToast.custom(
    (t) => (
      <Toast
        type={type}
        title={title}
        description={description}
        visible={t.visible}
        duration={duration === Infinity ? 0 : duration}
        icon={icon}
      />
    ),
    {
      duration,          // react-hot-toast dispara el dismiss automáticamente
      position: "top-right",
      ...restOpts,
    }
  );
}

// ─── API pública ──────────────────────────────────────────────────────────────
const toast = {
  success: (title, second, third) => {
    const { description, options } = parseArgs(title, second, third);
    return showToast("success", title, description, options);
  },
  error: (title, second, third) => {
    const { description, options } = parseArgs(title, second, third);
    return showToast("error", title, description, options);
  },
  warning: (title, second, third) => {
    const { description, options } = parseArgs(title, second, third);
    return showToast("warning", title, description, options);
  },
  info: (title, second, third) => {
    const { description, options } = parseArgs(title, second, third);
    return showToast("info", title, description, options);
  },
  loading: (title, second, third) => {
    const { description, options } = parseArgs(title, second, third);
    return showToast("loading", title, description, options);
  },
  dismiss: (id) => hotToast.dismiss(id),
  remove:  (id) => hotToast.remove(id),

  // Promise helper — loading → success/error automático
  promise: (promise, msgs = {}, options = {}) => {
    const id = toast.loading(msgs.loading ?? "Procesando...");
    promise
      .then((data) => {
        hotToast.dismiss(id);
        const title =
          typeof msgs.success === "function" ? msgs.success(data) : (msgs.success ?? "Completado.");
        toast.success(title);
      })
      .catch((err) => {
        hotToast.dismiss(id);
        const title =
          typeof msgs.error === "function" ? msgs.error(err) : (msgs.error ?? "Ocurrió un error.");
        toast.error(title);
      });
    return promise;
  },
};

export default toast;
