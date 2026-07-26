/**
 * Tailwind config — sistema de diseño ZeuDin (ver ../README.md y
 * ../examples/tokens-cheatsheet.md). Los valores acá SON la fuente de verdad
 * en código: no se meten hex/px crudos en los componentes, se usan estas
 * clases (bg-primary-container, text-secondary-container, text-headline-lg, etc).
 */
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
          DEFAULT: "#75777c",
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
        verified: {
          light: "#2fdd73",
          DEFAULT: "#0cae53",
          dark: "#0a8f42",
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
      },
    },
  },
  plugins: [],
};
