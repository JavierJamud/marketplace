import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Spinner } from "./ui/Spinner.jsx";

// Bloque 60: reemplaza las 3 implementaciones manuales de guard que había
// antes (una por panel, cada una escrita a mano y ligeramente distinta —
// la del panel de cliente ni siquiera chequeaba el rol) por una sola. Sin
// sesión válida (o con el rol que no corresponde) siempre manda a
// `redirectTo`, nunca deja pasar ni un instante la pantalla protegida.
export function ProtectedRoute({ roles, redirectTo, children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-container">
        <Spinner />
      </div>
    );
  }

  if (!user || (roles && !roles.includes(user.role))) {
    return <Navigate to={redirectTo} replace />;
  }

  return children ?? <Outlet />;
}
