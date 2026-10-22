// Casilla "también a la lista negra" al suspender un cliente o bloquear una tienda. Decisión del dueño: solo si el admin la
// marca. Con ella, el correo, los teléfonos, el documento, el nombre de la tienda y su usuario no se pueden volver a usar en
// ningún registro de cliente ni de tienda (backend lib/blacklist.js). Se puede sacar después desde Reportes > Lista negra.
export function BlacklistCheckbox({ checked, onChange, kind = "cliente" }) {
  return (
    <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-error/30 bg-error/5 p-3">
      <input type="checkbox" className="mt-0.5 h-4 w-4 flex-shrink-0 accent-error" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-[12.5px] text-on-surface">
        <span className="block font-semibold">Agregar a la lista negra</span>
        <span className="block text-on-surface-variant">
          Incumplió las normas: {kind === "tienda" ? "su correo, teléfonos, documento, nombre de tienda y usuario" : "su correo y su teléfono"} no se podrán
          usar para registrar otra cuenta ni otra tienda.
        </span>
      </span>
    </label>
  );
}
