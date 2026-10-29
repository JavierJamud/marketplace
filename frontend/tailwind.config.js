/**
 * Tailwind config — sistema de diseño ZeuDin (ver ../README.md y
 * ../examples/tokens-cheatsheet.md). Los valores acá SON la fuente de verdad
 * en código: no se meten hex/px crudos en los componentes, se usan estas
 * clases (bg-primary-container, text-secondary-container, text-headline-lg, etc).
 */
import plugin from "tailwindcss/plugin";

// Ventanas emergentes: una sola regla para todas (antes cada una tenía la suya y algunas se salían de la pantalla o dejaban los
// botones fuera de la vista). `modal-panel-6` (o -4, -5, o `modal-panel` sin relleno) en el panel de la ventana:
//  - nunca pasa del alto de la pantalla menos 2rem, así no toca los bordes;
//  - su contenido se desliza por dentro;
//  - la última fila del panel, si son botones, queda pegada abajo y siempre a la vista (el número es el relleno del panel,
//    para que el pie llegue de borde a borde).
const modalPanels = plugin(({ addComponents, theme }) => {
  const sizes = { "": "0px", "-4": theme("spacing.4"), "-5": theme("spacing.5"), "-6": theme("spacing.6") };
  const rules = {};
  for (const [suffix, pad] of Object.entries(sizes)) {
    rules[`.modal-panel${suffix}`] = {
      maxHeight: "calc(100dvh - 2rem)",
      overflowY: "auto",
      overscrollBehavior: "contain",
      "& > div:last-child:has(> button, > a)": {
        position: "sticky",
        bottom: `-${pad}`,
        zIndex: "10",
        margin: `${theme("spacing.4")} -${pad} -${pad}`,
        padding: `${theme("spacing.3")} ${pad === "0px" ? theme("spacing.4") : pad}`,
        backgroundColor: "inherit",
        borderTop: `1px solid ${theme("colors.surface.container")}`,
      },
    };
  }
  addComponents(rules);
});

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#fbf9fa",
          dim: "#dcd9db",
          bright: "#fbf9fa",
          "container-lowest": "#ffffff",
          "container-low": "#f5f3f4",
          container: "#f0edee",
          "container-high": "#eae7e9",
          "container-highest": "#e4e2e3",
          variant: "#e4e2e3",
        },
        "on-surface": {
          DEFAULT: "#1b1b1d",
          variant: "#44474c",
        },
        "inverse-surface": "#303031",
        "inverse-on-surface": "#f3f0f1",
        outline: {
          DEFAULT: "#65676c",
          variant: "#c5c6cc",
        },
        // Primary: navy — identidad de marca (footer, sidebar vendedor, hero)
        primary: {
          DEFAULT: "#0e1a28",
          container: "#232f3e",
        },
        "on-primary": {
          DEFAULT: "#ffffff",
          container: "#8a97a9",
        },
        // Secondary: naranja ZeuDin — CTAs, precios, badges
        secondary: {
          DEFAULT: "#8a5100",
          container: "#fe9800",
        },
        "on-secondary": {
          DEFAULT: "#ffffff",
          container: "#643900",
        },
        // Tertiary: teal — panel vendedor, links "Ver tienda"
        tertiary: {
          DEFAULT: "#001d1e",
          container: "#003435",
          accent: "#337475",
          "accent-light": "#61a0a1",
        },
        "on-tertiary": {
          DEFAULT: "#ffffff",
          container: "#61a0a1",
        },
        error: {
          DEFAULT: "#ba1a1a",
          container: "#ffdad6",
        },
        "on-error": {
          DEFAULT: "#ffffff",
          container: "#93000a",
        },
        background: "#fbf9fa",
        "on-background": "#1b1b1d",
        // Verde de WhatsApp: el botón y los íconos de WhatsApp usan el color de la marca (lo reconocen al instante).
        whatsapp: "#25D366",
        verified: {
          light: "#2fdd73",
          DEFAULT: "#0cae53",
          dark: "#087a38", // 5,5:1 sobre blanco (el anterior #0a8f42 daba 4,2:1)
        },
      },
      fontFamily: {
        display: ["Montserrat", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
      fontSize: {
        "display-lg": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["32px", { lineHeight: "40px", fontWeight: "700" }],
        "headline-lg-mobile": ["24px", { lineHeight: "32px", fontWeight: "700" }],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "title-lg": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "label-md": ["14px", { lineHeight: "20px", letterSpacing: "0.01em", fontWeight: "600" }],
        "label-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
      },
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
        full: "9999px",
      },
      spacing: {
        base: "4px",
        xs: "8px",
        sm: "16px",
        md: "24px",
        lg: "48px",
        xl: "80px",
        gutter: "24px",
      },
      maxWidth: {
        content: "1280px",
      },
      keyframes: {
        "cart-bump": {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(1.35) rotate(-8deg)" },
          "60%": { transform: "scale(0.95) rotate(4deg)" },
          "100%": { transform: "scale(1) rotate(0deg)" },
        },
        "badge-pop": {
          "0%": { transform: "scale(0.5)", opacity: "0.4" },
          "50%": { transform: "scale(1.3)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "kyc-scan": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "kyc-pulse": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "step-in": {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "overlay-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "check-pop": {
          "0%": { transform: "scale(0.3)", opacity: "0" },
          "60%": { transform: "scale(1.15)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        // Bloque 48: marquee continuo de categorías del Home — la lista se
        // duplica una vez ([...cats, ...cats]) y el track anima de 0% a
        // -50%; como la segunda mitad es idéntica a la primera, el reinicio
        // del keyframe cae sobre contenido visualmente igual → loop
        // perfectamente continuo, nunca "vuelve atrás" ni salta.
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        // Bloque 178 (pedido explícito — "se debe marcar... verde claro
        // parpadeando... no se puede confundir el camarero y darle
        // nuevamente pedidos que ya le había dado"): a propósito un
        // parpadeo de COLOR de fondo (no solo opacidad, como kyc-pulse de
        // arriba) — tiene que leerse inequívocamente como "recién
        // agregado", no como una animación de carga genérica.
        "new-item-blink": {
          "0%, 100%": { backgroundColor: "rgba(12,174,83,0.28)" },
          "50%": { backgroundColor: "rgba(12,174,83,0.06)" },
        },
        // Entrada de las ventanas: antes cada modal traía su propio <style> con un @keyframes copiado (modal-pop en
        // ConfirmModal, IdleWarningModal, ReportFraudModal y UnsavedChangesModal; otro en PlanDialog y PlanConfigDrawer).
        // Ahora es una sola definición; se usa con motion-safe: para respetar "reducir movimiento".
        "modal-pop": {
          "0%": { opacity: "0", transform: "scale(0.94) translateY(8px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "sheet-up": {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "cart-bump": "cart-bump 0.45s ease-out",
        "badge-pop": "badge-pop 0.35s ease-out",
        "kyc-scan": "kyc-scan 2.2s ease-in-out infinite",
        "kyc-pulse": "kyc-pulse 1.6s ease-in-out infinite",
        "step-in": "step-in 0.28s ease-out",
        "overlay-in": "overlay-in 0.2s ease-out",
        "check-pop": "check-pop 0.5s cubic-bezier(0.34,1.56,0.64,1)",
        "fade-up": "fade-up 0.45s ease-out",
        // Bloque 50 (pedido explícito: "muy rápido" → más suave, y después
        // "un poco más lento" todavía): 28s → 70s → 100s. linear se mantiene
        // (constante, sin aceleración/frenado) a propósito: es lo que hace
        // que pausar/reanudar en hover (ver .category-marquee-track en
        // index.css) nunca se sienta como un salto — la animación siempre
        // retoma exactamente donde se quedó.
        marquee: "marquee 100s linear infinite",
        "new-item-blink": "new-item-blink 1s ease-in-out infinite",
        "modal-pop": "modal-pop 0.18s ease-out",
        "sheet-up": "sheet-up 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [modalPanels],
};
