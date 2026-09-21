import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Toaster } from "react-hot-toast";
import App from "./App.jsx";
import { queryClient, queryPersister } from "./lib/queryClient.js";
import { CacheNotice } from "./components/CacheNotice.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { CartProvider } from "./context/CartContext.jsx";
import { LocationProvider } from "./context/LocationContext.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
        persistOptions={{ persister: queryPersister, maxAge: 24 * 60 * 60 * 1000, buster: "v1" }}
      >
        <AuthProvider>
          <LocationProvider>
            <CartProvider>
              <App />
              <CacheNotice />
              {/* Toaster: contenedor posicionado en top-right.
                  El diseño visual completo (card, sombra, animaciones) lo
                  gestiona <Toast> en components/ui/Toast.jsx — el Toaster
                  solo actúa como portal de montaje sin estilos propios.
                  La duración de cada toast la decide toast.jsx según contenido. */}
              <Toaster
                position="top-right"
                containerStyle={{ top: 16, right: 16, zIndex: 9999 }}
                toastOptions={{
                  style: { padding: 0, background: "transparent", boxShadow: "none", maxWidth: "none" },
                }}
              />
            </CartProvider>
          </LocationProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
