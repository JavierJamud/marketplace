// Casilla "Avisar a la tienda" junto a una acción del admin (ver lib/notifyVendor.js). El área tocable es de 44px (R-03).
export function NotifyVendorCheckbox({ checked, onChange, className = "" }) {
  return (
    <label className={`inline-flex min-h-11 cursor-pointer select-none items-center gap-2 text-[13px] font-semibold text-on-surface ${className}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#337475]" />
      Avisar a la tienda
      <span className="sr-only"> (le llega un aviso al celular y a su panel)</span>
    </label>
  );
}
