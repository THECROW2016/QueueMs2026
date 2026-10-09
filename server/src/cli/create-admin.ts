/**
 * Creates (or promotes) the first System Administrator.
 *
 *   npm run create-admin -- --username admin --name "Jane Admin" [--email jane@hospital.org]
 *
 * The password is read from the ADMIN_PASSWORD environment variable if set, otherwise
 * from an interactive prompt (input hidden). It is never taken from a command-line
 * argument, so it does not end up in shell history or process listings.
 */
import readline from 'node:readline';
import { prisma } from '../db.js';
import { seedReferenceData } from '../services/bootstrap.service.js';
import { createUser } from '../services/users.service.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const anyRl = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    process.stdout.write(question);
    anyRl._writeToOutput = () => undefined; // do not echo keystrokes
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const username = arg('username');
  const fullName = arg('name') ?? 'System Administrator';
  const email = arg('email');
  if (!username) throw new Error('Usage: npm run create-admin -- --username <name> [--name "Full Name"] [--email <address>]');

  await seedReferenceData(); // roles must exist
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden('Password (min 10 characters): ');
    const again = await promptHidden('Repeat password: ');
    if (password !== again) throw new Error('Passwords do not match.');
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new Error(`User "${username}" already exists. Use the admin UI to change roles or reset the password.`);

  const user = await createUser({ username, fullName, email, password, roleCodes: ['SYSTEM_ADMIN'], mustChangePassword: false });
  console.log(`Created System Administrator "${user.username}" (id ${user.id}).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
