import { CompactStoreCard } from "./CompactStoreCard.jsx";
import { StepCarousel } from "./StepCarousel.jsx";

// Bloque 48: tarjetas compactas, sin flechas ni puntos, loop de una sola
// dirección. Bloque 252 (pedido explícito): pasa de UNA tienda a la vez cada
// cierto tiempo (StepCarousel), sin hueco blanco al final, igual que las
// ofertas. En celular la tarjeta ocupa ~80% para que se asome la siguiente.
// Con una sola tienda se muestra quieta.
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
    <StepCarousel
      items={stores}
      getKey={(v) => v.id}
      renderItem={(v) => <CompactStoreCard vendor={v} />}
      itemClassName="w-[80%] px-2 sm:w-[45%] lg:w-1/3"
      stepClassName="[--slide-step:80%] sm:[--slide-step:45%] lg:[--slide-step:33.3333%]"
      intervalMs={4000}
      label="Tiendas verificadas"
    />
  );
}
