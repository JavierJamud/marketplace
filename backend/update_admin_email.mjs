import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const existing = await prisma.user.findUnique({ where: { email: "admin@zeudin.cu" } });
if (!existing) {
  console.log("NOT_FOUND: no user with email admin@zeudin.cu");
  process.exit(1);
}
if (existing.role !== "ADMIN") {
  console.log("WARNING: found user but role is", existing.role, "not ADMIN — aborting to be safe");
  process.exit(1);
}

const conflict = await prisma.user.findUnique({ where: { email: "admin@zeudin.com" } });
if (conflict) {
  console.log("CONFLICT: admin@zeudin.com already in use by another account", conflict.id);
  process.exit(1);
}

const updated = await prisma.user.update({ where: { id: existing.id }, data: { email: "admin@zeudin.com" } });
console.log("Updated OK:", { id: updated.id, email: updated.email, role: updated.role });
