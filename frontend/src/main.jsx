import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import App from "./App.jsx";
import { queryClient } from "./lib/queryClient.js";
import { AuthProvider } from "./context/AuthContext.jsx";
import { CartProvider } from "./context/CartContext.jsx";
import { LocationProvider } from "./context/LocationContext.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LocationProvider>
            <CartProvider>
              <App />
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
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
