import { timingSafeEqual } from "node:crypto";

import { sha256Hex } from "./account-proof";

const CREDENTIAL = /^[0-9a-f]{64}$/;
const CREDENTIAL_HASH = /^[0-9a-f]{64}$/;

export async function hashInstallationCredential(
  credential: string,
): Promise<string> {
  if (!CREDENTIAL.test(credential)) {
    throw new Error("installation credential is invalid");
  }
  return sha256Hex(credential);
}

export async function verifyInstallationCredential(
  credential: string,
  expectedHash: string,
): Promise<boolean> {
  if (!CREDENTIAL.test(credential) || !CREDENTIAL_HASH.test(expectedHash)) {
    return false;
  }
  const actualHash = await hashInstallationCredential(credential);
  return timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}
