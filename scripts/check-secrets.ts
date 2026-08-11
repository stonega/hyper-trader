import { lstat } from "node:fs/promises";

const MAX_SCANNED_FILE_BYTES = 2 * 1024 * 1024;

const forbiddenFile =
  /(?:^|\/)(?:\.env(?:\.(?!example$|sample$)[^/]*)?|google-services\.json|GoogleService-Info\.plist|[^/]+\.(?:pem|p12|pfx|jks|keystore|mobileprovision))$/iu;

export function isForbiddenSecretPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return forbiddenFile.test(normalized);
}

export function findSecretSignals(source: string): string[] {
  const findings = new Set<string>();
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(source)) {
    findings.add("private-key-block");
  }
  if (
    /\b(?:sk_live_|rk_live_|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b/u.test(
      source,
    )
  ) {
    findings.add("credential-token-prefix");
  }
  if (/\bAKIA[0-9A-Z]{16}\b/u.test(source)) {
    findings.add("aws-access-key");
  }

  const assignedHexValue =
    /\b([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*["'`](?:0x)?([0-9a-fA-F]{64})["'`]/gu;
  for (const match of source.matchAll(assignedHexValue)) {
    const identifier = match[1] ?? "";
    const normalizedIdentifier = identifier
      .replaceAll("_", "")
      .replaceAll("-", "")
      .toLowerCase();
    const isPrivateKeyIdentifier = ["privatekey", "apiwalletkey"].some(
      (privateKeyName) =>
        normalizedIdentifier === privateKeyName ||
        normalizedIdentifier.endsWith(privateKeyName),
    );
    if (!isPrivateKeyIdentifier) continue;

    const value = match[2] ?? "";
    if (new Set(value.toLowerCase()).size >= 4) {
      findings.add("assigned-private-key");
    }
  }

  const mnemonic =
    /\b(?:mnemonic|seedPhrase|seed_phrase)\s*[:=]\s*["'`]([a-z]+(?:\s+[a-z]+){11,23})["'`]/giu;
  if (mnemonic.test(source)) findings.add("assigned-seed-phrase");

  const pushToken = /\b(?:Expo|Exponent)PushToken\[([A-Za-z0-9_-]{20,})\]/gu;
  for (const match of source.matchAll(pushToken)) {
    const token = match[1] ?? "";
    if (/[a-z]/u.test(token) && /[A-Z]/u.test(token) && /[0-9]/u.test(token)) {
      findings.add("likely-live-push-token");
    }
  }
  return [...findings].sort();
}

function repositoryFiles(): string[] {
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error("git could not enumerate the repository secret-scan scope");
  }
  return new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((path) => path !== "");
}

async function run(): Promise<void> {
  const violations: string[] = [];
  const files = repositoryFiles();
  for (const path of files) {
    if (isForbiddenSecretPath(path)) {
      violations.push(`${path}: forbidden credential file`);
      continue;
    }
    const fileStat = await lstat(path).catch(() => null);
    if (fileStat === null || !fileStat.isFile()) continue;
    const file = Bun.file(path);
    if (file.size > MAX_SCANNED_FILE_BYTES) continue;
    let source: string;
    try {
      source = await file.text();
    } catch {
      continue;
    }
    if (source.includes("\0")) continue;
    for (const signal of findSecretSignals(source)) {
      violations.push(`${path}: ${signal}`);
    }
  }
  if (violations.length > 0) {
    console.error(
      "Secret boundary scan failed (contents are intentionally hidden):",
    );
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Secret boundary scan passed for ${files.length} tracked and unignored files.`,
  );
}

if (import.meta.main) await run();
