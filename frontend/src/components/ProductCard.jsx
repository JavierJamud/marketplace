import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { api } from "../lib/api.js";
import { Card } from "./ui/Card.jsx";
import { VerifiedBadge } from "./ui/VerifiedBadge.jsx";
import { StarRating } from "./ui/StarRating.jsx";
import { AddToCartControl } from "./AddToCartControl.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

export function ProductCard({ product }) {
  // images[] guarda paths relativos ("/uploads/products/<tienda>/<archivo>")
  // servidos por el backend, no por el frontend — hay que anteponer el origin.
  const image = product.images?.[0] ? `${api.defaults.baseURL}${product.images[0]}` : null;
  const discount = product.oldPrice ? Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100) : null;

  return (
    <Card className="group flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
      <Link to={`/producto/${product.vendor?.slug}/${product.slug}`} className="relative block">
        {(product.badge || discount) && (
          <span
            className={`absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-bold text-white ${
              discount ? "bg-error" : "bg-tertiary-accent"
            }`}
          >
            {product.badge ?? `-${discount}%`}
          </span>
        )}
        <div className="aspect-square w-full overflow-hidden bg-surface-container">
          {image ? (
            <img src={image} alt={product.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1 flex items-center gap-1">
          <span className="text-[11px] font-bold text-tertiary-accent">{product.vendor?.companyName}</span>
          {product.vendor?.isVerified && <VerifiedBadge size="sm" />}
        </div>
        <Link to={`/producto/${product.vendor?.slug}/${product.slug}`} className="mb-1.5 line-clamp-2 text-body-md font-semibold text-on-surface">
          {product.name}
        </Link>
        {product.vendor?.locations?.[0] && (
          <div className="mb-2.5 flex items-center gap-1 text-[11.5px] text-outline">
            <MapPin className="h-3 w-3" />
            {product.vendor.locations[0].municipality?.name ?? product.vendor.locations[0].province?.name}
          </div>
        )}
        {product.rating != null && <StarRating value={product.rating} size="h-3.5 w-3.5" showValue className="mb-2.5" />}
        <div className="mt-auto flex items-center justify-between">
          <div>
            <span className="text-base font-bold text-on-surface">{fmtCUP(product.price)}</span>
            {product.oldPrice && <span className="ml-1.5 text-label-sm text-outline line-through">{fmtCUP(product.oldPrice)}</span>}
          </div>
          <AddToCartControl product={product} />
        </div>
      </div>
    </Card>
  );
}
