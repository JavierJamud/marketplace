import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

// Las fotos de KYC son privadas — no hay <img src="URL pública">. Se piden
// como blob autenticado (el interceptor de axios adjunta el JWT) y se arma
// un object URL efímero solo en memoria del navegador de quien la ve.
// Compartido por AdminVerifications.jsx (ve documentos de cualquier tienda)
// y VendorProfile.jsx (el vendedor ve los suyos propios) — mismo endpoint
// GET /verification/:vendorId/file/:type, la ownership la valida el backend.
export function PrivateDocument({ vendorId, type, label, Icon, available }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!available) return;
    let objectUrl;
    api
      .get(`/verification/${vendorId}/file/${type}`, { responseType: "blob" })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [vendorId, type, available]);

  return (
    <div className="overflow-hidden rounded-md border border-surface-container-high">
      <div className="flex h-[150px] items-center justify-center bg-[repeating-linear-gradient(45deg,#e4e2e3,#e4e2e3_10px,#eae7e9_10px,#eae7e9_20px)]">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-8 w-8 text-outline" strokeWidth={1.6} />
        )}
      </div>
      <div className="px-3 py-2 text-[11.5px] font-semibold text-outline">
        {label}
        {!available && " · sin enviar"}
        {available && !url && !failed && " · cargando..."}
      </div>
    </div>
  );
}
