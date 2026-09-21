/**
 * Toast.jsx — Toast premium minimalista.
 *
 * - Sin botones de acción (cierre automático)
 * - Barra de progreso de izquierda a derecha (CSS puro, sin JS)
 * - Sin texto de contador
 * - Ícono contextual coloreado
 * - Totalmente responsivo (mobile-first)
 * - Duración controlada desde toast.jsx según contenido
 */

import React from "react";

// ─── Colores por tipo ─────────────────────────────────────────────────────────
// Bloque 216 (pedido explícito, con captura de referencia — "los claros se
// ven modernos"): antes la descripción siempre iba en gris plano
// (#6b7280), sin importar el tipo — se agrega `text`, un tono más oscuro
// del mismo color que ya usa el ícono (mismo criterio que la tarjeta de
// referencia: el subtítulo toma el color de su categoría, no un gris
// genérico). Un poco más oscuro que `main` a propósito — el `main` de cada
// tipo está pensado para un ícono/acento chico, no para texto de 12.5px
// (varios, sobre todo warning, no llegan al contraste mínimo de WCAG AA en
// texto normal si se usan tal cual sobre blanco).
const TYPE_COLORS = {
  success: { main: "#10b981", bg: "rgba(16,185,129,0.10)", text: "#047857" },
  error:   { main: "#ef4444", bg: "rgba(239,68,68,0.10)", text: "#b91c1c" },
  warning: { main: "#f59e0b", bg: "rgba(245,158,11,0.10)", text: "#92400e" },
  info:    { main: "#3b82f6", bg: "rgba(59,130,246,0.10)", text: "#1d4ed8" },
  loading: { main: "#6b7280", bg: "rgba(107,114,128,0.10)", text: "#4b5563" },
};

// ─── Biblioteca de íconos SVG inline ─────────────────────────────────────────
const ICON_PATHS = {
  success:  <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
  error:    <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>,
  warning:  <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  info:     <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>,
  cart:     <><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></>,
  delete:   <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></>,
  trash:    <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></>,
  save:     <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,
  user:     <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
  payment:  <><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></>,
  card:     <><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></>,
  upload:   <><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></>,
  download: <><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36"/></>,
  star:     <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>,
  review:   <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>,
  message:  <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
  chat:     <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
  copy:     <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  link:     <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
  mail:     <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
  email:    <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
  bell:     <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
  order:    <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
  store:    <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  favorite: <><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></>,
  heart:    <><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></>,
  shield:   <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
  lock:     <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  check:    <><polyline points="20 6 9 17 4 12"/></>,
  package:  <><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
  shipping: <><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
  phone:    <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 17z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  image:    <><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  location: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
};

// ─── Spinner de loading ───────────────────────────────────────────────────────
function SpinnerSVG({ size, color }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round"
      style={{ animation: "toastSpin 0.75s linear infinite" }}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ─── Ícono genérico ───────────────────────────────────────────────────────────
function ToastIcon({ name, size = 20, color }) {
  if (name === "loading") return <SpinnerSVG size={size} color={color} />;
  const paths = ICON_PATHS[name] ?? ICON_PATHS.info;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
export function Toast({ type = "success", title, description, visible, duration = 3000, icon: iconProp }) {
  const iconName = iconProp ?? type;
  // Bloque 217 (pedido explícito, con captura): "producto eliminado" es un
  // success técnico (la acción terminó sin error), pero eliminar/quitar es
  // destructivo — no debe leerse como algo positivo en verde. Cualquier
  // toast con ícono de papelera pasa a los colores de advertencia (ámbar/
  // naranja), sin importar el `type` real que lo disparó.
  const colors =
    iconName === "delete" || iconName === "trash"
      ? TYPE_COLORS.warning
      : TYPE_COLORS[type] ?? TYPE_COLORS.info;
  const hasDesc = Boolean(description);
  // Bloque 89 (pedido explícito): antes la barra de progreso era una
  // animación CSS puramente cosmética, ajena al hover — seguía llenándose
  // (y "terminando") aunque react-hot-toast SÍ pausa el cierre real al
  // pasar el mouse por encima (pausa nativa de la librería vía
  // onMouseEnter/onMouseLeave en su wrapper, con startPause/endPause).
  // Resultado: la barra se veía llena mucho antes de que el toast
  // realmente desapareciera. Ahora este mismo hover pausa también la
  // animación CSS de la barra (animationPlayState), en el mismo elemento
  // — al pausar, CSS conserva el punto exacto donde iba (no la resetea),
  // y sigue desde ahí al sacar el mouse, en sincronía con la pausa real.
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      role="alert"
      aria-live="polite"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        /* Layout */
        display: "flex",
        flexDirection: "column",
        /* Tamaño — responsivo */
        width: "min(360px, calc(100vw - 24px))",
        /* Card */
        background: "#ffffff",
        borderRadius: 14,
        boxShadow:
          "0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.09), 0 0 0 1px rgba(0,0,0,0.04)",
        overflow: "hidden",
        /* Animación entrada/salida */
        animation: visible
          ? "toastIn 0.42s cubic-bezier(0.34,1.56,0.64,1) forwards"
          : "toastOut 0.22s cubic-bezier(0.4,0,1,1) forwards",
        willChange: "transform, opacity",
        /* Tipografía */
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
      }}
    >
      {/* ── Cuerpo ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: hasDesc ? "flex-start" : "center",
          gap: 11,
          padding: hasDesc ? "14px 16px 12px" : "12px 16px",
        }}
      >
        {/* Ícono */}
        <div
          style={{
            flexShrink: 0,
            width: 38,
            height: 38,
            borderRadius: 10,
            background: colors.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ToastIcon name={iconName} size={19} color={colors.main} />
        </div>

        {/* Texto */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              fontWeight: 600,
              color: "#111827",
              lineHeight: 1.4,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </p>
          {hasDesc && (
            <p
              style={{
                margin: "3px 0 0",
                fontSize: 12.5,
                color: colors.text,
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {description}
            </p>
          )}
        </div>
      </div>

      {/* ── Barra de progreso (izquierda → derecha) ────────────────────── */}
      <div
        style={{
          height: 3,
          background: `${colors.main}1a`,  /* ~10% opacidad */
        }}
      >
        <div
          style={{
            height: "100%",
            width: "100%",
            background: colors.main,
            transformOrigin: "left center",
            transform: "scaleX(0)",
            /* La animación CSS lleva de scaleX(0)→scaleX(1) en `duration` ms */
            animation: `toastProgress ${duration}ms linear forwards`,
            // Debe ir DESPUÉS de `animation` en el objeto: el shorthand ya
            // trae implícito "running", y esta declaración explícita es la
            // que gana al final (mismo orden que en una hoja CSS normal).
            animationPlayState: isHovered ? "paused" : "running",
          }}
        />
      </div>
    </div>
  );
}
