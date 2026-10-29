import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, MailX } from "lucide-react";
import { api } from "../../lib/api.js";
import { Spinner } from "../../components/ui/Spinner.jsx";

// Enlace de baja del pie de los correos de promoción: recordatorios de carrito y puntos, ofertas de tiendas, campañas y
// ofertas del admin (todos apagan User.marketingEmails). Funciona sin iniciar sesión: el enlace lleva una firma que solo
// vale para esa cuenta. Los correos de pedidos y de la cuenta siguen llegando.
export default function EmailUnsubscribe() {
  const [params] = useSearchParams();
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [role, setRole] = useState(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const u = params.get("u");
    const t = params.get("t");
    if (!u || !t) {
      setState("error");
      setError("El enlace está incompleto.");
      return;
    }
    api
      .post("/loyalty/unsubscribe", { u, t })
      .then((r) => {
        setRole(r.data?.role ?? null);
        setState("done");
      })
      .catch((err) => {
        setState("error");
        setError(err.response?.data?.error ?? "No se pudo completar. Inténtalo de nuevo más tarde.");
      });
  }, [params]);

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      {state === "loading" && <Spinner />}
      {state === "done" && (
        <>
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-verified" aria-hidden="true" />
          <h1 className="font-display text-[22px] font-extrabold text-on-surface">Listo, ya no te enviaremos correos de promoción</h1>
          <p className="mt-2 text-[14px] text-on-surface-variant">
            Los correos de tus pedidos y de tu cuenta seguirán llegando. Si cambias de idea, puedes volver a activarlos en {role === "VENDOR" ? "la configuración de tu tienda" : "tu perfil"}.
          </p>
          <Link to={role === "VENDOR" ? "/vendedor/configuracion?tab=facturacion" : "/cuenta/panel?tab=profile"} className="mt-5 inline-flex min-h-11 items-center font-bold text-tertiary-accent underline">
            {role === "VENDOR" ? "Ir a la configuración de mi tienda" : "Ir a mi perfil"}
          </Link>
        </>
      )}
      {state === "error" && (
        <>
          <MailX className="mx-auto mb-3 h-12 w-12 text-error" aria-hidden="true" />
          <h1 className="font-display text-[22px] font-extrabold text-on-surface">No pudimos darte de baja</h1>
          <p className="mt-2 text-[14px] text-on-surface-variant">{error}</p>
          <Link to="/cuenta/panel?tab=profile" className="mt-5 inline-flex min-h-11 items-center font-bold text-tertiary-accent underline">Apagarlos desde mi perfil</Link>
        </>
      )}
    </div>
  );
}
