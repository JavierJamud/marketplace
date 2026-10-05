import { CompactStoreCard } from "./CompactStoreCard.jsx";
import { AutoCarousel } from "./AutoCarousel.jsx";

// Bloque 48: tarjetas compactas, sin flechas ni puntos. Bloque 254 (pedido
// explícito): pasa de UNA tienda a la vez cada cierto tiempo, la tienda actual
// queda CENTRADA (las vecinas se asoman a los lados) y se puede deslizar a mano.
// Con una sola tienda se muestra quieta.
export function VerifiedStoresSlider({ stores }) {
  if (!stores.length) return null;

  if (stores.length === 1) {
    return (
      <div className="mx-auto max-w-[420px]">
        <CompactStoreCard vendor={stores[0]} />
      </div>
    );
  }

  return (
    <AutoCarousel
      items={stores}
      getKey={(v) => v.id}
      renderItem={(v) => <CompactStoreCard vendor={v} />}
      itemClassName="basis-[80%] px-2 sm:basis-[45%] lg:basis-1/3"
      align="center"
      delay={4000}
      label="Tiendas verificadas"
    />
  );
}
