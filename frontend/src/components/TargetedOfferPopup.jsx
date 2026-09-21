import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, X } from "lucide-react";
import { api } from "../lib/api.js";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Mismo criterio que offerLinkTo/isExternalUrl en OffersSlider.jsx (Bloque
// 192): interno (empieza con "/") usa <Link>, externo (http/https) abre en
// pestaña nueva.
function isExternalUrl(url) {
  return /^https?:\/\//.test(url);
}

// Bloque 194 (pedido explícito — "ofertas autodirigidas... mostrarse en el
// panel o en la cuenta cuando el cliente o vendedor se logeen como forma de
// popup"): montado UNA vez a nivel de layout (PublicLayout.jsx para
// clientes, VendorLayout.jsx para vendedores/staff) — igual criterio que
// NewOrderPopup.jsx/StaleOrderAlert.jsx del panel de vendedor. Muestra la
// PRIMERA oferta pendiente como modal centrado; al cerrarla, invalida la
// query para que aparezca la siguiente si hay más de una.
//
// Polling: 60s (`refetchInterval`) + `refetchOnMount` implícito (default de
// React Query) — mismo orden de magnitud que StaleOrderAlert.jsx (60s) para
// algo que no es urgente como un pedido nuevo; no hace falta el 2.5s de
// NewOrderPopup. Documentado acá porque el enunciado dejaba la elección a
// criterio propio.
const POLL_MS = 60000;

export function TargetedOfferPopup({ enabled = true }) {
  const queryClient = useQueryClient();
  const [dismissingId, setDismissingId] = useState(null);

  const { data: offers } = useQuery({
    queryKey: ["my-targeted-offers"],
    queryFn: async () => (await api.get("/targeted-offers/me")).data.offers,
    enabled,
    refetchInterval: POLL_MS,
  });

  const dismiss = useMutation({
    mutationFn: async (id) => (await api.patch(`/targeted-offers/${id}/dismiss`)).data,
    onMutate: (id) => setDismissingId(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-targeted-offers"] }),
    onSettled: () => setDismissingId(null),
  });

  if (!offers || offers.length === 0) return null;

  // Una a la vez (mismo criterio que NewOrderPopup/StaleOrderAlert) — al
  // descartar esta, el próximo refetch/invalidate ya trae la siguiente en
  // su lugar, si hay otra pendiente.
  const offer = offers[0];
  const to = offer.ctaUrl;
  const external = to && isExternalUrl(to);

  return (
    // Bloque 196: sin ningún borrador propio — cerrar (clic afuera) es lo
    // mismo que descartar el aviso, mismo mutation que ya usa la X.
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-inverse-surface/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss.mutate(offer.id); }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl animate-fade-up">
        {offer.imageUrl && (
          <div className="aspect-[16/9] w-full overflow-hidden bg-surface-container">
            <img src={imgUrl(offer.imageUrl)} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="p-6">
          <div className="mb-3 flex items-start gap-3">
            {!offer.imageUrl && (
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container">
                <Megaphone className="h-5 w-5 text-on-secondary-container" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-title-lg font-bold text-on-surface">{offer.title}</h2>
            </div>
            <button
              onClick={() => dismiss.mutate(offer.id)}
              disabled={dismissingId === offer.id}
              className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-variant"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="mb-5 whitespace-pre-line text-[13.5px] leading-relaxed text-on-surface-variant">{offer.message}</p>

          <div className="flex flex-col gap-2 sm:flex-row">
            {offer.ctaLabel && offer.ctaUrl && (
              external ? (
                <a
                  href={offer.ctaUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => dismiss.mutate(offer.id)}
                  className="flex flex-1 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary/90"
                >
                  {offer.ctaLabel}
                </a>
              ) : (
                <Link
                  to={offer.ctaUrl}
                  onClick={() => dismiss.mutate(offer.id)}
                  className="flex flex-1 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary/90"
                >
                  {offer.ctaLabel}
                </Link>
              )
            )}
            <button
              onClick={() => dismiss.mutate(offer.id)}
              disabled={dismissingId === offer.id}
              className="flex-1 rounded-xl border border-outline-variant px-5 py-2.5 text-[13px] font-semibold text-on-surface transition hover:bg-surface-variant disabled:opacity-50"
            >
              {offer.ctaLabel ? "Ahora no" : "Cerrar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
