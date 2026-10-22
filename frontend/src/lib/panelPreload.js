// Descarga por adelantado el código del panel al que va a entrar alguien que inicia sesión. Los paneles se cargan aparte
// (App.jsx, lazyRetry) y el cambio de página va en transición: sin esto el formulario de ingreso seguía en pantalla, ya
// desbloqueado y con el "¡Bienvenido!" mostrado, mientras se bajaba el panel. Son los mismos archivos que pide App.jsx,
// así que no se descarga nada dos veces.
const PANEL_MODULES = {
  ADMIN: () => [import("../pages/admin/AdminLayout.jsx"), import("../pages/admin/AdminDashboard.jsx")],
  VENDOR: () => [import("../pages/vendor/VendorLayout.jsx"), import("../pages/vendor/VendorDashboard.jsx")],
  VENDOR_STAFF: () => [import("../pages/vendor/VendorLayout.jsx"), import("../pages/vendor/VendorDashboard.jsx")],
  PARTNER: () => [import("../pages/partner/PartnerLayout.jsx"), import("../pages/partner/PartnerDashboard.jsx")],
  CUSTOMER: () => [import("../pages/customer/CustomerPanel.jsx")],
};

// Tope de espera: con señal muy débil se entra igual y el panel termina de llegar con su propia pantalla de carga.
const MAX_WAIT_MS = 8000;

export function preloadPanel(role) {
  const load = PANEL_MODULES[role];
  if (!load) return Promise.resolve();
  const modules = Promise.all(load()).catch(() => {});
  return Promise.race([modules, new Promise((r) => setTimeout(r, MAX_WAIT_MS))]);
}
