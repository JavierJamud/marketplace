// Bloqueo del scroll de la página mientras hay una ventana abierta (carrito, filtros, foto ampliada, selector de lugar, etc.).
// Cada ventana restauraba el scroll por su cuenta, y si dos coincidían (una se abría con la otra aún abierta y se cerraban en el
// orden contrario) el cuerpo de la página podía quedar bloqueado para siempre: sin poder deslizarla, y en el celular con la
// página a medio desplazar. Aquí hay un único contador: el scroll solo se libera cuando se cierra la última ventana.
let openLocks = 0;

export function lockPageScroll() {
  openLocks += 1;
  document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openLocks = Math.max(0, openLocks - 1);
    if (openLocks === 0) document.body.style.overflow = "";
  };
}

// Red de seguridad: al cambiar de página no puede haber ventanas abiertas, así que si el cuerpo sigue bloqueado se libera.
export function releaseStaleScrollLock() {
  if (openLocks === 0 && document.body.style.overflow === "hidden") document.body.style.overflow = "";
}
