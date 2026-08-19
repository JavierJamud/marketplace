export function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for HTTP environments (like testing on local network via mobile)
  // where crypto.randomUUID is not available because it requires HTTPS.
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
