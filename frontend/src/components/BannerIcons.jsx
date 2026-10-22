import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { themeFor, seedFrom, mulberry32 } from "../lib/vendorBannerIcons.js";

// Fondo de íconos del rubro de la tienda (cabecera de la tienda y tarjetas de tienda). Se calcula con el tamaño REAL del
// contenedor: antes las posiciones iban en porcentaje sin conocerlo y los íconos se pisaban en un banner bajo o dejaban
// huecos en uno alto. Reglas (pedido del dueño):
// - Ningún ícono encima de otro: cada uno vive dentro de su celda, con margen, girado o no.
// - Sin huecos: celdas parejas en todo el contenedor, filas alternadas como ladrillos para que se vea salteado.
// - Variados: tamaños y giros distintos, y nunca el mismo ícono junto a sus vecinos (izquierda ni fila de arriba).
// - Fijo por tienda: la misma tienda siempre muestra el mismo patrón (semilla = id de la tienda).
const STROKE_WIDTH = 1.25;
const MIN_OPACITY = 0.16;
const MAX_OPACITY = 0.28;
const GAP = 6;
const ROTATED = 1.42; // un cuadrado girado a 45° ocupa ~1,42 veces su lado

function layout(vendor, width, height, { cell, minSize, maxSize }) {
  const icons = themeFor(vendor);
  const rand = mulberry32(seedFrom(vendor?.id));
  const cols = Math.max(3, Math.round(width / cell));
  const rows = Math.max(2, Math.round(height / cell));
  const cw = width / cols;
  const ch = height / rows;
  const fit = Math.min(cw, ch) - GAP;
  const biggest = Math.max(8, Math.min(maxSize, fit / ROTATED));
  const smallest = Math.min(minSize, biggest);

  let bag = [];
  const draw = (exclude) => {
    for (let tries = 0; tries < icons.length * 2; tries++) {
      if (!bag.length) {
        bag = icons.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      const candidate = bag.pop();
      if (!exclude.has(candidate) || icons.length <= exclude.size) return candidate;
      bag.unshift(candidate);
    }
    return bag.pop() ?? icons[0];
  };

  const placed = [];
  const byRow = [];
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? -cw / 2 : 0;
    const count = r % 2 ? cols + 1 : cols;
    const row = [];
    for (let c = 0; c < count; c++) {
      const cx = offset + c * cw + cw / 2;
      const cy = r * ch + ch / 2;
      // Vecinos que no pueden repetir: el de la izquierda y los de la fila de arriba que tocan esta celda.
      const exclude = new Set();
      if (row.length) exclude.add(row[row.length - 1].Icon);
      for (const up of byRow[r - 1] ?? []) if (Math.abs(up.cx - cx) <= cw) exclude.add(up.Icon);
      const Icon = draw(exclude);
      const size = smallest + rand() * (biggest - smallest);
      const room = Math.max(0, fit - size * ROTATED) / 2;
      const item = {
        key: `${r}-${c}`,
        Icon,
        cx,
        left: cx + (rand() * 2 - 1) * room,
        top: cy + (rand() * 2 - 1) * room,
        size,
        rotate: Math.floor(rand() * 360),
        opacity: MIN_OPACITY + rand() * (MAX_OPACITY - MIN_OPACITY),
      };
      row.push(item);
      placed.push(item);
    }
    byRow.push(row);
  }
  return placed;
}

export function BannerIcons({ vendor, cell = 68, minSize = 18, maxSize = 40 }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setBox((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Solo lo que cambia el patrón: el tamaño, la tienda (semilla) y su rubro.
  const id = vendor?.id;
  const isRestaurant = vendor?.isRestaurant;
  const categorySlug = vendor?.businessCategory?.slug;
  const categoryName = vendor?.businessCategory?.name;
  const items = useMemo(() => {
    if (!box?.w || !box?.h) return [];
    const seedVendor = { id, isRestaurant, businessCategory: { slug: categorySlug, name: categoryName } };
    return layout(seedVendor, box.w, box.h, { cell, minSize, maxSize });
  }, [box, id, isRestaurant, categorySlug, categoryName, cell, minSize, maxSize]);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {items.map(({ key, Icon, top, left, size, rotate, opacity }) => (
        <Icon
          key={key}
          strokeWidth={STROKE_WIDTH}
          className="absolute text-white"
          style={{ top, left, width: size, height: size, transform: `translate(-50%, -50%) rotate(${rotate}deg)`, opacity }}
        />
      ))}
    </div>
  );
}
