import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, MapPin, UserRound, X } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

// Bloque 277 (pedido explícito — "un botón, en la tienda y en el chatbot, para ver quién es el
// representante de la tienda, con los datos del registro: nombre, datos de la tienda, las fotos"):
// ficha del representante de una tienda VERIFICADA. El botón solo aparece si la tienda tiene un
// archivo de verificación aprobado. Por privacidad la ficha pública muestra nombre, datos del
// negocio y ubicación; la foto del representante solo la ve quien inició sesión; y el número de
// identificación, el ID fiscal, las fotos del documento y los pagos nunca salen de la plataforma.

function useRepresentative(slug) {
  return useQuery({
    queryKey: ["store-representative", slug],
    queryFn: async () => (await api.get(`/vendors/${slug}/representative`)).data.representative,
    enabled: !!slug,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

function RepresentativePhoto({ slug, name }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl;
    api
      .get(`/vendors/${slug}/representative/photo`, { responseType: "blob" })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [slug]);
  const initial = (name ?? "?").trim().charAt(0).toUpperCase();
  return (
    <span className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-display text-[36px] font-extrabold text-secondary-container">
      {url && !failed ? <img src={url} alt={`Foto de ${name ?? "el representante"}`} className="h-full w-full object-cover" /> : initial}
    </span>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-surface-container-high py-2.5 text-[13.5px] last:border-0">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 break-words font-semibold text-on-surface">{value}</dd>
    </div>
  );
}

function RepresentativeModal({ slug, data, onClose }) {
  const { user } = useAuth();
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const place = [data.municipality, data.province, data.country].filter(Boolean).join(", ");
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-inverse-surface/50 p-4" role="dialog" aria-modal="true" aria-labelledby="representative-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[88vh] w-full max-w-[460px] overflow-y-auto rounded-3xl bg-surface-container-lowest p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="representative-title" className="font-display text-[18px] font-extrabold text-on-surface">
            Representante de la tienda
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-4">
          {data.hasPhoto && user ? (
            <RepresentativePhoto slug={slug} name={data.name} />
          ) : (
            <span className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-full bg-primary text-secondary-container">
              <UserRound className="h-10 w-10" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <p className="break-words font-display text-[20px] font-extrabold leading-6 text-on-surface">{data.name ?? "Sin nombre registrado"}</p>
            <p className="mt-1 text-[13px] text-on-surface-variant">Responsable de {data.companyName}</p>
            {data.verifiedAt && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#087A38]">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                Verificado el {new Date(data.verifiedAt).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            )}
          </div>
        </div>

        {data.hasPhoto && !user && (
          <p className="mb-4 rounded-xl bg-surface-container px-3.5 py-2.5 text-[12.5px] text-on-surface-variant">
            <Link to="/cuenta" className="font-semibold text-tertiary-accent underline">
              Inicia sesión
            </Link>{" "}
            para ver la foto del representante.
          </p>
        )}

        <dl>
          <Row label="Negocio" value={data.companyName} />
          <Row label="Descripción" value={data.description} />
          <Row label="Dirección" value={data.address} />
          {place && (
            <div className="grid grid-cols-[110px_1fr] gap-3 py-2.5 text-[13.5px]">
              <dt className="text-on-surface-variant">Ubicación</dt>
              <dd className="flex min-w-0 items-start gap-1 font-semibold text-on-surface">
                <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
                {place}
              </dd>
            </div>
          )}
        </dl>

        <p className="mt-4 text-[12px] leading-5 text-outline">Son los datos del registro verificado de la tienda. Los documentos de identidad y los datos de pago son privados y solo los revisa la plataforma.</p>
      </div>
    </div>
  );
}

// `variant`: "round" (botón circular de la franja de la tienda) o "chat" (icono pequeño del encabezado del chat).
export function RepresentativeButton({ vendor, variant = "round" }) {
  const [open, setOpen] = useState(false);
  const { data } = useRepresentative(vendor?.slug);
  if (!data) return null;
  const className =
    variant === "chat"
      ? "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      : "flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Ver quién es el representante de la tienda" title="Ver representante" className={className}>
        <UserRound className={variant === "chat" ? "h-[18px] w-[18px]" : "h-[18px] w-[18px]"} aria-hidden="true" />
      </button>
      {open && <RepresentativeModal slug={vendor.slug} data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
