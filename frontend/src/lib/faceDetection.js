// Detección de rostro para la selfie de verificación, en cualquier navegador.
// Chrome y Edge traen un detector propio (FaceDetector); Firefox y Safari no. En esos se usa MediaPipe (de Google), que corre
// dentro del propio navegador: el video nunca sale del teléfono o la computadora. Sus archivos (unos 13 MB, solo se bajan al
// abrir la cámara de la selfie) se sirven desde baznova.com (/mediapipe) y el modelo (230 KB) desde /blaze_face_short_range.tflite.
//
// Los dos devuelven lo mismo: una lista de rostros con boundingBox {x, y, width, height} en píxeles del video.

export function faceDetectionSupported() {
  return typeof window !== "undefined" && ("FaceDetector" in window || typeof WebAssembly === "object");
}

let mediapipePromise = null;

async function createMediapipeDetector() {
  const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/blaze_face_short_range.tflite" },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.55,
  });
  let lastTs = 0;
  return {
    async detect(video) {
      // MediaPipe pide marcas de tiempo siempre crecientes.
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      const result = detector.detectForVideo(video, ts);
      return (result?.detections ?? [])
        .filter((d) => d.boundingBox)
        .map((d) => ({ boundingBox: { x: d.boundingBox.originX, y: d.boundingBox.originY, width: d.boundingBox.width, height: d.boundingBox.height } }));
    },
  };
}

export async function createFaceDetector() {
  if (typeof window !== "undefined" && "FaceDetector" in window) {
    try {
      return new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    } catch {
      // Si el detector nativo falla al crearse, se usa MediaPipe.
    }
  }
  mediapipePromise ??= createMediapipeDetector().catch((err) => {
    mediapipePromise = null;
    throw err;
  });
  return mediapipePromise;
}
