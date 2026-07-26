// Receta estándar de react-easy-crop (docs oficiales) adaptada a Promise +
// Blob: recorta `imageSrc` según `pixelCrop` (el objeto que entrega
// onCropComplete) usando un canvas, sin depender de ninguna librería extra.
// Bug real (Bloque 52): con crossOrigin="anonymous" seteado ANTES del src, el
// recorte final salía sólido negro para imágenes locales — el blob: URL que
// genera esta pantalla (URL.createObjectURL sobre un archivo elegido por el
// usuario) es siempre mismo-origen, nunca necesita CORS, y ese atributo
// alcanzaba a correr una carrera con la decodificación real del bitmap en
// Chromium. Sacarlo no tiene contra — este helper nunca carga una URL remota.
function createImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", reject);
    img.src = src;
  });
}

export async function getCroppedImageBlob(imageSrc, pixelCrop, mimeType = "image/jpeg") {
  const image = await createImage(imageSrc);
  // Si el bitmap no llegó a decodificar (0×0), seguir de largo generaba un
  // canvas vacío que toBlob() rellenaba de negro sólido (JPEG no soporta
  // transparencia) — mejor fallar fuerte acá que subir una foto rota.
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("La imagen no terminó de cargar. Intenta de nuevo.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen recortada."))),
      mimeType,
      0.92
    );
  });
}
