export type DeletionScopeKind = "installation" | "account_link" | "push_token";

export interface DeletionTombstoneInput {
  readonly deletionId: string;
  readonly scopeKind: DeletionScopeKind;
  readonly scopeIdentifier: string;
  readonly deletionGeneration: number;
  readonly deletedAt: number;
}

export interface DeletionTombstoneItem {
  readonly sequence: number;
  readonly deletionId: string;
  readonly scopeKind: DeletionScopeKind;
  readonly scopeMac: string;
  readonly deletionGeneration: number;
  readonly deletedAt: number;
  readonly keyVersion: string;
  readonly mac: string;
}

export interface DeletionLedgerReceipt {
  readonly sequence: number;
  readonly durableHead: number;
  readonly deletionId: string;
}

export interface DeletionLedgerPort {
  append(
    deletionId: string,
    seal: (sequence: number) => Promise<DeletionTombstoneItem>,
  ): Promise<{
    readonly item: DeletionTombstoneItem;
    readonly receipt: DeletionLedgerReceipt;
  }>;
  currentHead(): Promise<number>;
  readRange(
    afterSequence: number,
    throughSequence: number,
  ): Promise<DeletionTombstoneItem[]>;
}

export interface TombstoneKeyProvider {
  mac(keyVersion: string, bytes: Uint8Array): Promise<string>;
  verify(keyVersion: string, bytes: Uint8Array, mac: string): Promise<boolean>;
}

export class TombstoneRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TombstoneRecoveryError";
  }
}

export async function appendDeletionTombstone(
  ledger: DeletionLedgerPort,
  keyProvider: TombstoneKeyProvider,
  input: DeletionTombstoneInput,
  keyVersion: string,
): Promise<{
  readonly item: DeletionTombstoneItem;
  readonly receipt: DeletionLedgerReceipt;
}> {
  assertTombstoneFields(input, keyVersion);
  const scopeMac = await keyProvider.mac(
    keyVersion,
    encodeCanonical(`scope/v1|${input.scopeKind}|${input.scopeIdentifier}`),
  );
  const result = await ledger.append(input.deletionId, async (sequence) => {
    const unsigned = {
      sequence,
      deletionId: input.deletionId,
      scopeKind: input.scopeKind,
      scopeMac,
      deletionGeneration: input.deletionGeneration,
      deletedAt: input.deletedAt,
      keyVersion,
    } as const;
    return {
      ...unsigned,
      mac: await keyProvider.mac(keyVersion, tombstoneMacBytes(unsigned)),
    };
  });
  if (
    result.item.deletionId !== input.deletionId ||
    result.receipt.deletionId !== input.deletionId ||
    result.receipt.sequence !== result.item.sequence ||
    result.receipt.durableHead < result.receipt.sequence
  ) {
    throw new TombstoneRecoveryError("deletion ledger receipt is inconsistent");
  }
  return result;
}

export async function verifyTombstoneReplay(input: {
  readonly ledger: DeletionLedgerPort;
  readonly keyProvider: TombstoneKeyProvider;
  readonly backupWatermark: number;
}): Promise<{
  readonly currentHead: number;
  readonly items: readonly DeletionTombstoneItem[];
}> {
  if (
    !Number.isSafeInteger(input.backupWatermark) ||
    input.backupWatermark < 0
  ) {
    throw new TombstoneRecoveryError("backup watermark is invalid");
  }
  const currentHead = await input.ledger.currentHead();
  if (!Number.isSafeInteger(currentHead) || currentHead < 0) {
    throw new TombstoneRecoveryError("ledger head is corrupt");
  }
  if (currentHead < input.backupWatermark) {
    throw new TombstoneRecoveryError("ledger head is stale");
  }
  const items = await input.ledger.readRange(
    input.backupWatermark,
    currentHead,
  );
  let expected = input.backupWatermark + 1;
  const deletionIds = new Set<string>();
  for (const item of items) {
    assertTombstoneFields(item, item.keyVersion);
    if (
      !Number.isSafeInteger(item.sequence) ||
      item.sequence < 1 ||
      !/^[0-9a-f]{64}$/.test(item.scopeMac) ||
      !/^[0-9a-f]{64}$/.test(item.mac)
    ) {
      throw new TombstoneRecoveryError("deletion ledger item is corrupt");
    }
    if (item.sequence !== expected) {
      throw new TombstoneRecoveryError("deletion ledger sequence gap");
    }
    if (deletionIds.has(item.deletionId)) {
      throw new TombstoneRecoveryError(
        "deletion ledger contains a duplicate deletion ID",
      );
    }
    deletionIds.add(item.deletionId);
    let valid: boolean;
    try {
      const { mac: _mac, ...unsigned } = item;
      valid = await input.keyProvider.verify(
        item.keyVersion,
        tombstoneMacBytes(unsigned),
        item.mac,
      );
    } catch (error) {
      throw new TombstoneRecoveryError(
        error instanceof Error
          ? error.message
          : "tombstone key version unavailable",
      );
    }
    if (!valid) throw new TombstoneRecoveryError("tombstone MAC is invalid");
    expected += 1;
  }
  if (expected !== currentHead + 1) {
    throw new TombstoneRecoveryError("deletion ledger sequence gap");
  }
  return { currentHead, items };
}

