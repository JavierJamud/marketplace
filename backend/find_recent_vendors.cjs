const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const vendors = await prisma.vendor.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { user: true }
  });
  console.log(JSON.stringify(vendors.map(v => ({ company: v.companyName, slug: v.slug, email: v.user?.email, passwordHash: v.user?.passwordHash })), null, 2));
}

main().finally(() => prisma.$disconnect());
