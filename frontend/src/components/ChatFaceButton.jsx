import { NovaFace } from "./NovaFace.jsx";

// Botón flotante de los dos chats con IA de la web pública (bot general y bot de tienda), compartido para no duplicar
// el marcado. Es la cara de Nova (NovaFace.jsx), la misma del asistente de los paneles: con el chat abierto pone los
// ojos felices y en escritorio también al pasar el cursor. El CSS vive en index.css (.chat-face-btn y .nova-face).
// animate-fade-up: misma entrada que la burbuja de notificación de al lado, para que combinen al aparecer.
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
      <NovaFace happy={isOpen} className="h-full w-full" />
      {unread > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white animate-fade-up">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
