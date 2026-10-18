-- Las acciones del admin sobre una tienda se registraban con actorRole "ADMIN", que no existía: el registro fallaba en silencio.
ALTER TYPE "ActivityActorRole" ADD VALUE 'ADMIN';
