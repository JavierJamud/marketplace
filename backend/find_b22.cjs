const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const vendors = await prisma.vendor.findMany({
    where: { companyName: { contains: 'B22', mode: 'insensitive' } },
    include: { user: true }
  });
  console.log(JSON.stringify(vendors.map(v => ({ company: v.companyName, email: v.user.email, id: v.id })), null, 2));
}

main().finally(() => prisma.$disconnect());
