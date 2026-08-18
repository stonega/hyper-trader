export const LOWERCASE_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
export const JOURNAL_ID_PATTERN = /^jrnl_[0-9a-f]{32}$/;
export const CORRELATION_ID_PATTERN = /^act_[0-9a-f]{32}$/;
export const LOWERCASE_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

export function assertTime(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
}