function assertTombstoneFields(
  input: Pick<
    DeletionTombstoneInput,
    "deletionId" | "scopeKind" | "deletionGeneration" | "deletedAt"
  >,
  keyVersion: string,
): void {
  if (
    !/^[a-z0-9_:-]{1,128}$/.test(input.deletionId) ||
    !["installation", "account_link", "push_token"].includes(input.scopeKind) ||
    !Number.isSafeInteger(input.deletionGeneration) ||
    input.deletionGeneration < 1 ||
    !Number.isSafeInteger(input.deletedAt) ||
    input.deletedAt < 1 ||
    !/^[a-z0-9_-]{1,128}$/.test(keyVersion)
  ) {
    throw new TombstoneRecoveryError("deletion tombstone fields are invalid");
  }
}

export class InMemoryDeletionLedger implements DeletionLedgerPort {
  readonly #items: DeletionTombstoneItem[] = [];
  readonly #byDeletionId = new Map<string, DeletionTombstoneItem>();
  #appendTail: Promise<void> = Promise.resolve();

  async append(
    deletionId: string,
    seal: (sequence: number) => Promise<DeletionTombstoneItem>,
  ): Promise<{
    readonly item: DeletionTombstoneItem;
    readonly receipt: DeletionLedgerReceipt;
  }> {
    let release!: () => void;
    const previous = this.#appendTail;
    this.#appendTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const existing = this.#byDeletionId.get(deletionId);
      if (existing) {
        return {
          item: existing,
          receipt: receiptFor(existing, this.#items.length),
        };
      }
      const item = await seal(this.#items.length + 1);
      if (
        item.sequence !== this.#items.length + 1 ||
        item.deletionId !== deletionId
      ) {
        throw new TombstoneRecoveryError(
          "ledger adapter rejected noncanonical append",
        );
      }
      this.#items.push(Object.freeze({ ...item }));
      this.#byDeletionId.set(deletionId, item);
      return { item, receipt: receiptFor(item, this.#items.length) };
    } finally {
      release();
    }
  }

  async currentHead(): Promise<number> {
    return this.#items.length;
  }

  async readRange(
    afterSequence: number,
    throughSequence: number,
  ): Promise<DeletionTombstoneItem[]> {
    return this.#items
      .filter(
        (item) =>
          item.sequence > afterSequence && item.sequence <= throughSequence,
      )
      .map((item) => ({ ...item }));
  }

  unsafeMutateForTest(
    sequence: number,
    patch: Partial<DeletionTombstoneItem>,
  ): void {
    const index = sequence - 1;
    const current = this.#items[index];
    if (!current) throw new TombstoneRecoveryError("test item not found");
    const next = { ...current, ...patch };
    this.#items[index] = next;
    this.#byDeletionId.set(next.deletionId, next);
  }
}

export class InMemoryTombstoneKeyProvider implements TombstoneKeyProvider {
  readonly #keys: ReadonlyMap<string, Uint8Array>;

  constructor(keys: Readonly<Record<string, Uint8Array>>) {
    this.#keys = new Map(
      Object.entries(keys).map(([version, key]) => [version, key.slice()]),
    );
  }

  async mac(keyVersion: string, bytes: Uint8Array): Promise<string> {
    const keyBytes = this.#keys.get(keyVersion);
    if (!keyBytes)
      throw new TombstoneRecoveryError("missing tombstone key version");
    const key = await crypto.subtle.importKey(
      "raw",
      cryptoBytes(keyBytes),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return Buffer.from(
      await crypto.subtle.sign("HMAC", key, cryptoBytes(bytes)),
    ).toString("hex");
  }

  async verify(
    keyVersion: string,
    bytes: Uint8Array,
    mac: string,
  ): Promise<boolean> {
    const expected = await this.mac(keyVersion, bytes);
    if (!/^[0-9a-f]{64}$/.test(mac)) return false;
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(mac, "hex"),
    );
  }
}

function tombstoneMacBytes(
  item: Omit<DeletionTombstoneItem, "mac">,
): Uint8Array {
  return encodeCanonical(
    JSON.stringify([
      "deletion-tombstone/v1",
      item.sequence,
      item.deletionId,
      item.scopeKind,
      item.scopeMac,
      item.deletionGeneration,
      item.deletedAt,
      item.keyVersion,
    ]),
  );
}

function encodeCanonical(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function receiptFor(
  item: DeletionTombstoneItem,
  durableHead: number,
): DeletionLedgerReceipt {
  return {
    sequence: item.sequence,
    durableHead,
    deletionId: item.deletionId,
  };
}

function cryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

import { timingSafeEqual } from "node:crypto";
