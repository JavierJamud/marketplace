import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Bloque 271 (pedido explícito — "el menú de los tres puntos se ve por detrás del botón
// del asistente y alarga la página; debe mostrarse en el espacio más amplio: hacia
// abajo si hay lugar, y si no hacia arriba o hacia un lado"): un desplegable anclado a
// un botón que
//  - se dibuja en <body> con position:fixed, así ningún contenedor (overflow, sticky,
//    z-index) lo recorta, tapa o alarga el alto de la página;
//  - se coloca solo: debajo del botón si cabe; si no, arriba; si tampoco, al costado,
//    y si aun así no cabe se acota su alto y se desplaza por dentro;
//  - queda por encima del botón flotante del asistente (z-60) y de su ventana (z-70),
//    pero por debajo de los modales (z-100);
//  - se cierra al tocar afuera, con Escape, y si el botón sale de la pantalla.
const MARGIN = 8;
const GAP = 6;

export function AnchoredPopover({ anchorRef, open, onClose, children, className = "", role = "menu", minWidth = 170 }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;
    const a = anchor.getBoundingClientRect();
    // Si el botón ya salió de la pantalla (la página se desplazó), el menú no tiene a qué anclarse.
    if (a.bottom < 0 || a.top > window.innerHeight || a.right < 0 || a.left > window.innerWidth) {
      onClose?.();
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.max(pop.offsetWidth, minWidth);
    const naturalH = pop.scrollHeight;
    const below = vh - a.bottom - GAP - MARGIN;
    const above = a.top - GAP - MARGIN;

    let top;
    let maxHeight;
    let left = a.right - w; // alineado al borde derecho del botón
    if (naturalH <= below) {
      top = a.bottom + GAP;
    } else if (naturalH <= above) {
      top = a.top - GAP - naturalH;
    } else if (below >= above && below >= 140) {
      top = a.bottom + GAP;
      maxHeight = below;
    } else if (above >= 140) {
      maxHeight = above;
      top = a.top - GAP - above;
    } else {
      // Ni arriba ni abajo hay lugar: al costado del botón, ocupando el alto de la pantalla.
      maxHeight = vh - MARGIN * 2;
      top = Math.max(MARGIN, Math.min(a.top, vh - MARGIN - Math.min(naturalH, maxHeight)));
      left = a.left - GAP - w >= MARGIN ? a.left - GAP - w : a.right + GAP;
    }
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    setPos({ top, left, maxHeight });
  }, [anchorRef, onClose, minWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    place();
    return undefined;
  }, [open, place, children]);

  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    function onDown(e) {
      if (popRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose?.();
    }
    function onKey(e) {
      if (e.key === "Escape") {
        onClose?.();
        anchorRef.current?.focus?.();
      }
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={popRef}
      role={role}
      className={`fixed z-[90] overflow-y-auto ${className}`}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, maxHeight: pos?.maxHeight, minWidth, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body
  );
}
