// Reduce una foto en el propio navegador antes de subirla: la baja al ancho máximo que se va a mostrar y la guarda en WebP (o JPEG
// si el navegador no sabe hacer WebP). Una foto de teléfono de 4 a 8 MB queda en unos 100 a 250 KB, así sube rápido aunque la
// conexión sea lenta y el servidor recibe menos datos. El servidor la vuelve a procesar (miniatura incluida), esto solo evita
// enviarle de más.
//
// Nunca bloquea la subida: si algo falla, o si el resultado no es más liviano que el original, devuelve el archivo tal cual.
// El nombre del archivo lleva la extensión que el servidor acepta (.webp o .jpg).
const loadBitmap = async (blob) => {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      /* navegador sin esa opción: se usa <img>, que también respeta la orientación */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function compressImage(file, { maxWidth = 1400, quality = 0.82 } = {}) {
  try {
    const bitmap = await loadBitmap(file);
    const srcW = bitmap.width || bitmap.naturalWidth;
    const srcH = bitmap.height || bitmap.naturalHeight;
    if (!srcW || !srcH) return file;
    const scale = Math.min(1, maxWidth / srcW);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));
    const ctx = canvas.getContext("2d");
    // Fondo blanco: un JPEG no tiene transparencia y sin esto lo transparente saldría negro.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality); // Safari antiguo no genera WebP
    if (!blob || blob.size >= file.size) return file;
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const base = (file.name || "foto").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.${ext}`, { type: blob.type });
  } catch {
    return file;
  }
}
