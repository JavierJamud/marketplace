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
 *   // Con ícono contextual explícito (opcional — ver inferIcon() más abajo,
 *   // Bloque 216: sin esto, success/info YA eligen un ícono específico solo,
 *   // a partir de palabras clave del propio título/descripción. Pasar
 *   // `icon` acá gana siempre, para los casos donde el texto no alcanza a
 *   // distinguir la acción real).
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

// ─── Bloque 216 (pedido explícito — "los toast deben ser más específicos
// para cada cosa"): de 484 llamados a toast en todo el frontend, menos de
// 20 pasaban un `icon` a mano — el resto caía siempre en el genérico
// (✓ para success, ✗ para error), sin importar QUÉ pasó de verdad. En vez
// de tocar cada uno de esos ~465 call sites a mano, esto lee el propio
// texto (título + descripción, sin importar mayúsculas/tildes) y elige el
// ícono más específico que calce — así todo toast ya escrito (y cualquiera
// nuevo que se agregue después) se vuelve específico solo, sin cambiar ni
// una línea en cada pantalla. `icon` explícito en las opciones SIEMPRE gana
// sobre esto (ver showToast más abajo).
//
// Orden: los verbos de ACCIÓN (eliminar/agregar/copiar...) van ANTES que
// los sustantivos de dominio (producto/tienda...) — "Producto eliminado"
// debe verse como "eliminar" (papelera), no como "producto" (paquete); el
// sustantivo solo decide cuando no hay un verbo más específico.
const ICON_KEYWORDS = [
  [/elimin|borr|quit|remov|sacad[oa]|descart|cancelad[oa]|cancel[oó]|rechaz|revoc/i, "delete"],
  [/carrito/i, "cart"],
  [/favorit/i, "heart"],
  [/contraseñ|password/i, "lock"],
  [/correo|email/i, "mail"],
  [/pago|pagó|pagad[oa]|pagar|cobr/i, "payment"],
  [/pedido|orden(?!ar)/i, "order"],
  [/reseñ|comentari|calificaci|opinion/i, "review"],
  [/mensaje|chat|respuesta/i, "message"],
  [/foto|imagen|logo/i, "image"],
  [/usuario|perfil|cuenta/i, "user"],
  [/tienda/i, "store"],
  [/env[ií]o|entreg/i, "shipping"],
  [/producto|stock|inventario|catálogo|catalogo/i, "package"],
  [/copiad|enlace|link/i, "link"],
  [/subid|cargad|subi[oó]/i, "upload"],
  [/descarg/i, "download"],
  [/notificaci/i, "bell"],
  [/ubicaci|direcci|provincia|municipio|país|pais/i, "location"],
  [/tel[ée]fono|whatsapp|llamad/i, "phone"],
  [/configuraci|ajuste/i, "settings"],
  [/calendario|horario|fecha|agend/i, "calendar"],
  [/verificad|verificaci|aprobad|confirmad[oa]|reactivad/i, "shield"],
  [/guardad|actualizad|creado|creada|publicad|activ[oó]|desactiv/i, "save"],
];

// Solo para success/info: en error/warning el ícono se deja siempre fijo
// (círculo con X / triángulo) — a propósito, para que un vistazo rápido a
// "algo salió mal" no dependa de reconocer un glifo distinto cada vez.
function inferIcon(type, title, description) {
  if (type !== "success" && type !== "info") return type;
  const text = `${title ?? ""} ${description ?? ""}`;
  for (const [re, icon] of ICON_KEYWORDS) {
    if (re.test(text)) return icon;
  }
  return type;
}

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
        icon={icon ?? inferIcon(type, title, description)}
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
