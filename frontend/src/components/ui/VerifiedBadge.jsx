import clsx from "clsx";
import verifiedIcon from "../../assets/verified-badge.svg";

const SIZES = { sm: "h-3.5 w-3.5", md: "h-5 w-5", lg: "h-6 w-6" };

// Sello de tienda verificada (Plan Business + KYC aprobado). Usar siempre
// junto al nombre de la tienda donde vendor.isVerified === true.
export function VerifiedBadge({ size = "md", className, title = "Tienda verificada" }) {
  return <img src={verifiedIcon} alt={title} title={title} className={clsx(SIZES[size], "inline-block shrink-0", className)} />;
}
