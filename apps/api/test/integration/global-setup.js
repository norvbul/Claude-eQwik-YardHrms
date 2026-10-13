// Empties the isolated test database (all tables dropped) and applies all migrations.
// Never touches DATABASE_URL. Prisma creates the database on deploy if it does not exist.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async () => {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl || !/test/i.test(new URL(testUrl).pathname)) throw new Error('TEST_DATABASE_URL must be set and its database name must contain "test"');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    // One pinned connection: FOREIGN_KEY_CHECKS is a session setting.
    await prisma.$transaction(
      async (tx) => {
        const tables = await tx.$queryRawUnsafe('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
        for (const row of tables) await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS \`${String(row.t ?? row.T ?? row.TABLE_NAME).replace(/`/g, '')}\``);
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
      },
      { timeout: 120000 },
    );
  } catch (e) {
    if (!/does not exist|P1003|Unknown database/i.test(String(e?.message ?? e))) throw e;
  } finally {
    await prisma.$disconnect();
  }
  const root = path.resolve(__dirname, '../../../..');
  execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', path.join(root, 'prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
};
