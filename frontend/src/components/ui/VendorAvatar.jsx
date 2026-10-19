import { useState } from "react";
import clsx from "clsx";
import { imgUrl } from "../../lib/imgUrl.js";

// Foto de la tienda junto a su nombre: el logo si lo tiene; si no (o si no carga), la inicial sobre el color de la tienda.
// Siempre cuadrada y `shrink-0`: dentro de una fila flex se aplastaba en el celular cuando el texto de al lado era largo.
// `className` define tamaño y forma (p. ej. "h-10 w-10 rounded-full text-sm").
export function VendorAvatar({ vendor, className = "h-11 w-11 rounded-[11px] text-base" }) {
  const [broken, setBroken] = useState(false);
  const initial = (vendor?.companyName ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (vendor?.logoUrl && !broken) {
    return (
      <img
        src={imgUrl(vendor.logoUrl)}
        alt={`Logo de ${vendor.companyName}`}
        onError={() => setBroken(true)}
        className={clsx("aspect-square shrink-0 border border-surface-container-high bg-white object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={clsx("flex aspect-square shrink-0 items-center justify-center font-display font-bold text-white", className)}
      style={{ background: vendor?.color ?? "#232F3E" }}
    >
      {initial}
    </span>
  );
}
