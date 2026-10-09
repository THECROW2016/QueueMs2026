import { prisma } from '../src/db.js';
import { seedReferenceData } from '../src/services/bootstrap.service.js';
import { createUser } from '../src/services/users.service.js';
import { DEPARTMENTS } from '../src/domain/constants.js';

/**
 * Seeds permissions, roles, the seven departments, counters, routing rules and default
 * settings. Safe to run repeatedly.
 *
 * Demo staff accounts (synthetic, for local development only) are created only when
 * SEED_DEMO_USERS=1 and NODE_ENV is not "production". The shared demo password comes
 * from DEMO_PASSWORD; it is never hardcoded.
 */
async function main() {
  await seedReferenceData();
  console.log('Seeded roles, permissions, departments, counters, routing rules and settings.');

  if (process.env.SEED_DEMO_USERS === '1') {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to create demo users in production.');
    const password = process.env.DEMO_PASSWORD;
    if (!password || password.length < 10) throw new Error('Set DEMO_PASSWORD (10+ characters) to create demo users.');
    const depts = await prisma.department.findMany();
    for (const d of DEPARTMENTS) {
      const username = d.code.toLowerCase();
      if (await prisma.user.findUnique({ where: { username } })) continue;
      const dept = depts.find((x) => x.code === d.code)!;
      await createUser({
        username, fullName: `${d.name} (demo)`, password, roleCodes: [d.code], departmentIds: [dept.id],
      });
      console.log(`Created demo user "${username}"`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
