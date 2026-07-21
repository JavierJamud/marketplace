export class AppError extends Error {
  // details: payload estructurado opcional (ej. qué productos superan el
  // stock disponible) para que el frontend pueda reaccionar sin parsear el
  // mensaje de texto.
  constructor(message, statusCode = 400, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}
