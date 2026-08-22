import { SQL } from "bun";

import { migrateNotifications } from "../apps/api/src/db/migrations";

const CONTAINER_NAME = "hyper-trader-postgres-local";
const VOLUME_NAME = "hyper-trader-postgres-local-data";
const IMAGE = "docker.io/library/postgres:17-alpine";
const DATABASE = "hyper_trader";
const USER = "hyper_trader";
const PASSWORD = "hyper_trader_local_only";
const PORT = localPort(process.env.HYPER_TRADER_POSTGRES_PORT ?? "5432");
const DATABASE_URL = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`;

const command = process.argv[2];
if (command === "up") {
  await up();
} else if (command === "down") {
  await down();
} else if (command === "status") {
  await status();
} else {
  throw new Error("usage: bun scripts/local-postgres.ts <up|down|status>");
}

async function up(): Promise<void> {
  await requirePodman();
  if (await containerExists()) {
    await assertPublishedPort();
    if (!(await containerRunning())) {
      await run(["podman", "start", CONTAINER_NAME]);
    }
  } else {
    await run([
      "podman",
      "run",
      "--detach",
      "--name",
      CONTAINER_NAME,
      "--label",
      "io.hyper-trader.environment=local",
      "--publish",
      `127.0.0.1:${PORT}:5432`,
      "--env",
      `POSTGRES_DB=${DATABASE}`,
      "--env",
      `POSTGRES_USER=${USER}`,
      "--env",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "--env",
      "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256",
      "--volume",
      `${VOLUME_NAME}:/var/lib/postgresql/data:Z`,
      "--health-cmd",
      `pg_isready --username=${USER} --dbname=${DATABASE}`,
      "--health-interval",
      "2s",
      "--health-timeout",
      "3s",
      "--health-retries",
      "30",
      IMAGE,
    ]);
  }

  await waitUntilReady();
  const sql = new SQL(DATABASE_URL, { max: 2 });
  try {
    await migrateNotifications(sql);
  } finally {
    await sql.close();
  }
  console.log(
    `PostgreSQL is ready on 127.0.0.1:${PORT}; notification and market-catalog migrations are current.`,
  );
}

async function down(): Promise<void> {
  await requirePodman();
  if (!(await containerExists())) {
    console.log("Local PostgreSQL container does not exist.");
    return;
  }
  if (await containerRunning()) {
    await run(["podman", "stop", "--time", "10", CONTAINER_NAME]);
  }
  console.log(
    `Local PostgreSQL is stopped; persistent volume ${VOLUME_NAME} was preserved.`,
  );
}

async function status(): Promise<void> {
  await requirePodman();
  if (!(await containerExists())) {
    console.log("Local PostgreSQL container does not exist.");
    return;
  }
  await assertPublishedPort();
  const state = (
    await output([
      "podman",
      "inspect",
      "--format",
      "{{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
      CONTAINER_NAME,
    ])
  ).trim();
  console.log(`${CONTAINER_NAME}: ${state}`);
}

async function requirePodman(): Promise<void> {
  await run(["podman", "version", "--format", "{{.Client.Version}}"]).catch(
    (error) => {
      throw new Error(
        `Podman is required for local PostgreSQL: ${message(error)}`,
      );
    },
  );
}

async function containerExists(): Promise<boolean> {
  const result = await spawn(["podman", "container", "exists", CONTAINER_NAME]);
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw new Error(
    `Podman could not inspect ${CONTAINER_NAME}: ${result.stderr}`,
  );
}

async function containerRunning(): Promise<boolean> {
  return (
    (
      await output([
        "podman",
        "inspect",
        "--format",
        "{{.State.Running}}",
        CONTAINER_NAME,
      ])
    ).trim() === "true"
  );
}

async function assertPublishedPort(): Promise<void> {
  const published = (
    await output(["podman", "port", CONTAINER_NAME, "5432/tcp"])
  ).trim();
  if (published !== `127.0.0.1:${PORT}`) {
    throw new Error(
      `${CONTAINER_NAME} publishes ${published || "no port"}; expected 127.0.0.1:${PORT}`,
    );
  }
}

async function waitUntilReady(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await spawn([
      "podman",
      "exec",
      CONTAINER_NAME,
      "pg_isready",
      `--username=${USER}`,
      `--dbname=${DATABASE}`,
    ]);
    if (result.exitCode === 0) return;
    await Bun.sleep(500);
  }
  throw new Error(
    `PostgreSQL did not become ready; inspect with podman logs ${CONTAINER_NAME}`,
  );
}

async function run(argv: readonly string[]): Promise<void> {
  const result = await spawn(argv);
  if (result.exitCode !== 0) {
    throw new Error(`${argv.slice(0, 2).join(" ")} failed: ${result.stderr}`);
  }
}

async function output(argv: readonly string[]): Promise<string> {
  const result = await spawn(argv);
  if (result.exitCode !== 0) {
    throw new Error(`${argv.slice(0, 2).join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

async function spawn(argv: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

function localPort(value: string): number {
  if (!/^[1-9][0-9]{0,4}$/.test(value)) {
    throw new Error("HYPER_TRADER_POSTGRES_PORT must be a valid TCP port");
  }
  const port = Number(value);
  if (port > 65_535) {
    throw new Error("HYPER_TRADER_POSTGRES_PORT must be a valid TCP port");
  }
  return port;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
