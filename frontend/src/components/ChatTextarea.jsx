import { useLayoutEffect, useRef } from "react";

// Campo de escritura de los chats: crece con el texto hasta unas 5 líneas (después se desplaza por dentro), así se ve todo lo
// que se escribió o pegó antes de enviarlo. Enter envía; Mayús + Enter hace un salto de línea.
const MAX_HEIGHT_PX = 120;

export function ChatTextarea({ value, onChange, onSend, placeholder, disabled }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSend();
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={placeholder}
      enterKeyHint="send"
      className="block min-h-10 flex-1 resize-none overflow-hidden rounded-[20px] border border-outline-variant bg-surface-container-lowest px-4 py-[9px] text-[13px] leading-5 outline-none focus-visible:border-tertiary-accent disabled:opacity-60"
    />
  );
}
