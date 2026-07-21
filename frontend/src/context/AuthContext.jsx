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
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshRole, refetch: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
