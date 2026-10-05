// Interruptor compartido del panel de admin. El área tocable es de 44px de
// alto aunque la pastilla se vea de 26px (R-03): el botón lleva padding
// vertical y la pastilla va adentro.
export default function ToggleSwitch({ isActive, disabled, onToggle, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className="flex h-11 w-12 flex-shrink-0 items-center justify-center rounded-lg disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
    >
      <span className="relative block h-[26px] w-11 rounded-full transition-colors" style={{ background: isActive ? "#0CAE53" : "#c5c6cc" }}>
        <span className="absolute top-[3px] h-5 w-5 rounded-full bg-white transition-all" style={{ left: isActive ? "21px" : "3px" }} />
      </span>
    </button>
  );
}
