const SECP256K1_ORDER = Uint8Array.from([
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xfe, 0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2,
  0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
]);

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function isValidSecp256k1Secret(bytes: Uint8Array): boolean {
  if (bytes.length !== 32 || bytes.every((value) => value === 0)) return false;
  return compareBytes(bytes, SECP256K1_ORDER) < 0;
}
