import { useEffect, useState } from "react";

// Bloque 96 (pedido explícito): el hero de la Home pasa de 1 imagen fija a
// varias — se muestran de a una con un fundido cruzado (crossfade, todas
// apiladas con position:absolute y solo la activa en opacity-100) en vez de
// deslizarse, que es lo que la mayoría de los sitios modernos usa para un
// hero así (Apple, Airbnb, etc.) — no reordena el layout ni "empuja" nada al
// cambiar. Avanza sola cada 5s; los punticos de abajo (solo si hay más de
// 1 imagen) también saltan a una puntual con un clic.
const AUTOPLAY_MS = 5000;

export function HeroImageSlider({ images, alt }) {
  const [activeIndex, setActiveIndex] = useState(0);

  // Si el admin sube/borra imágenes y la lista cambia de tamaño, nunca
  // queremos quedar apuntando a un índice que ya no existe.
  useEffect(() => {
    setActiveIndex((i) => (i >= images.length ? 0 : i));
  }, [images.length]);

  useEffect(() => {
    if (images.length < 2) return;
    const id = setInterval(() => setActiveIndex((i) => (i + 1) % images.length), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [images.length]);

  // Sin ninguna imagen cargada: se reserva el mismo espacio del recuadro
  // (transparente, Bloque 95) en vez de no renderizar nada — así el layout
  // de 2 columnas del hero no se desarma si el admin todavía no subió nada.
  if (images.length === 0) return <div className="h-[320px] rounded-xl lg:h-[400px]" />;

  return (
    <div className="flex flex-col">
      <div className="relative h-[320px] overflow-hidden rounded-xl lg:h-[400px]">
        {images.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={i === 0 ? alt : ""}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-700 ease-in-out ${
              i === activeIndex ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          />
        ))}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setActiveIndex(i)}
              aria-label={`Ver imagen ${i + 1} de ${images.length}`}
              aria-current={i === activeIndex}
              className={`h-2 rounded-full transition-all ${i === activeIndex ? "w-6 bg-white" : "w-2 bg-white/40 hover:bg-white/60"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
