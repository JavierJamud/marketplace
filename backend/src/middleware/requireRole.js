import { AppError } from "../utils/AppError.js";

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError("No tienes permiso para esta acción.", 403);
    }
    next();
  };
}
