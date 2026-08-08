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
              {/* Auditoría 2026-08-06: el header público es sticky de 76px —
                  con el offset por defecto (~16px) el toast quedaba tapando
                  parcialmente el buscador (ej. al confirmar "Solicitar" en
                  Store.jsx). containerStyle.top lo baja por debajo del
                  header en todo el sitio, sin tocar la posición horizontal. */}
              <Toaster position="top-center" containerStyle={{ top: 90 }} toastOptions={{ duration: 3500 }} />
            </CartProvider>
          </LocationProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
