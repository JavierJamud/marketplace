// Bloqueo del scroll de la página mientras hay una ventana abierta (carrito, filtros, foto ampliada, selector de lugar, etc.).
// Cada ventana restauraba el scroll por su cuenta, y si dos coincidían (una se abría con la otra aún abierta y se cerraban en el
// orden contrario) el cuerpo de la página podía quedar bloqueado para siempre: sin poder deslizarla, y en el celular con la
// página a medio desplazar. Aquí hay un único contador: el scroll solo se libera cuando se cierra la última ventana.
//
// Se bloquea en <html>, no en <body>: index.css le pone overflow-x:clip a <html> (para que nada ensanche la página en iPhone),
// y con eso un overflow:hidden en <body> ya no pasa a la ventana del navegador: <body> se volvía su propia caja de scroll y
// todo lo "sticky" (el menú lateral del admin y del vendedor, la barra de arriba) se acomodaba a esa caja, saltaba hacia
// arriba y se estiraba mientras la ventana estaba abierta.
let openLocks = 0;
const root = () => document.documentElement;

export function lockPageScroll() {
  openLocks += 1;
  root().style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openLocks = Math.max(0, openLocks - 1);
    if (openLocks === 0) root().style.overflow = "";
  };
}

// Red de seguridad: al cambiar de página no puede haber ventanas abiertas, así que si la página sigue bloqueada se libera.
export function releaseStaleScrollLock() {
  if (openLocks === 0 && root().style.overflow === "hidden") root().style.overflow = "";
  // Por si quedó un bloqueo del método anterior en <body>.
  if (openLocks === 0 && document.body.style.overflow === "hidden") document.body.style.overflow = "";
}
