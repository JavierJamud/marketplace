import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
    } catch {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    // Bloque 47: 2FA opt-in — el backend NUNCA emite tokens acá si la cuenta
    // lo tiene activo, solo avisa que mandó un código. Account.jsx detecta
    // esta forma (sin accessToken) y muestra el paso de "ingresá el código".
    if (data.requiresTwoFactor) return { requiresTwoFactor: true, email: data.email };
    localStorage.setItem("accessToken", data.accessToken);
    localStorage.setItem("refreshToken", data.refreshToken);
    setUser(data.user);
    return data.user;
  };

  // Segundo paso del login cuando 2FA está activo — mismo resultado final
  // que login() (tokens + user), pero validando el código de 6 dígitos.
  const verifyTwoFactor = async (email, code) => {
    const { data } = await api.post("/auth/2fa/verify", { email, code });
    localStorage.setItem("accessToken", data.accessToken);
    localStorage.setItem("refreshToken", data.refreshToken);
    setUser(data.user);
    return data.user;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    localStorage.setItem("accessToken", data.accessToken);
    localStorage.setItem("refreshToken", data.refreshToken);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setUser(null);
  };

  // El JWT lleva el role "horneado" al firmarlo (ver middleware/auth.js:
  // requireRole nunca vuelve a mirar la DB) — un usuario que se acaba de
  // convertir en vendedor (createVendor sube su role a VENDOR en la DB)
  // sigue teniendo un accessToken viejo con role CUSTOMER hasta que se
  // reemite. Sin este paso, /vendedor/* devuelve 403 hasta el próximo login.
  const refreshRole = async () => {
    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) return;
    const { data } = await api.post("/auth/refresh", { refreshToken });
    localStorage.setItem("accessToken", data.accessToken);
    await loadMe();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyTwoFactor, register, logout, refreshRole, refetch: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
