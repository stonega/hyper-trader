import * as Crypto from "expo-crypto";

export async function randomNotificationHex(bytes: 16 | 32): Promise<string> {
  return [...(await Crypto.getRandomBytesAsync(bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
