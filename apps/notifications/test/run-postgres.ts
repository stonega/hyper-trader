import { SQL } from "bun";

const repositoryRoot = new URL("../../../", import.meta.url).pathname;
const integrationTest =
  "apps/notifications/src/db/postgres.integration.test.ts";
const suppliedDatabaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;

if (suppliedDatabaseUrl) {
  process.exit(await runIntegration(suppliedDatabaseUrl));
}

const containerName = `hyper-trader-notification-test-${process.pid}`;
if (!/^hyper-trader-notification-test-[1-9][0-9]*$/.test(containerName)) {
  throw new Error(
    "refusing to use an invalid notification test container name",
  );
}

await requireSuccessful([
  "docker",
  "version",
  "--format",
  "{{.Server.Version}}",
]);
let started = false;
try {
  await requireSuccessful([
    "docker",
    "run",
    "--rm",
    "--detach",
    "--name",
    containerName,
    "--env",
    "POSTGRES_USER=hyper_trader_test",
    "--env",
    "POSTGRES_PASSWORD=hyper_trader_test",
    "--env",
    "POSTGRES_DB=hyper_trader_test",
    "--publish",
    "127.0.0.1::5432",
    "postgres:17-alpine",
  ]);
  started = true;
  const portOutput = await requireSuccessful([
    "docker",
    "port",
    containerName,
    "5432/tcp",
  ]);
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/m.exec(portOutput.trim());
  if (!match?.[1] || Number(match[1]) > 65_535) {
    throw new Error("Docker returned an invalid PostgreSQL test port");
  }
  const databaseUrl =
    `postgres://hyper_trader_test:hyper_trader_test@127.0.0.1:${match[1]}` +
    "/hyper_trader_test";
  await waitUntilReady(containerName, databaseUrl);
  process.exitCode = await runIntegration(databaseUrl);
} finally {
  if (started) {
    await requireSuccessful(["docker", "stop", "--time", "2", containerName]);
  }
}

async function runIntegration(databaseUrl: string): Promise<number> {
  const child = Bun.spawn(
    ["bun", "test", "--timeout", "30000", integrationTest],
    {
      cwd: repositoryRoot,
      env: { ...process.env, NOTIFICATION_TEST_DATABASE_URL: databaseUrl },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return child.exited;
}

async function waitUntilReady(
  name: string,
  databaseUrl: string,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const child = Bun.spawn(
      [
        "docker",
        "exec",
        name,
        "pg_isready",
        "--username",
        "hyper_trader_test",
        "--dbname",
        "hyper_trader_test",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    if ((await child.exited) === 0 && (await acceptsSql(databaseUrl))) return;
    await Bun.sleep(250);
  }
  throw new Error(
    "PostgreSQL test container did not become ready within 20 seconds",
  );
}

async function acceptsSql(databaseUrl: string): Promise<boolean> {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const rows = await sql<{ ready: number }[]>`SELECT 1::int AS ready`;
    return rows[0]?.ready === 1;
  } catch {
    return false;
  } finally {
    await sql.close().catch(() => undefined);
  }
}

async function requireSuccessful(command: readonly string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command[0]} ${command[1] ?? ""} failed: ${stderr.trim() || "unknown error"}`,
    );
  }
  return stdout;
}
