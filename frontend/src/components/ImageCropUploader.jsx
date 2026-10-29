import { useEffect, useState } from "react";
import Cropper from "react-easy-crop";
import toast from "../lib/toast.jsx";
import { ImagePlus, ZoomIn } from "lucide-react";
import { Button } from "./ui/Button.jsx";
import { getCroppedImageBlob } from "../utils/cropImage.js";

// Bloque 51: subir imagen desde el dispositivo + recorte/ajuste antes de
// guardar, con una guía del tamaño recomendado — pedido explícito tanto para
// ofertas personalizadas como (Bloque 51 parte 4) para imágenes de producto.
// Reusable: el padre decide el aspect ratio (vertical/horizontal) y qué
// hacer con el Blob final (agregarlo a un FormData, mostrarlo, etc.).
export function ImageCropUploader({
  value,
  aspect,
  recommendedLabel,
  onFileReady,
  accept = "image/png,image/jpeg,image/webp",
  boxClassName = "aspect-[7/4] w-full max-w-[280px]",
  compact = false,
  // Para botones de "agregar otra foto": después de subir, el cuadro vuelve a ser el botón y no muestra la última foto.
  clearOnConfirm = false,
}) {
  const [rawSrc, setRawSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  // Zoom con el que la foto entera cabe dentro del marco (se calcula al cargar la foto y al conocer el tamaño del marco).
  const [media, setMedia] = useState(null);
  // Marco fijo con la proporción real de la tarjeta: lo que se ve dentro es lo que se guarda. coverZoom llena el marco;
  // fitZoom deja ver la foto entera (con margen blanco si no tiene la misma proporción).
  // El marco no puede ser más ancho que la pantalla (menos los márgenes del diálogo), si no se corta en celulares chicos.
  const FRAME_W = Math.min(340, (typeof window !== "undefined" ? window.innerWidth : 400) - 72);
  const cropSize = { width: FRAME_W, height: Math.round(FRAME_W / aspect) };
  const coverZoom = media ? Math.max(cropSize.width / media.width, cropSize.height / media.height) : 1;
  const fitZoom = media ? Math.min(cropSize.width / media.width, cropSize.height / media.height) : 1;
  const minZoom = Math.min(fitZoom, coverZoom);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [preview, setPreview] = useState(null);
  // Bug real (Bloque 52): confirmar el recorte antes de que react-easy-crop
  // termine de decodificar la imagen producía un archivo sólido negro (ver
  // cropImage.js) — este flag, seteado por Cropper.onMediaLoaded, bloquea el
  // botón hasta que el bitmap real esté listo.
  const [mediaReady, setMediaReady] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Si cambia la orientación (aspect) mientras hay una foto cruda sin
  // confirmar, reiniciar el recorte — si no, el crop viejo queda desalineado
  // con el nuevo marco.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, [aspect]);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRawSrc(URL.createObjectURL(file));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setMediaReady(false);
    setMedia(null);
    setCroppedAreaPixels(null);
    e.target.value = "";
  }

  async function confirmCrop() {
    if (!rawSrc || !croppedAreaPixels || !mediaReady) return;
    setConfirming(true);
    try {
      const blob = await getCroppedImageBlob(rawSrc, croppedAreaPixels);
      if (!clearOnConfirm) setPreview(URL.createObjectURL(blob));
      onFileReady(blob);
      setRawSrc(null);
    } catch {
      toast.error("No se pudo procesar la imagen. Intenta de nuevo.");
    } finally {
      setConfirming(false);
    }
  }

  const displaySrc = preview ?? value;

  return (
    <div>
      {recommendedLabel && <p className="mb-1.5 text-[11.5px] text-outline">{recommendedLabel}</p>}
      <label
        className={`relative flex cursor-pointer items-center justify-center overflow-hidden border-dashed border-outline-variant bg-surface-container ${
          compact ? "rounded-md border" : "rounded-xl border"
        } ${boxClassName}`}
      >
        {displaySrc ? (
          <img src={displaySrc} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className={`flex flex-col items-center text-outline ${compact ? "gap-0.5" : "gap-1.5"}`}>
            <ImagePlus className={compact ? "h-4 w-4" : "h-6 w-6"} />
            {!compact && <span className="text-[12px] font-semibold">Subir imagen</span>}
          </span>
        )}
        {displaySrc && !compact && (
          <span className="absolute inset-x-0 bottom-0 bg-inverse-surface/60 py-1 text-center text-[11px] font-semibold text-white">
            Cambiar imagen
          </span>
        )}
        <input type="file" accept={accept} onChange={handleFile} className="hidden" />
      </label>

      {rawSrc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-inverse-surface/50 p-4">
          <div className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-surface-container-lowest p-5 max-h-[calc(100dvh-2rem)]">
            <h4 className="mb-1 text-title-md text-on-surface">Acomoda tu foto</h4>
            <p className="mb-3 text-[12px] text-outline">El marco es exactamente lo que se verá en la tarjeta del producto. Arrastra la foto para moverla y usa el control para acercarla o alejarla.</p>
            <div className="relative h-[280px] w-full overflow-hidden rounded-lg bg-black">
              <Cropper
                image={rawSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, areaPixels) => setCroppedAreaPixels(areaPixels)}
                cropSize={cropSize}
                onMediaLoaded={(m) => {
                  setMedia(m);
                  setZoom(Math.max(cropSize.width / m.width, cropSize.height / m.height));
                  setMediaReady(true);
                }}
                minZoom={minZoom}
                maxZoom={Math.max(3, coverZoom * 3)}
                restrictPosition={zoom >= coverZoom - 0.001}
                showGrid={false}
              />
              {!mediaReady && (
                <div className="absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-white/70">
                  Cargando imagen...
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <ZoomIn className="h-4 w-4 flex-shrink-0 text-outline" />
              <input
                type="range"
                min={minZoom}
                max={Math.max(3, coverZoom * 3)}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setCrop({ x: 0, y: 0 }); setZoom(coverZoom); }} className="min-h-11 rounded-lg border border-outline-variant text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container">
                Llenar el marco
              </button>
              <button type="button" onClick={() => { setCrop({ x: 0, y: 0 }); setZoom(fitZoom); }} disabled={fitZoom >= coverZoom - 0.001} className="min-h-11 rounded-lg border border-outline-variant text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-40">
                Ver la foto completa
              </button>
            </div>
            <div className="mt-4 flex gap-2.5">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setRawSrc(null)} disabled={confirming}>
                Cancelar
              </Button>
              <Button type="button" className="flex-1" onClick={confirmCrop} disabled={!mediaReady || !croppedAreaPixels || confirming}>
                {confirming ? "Procesando..." : "Usar esta imagen"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
