import { CompactStoreCard } from "./CompactStoreCard.jsx";
import { InfiniteMarquee } from "./InfiniteMarquee.jsx";

// Bloque 48: tarjetas compactas, sin flechas ni puntos, loop de una sola
// dirección. Bloque 251 (pedido explícito): ahora es el desplazamiento infinito
// continuo de InfiniteMarquee (las tiendas que ya pasaron vuelven a entrar por
// el final, sin hueco blanco) y sin botón de pausa. Con una sola tienda se
// muestra quieta: repetirla sola no tiene sentido.
export function VerifiedStoresSlider({ stores }) {
  if (!stores.length) return null;

  if (stores.length === 1) {
    return (
      <div className="max-w-[420px]">
        <CompactStoreCard vendor={stores[0]} />
      </div>
    );
  }

  return (
    <InfiniteMarquee
      items={stores}
      getKey={(v) => v.id}
      renderItem={(v) => <CompactStoreCard vendor={v} />}
      itemClassName="w-[78vw] px-2 sm:w-[360px] lg:w-[410px]"
      secondsPerItem={7}
      label="Tiendas verificadas"
    />
  );
}
