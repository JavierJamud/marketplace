import "./lib/safeStorage.js";
import { installInputGuards } from "./lib/inputGuards.js";
import { installAspectRatioFallback } from "./lib/aspectRatioFallback.js";
import { installDiagnostics } from "./lib/diagnostics.js";

// Copia de la consola y de lo último que hizo la persona, para los reportes de errores visuales (ver lib/diagnostics.js).
// Va primero para no perderse los mensajes del arranque.
installDiagnostics();

// Filtro central de campos numéricos y de nombres (ver lib/inputGuards.js).
installInputGuards();
// Alto de las cajas aspect-* en navegadores viejos sin aspect-ratio (ver lib/aspectRatioFallback.js).
installAspectRatioFallback();
import ReportErrorModal from "./components/ReportErrorModal.jsx";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { AppToaster } from "./components/ui/AppToaster.jsx";
import App from "./App.jsx";
import { queryClient, queryPersister } from "./lib/queryClient.js";
import { CacheNotice } from "./components/CacheNotice.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { CartProvider } from "./context/CartContext.jsx";
import { LocationProvider } from "./context/LocationContext.jsx";
import { FlowProvider } from "./context/FlowContext.jsx";
// Fuentes servidas desde el propio sitio (antes Google Fonts): sin bloqueo por un tercero y con caché de un año.
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import "@fontsource/montserrat/latin-800.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./index.css";
import { reloadOnceForNewVersion, ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { reportClientError } from "./lib/clientErrorReport.js";
import { UnsavedGuardProvider } from "./lib/unsavedGuard.jsx";

// Vite avisa cuando falla la descarga de un archivo de la página (versión nueva publicada): se recarga una vez.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  reportClientError({ kind: "chunk", error: e.payload ?? "vite:preloadError", recovered: true });
  reloadOnceForNewVersion();
});

// Fallos que no pasan por ninguna pantalla (un script o una promesa sin atender): solo se avisan al servidor para dejar rastro.
window.addEventListener("error", (e) => {
  if (e.target && e.target !== window) return; // errores de carga de imágenes u otros archivos: no son de código
  reportClientError({ kind: "script", error: e.error ?? e.message });
});
window.addEventListener("unhandledrejection", (e) => reportClientError({ kind: "promise", error: e.reason }));

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <UnsavedGuardProvider>
      {/* Bloque 136 (pedido explícito): PersistQueryClientProvider en vez
          del QueryClientProvider de siempre — hidrata el caché desde
          localStorage ANTES de que las páginas monten, así una pantalla ya
          visitada pinta con datos reales de una, sin loader, incluso
          después de una recarga completa (F5) — no solo al navegar
          adentro de la SPA (eso ya lo daba React Query solo, en memoria).
          buster: cambiarlo en un despliegue futuro que modifique la forma
          de alguna respuesta invalida todo el caché viejo de una, evita
          que un objeto con shape vieja rompa un componente nuevo. */}
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: 24 * 60 * 60 * 1000,
          buster: __APP_BUILD__,
          // Bloque 241: las listas paginadas del admin (clave "admin-list-*")
          // no se guardan en localStorage — una consulta por cada combinación
          // de página/filtro/orden, con miles de filas posibles, inflaría el
          // almacenamiento del navegador (límite ~5MB) y desplazaría el caché
          // útil del resto del sitio.
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) && !String(query.queryKey[0]).startsWith("admin-list-") && query.queryKey[0] !== "maintenance",
          },
        }}
      >
        <AuthProvider>
          <LocationProvider>
            <FlowProvider>
            <CartProvider>
              <App />
              <CacheNotice />
              <ReportErrorModal />
              {/* Avisos de todo el sitio (Sileo), ver lib/toast.jsx y components/ui/AppToaster.jsx. */}
              <AppToaster />
            </CartProvider>
            </FlowProvider>
          </LocationProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
      </UnsavedGuardProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
