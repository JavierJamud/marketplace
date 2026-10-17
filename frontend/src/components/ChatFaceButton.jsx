// Bloque 48: botón flotante de 3 estados (cerrado = 3 puntos en fila,
// hover = sonrisa ancha relajada, abierto = sonrisa asimétrica rotada) —
// reemplaza el ícono Bot() del Bloque 47 en ambos widgets (bot de tienda y
// bot general). El CSS real vive en index.css (.chat-face-btn y afines);
// acá solo se arma el HTML/clase condicional, igual en los dos widgets, así
// que se comparte como un solo componente en vez de duplicar el marcado.
// animate-fade-up (pedido explícito): misma animación de entrada que ya usa
// la burbuja de notificación de al lado (ver MarketplaceChatWidget.jsx/
// StoreChatWidget.jsx), para que los dos elementos combinen al aparecer.
// `unread`: mensajes del bot que llegaron con el chat cerrado (ver lib/useChatUnread.js); se muestran en un círculo rojo.
export function ChatFaceButton({ isOpen, onClick, ariaLabel, className = "", unread = 0 }) {
  const label = unread > 0 ? `${ariaLabel} (${unread} ${unread === 1 ? "mensaje sin leer" : "mensajes sin leer"})` : ariaLabel;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`chat-face-btn animate-fade-up ${isOpen ? "active" : ""} ${className}`}
    >
      <div>
        <div className="chat-face-left-eye" />
        <div className="chat-face-mouth" />
        <div className="chat-face-right-eye" />
      </div>
      {unread > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white animate-fade-up">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
