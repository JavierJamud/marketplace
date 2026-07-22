// Bloque 48: botón flotante de 3 estados (cerrado = 3 puntos en fila,
// hover = sonrisa ancha relajada, abierto = sonrisa asimétrica rotada) —
// reemplaza el ícono Bot() del Bloque 47 en ambos widgets (bot de tienda y
// bot general). El CSS real vive en index.css (.chat-face-btn y afines);
// acá solo se arma el HTML/clase condicional, igual en los dos widgets, así
// que se comparte como un solo componente en vez de duplicar el marcado.
// animate-fade-up (pedido explícito): misma animación de entrada que ya usa
// la burbuja de notificación de al lado (ver MarketplaceChatWidget.jsx/
// StoreChatWidget.jsx), para que los dos elementos combinen al aparecer.
export function ChatFaceButton({ isOpen, onClick, ariaLabel, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`chat-face-btn animate-fade-up ${isOpen ? "active" : ""} ${className}`}
    >
      <div>
        <div className="chat-face-left-eye" />
        <div className="chat-face-mouth" />
        <div className="chat-face-right-eye" />
      </div>
    </button>
  );
}
