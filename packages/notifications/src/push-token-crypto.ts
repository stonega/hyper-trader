import { sha256Hex } from "./account-proof";

export interface PushTokenKeyProvider {
  activeKeyVersion(): string;
  wrapKey(version: string, plaintextKey: Uint8Array): Promise<Uint8Array>;
  unwrapKey(version: string, wrappedKey: Uint8Array): Promise<Uint8Array>;
}

export interface EncryptedPushToken {
  readonly installationId: string;
  readonly provider: "expo";
  readonly tokenFingerprint: string;
  readonly ciphertext: string;
  readonly nonce: string;
  readonly keyVersion: string;
  readonly wrappedDek: string;
}

export class PushTokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushTokenCryptoError";
  }
}

export async function encryptPushToken(
  input: {
    readonly installationId: string;
    readonly provider: "expo";
    readonly token: string;
  },
  keyProvider: PushTokenKeyProvider,
): Promise<EncryptedPushToken> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  if (nonce.byteLength !== 12) {
    throw new PushTokenCryptoError("AES-GCM nonce must be 96 bits");
  }
  const tokenFingerprint = await sha256Hex(input.token);
  const keyVersion = keyProvider.activeKeyVersion();
  if (dataKey.byteLength !== 32) {
    throw new PushTokenCryptoError("push token data key must be 256 bits");
  }
  const keyBytes = dataKey.slice();
  try {
    const wrappedDek = await keyProvider.wrapKey(keyVersion, keyBytes);
    if (wrappedDek.byteLength < 16 || wrappedDek.byteLength > 4096) {
      throw new PushTokenCryptoError("wrapped push token key is invalid");
    }
    const key = await importAesKey(keyBytes);
    const aad = cryptoBytes(
      tokenAad(input.installationId, input.provider, tokenFingerprint),
    );
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: cryptoBytes(nonce),
        additionalData: aad,
        tagLength: 128,
      },
      key,
      new TextEncoder().encode(input.token),
    );
    return {
      installationId: input.installationId,
      provider: input.provider,
      tokenFingerprint,
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      nonce: Buffer.from(nonce).toString("hex"),
      keyVersion,
      wrappedDek: Buffer.from(wrappedDek).toString("base64"),
    };
  } finally {
    keyBytes.fill(0);
  }
}

export async function decryptPushToken(
  input: EncryptedPushToken,
  keyProvider: PushTokenKeyProvider,
): Promise<string> {
  let keyBytes: Uint8Array;
  try {
    keyBytes = await keyProvider.unwrapKey(
      input.keyVersion,
      Buffer.from(input.wrappedDek, "base64"),
    );
  } catch {
    throw new PushTokenCryptoError("push token key unwrap failed");
  }
  try {
    const key = await importAesKey(keyBytes);
    const aad = tokenAad(
      input.installationId,
      input.provider,
      input.tokenFingerprint,
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: cryptoBytes(Buffer.from(input.nonce, "hex")),
        additionalData: cryptoBytes(aad),
        tagLength: 128,
      },
      key,
      cryptoBytes(Buffer.from(input.ciphertext, "base64")),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch (error) {
    if (error instanceof PushTokenCryptoError) throw error;
    throw new PushTokenCryptoError("push token authentication failed");
  } finally {
    keyBytes.fill(0);
  }
}

export async function reencryptPushToken(
  input: EncryptedPushToken,
  keyProvider: PushTokenKeyProvider,
): Promise<EncryptedPushToken> {
  const token = await decryptPushToken(input, keyProvider);
  const rotated = await encryptPushToken(
    {
      installationId: input.installationId,
      provider: input.provider,
      token,
    },
    keyProvider,
  );
  if (rotated.tokenFingerprint !== input.tokenFingerprint) {
    throw new PushTokenCryptoError(
      "push token fingerprint changed during rotation",
    );
  }
  return rotated;
}

function tokenAad(
  installationId: string,
  provider: "expo",
  fingerprint: string,
): Uint8Array {
  return new TextEncoder().encode(
    `push-token/v1|${installationId}|${provider}|${fingerprint}`,
  );
}

async function importAesKey(bytes: Uint8Array): Promise<CryptoKey> {
  if (bytes.byteLength !== 32) {
    throw new PushTokenCryptoError("push token key must be 256 bits");
  }
  return crypto.subtle.importKey("raw", cryptoBytes(bytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function cryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}
