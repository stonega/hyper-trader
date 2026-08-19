import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const flowDirectory = join(import.meta.dir, "../apps/mobile/e2e/flows");
const requiredJourneys = {
  "account-switch.yaml": ["AE1", "account-switch"],
  "market-search.yaml": ["AE2", "market-search"],
  "notification-context-entry.yaml": ["AE8", "notification-context-entry"],
  "portfolio-close.yaml": ["AE7", "portfolio-close"],
  "read-only-launch.yaml": ["AE4", "read-only-launch"],
  "rotation.yaml": ["AE11", "rotation"],
  "setup-interruption.yaml": ["AE10", "setup-interruption"],
  "testnet-order-review.yaml": ["AE14", "testnet-order-review"],
  "unknown-result-recovery.yaml": ["AE6", "unknown-result-recovery"],
} as const;

const failures: string[] = [];
const files = (await readdir(flowDirectory))
  .filter((path) => path.endsWith(".yaml"))
  .sort();
const expected = Object.keys(requiredJourneys).sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  failures.push(
    `journey set mismatch\nexpected: ${expected.join(", ")}\nreceived: ${files.join(", ")}`,
  );
}

for (const [file, [acceptance, fixture]] of Object.entries(requiredJourneys)) {
  const source = await readFile(join(flowDirectory, file), "utf8");
  const requiredTokens = [
    "appId: $" + "{APP_ID}",
    "tags:",
    "fixture",
    `# acceptance: ${acceptance}`,
    `HT_E2E_FIXTURE: ${fixture}`,
    "- launchApp:",
    "- assertVisible:",
  ];
  for (const token of requiredTokens) {
    if (!source.includes(token)) failures.push(`${file}: missing ${token}`);
  }
  if (/tapOn:\s*["']?(?:Confirm testnet action|Submit)/u.test(source)) {
    failures.push(
      `${file}: fixture journeys may reach review but must not submit an exchange action`,
    );
  }
}

if (failures.length > 0) {
  console.error("Mobile fixture journey contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Validated ${expected.length} deterministic Maestro fixture contracts.`,
);
console.log(
  "Static validation only; no simulator, device, release build, or provider was contacted.",
);
console.log(
  "Run bun run test:e2e:mobile:device with the documented acknowledgement and controlled fixture build for device evidence.",
);
