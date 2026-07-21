import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Store, BadgeCheck } from "lucide-react";
import { api } from "../../lib/api.js";
import { VerifiedBadge } from "../ui/VerifiedBadge.jsx";

const DEBOUNCE_MS = 280;
const MIN_CHARS = 2;

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function imgUrl(path) {
  return path ? `${api.defaults.baseURL}${path}` : null;
}

// Bloque 22: reemplaza el <form> simple que vivía inline en Header.jsx —
// mismo submit-a-/catalogo?q=... de siempre (Enter o el ícono de lupa), más
// un dropdown de resultados en vivo mientras se escribe. Mismo patrón de
// "cerrar al click afuera" que AccountMenu (Header.jsx) y mismo estilo de
// dropdown (fondo/borde/sombra) para no inventar uno nuevo.
export function SearchBar() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [vendorResults, setVendorResults] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Bloque 30: "Solo verificadas" — filtra tanto el dropdown como, si se
  // hace "Ver todos los resultados", el catálogo completo (Shop.jsx ya leía
  // esto de su propio estado local; ahora también arranca desde la URL).
  const [onlyVerified, setOnlyVerified] = useState(false);
  const ref = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (trimmed.length < MIN_CHARS) {
      setResults([]);
      setVendorResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      try {
        const { data } = await api.get("/search/autocomplete", { params: { q: trimmed, onlyVerified: onlyVerified || undefined } });
        // Si el cliente siguió escribiendo, esta respuesta ya es vieja —
        // ignorarla evita que una tecla más lenta pise el resultado de una
        // búsqueda más nueva que llegó primero.
        if (requestId !== requestIdRef.current) return;
        setResults(data.products);
        setVendorResults(data.vendors ?? []);
        setHasMore(data.hasMore);
        setOpen(true);
      } catch {
        if (requestId === requestIdRef.current) {
          setResults([]);
          setVendorResults([]);
        }
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [q, onlyVerified]);

  function goToFullSearch() {
    setOpen(false);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyVerified) params.set("onlyVerified", "true");
    const qs = params.toString();
    navigate(qs ? `/catalogo?${qs}` : "/catalogo");
  }

  function handleSubmit(e) {
    e.preventDefault();
    goToFullSearch();
  }

  function closeAfterSelect() {
    setOpen(false);
    setQ("");
  }

  return (
    <div ref={ref} className="relative flex-1">
      <form onSubmit={handleSubmit} className="flex h-10 items-center gap-2 rounded bg-white/10 px-3.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => (results.length > 0 || vendorResults.length > 0) && setOpen(true)}
          placeholder="Buscar productos, tiendas, comida..."
          className="w-full min-w-0 border-none bg-transparent text-[13px] text-white outline-none placeholder:text-white/50"
        />
        <button type="submit" aria-label="Buscar" className="flex-shrink-0 text-white/60 hover:text-white">
          <Search className="h-4 w-4" />
        </button>
      </form>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[460px] overflow-y-auto rounded-md border border-surface-container-high bg-surface-container-lowest shadow-lg">
          {/* Bloque 30: chip de filtro rápido — visible siempre que el
              dropdown está abierto, así se puede activar/desactivar sin
              perder lo ya escrito. Re-dispara la búsqueda (ver el useEffect
              de arriba, que ahora también depende de onlyVerified). */}
          <div className="sticky top-0 z-10 border-b border-surface-container-high bg-surface-container-lowest px-3.5 py-2">
            <button
              type="button"
              onClick={() => setOnlyVerified((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold ${
                onlyVerified ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant"
              }`}
            >
              <BadgeCheck className="h-3.5 w-3.5" /> Solo verificadas
            </button>
          </div>

          {loading ? (
            <p className="px-3.5 py-4 text-center text-[12.5px] text-outline">Buscando...</p>
          ) : results.length > 0 || vendorResults.length > 0 ? (
            <>
              {vendorResults.length > 0 && (
                <>
                  <p className="px-3.5 pt-2.5 text-[10.5px] font-bold uppercase tracking-wide text-outline">Tiendas</p>
                  {vendorResults.map((v) => (
                    <Link
                      key={v.id}
                      to={`/tienda/${v.slug}`}
                      onClick={closeAfterSelect}
                      className="flex items-center gap-3 border-b border-surface-container px-3.5 py-2.5 last:border-b-0 hover:bg-surface-container"
                    >
                      <div
                        style={{ background: v.color ?? "#232F3E" }}
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full font-display font-extrabold text-white"
                      >
                        {v.companyName[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-on-surface">{v.companyName}</span>
                          {v.isVerified && <VerifiedBadge size="sm" />}
                        </div>
                        <div className="flex items-center gap-1 text-[11.5px] text-outline">
                          <Store className="h-3 w-3" /> Ver tienda
                        </div>
                      </div>
                    </Link>
                  ))}
                </>
              )}

              {results.length > 0 && (
                <>
                  {vendorResults.length > 0 && <p className="px-3.5 pt-2.5 text-[10.5px] font-bold uppercase tracking-wide text-outline">Productos</p>}
                  {results.map((p) => (
                    <Link
                      key={p.id}
                      to={`/producto/${p.vendor.slug}/${p.slug}`}
                      onClick={closeAfterSelect}
                      className="flex items-center gap-3 border-b border-surface-container px-3.5 py-2.5 last:border-b-0 hover:bg-surface-container"
                    >
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-surface-container">
                        {p.image ? (
                          <img src={imgUrl(p.image)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[8.5px] text-outline">Sin foto</div>
                        )}
                      </div>
                      {/* Precio plegado en la 2da línea (no en su propia columna
                          de ancho fijo) — con la barra de búsqueda angosta en
                          mobile, una columna de precio aparte le dejaba ~0px de
                          ancho real a esta columna y el nombre/tienda
                          desaparecían del todo, no solo se truncaban. */}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-on-surface">{p.name}</div>
                        <div className="flex min-w-0 items-center gap-1 text-[11.5px] text-outline">
                          <span className="min-w-0 truncate">{p.vendor.companyName}</span>
                          <span className="flex-shrink-0 font-bold text-on-surface">· {fmtCUP(p.price)}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </>
              )}
              {hasMore && (
                <button
                  type="button"
                  onClick={goToFullSearch}
                  className="block w-full px-3.5 py-2.5 text-center text-[12.5px] font-semibold text-tertiary-accent hover:bg-surface-container"
                >
                  Ver todos los resultados →
                </button>
              )}
            </>
          ) : (
            <p className="px-3.5 py-4 text-center text-[12.5px] text-outline">Sin resultados para &ldquo;{q.trim()}&rdquo;.</p>
          )}
        </div>
      )}
    </div>
  );
}
