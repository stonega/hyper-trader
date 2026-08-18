import {
  assertTestnetSigningCapability,
  type Eip712Payload,
  type Eip712Signature,
  normalizeSignerBinding,
} from "@hyper-trader/hyperliquid";
import { type PrivateKeyAccount, parseSignature, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type {
  DestroyableAgentSigner,
  ProtectedAgentSecret,
} from "../../core/session/manager";
import { isValidSecp256k1Secret } from "./secret-material";

export async function deriveAgentAddress(secret: Uint8Array): Promise<string> {
  if (!isValidSecp256k1Secret(secret)) {
    throw new TypeError("The staged agent scalar is invalid.");
  }
  return privateKeyToAccount(toHex(secret)).address.toLowerCase();
}

export async function expoCryptographicRandomBytes(
  length: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(length) || length < 1 || length > 1_024) {
    throw new TypeError("The random byte request is out of bounds.");
  }
  const crypto = await import("expo-crypto");
  return crypto.getRandomBytesAsync(length);
}

function protocolSignature(value: `0x${string}`): Eip712Signature {
  const parsed = parseSignature(value);
  const v =
    parsed.v === undefined
      ? parsed.yParity === 0
        ? 27
        : 28
      : Number(parsed.v);
  if (v !== 27 && v !== 28) {
    throw new Error("The device signer returned an invalid recovery value.");
  }
  return { r: parsed.r, s: parsed.s, v };
}

export async function createAgentSigner(
  secret: ProtectedAgentSecret,
): Promise<DestroyableAgentSigner> {
  assertTestnetSigningCapability(secret.binding.network);
  if (!isValidSecp256k1Secret(secret.bytes)) {
    throw new TypeError("The protected agent scalar is invalid.");
  }
  const binding = normalizeSignerBinding(secret.binding);
  let account: PrivateKeyAccount | null = privateKeyToAccount(
    toHex(secret.bytes),
  );
  if (account.address.toLowerCase() !== binding.agentAddress) {
    account = null;
    throw new Error("The protected scalar does not derive the bound agent.");
  }
  return {
    binding,
    async signTypedData(payload: Eip712Payload) {
      if (account === null)
        throw new Error("The signer session was destroyed.");
      const signature = await account.signTypedData({
        domain: payload.domain,
        types: payload.types,
        primaryType: payload.primaryType,
        message: payload.message,
      });
      return protocolSignature(signature);
    },
    destroy() {
      account = null;
    },
  };
}
