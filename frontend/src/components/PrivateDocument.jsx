import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../lib/api.js";

// Las fotos de KYC son privadas — no hay <img src="URL pública">. Se piden
// como blob autenticado (el interceptor de axios adjunta el JWT) y se arma
// un object URL efímero solo en memoria del navegador de quien la ve.
// Compartido por AdminVerifications.jsx (ve documentos de cualquier tienda)
// y VendorProfile.jsx (el vendedor ve los suyos propios) — mismo endpoint
// GET /verification/:vendorId/file/:type por defecto, la ownership la
// valida el backend; `endpoint` lo sobreescribe (Bloque 72: el archivo de
// verificación sirve sus propias fotos desde /admin/verification-archive,
// no desde la VerificationRequest en curso — mismo componente, otro path).
// `downloadable` (Bloque 72) agrega un botón real de descarga, no solo ver.
// `kind` (Bloque 146, default "image"): "video" pinta un <video controls>
// en vez de un <img> — mismo blob autenticado de siempre, el video de
// liveness (CameraCapture.jsx) usa este mismo componente/endpoint.
export function PrivateDocument({ vendorId, type, label, Icon, available, endpoint, downloadable, kind = "image" }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!available) return;
    let objectUrl;
    api
      .get(endpoint ?? `/verification/${vendorId}/file/${type}`, { responseType: "blob" })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [vendorId, type, available, endpoint]);

  return (
    <div className="overflow-hidden rounded-md border border-surface-container-high">
      <div className="relative flex h-[150px] items-center justify-center bg-[repeating-linear-gradient(45deg,#e4e2e3,#e4e2e3_10px,#eae7e9_10px,#eae7e9_20px)]">
        {url && kind === "video" ? (
          <video src={url} controls className="h-full w-full object-cover" />
        ) : url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-8 w-8 text-outline" strokeWidth={1.6} />
        )}
        {url && downloadable && (
          <a
            href={url}
            download={`${label.replace(/\s+/g, "-").toLowerCase()}.${kind === "video" ? "webm" : "jpg"}`}
            title="Descargar"
            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
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
