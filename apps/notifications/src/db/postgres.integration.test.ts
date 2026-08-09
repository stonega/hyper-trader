import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  buildAccountProofMessage,
  InMemoryDeletionLedger,
  InMemoryTombstoneKeyProvider,
  operationDigest,
  type PushTokenKeyProvider,
  sha256Hex,
} from "@hyper-trader/notifications";
import { SQL } from "bun";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PostgresNotificationApplication } from "../postgres-application";
import {
  getNotificationMigrationStatus,
  migrateNotifications,
  rollbackNotificationMigrations,
} from "./migrations";
import {
  ACCOUNT_RELATIONSHIP_TIMEOUT_MS,
  DrainPendingError,
  PostgresNotificationStore,
  StoreConflictError,
  StoreDependencyUnavailableError,
  StoreRateLimitError,
  StoreUnauthorizedError,
} from "./notification-store";

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const master = privateKeyToAccount(generatePrivateKey());
const installationId = "11".repeat(16);
let credential = "22".repeat(32);
const rotatedCredential = "23".repeat(32);
const secondInstallationId = "14".repeat(16);
const secondCredential = "15".repeat(32);
const targetAccount = `0x${"33".repeat(20)}`;

class TestPushKeyProvider implements PushTokenKeyProvider {
  readonly #keys = new Map([
    ["push-v1", new Uint8Array(32).fill(9)],
    ["push-v2", new Uint8Array(32).fill(11)],
  ]);
  activeVersion = "push-v1";

  activeKeyVersion(): string {
    return this.activeVersion;
  }

  async wrapKey(
    version: string,
    plaintextKey: Uint8Array,
  ): Promise<Uint8Array> {
    const key = this.#keys.get(version);
    if (!key) throw new Error("missing push key version");
    return plaintextKey.map((byte, index) => byte ^ (key[index] ?? 0));
  }

  async unwrapKey(
    version: string,
    wrappedKey: Uint8Array,
  ): Promise<Uint8Array> {
    const key = this.#keys.get(version);
    if (!key || wrappedKey.byteLength !== 32)
      throw new Error("missing push key version");
    return wrappedKey.map((byte, index) => byte ^ (key[index] ?? 0));
  }
}

async function createVerifiedLink(
  store: PostgresNotificationStore,
  input: {
    readonly installationId: string;
    readonly credential: string;
    readonly accountLinkId: string;
    readonly targetAccount: string;
  },
): Promise<void> {
  const digest = await operationDigest("account-link/v1", {
    installationId: input.installationId,
    network: "testnet",
    masterAccount: master.address.toLowerCase(),
    targetAccount: input.targetAccount,
    accountLinkId: input.accountLinkId,
  });
  const issued = await store.issueAccountLinkChallenge({
    installationId: input.installationId,
    credential: input.credential,
    network: "testnet",
    masterAccount: master.address.toLowerCase(),
    targetAccount: input.targetAccount,
    purpose: "notification-account-link",
    operationDigest: digest,
  });
  const message = buildAccountProofMessage(issued.record, issued.challenge);
  await store.verifyAccountLinkProof(
    {
      installationId: input.installationId,
      credential: input.credential,
      accountLinkId: input.accountLinkId,
      challenge: issued.challenge,
      message,
      signature: await master.signMessage({ message }),
    },
    async () => ({ supported: true, relationshipResult: "master-target" }),
  );
}

async function expectConstraintRejected(
  sql: SQL,
  statement: string,
): Promise<void> {
  await sql.unsafe(`
    DO $constraint_check$
    BEGIN
      BEGIN
        ${statement};
        RAISE EXCEPTION 'expected database constraint rejection';
      EXCEPTION
        WHEN foreign_key_violation OR check_violation OR unique_violation THEN
          NULL;
      END;
    END
    $constraint_check$
  `);
}

integration("PostgreSQL notification foundation", () => {
  let first: SQL;
  let second: SQL;
  let store: PostgresNotificationStore;
  let peer: PostgresNotificationStore;
  const ledger = new InMemoryDeletionLedger();
  const pushKeys = new TestPushKeyProvider();
  const tombstoneKeys = new InMemoryTombstoneKeyProvider({
    "tombstone-v1": new Uint8Array(32).fill(7),
    "tombstone-v2": new Uint8Array(32).fill(8),
  });
  beforeAll(async () => {
    first = new SQL(databaseUrl as string, { max: 2 });
    second = new SQL(databaseUrl as string, { max: 2 });
    await rollbackNotificationMigrations(first, { target: 0 });
    await migrateNotifications(first, { target: 4 });
    const dependencies = {
      tokenKeyProvider: pushKeys,
      tombstoneKeyProvider: tombstoneKeys,
      deletionLedger: ledger,
      tombstoneKeyVersion: "tombstone-v1",
      serviceOrigin: "https://notify.example.com",
    } as const;
    store = new PostgresNotificationStore(first, dependencies);
    peer = new PostgresNotificationStore(second, dependencies);
  });

  afterAll(async () => {
    await rollbackNotificationMigrations(first, { target: 0 });
    await first.close();
    await second.close();
  });

  test("runs expand-migrate-contract forward and exposes a closed activation gate", async () => {
    expect(await getNotificationMigrationStatus(first)).toEqual({
      currentVersion: 4,
      schemaPhase: "contracted",
      restoreState: "blocked",
      mutationsEnabled: false,
      monitorsEnabled: false,
      deliveryEnabled: false,
      ledgerWatermark: 0,
      ledgerHead: 0,
    });
    const history = await first.unsafe<
      { up_checksum: string; down_checksum: string }[]
    >(
      `SELECT up_checksum, down_checksum FROM notification_migration_history WHERE version = 3`,
    );
    const contractHistory = history[0];
    if (!contractHistory) throw new Error("contract migration history missing");
    await first.unsafe(
      `UPDATE notification_migration_history SET up_checksum = $1 WHERE version = 3`,
      ["0".repeat(64)],
    );
    await expect(getNotificationMigrationStatus(first)).rejects.toThrow(
      "checksum",
    );
    await expect(store.prepareRestore(0)).rejects.toThrow("checksum");
    await first.unsafe(
      `UPDATE notification_migration_history SET up_checksum = $1 WHERE version = 3`,
      [contractHistory.up_checksum],
    );
    const workerHistory = await first.unsafe<{ down_checksum: string }[]>(
      `SELECT down_checksum FROM notification_migration_history WHERE version = 4`,
    );
    const workerDownChecksum = workerHistory[0]?.down_checksum;
    if (!workerDownChecksum)
      throw new Error("worker migration history missing");
    await first.unsafe(
      `UPDATE notification_migration_history SET down_checksum = $1 WHERE version = 4`,
      ["1".repeat(64)],
    );
    await expect(
      rollbackNotificationMigrations(first, { target: 3 }),
    ).rejects.toThrow("checksum");
    await first.unsafe(
      `UPDATE notification_migration_history SET down_checksum = $1 WHERE version = 4`,
      [workerDownChecksum],
    );
    await expect(
      first.begin(async (transaction) => {
        await transaction`DELETE FROM notification_migration_history WHERE version = 2`;
        await getNotificationMigrationStatus(transaction);
      }),
    ).rejects.toThrow("continuous");
    await expect(
      first.begin(async (transaction) => {
        await transaction`
          INSERT INTO notification_migration_history (
            version, name, up_checksum, down_checksum
          ) VALUES (5, 'unknown', ${"2".repeat(64)}, ${"3".repeat(64)})
        `;
        await getNotificationMigrationStatus(transaction);
      }),
    ).rejects.toThrow("unknown");
    await expect(
      first.begin(async (transaction) => {
        await transaction`
          UPDATE notification_migration_history SET name = 'edited' WHERE version = 2
        `;
        await getNotificationMigrationStatus(transaction);
      }),
    ).rejects.toThrow("continuous");
    expect((await getNotificationMigrationStatus(first)).currentVersion).toBe(
      4,
    );
  });

  test("stores hashed credentials and encrypted unique token fingerprints", async () => {
    await store.prepareRestore(0);
    await store.replayRestore();
    await store.registerInstallation({
      installationId,
      credential,
      provider: "expo",
      pushToken: "ExponentPushToken[foundation-a]",
    });
    const rows = await first.unsafe<
      {
        credential_hex: string;
        ciphertext_text: string;
        fingerprint_hex: string;
      }[]
    >(
      `
      SELECT encode(i.credential_hash, 'hex') AS credential_hex,
             encode(t.ciphertext, 'escape') AS ciphertext_text,
             encode(t.token_fingerprint, 'hex') AS fingerprint_hex
      FROM notification_installations i
      JOIN notification_push_tokens t USING (installation_id)
      WHERE i.installation_id = $1
    `,
      [installationId],
    );
    expect(rows[0]?.credential_hex).not.toBe(credential);
    expect(rows[0]?.ciphertext_text).not.toContain("foundation-a");
    expect(rows[0]?.fingerprint_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await peer.authenticateInstallation(installationId, credential),
    ).toBe(true);

    await expect(
      peer.registerInstallation({
        installationId: "44".repeat(16),
        credential: "55".repeat(32),
        provider: "expo",
        pushToken: "ExponentPushToken[foundation-a]",
      }),
    ).rejects.toThrow(StoreConflictError);

    await peer.registerInstallation({
      installationId: secondInstallationId,
      credential: secondCredential,
      provider: "expo",
      pushToken: "ExponentPushToken[foundation-b]",
    });
    const keyRows = await first.unsafe<
      { fingerprint: string; wrapped_dek: string; key_version: string }[]
    >(`
      SELECT encode(token_fingerprint, 'hex') AS fingerprint,
             encode(wrapped_dek, 'hex') AS wrapped_dek, key_version
      FROM notification_push_tokens ORDER BY installation_id
    `);
    expect(new Set(keyRows.map((row) => row.wrapped_dek)).size).toBe(2);
    const missingOldPushKeys: PushTokenKeyProvider = {
      activeKeyVersion: () => "push-v2",
      wrapKey: async (_version, key) => key.map((byte) => byte ^ 11),
      unwrapKey: async (version, wrapped) => {
        if (version !== "push-v2")
          throw new Error("missing old push key version");
        return wrapped.map((byte) => byte ^ 11);
      },
    };
    const missingOldKeyStore = new PostgresNotificationStore(second, {
      tokenKeyProvider: missingOldPushKeys,
      tombstoneKeyProvider: tombstoneKeys,
      deletionLedger: ledger,
      tombstoneKeyVersion: "tombstone-v1",
      serviceOrigin: "https://notify.example.com",
    });
    await missingOldKeyStore.prepareRestore(0);
    await expect(missingOldKeyStore.replayRestore()).rejects.toThrow("unwrap");
    expect((await getNotificationMigrationStatus(first)).deliveryEnabled).toBe(
      false,
    );
    await store.prepareRestore(0);
    await store.replayRestore();
    const fingerprintsBefore = keyRows.map((row) => row.fingerprint).sort();
    pushKeys.activeVersion = "push-v2";
    expect(await store.rotatePushTokenKeys(1)).toEqual({
      rotated: 1,
      remaining: 1,
    });
    expect(await peer.rotatePushTokenKeys(1)).toEqual({
      rotated: 1,
      remaining: 0,
    });
    const rotated = await first.unsafe<
      { fingerprint: string; key_version: string }[]
    >(`
      SELECT encode(token_fingerprint, 'hex') AS fingerprint, key_version
      FROM notification_push_tokens ORDER BY installation_id
    `);
    expect(rotated.map((row) => row.fingerprint).sort()).toEqual(
      fingerprintsBefore,
    );
    expect(new Set(rotated.map((row) => row.key_version))).toEqual(
      new Set(["push-v2"]),
    );
  });

  test("atomically consumes proof and creates one exact verified account link", async () => {
    const digest = await operationDigest("account-link/v1", {
      installationId,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      accountLinkId: "66".repeat(16),
    });
    const challenge = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      purpose: "notification-account-link",
      operationDigest: digest,
    });
    const message = buildAccountProofMessage(
      challenge.record,
      challenge.challenge,
    );
    const signature = await master.signMessage({ message });
    const result = await store.verifyAccountLinkProof(
      {
        installationId,
        credential,
        accountLinkId: "66".repeat(16),
        challenge: challenge.challenge,
        message,
        signature,
      },
      async () => ({ supported: true, relationshipResult: "master-target" }),
    );
    expect(result.state).toBe("active");
    await expect(
      peer.verifyAccountLinkProof(
        {
          installationId,
          credential,
          accountLinkId: "66".repeat(16),
          challenge: challenge.challenge,
          message,
          signature,
        },
        async () => ({ supported: true, relationshipResult: "master-target" }),
      ),
    ).rejects.toThrow("pending");
    const persisted = await first.unsafe<{ proof_columns: number }[]>(`
      SELECT count(*)::int AS proof_columns
      FROM information_schema.columns
      WHERE table_name IN ('notification_account_links', 'notification_account_link_challenges')
        AND column_name IN ('signature', 'message', 'proof_bytes', 'raw_challenge')
    `);
    expect(persisted[0]?.proof_columns).toBe(0);
  });

  test("bounds a stalled relationship lookup, releases locks, and preserves the challenge", async () => {
    const accountLinkId = "65".repeat(16);
    const stalledTarget = `0x${"64".repeat(20)}`;
    const digest = await operationDigest("account-link/v1", {
      installationId,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount: stalledTarget,
      accountLinkId,
    });
    const issued = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount: stalledTarget,
      purpose: "notification-account-link",
      operationDigest: digest,
    });
    const message = buildAccountProofMessage(issued.record, issued.challenge);
    const input = {
      installationId,
      credential,
      accountLinkId,
      challenge: issued.challenge,
      message,
      signature: await master.signMessage({ message }),
      ip: "192.0.2.62",
    };
    const startedAt = Date.now();
    await expect(
      store.verifyAccountLinkProof(input, async ({ signal, deadlineAtMs }) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(deadlineAtMs).toBeGreaterThan(startedAt);
        return new Promise(() => {});
      }),
    ).rejects.toThrow(StoreDependencyUnavailableError);
    expect(Date.now() - startedAt).toBeLessThan(
      ACCOUNT_RELATIONSHIP_TIMEOUT_MS + 750,
    );
    const state = await first.unsafe<{ state: string }[]>(
      `SELECT state FROM notification_account_link_challenges WHERE challenge_hash = decode($1, 'hex')`,
      [await sha256Hex(issued.challenge)],
    );
    expect(state[0]?.state).toBe("pending");
    await expect(
      peer.verifyAccountLinkProof(input, async ({ signal, deadlineAtMs }) => {
        expect(signal.aborted).toBe(false);
        expect(deadlineAtMs).toBeGreaterThan(Date.now());
        return { supported: true, relationshipResult: "master-target" };
      }),
    ).resolves.toEqual({ accountLinkId, state: "active" });
    await first.unsafe(
      `DELETE FROM notification_account_links WHERE account_link_id = $1`,
      [accountLinkId],
    );
    await first.unsafe(
      `
      UPDATE notification_account_link_challenges
      SET issued_at = issued_at - interval '2 hours',
          expires_at = expires_at - interval '2 hours'
      WHERE challenge_hash = decode($1, 'hex')
    `,
      [await sha256Hex(issued.challenge)],
    );
  });

  test("rejects a stolen bearer for account-rule authority but permits price rules", async () => {
    await expect(
      store.putAccountRule(
        {
          ruleId: "88".repeat(16),
          scope: "account",
          network: "testnet",
          marketId: "perp:BTC",
          eventType: "fill",
          threshold: "0",
          accountLinkId: "66".repeat(16),
        },
        { installationId, credential },
      ),
    ).rejects.toThrow("fresh account proof");
    await store.putPriceRule(
      {
        ruleId: "99".repeat(16),
        scope: "price",
        network: "testnet",
        marketId: "perp:BTC",
        eventType: "price_above",
        threshold: "100000",
      },
      { installationId, credential },
    );
  });

  test("consumes a fresh exact proof with each account-rule replacement", async () => {
    const rule = {
      ruleId: "12".repeat(16),
      scope: "account" as const,
      network: "testnet" as const,
      marketId: "perp:BTC",
      eventType: "fill" as const,
      threshold: "0",
      accountLinkId: "66".repeat(16),
    };
    const digest = await operationDigest("account-rule/v1", rule);
    const issued = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      purpose: "notification-account-rule-mutation",
      operationDigest: digest,
    });
    const message = buildAccountProofMessage(issued.record, issued.challenge);
    const signature = await master.signMessage({ message });
    const proof = { challenge: issued.challenge, message, signature };
    const relationship = async () => ({
      supported: true,
      relationshipResult: "master-target",
    });

    await expect(
      store.putAccountRule(
        { ...rule, threshold: "1" },
        { installationId, credential },
        proof,
        relationship,
      ),
    ).rejects.toThrow("operation digest");
    await expect(
      store.putAccountRule(
        rule,
        { installationId, credential: "34".repeat(32) },
        proof,
        relationship,
      ),
    ).rejects.toThrow(StoreUnauthorizedError);
    await expect(
      store.putAccountRule(
        rule,
        { installationId, credential },
        proof,
        relationship,
      ),
    ).resolves.toEqual({ ruleId: rule.ruleId, state: "active" });
    await expect(
      store.putAccountRule(
        rule,
        { installationId, credential },
        proof,
        relationship,
      ),
    ).rejects.toThrow("pending");

    const collidingRule = { ...rule, ruleId: "99".repeat(16) };
    const collisionDigest = await operationDigest(
      "account-rule/v1",
      collidingRule,
    );
    const collisionChallenge = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      purpose: "notification-account-rule-mutation",
      operationDigest: collisionDigest,
    });
    const collisionMessage = buildAccountProofMessage(
      collisionChallenge.record,
      collisionChallenge.challenge,
    );
    await expect(
      store.putAccountRule(
        collidingRule,
        { installationId, credential },
        {
          challenge: collisionChallenge.challenge,
          message: collisionMessage,
          signature: await master.signMessage({ message: collisionMessage }),
        },
        relationship,
      ),
    ).rejects.toThrow(StoreConflictError);
    const collisionHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(collisionChallenge.challenge),
    );
    const collisionState = await first.unsafe<{ state: string }[]>(
      `
      SELECT state FROM notification_account_link_challenges
      WHERE challenge_hash = $1
    `,
      [new Uint8Array(collisionHash)],
    );
    expect(collisionState[0]?.state).toBe("pending");

    for (const mismatch of [
      { network: "testnet" as const, target: `0x${"45".repeat(20)}` },
      { network: "mainnet" as const, target: targetAccount },
    ]) {
      const mismatchChallenge = await store.issueAccountLinkChallenge({
        installationId,
        credential,
        network: mismatch.network,
        masterAccount: master.address.toLowerCase(),
        targetAccount: mismatch.target,
        purpose: "notification-account-rule-mutation",
        operationDigest: digest,
      });
      const mismatchMessage = buildAccountProofMessage(
        mismatchChallenge.record,
        mismatchChallenge.challenge,
      );
      await expect(
        store.putAccountRule(
          rule,
          { installationId, credential },
          {
            challenge: mismatchChallenge.challenge,
            message: mismatchMessage,
            signature: await master.signMessage({ message: mismatchMessage }),
          },
          relationship,
        ),
      ).rejects.toThrow("link binding");
    }
  });

  test("scopes rule identity per installation and rejects cross-scope SQL references", async () => {
    await peer.putPriceRule(
      {
        ruleId: "19".repeat(16),
        scope: "price",
        network: "testnet",
        marketId: "perp:BTC",
        eventType: "price_above",
        threshold: "100000",
      },
      { installationId: secondInstallationId, credential: secondCredential },
    );
    const identities = await first.unsafe<
      { identity: string; count: number }[]
    >(`
      SELECT encode(identity_digest, 'hex') AS identity, count(*)::int AS count
      FROM notification_rules WHERE scope = 'price'
      GROUP BY identity_digest
    `);
    expect(identities.some((row) => row.count === 2)).toBe(true);

    await expectConstraintRejected(
      first,
      `
        INSERT INTO notification_rules (
          rule_id, installation_id, account_link_id, scope, network,
          market_id, event_type, threshold, identity_digest
        ) VALUES ('${"1a".repeat(16)}', '${secondInstallationId}', '${"66".repeat(16)}',
                  'account', 'testnet', 'perp:BTC', 'fill', '0', decode('${"1b".repeat(32)}', 'hex'))
    `,
    );
    await expectConstraintRejected(
      first,
      `
        INSERT INTO notification_alerts (
          alert_id, installation_id, account_link_id, category, network, route_hint
        ) VALUES ('${"1c".repeat(16)}', '${secondInstallationId}', '${"66".repeat(16)}',
                  'execution', 'testnet', 'market')
    `,
    );
    await expectConstraintRejected(
      first,
      `
        INSERT INTO notification_outbox (
          outbox_id, alert_id, installation_id, network, revocation_generation
        ) VALUES ('${"1d".repeat(16)}', '${"1c".repeat(16)}', '${secondInstallationId}',
                  'testnet', 0)
    `,
    );
    await first.unsafe(
      `
      INSERT INTO notification_alerts (
        alert_id, installation_id, account_link_id, rule_id, category, network, route_hint
      ) VALUES ($1, $2, $3, $4, 'price', 'testnet', 'constraint-test')
    `,
      ["2a".repeat(16), installationId, "66".repeat(16), "99".repeat(16)],
    );
    await first.unsafe(
      `
      INSERT INTO notification_outbox (
        outbox_id, alert_id, installation_id, account_link_id, network, revocation_generation
      ) VALUES ($1, $2, $3, $4, 'testnet', 0)
    `,
      ["2b".repeat(16), "2a".repeat(16), installationId, "66".repeat(16)],
    );
    await expectConstraintRejected(
      first,
      `
      INSERT INTO notification_dispatch_permits (
        permit_id, outbox_id, installation_id, network, revocation_generation,
        expires_at, provider_deadline_at
      ) VALUES ('${"2c".repeat(16)}', '${"2b".repeat(16)}', '${secondInstallationId}',
                'testnet', 0, clock_timestamp() + interval '30 seconds',
                clock_timestamp() + interval '10 seconds')
    `,
    );
    await expectConstraintRejected(
      first,
      `
      INSERT INTO notification_dispatch_permits (
        permit_id, outbox_id, installation_id, account_link_id, network,
        revocation_generation, expires_at, provider_deadline_at
      ) VALUES ('${"2c".repeat(16)}', '${"2b".repeat(16)}', '${installationId}',
                '${"66".repeat(16)}', 'testnet', 0,
                clock_timestamp() + interval '31 seconds',
                clock_timestamp() + interval '10 seconds')
    `,
    );
    await expectConstraintRejected(
      first,
      `
      INSERT INTO notification_dispatch_permits (
        permit_id, outbox_id, installation_id, account_link_id, network,
        revocation_generation, state, expires_at, provider_deadline_at
      ) VALUES ('${"2c".repeat(16)}', '${"2b".repeat(16)}', '${installationId}',
                '${"66".repeat(16)}', 'testnet', 0, 'finished',
                clock_timestamp() + interval '30 seconds',
                clock_timestamp() + interval '10 seconds')
    `,
    );
    await first.unsafe(
      `
      INSERT INTO notification_dispatch_permits (
        permit_id, outbox_id, installation_id, account_link_id, network,
        revocation_generation, state, created_at, expires_at, provider_deadline_at
      ) VALUES ($1, $2, $3, $4, 'testnet', 0, 'expired',
                '2000-01-01T00:00:00Z', '2000-01-01T00:00:30Z',
                '2000-01-01T00:00:10Z')
    `,
      ["2d".repeat(16), "2b".repeat(16), installationId, "66".repeat(16)],
    );
    await expectConstraintRejected(
      first,
      `
      UPDATE notification_installations
      SET state = 'inactive', credential_hash = NULL
      WHERE installation_id = '${secondInstallationId}'
    `,
    );
    await expectConstraintRejected(
      first,
      `
      INSERT INTO notification_revocation_operations (
        operation_id, deletion_id, scope_kind, scope_id, state
      ) VALUES ('${"2e".repeat(16)}', 'constraint-revocation', 'installation',
                '${secondInstallationId}', 'committed')
    `,
    );
    await first.unsafe(
      `DELETE FROM notification_dispatch_permits WHERE permit_id = $1`,
      ["2d".repeat(16)],
    );
    await first.unsafe(`DELETE FROM notification_outbox WHERE outbox_id = $1`, [
      "2b".repeat(16),
    ]);
    await first.unsafe(`DELETE FROM notification_alerts WHERE alert_id = $1`, [
      "2a".repeat(16),
    ]);
  });

  test("rebinds an account-alert token only with an exact fresh proof", async () => {
    await first.unsafe(
      `
      UPDATE notification_account_link_challenges
      SET issued_at = issued_at - interval '2 hours', expires_at = expires_at - interval '2 hours'
      WHERE installation_id = $1
    `,
      [installationId],
    );
    const replacementToken = "ExponentPushToken[proof-bound-replacement]";
    const accountLinkId = "66".repeat(16);
    const fingerprint = await sha256Hex(replacementToken);
    const digest = await operationDigest("push-token-rebind/v1", {
      installationId,
      accountLinkId,
      provider: "expo",
      tokenFingerprint: fingerprint,
    });
    const issued = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      purpose: "notification-push-token-rebind",
      operationDigest: digest,
    });
    const message = buildAccountProofMessage(issued.record, issued.challenge);
    const proof = {
      challenge: issued.challenge,
      message,
      signature: await master.signMessage({ message }),
    };
    const relationship = async () => ({
      supported: true,
      relationshipResult: "master-target",
    });
    await expect(
      store.rebindPushToken(
        {
          installationId,
          credential,
          accountLinkId: "67".repeat(16),
          provider: "expo",
          pushToken: replacementToken,
          proof,
        },
        relationship,
      ),
    ).rejects.toThrow("operation digest");
    await expect(
      store.rebindPushToken(
        {
          installationId,
          credential,
          accountLinkId,
          provider: "expo",
          pushToken: "ExponentPushToken[wrong-fingerprint]",
          proof,
        },
        relationship,
      ),
    ).rejects.toThrow("operation digest");
    await expect(
      store.rebindPushToken(
        {
          installationId,
          credential: "24".repeat(32),
          accountLinkId,
          provider: "expo",
          pushToken: replacementToken,
          proof,
        },
        relationship,
      ),
    ).rejects.toThrow(StoreUnauthorizedError);
    await expect(
      store.rebindPushToken(
        {
          installationId,
          credential,
          accountLinkId,
          provider: "expo",
          pushToken: replacementToken,
          proof,
        },
        relationship,
      ),
    ).resolves.toMatchObject({
      tokenFingerprint: fingerprint,
      state: "active",
    });
    await expect(
      store.readDecryptedPushTokenForProvider(installationId),
    ).resolves.toBe(replacementToken);
    await expect(
      store.rebindPushToken(
        {
          installationId,
          credential,
          accountLinkId,
          provider: "expo",
          pushToken: replacementToken,
          proof,
        },
        relationship,
      ),
    ).rejects.toThrow("pending");

    const collidingToken = "ExponentPushToken[foundation-b]";
    const collisionDigest = await operationDigest("push-token-rebind/v1", {
      installationId,
      accountLinkId,
      provider: "expo",
      tokenFingerprint: await sha256Hex(collidingToken),
    });
    const collision = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      purpose: "notification-push-token-rebind",
      operationDigest: collisionDigest,
    });
    const collisionMessage = buildAccountProofMessage(
      collision.record,
      collision.challenge,
    );
    await expect(
      store.rebindPushToken(
        {
          installationId,
          credential,
          accountLinkId,
          provider: "expo",
          pushToken: collidingToken,
          proof: {
            challenge: collision.challenge,
            message: collisionMessage,
            signature: await master.signMessage({ message: collisionMessage }),
          },
        },
        relationship,
      ),
    ).rejects.toThrow(StoreConflictError);
    const collisionState = await first.unsafe<{ state: string }[]>(
      `
      SELECT state FROM notification_account_link_challenges
      WHERE challenge_hash = decode($1, 'hex')
    `,
      [await sha256Hex(collision.challenge)],
    );
    expect(collisionState[0]?.state).toBe("pending");

    const rollbackToken = "ExponentPushToken[transaction-rollback]";
    const rollbackDigest = await operationDigest("push-token-rebind/v1", {
      installationId,
      accountLinkId,
      provider: "expo",
      tokenFingerprint: await sha256Hex(rollbackToken),
    });
    const rollbackChallenge = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      purpose: "notification-push-token-rebind",
      operationDigest: rollbackDigest,
    });
    const rollbackMessage = buildAccountProofMessage(
      rollbackChallenge.record,
      rollbackChallenge.challenge,
    );
    const rollbackProof = {
      challenge: rollbackChallenge.challenge,
      message: rollbackMessage,
      signature: await master.signMessage({ message: rollbackMessage }),
    };
    const storedTokens = await first.unsafe<
      {
        token_id: string;
        provider: "expo";
        token_fingerprint: Uint8Array;
        ciphertext: Uint8Array;
        nonce: Uint8Array;
        key_version: string;
        wrapped_dek: Uint8Array;
        recovery_scope_mac: Uint8Array;
        recovery_key_version: string;
      }[]
    >(`SELECT * FROM notification_push_tokens WHERE installation_id = $1`, [
      installationId,
    ]);
    const storedToken = storedTokens[0];
    if (!storedToken) throw new Error("push token fixture is unavailable");
    await first.unsafe(
      `DELETE FROM notification_push_tokens WHERE installation_id = $1`,
      [installationId],
    );
    await expect(
      store.rebindPushToken(
        {
          installationId,
          credential,
          accountLinkId,
          provider: "expo",
          pushToken: rollbackToken,
          proof: rollbackProof,
        },
        relationship,
      ),
    ).rejects.toThrow("push token is unavailable");
    const rollbackState = await first.unsafe<{ state: string }[]>(
      `
      SELECT state FROM notification_account_link_challenges
      WHERE challenge_hash = decode($1, 'hex')
    `,
      [await sha256Hex(rollbackChallenge.challenge)],
    );
    expect(rollbackState[0]?.state).toBe("pending");
    await first`
      INSERT INTO notification_push_tokens (
        token_id, installation_id, provider, token_fingerprint, ciphertext,
        nonce, key_version, wrapped_dek, recovery_scope_mac, recovery_key_version
      ) VALUES (
        ${storedToken.token_id}, ${installationId}, ${storedToken.provider},
        ${storedToken.token_fingerprint}, ${storedToken.ciphertext},
        ${storedToken.nonce}, ${storedToken.key_version}, ${storedToken.wrapped_dek},
        ${storedToken.recovery_scope_mac}, ${storedToken.recovery_key_version}
      )
    `;
    await expect(
      store.rebindPushToken(
        {
          installationId,
          credential,
          accountLinkId,
          provider: "expo",
          pushToken: rollbackToken,
          proof: rollbackProof,
        },
        relationship,
      ),
    ).resolves.toMatchObject({ state: "active" });
  });

  test("rotates installation credentials atomically and invalidates stale challenges", async () => {
    await first.unsafe(
      `
      UPDATE notification_account_link_challenges
      SET issued_at = issued_at - interval '2 hours', expires_at = expires_at - interval '2 hours'
      WHERE installation_id = $1
    `,
      [installationId],
    );
    const accountLinkId = "68".repeat(16);
    const digest = await operationDigest("account-link/v1", {
      installationId,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount: `0x${"69".repeat(20)}`,
      accountLinkId,
    });
    const issued = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount: `0x${"69".repeat(20)}`,
      purpose: "notification-account-link",
      operationDigest: digest,
    });
    const oldCredential = credential;
    await expect(
      store.rotateInstallationCredential({
        installationId,
        credential: oldCredential,
        newCredential: rotatedCredential,
      }),
    ).resolves.toEqual({
      installationId,
      credentialGeneration: 2,
      state: "active",
    });
    expect(
      await store.authenticateInstallation(installationId, oldCredential),
    ).toBe(false);
    expect(
      await store.authenticateInstallation(installationId, rotatedCredential),
    ).toBe(true);
    const message = buildAccountProofMessage(issued.record, issued.challenge);
    await expect(
      store.verifyAccountLinkProof(
        {
          installationId,
          credential: rotatedCredential,
          accountLinkId,
          challenge: issued.challenge,
          message,
          signature: await master.signMessage({ message }),
        },
        async () => ({ supported: true, relationshipResult: "master-target" }),
      ),
    ).rejects.toThrow("credential binding is stale");
    await expect(
      store.rotateInstallationCredential({
        installationId,
        credential: oldCredential,
        newCredential: "25".repeat(32),
      }),
    ).rejects.toThrow(StoreUnauthorizedError);
    credential = rotatedCredential;
  });

  test("serializes the rule race and enforces the account-link quota under the installation lock", async () => {
    const ruleCounts = await first.unsafe<{ count: number }[]>(
      `
      SELECT count(*)::int AS count FROM notification_rules
      WHERE installation_id = $1 AND active
    `,
      [installationId],
    );
    const seededRuleIds: string[] = [];
    for (let index = ruleCounts[0]?.count ?? 0; index < 99; index += 1) {
      const ruleId = (10_000 + index).toString(16).padStart(32, "0");
      seededRuleIds.push(ruleId);
      await first.unsafe(
        `
        INSERT INTO notification_rules (
          rule_id, installation_id, scope, network, market_id,
          event_type, threshold, identity_digest
        ) VALUES ($1, $2, 'price', 'testnet', $3, 'price_above', $4, decode($5, 'hex'))
      `,
        [
          ruleId,
          installationId,
          `perp:QUOTA-${index}`,
          String(index),
          await sha256Hex(`quota-rule-${index}`),
        ],
      );
    }
    const concurrentRules = await Promise.allSettled([
      store.putPriceRule(
        {
          ruleId: "71".repeat(16),
          scope: "price",
          network: "testnet",
          marketId: "perp:QUOTA-A",
          eventType: "price_above",
          threshold: "700001",
        },
        { installationId, credential },
      ),
      peer.putPriceRule(
        {
          ruleId: "72".repeat(16),
          scope: "price",
          network: "testnet",
          marketId: "perp:QUOTA-B",
          eventType: "price_above",
          threshold: "700002",
        },
        { installationId, credential },
      ),
    ]);
    expect(
      concurrentRules.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrentRules.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const survivingRuleIndex = concurrentRules.findIndex(
      (result) => result.status === "fulfilled",
    );
    const survivingRuleId = (survivingRuleIndex === 0 ? "71" : "72").repeat(16);
    await expect(
      store.putPriceRule(
        {
          ruleId: survivingRuleId,
          scope: "price",
          network: "testnet",
          marketId: `perp:QUOTA-${survivingRuleIndex === 0 ? "A" : "B"}`,
          eventType: "price_above",
          threshold: "700003",
        },
        { installationId, credential },
      ),
    ).resolves.toMatchObject({ ruleId: survivingRuleId });
    for (const ruleId of [...seededRuleIds, "71".repeat(16), "72".repeat(16)]) {
      await first.unsafe(`DELETE FROM notification_rules WHERE rule_id = $1`, [
        ruleId,
      ]);
    }

    await first.unsafe(
      `
      UPDATE notification_account_link_challenges
      SET issued_at = issued_at - interval '2 hours', expires_at = expires_at - interval '2 hours'
      WHERE installation_id = $1
    `,
      [installationId],
    );
    const seededLinkIds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const accountLinkId = (20_000 + index).toString(16).padStart(32, "0");
      seededLinkIds.push(accountLinkId);
      await first.unsafe(
        `
        INSERT INTO notification_account_links (
          account_link_id, installation_id, network, master_account, target_account,
          proof_version, relationship_result, verified_at,
          recovery_scope_mac, recovery_key_version
        ) VALUES ($1, $2, 'testnet', $3, $4, 1, 'master-target', clock_timestamp(),
                  decode($5, 'hex'), 'tombstone-v1')
      `,
        [
          accountLinkId,
          installationId,
          master.address.toLowerCase(),
          `0x${(30_000 + index).toString(16).padStart(40, "0")}`,
          await sha256Hex(`quota-link-${index}`),
        ],
      );
    }
    const candidates = await Promise.all(
      [0, 1].map(async (index) => {
        const accountLinkId = (21_000 + index).toString(16).padStart(32, "0");
        const candidateTarget = `0x${(31_000 + index).toString(16).padStart(40, "0")}`;
        const operationDigestValue = await operationDigest("account-link/v1", {
          installationId,
          network: "testnet",
          masterAccount: master.address.toLowerCase(),
          targetAccount: candidateTarget,
          accountLinkId,
        });
        const issued = await store.issueAccountLinkChallenge({
          installationId,
          credential,
          network: "testnet",
          masterAccount: master.address.toLowerCase(),
          targetAccount: candidateTarget,
          purpose: "notification-account-link",
          operationDigest: operationDigestValue,
        });
        const message = buildAccountProofMessage(
          issued.record,
          issued.challenge,
        );
        return {
          installationId,
          credential,
          accountLinkId,
          challenge: issued.challenge,
          message,
          signature: await master.signMessage({ message }),
        };
      }),
    );
    const relationship = async () => ({
      supported: true,
      relationshipResult: "master-target",
    });
    const firstCandidate = candidates[0];
    const secondCandidate = candidates[1];
    if (!firstCandidate || !secondCandidate) {
      throw new Error("account quota candidates were not created");
    }
    await expect(
      store.verifyAccountLinkProof(firstCandidate, relationship),
    ).resolves.toMatchObject({ state: "active" });
    await expect(
      peer.verifyAccountLinkProof(secondCandidate, relationship),
    ).rejects.toThrow("linked account quota exhausted");
    const activeLinks = await first.unsafe<{ count: number }[]>(
      `
      SELECT count(*)::int AS count FROM notification_account_links
      WHERE installation_id = $1 AND state = 'active'
    `,
      [installationId],
    );
    expect(activeLinks[0]?.count).toBe(10);
    for (const accountLinkId of [
      ...seededLinkIds,
      firstCandidate.accountLinkId,
      secondCandidate.accountLinkId,
    ]) {
      await first.unsafe(
        `DELETE FROM notification_account_links WHERE account_link_id = $1`,
        [accountLinkId],
      );
    }
  });

  test("enforces shared durable mutation, token-change, and failed-proof admission", async () => {
    await first.unsafe(
      `DELETE FROM notification_admission_events WHERE installation_id = $1`,
      [installationId],
    );
    const tokenInputs = await Promise.all(
      ["a", "b"].map(async (suffix, index) => {
        const pushToken = `ExponentPushToken[quota-${suffix}]`;
        const operationDigestValue = await operationDigest(
          "push-token-rebind/v1",
          {
            installationId,
            accountLinkId: "66".repeat(16),
            provider: "expo",
            tokenFingerprint: await sha256Hex(pushToken),
          },
        );
        const issued = await store.issueAccountLinkChallenge({
          installationId,
          credential,
          network: "testnet",
          masterAccount: master.address.toLowerCase(),
          targetAccount,
          purpose: "notification-push-token-rebind",
          operationDigest: operationDigestValue,
        });
        const message = buildAccountProofMessage(
          issued.record,
          issued.challenge,
        );
        return {
          installationId,
          credential,
          accountLinkId: "66".repeat(16),
          provider: "expo" as const,
          pushToken,
          proof: {
            challenge: issued.challenge,
            message,
            signature: await master.signMessage({ message }),
          },
          ip: `192.0.2.${74 + index}`,
        };
      }),
    );
    await first.unsafe(
      `DELETE FROM notification_admission_events WHERE installation_id = $1`,
      [installationId],
    );
    await first.unsafe(
      `
      INSERT INTO notification_admission_events (
        kind, installation_id, ip_address, status
      ) SELECT 'token_change', $1, '192.0.2.73', 'committed'
        FROM generate_series(1, 9)
    `,
      [installationId],
    );
    const firstTokenInput = tokenInputs[0];
    const secondTokenInput = tokenInputs[1];
    if (!firstTokenInput || !secondTokenInput) {
      throw new Error("token admission fixtures were not created");
    }
    await expect(
      store.rebindPushToken(firstTokenInput, async () => ({
        supported: true,
        relationshipResult: "master-target",
      })),
    ).resolves.toMatchObject({ state: "active" });
    await expect(
      peer.rebindPushToken(secondTokenInput, async () => ({
        supported: true,
        relationshipResult: "master-target",
      })),
    ).rejects.toThrow(StoreRateLimitError);

    await first.unsafe(
      `DELETE FROM notification_admission_events WHERE installation_id = $1`,
      [installationId],
    );
    await first.unsafe(
      `
      INSERT INTO notification_admission_events (
        kind, installation_id, ip_address, status
      ) SELECT 'mutation', $1, '192.0.2.76', 'committed'
        FROM generate_series(1, 29)
    `,
      [installationId],
    );
    const installationRace = await Promise.allSettled([
      store.putPriceRule(
        {
          ruleId: "73".repeat(16),
          scope: "price",
          network: "testnet",
          marketId: "perp:ADMISSION-A",
          eventType: "price_above",
          threshold: "1",
        },
        { installationId, credential, ip: "192.0.2.77" },
      ),
      peer.putPriceRule(
        {
          ruleId: "74".repeat(16),
          scope: "price",
          network: "testnet",
          marketId: "perp:ADMISSION-B",
          eventType: "price_above",
          threshold: "2",
        },
        { installationId, credential, ip: "192.0.2.78" },
      ),
    ]);
    expect(
      installationRace.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      installationRace.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await first.unsafe(
      `DELETE FROM notification_rules WHERE rule_id IN ($1, $2)`,
      ["73".repeat(16), "74".repeat(16)],
    );

    const sharedIp = "192.0.2.79";
    await first.unsafe(
      `
      INSERT INTO notification_admission_events (kind, ip_address, status)
      SELECT 'mutation', $1, 'committed' FROM generate_series(1, 59)
    `,
      [sharedIp],
    );
    const ipRace = await Promise.allSettled([
      store.registerInstallation(
        {
          installationId: "73".repeat(16),
          credential: "83".repeat(32),
          provider: "expo",
          pushToken: "ExponentPushToken[ip-quota-a]",
        },
        sharedIp,
      ),
      peer.registerInstallation(
        {
          installationId: "74".repeat(16),
          credential: "84".repeat(32),
          provider: "expo",
          pushToken: "ExponentPushToken[ip-quota-b]",
        },
        sharedIp,
      ),
    ]);
    expect(
      ipRace.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      ipRace.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await first.unsafe(
      `DELETE FROM notification_installations WHERE installation_id IN ($1, $2)`,
      ["73".repeat(16), "74".repeat(16)],
    );

    const failedProofIp = "192.0.2.80";
    await first.unsafe(
      `
      INSERT INTO notification_admission_events (kind, ip_address, status)
      SELECT 'failed_proof', $1, 'failed' FROM generate_series(1, 9)
    `,
      [failedProofIp],
    );
    await expect(
      store.verifyAccountLinkProof(
        {
          installationId,
          credential,
          accountLinkId: "75".repeat(16),
          challenge: "76".repeat(32),
          message: "unavailable-challenge",
          signature: "0x",
          ip: failedProofIp,
        },
        async () => ({ supported: true, relationshipResult: "master-target" }),
      ),
    ).rejects.toThrow("challenge is unavailable");
    await expect(
      peer.verifyAccountLinkProof(
        {
          installationId,
          credential,
          accountLinkId: "77".repeat(16),
          challenge: "78".repeat(32),
          message: "unavailable-challenge",
          signature: "0x",
          ip: failedProofIp,
        },
        async () => ({ supported: true, relationshipResult: "master-target" }),
      ),
    ).rejects.toThrow(StoreRateLimitError);
  });

  test("authenticates before charging victim quotas and linearizes credential rotation", async () => {
    await first.unsafe(
      `DELETE FROM notification_admission_events WHERE installation_id = $1`,
      [installationId],
    );
    const application = new PostgresNotificationApplication({
      store,
      relationshipVerifier: async () => ({
        supported: true,
        relationshipResult: "master-target",
      }),
    });
    for (let index = 0; index < 35; index += 1) {
      await expect(
        application.putRule(
          {
            rule: {
              ruleId: (50_000 + index).toString(16).padStart(32, "0"),
              scope: "price",
              network: "testnet",
              marketId: "perp:INVALID-BEARER",
              eventType: "price_above",
              threshold: "1",
            },
          },
          { credential: "ff".repeat(32), ip: "192.0.2.91" },
        ),
      ).rejects.toMatchObject({ status: 401 });
    }
    await expect(
      application.putRule(
        {
          rule: {
            ruleId: "75".repeat(16),
            scope: "account",
            network: "testnet",
            marketId: "perp:STOLEN-LINK",
            eventType: "fill",
            threshold: "0",
            accountLinkId: "66".repeat(16),
          },
        },
        { credential: "fe".repeat(32), ip: "192.0.2.92" },
      ),
    ).rejects.toMatchObject({ status: 401 });
    const victimCharges = await first.unsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM notification_admission_events WHERE installation_id = $1`,
      [installationId],
    );
    expect(victimCharges[0]?.count).toBe(0);
    await expect(
      application.registerInstallation(
        {
          installationId,
          credential: "fd".repeat(32),
          provider: "expo",
          pushToken: "ExponentPushToken[chosen-existing-id]",
        },
        { ip: "192.0.2.93" },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await first.unsafe<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM notification_admission_events WHERE installation_id = $1`,
          [installationId],
        )
      )[0]?.count,
    ).toBe(0);

    await first.unsafe(
      `
      INSERT INTO notification_admission_events (
        kind, installation_id, ip_address, status
      ) SELECT 'mutation', $1, '192.0.2.94', 'committed'
        FROM generate_series(1, 29)
    `,
      [installationId],
    );
    const nextCredential = "85".repeat(32);
    const [rotation, mutation] = await Promise.allSettled([
      store.rotateInstallationCredential({
        installationId,
        credential,
        newCredential: nextCredential,
        ip: "192.0.2.95",
      }),
      peer.putPriceRule(
        {
          ruleId: "76".repeat(16),
          scope: "price",
          network: "testnet",
          marketId: "perp:ROTATION-RACE",
          eventType: "price_above",
          threshold: "2",
        },
        { installationId, credential, ip: "192.0.2.96" },
      ),
    ]);
    expect(
      [rotation, mutation].filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const charges = await first.unsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM notification_admission_events WHERE installation_id = $1`,
      [installationId],
    );
    expect(charges[0]?.count).toBe(30);
    if (rotation.status === "fulfilled") credential = nextCredential;
    expect(
      await store.authenticateInstallation(installationId, credential),
    ).toBe(true);
    await expect(
      application.unlinkAccount(
        {
          installationId,
          accountLinkId: "66".repeat(16),
          operationId: "77".repeat(16),
        },
        { credential, ip: "192.0.2.97" },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(
      (
        await first.unsafe<{ state: string }[]>(
          `SELECT state FROM notification_account_links WHERE account_link_id = $1`,
          ["66".repeat(16)],
        )
      )[0]?.state,
    ).toBe("active");
    await first.unsafe(`DELETE FROM notification_rules WHERE rule_id = $1`, [
      "76".repeat(16),
    ]);
    await first.unsafe(
      `DELETE FROM notification_admission_events WHERE installation_id = $1`,
      [installationId],
    );
  });

  test("unlinks one account in isolation and proof-revokes an exact sorted lost-device set", async () => {
    await first.unsafe(
      `
      UPDATE notification_account_link_challenges
      SET issued_at = issued_at - interval '2 hours', expires_at = expires_at - interval '2 hours'
      WHERE installation_id = $1
    `,
      [installationId],
    );
    const secondaryTarget = `0x${"1e".repeat(20)}`;
    await createVerifiedLink(store, {
      installationId,
      credential,
      accountLinkId: "1f".repeat(16),
      targetAccount: secondaryTarget,
    });
    for (const [suffix, permitSuffix] of [
      ["31", "41"],
      ["32", "42"],
      ["33", "43"],
    ] as const) {
      await first.unsafe(
        `
        INSERT INTO notification_alerts (
          alert_id, installation_id, account_link_id, category, network, route_hint
        ) VALUES ($1, $2, $3, 'execution', 'testnet', 'account')
      `,
        [suffix.repeat(16), installationId, "1f".repeat(16)],
      );
      await first.unsafe(
        `
        INSERT INTO notification_outbox (
          outbox_id, alert_id, installation_id, account_link_id, network,
          revocation_generation
        ) VALUES ($1, $2, $3, $4, 'testnet', 0)
      `,
        [
          (Number.parseInt(suffix, 16) + 16).toString(16).repeat(16),
          suffix.repeat(16),
          installationId,
          "1f".repeat(16),
        ],
      );
      await store.acquireDispatchPermit({
        installationId,
        accountLinkId: "1f".repeat(16),
        outboxId: (Number.parseInt(suffix, 16) + 16).toString(16).repeat(16),
        permitId: permitSuffix.repeat(16),
      });
    }
    await store.markProviderSubmissionStarted("42".repeat(16));
    await store.finishDispatchPermit("42".repeat(16), "provider_accepted");
    await store.markProviderSubmissionStarted("43".repeat(16));
    await first.unsafe(
      `UPDATE notification_dispatch_permits SET provider_deadline_at = clock_timestamp() - interval '1 second' WHERE permit_id = $1`,
      ["43".repeat(16)],
    );
    const unlink = await store.startAccountLinkDrain({
      installationId,
      credential,
      accountLinkId: "1f".repeat(16),
      operationId: "20".repeat(16),
    });
    expect(await peer.commitAccountLinkUnlink(unlink.operationId)).toEqual({
      operationId: unlink.operationId,
      state: "inactive",
      ledgerSequence: 1,
    });
    await expect(
      peer.markProviderSubmissionStarted("41".repeat(16)),
    ).rejects.toThrow("not active");
    const dispatchHistory = await first.unsafe<
      {
        permit_id: string;
        permit_state: string;
        outbox_state: string;
        account_link_scope_id: string | null;
        deletion_id: string | null;
      }[]
    >(
      `
      SELECT p.permit_id, p.state AS permit_state, o.state AS outbox_state,
             p.account_link_scope_id, p.deletion_id
      FROM notification_dispatch_permits p
      JOIN notification_outbox o USING (outbox_id)
      WHERE p.permit_id IN ($1, $2, $3) ORDER BY p.permit_id
    `,
      ["41".repeat(16), "42".repeat(16), "43".repeat(16)],
    );
    expect(dispatchHistory).toEqual([
      {
        permit_id: "41".repeat(16),
        permit_state: "expired",
        outbox_state: "cancelled",
        account_link_scope_id: "1f".repeat(16),
        deletion_id: `account_link:${"1f".repeat(16)}:1`,
      },
      {
        permit_id: "42".repeat(16),
        permit_state: "finished",
        outbox_state: "provider_accepted",
        account_link_scope_id: "1f".repeat(16),
        deletion_id: `account_link:${"1f".repeat(16)}:1`,
      },
      {
        permit_id: "43".repeat(16),
        permit_state: "finished",
        outbox_state: "provider_outcome_unknown",
        account_link_scope_id: "1f".repeat(16),
        deletion_id: `account_link:${"1f".repeat(16)}:1`,
      },
    ]);
    const surviving = await first.unsafe<
      { first_link: number; installations: number }[]
    >(
      `
      SELECT
        (SELECT count(*)::int FROM notification_account_links WHERE account_link_id = $1) AS first_link,
        (SELECT count(*)::int FROM notification_installations WHERE state = 'active') AS installations
    `,
      ["66".repeat(16)],
    );
    expect(surviving[0]).toEqual({ first_link: 1, installations: 2 });

    await createVerifiedLink(peer, {
      installationId: secondInstallationId,
      credential: secondCredential,
      accountLinkId: "21".repeat(16),
      targetAccount,
    });
    await first.unsafe(
      `
      UPDATE notification_account_link_challenges
      SET issued_at = issued_at - interval '2 hours', expires_at = expires_at - interval '2 hours'
      WHERE installation_id = $1
    `,
      [installationId],
    );
    const operationId = "22".repeat(16);
    const selectedInstallationIds = [secondInstallationId];
    const revokeDigest = await operationDigest("lost-installation-revoke/v1", {
      requestingInstallationId: installationId,
      operationId,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      selectedInstallationIds,
    });
    const revokeChallenge = await store.issueAccountLinkChallenge({
      installationId,
      credential,
      network: "testnet",
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      purpose: "notification-installation-revoke",
      operationDigest: revokeDigest,
    });
    const revokeMessage = buildAccountProofMessage(
      revokeChallenge.record,
      revokeChallenge.challenge,
    );
    const revokeProof = {
      requestingInstallationId: installationId,
      credential,
      operationId,
      network: "testnet" as const,
      masterAccount: master.address.toLowerCase(),
      targetAccount,
      selectedInstallationIds,
      challenge: revokeChallenge.challenge,
      message: revokeMessage,
      signature: await master.signMessage({ message: revokeMessage }),
    };
    const relationship = async () => ({
      supported: true,
      relationshipResult: "master-target",
    });
    await expect(
      store.verifyLostInstallationRevokeProof(
        { ...revokeProof, selectedInstallationIds: [installationId] },
        relationship,
      ),
    ).rejects.toThrow("binding");
    const draining = await store.verifyLostInstallationRevokeProof(
      revokeProof,
      relationship,
    );
    expect(draining.operationIds).toHaveLength(1);
    expect(
      await store.commitInstallationRevocation(draining.operationIds[0] ?? ""),
    ).toMatchObject({
      state: "inactive",
      ledgerSequence: 2,
    });
    const installationStates = await first.unsafe<
      { installation_id: string; state: string }[]
    >(
      `SELECT installation_id, state FROM notification_installations ORDER BY installation_id`,
    );
    expect(installationStates).toEqual([
      { installation_id: installationId, state: "active" },
      { installation_id: secondInstallationId, state: "inactive" },
    ]);
  });

  test("linearizes drain against independent dispatch acquisition and commits deletion once", async () => {
    await first.unsafe(
      `
      INSERT INTO notification_alerts (
        alert_id, installation_id, account_link_id, rule_id, category, network, route_hint
      ) VALUES ($1, $2, $3, $4, 'price', 'testnet', 'market')
    `,
      ["aa".repeat(16), installationId, "66".repeat(16), "99".repeat(16)],
    );
    await first.unsafe(
      `
      INSERT INTO notification_outbox (
        outbox_id, alert_id, installation_id, account_link_id, network, revocation_generation
      ) VALUES ($1, $2, $3, $4, 'testnet', 0)
    `,
      ["bb".repeat(16), "aa".repeat(16), installationId, "66".repeat(16)],
    );
    await store.acquireDispatchPermit({
      installationId,
      accountLinkId: "66".repeat(16),
      outboxId: "bb".repeat(16),
      permitId: "cc".repeat(16),
    });
    await store.markProviderSubmissionStarted("cc".repeat(16));
    const rotatedPeer = new PostgresNotificationStore(second, {
      tokenKeyProvider: new TestPushKeyProvider(),
      tombstoneKeyProvider: tombstoneKeys,
      deletionLedger: ledger,
      tombstoneKeyVersion: "tombstone-v2",
      serviceOrigin: "https://notify.example.com",
    });
    const operation = await rotatedPeer.startInstallationDrain({
      installationId,
      credential,
      operationId: "dd".repeat(16),
    });
    await expect(
      store.acquireDispatchPermit({
        installationId,
        accountLinkId: "66".repeat(16),
        outboxId: "bb".repeat(16),
        permitId: "ee".repeat(16),
      }),
    ).rejects.toThrow("active");
    await expect(
      rotatedPeer.commitInstallationRevocation(operation.operationId),
    ).rejects.toThrow(DrainPendingError);
    await store.finishDispatchPermit(
      "cc".repeat(16),
      "provider_outcome_unknown",
    );
    const committed = await rotatedPeer.commitInstallationRevocation(
      operation.operationId,
    );
    expect(committed.state).toBe("inactive");
    expect(committed.ledgerSequence).toBe(3);
    const tombstones = await first.unsafe<{ key_version: string }[]>(`
      SELECT key_version FROM notification_deletion_tombstones WHERE deletion_id LIKE 'installation:%'
    `);
    expect(tombstones[0]?.key_version).toBe("tombstone-v1");
    expect(
      await store.authenticateInstallation(installationId, credential),
    ).toBe(false);
    const state = await first.unsafe<
      {
        installation_state: string;
        pending_outbox: number;
        rule_count: number;
      }[]
    >(
      `
      SELECT i.state AS installation_state,
             (SELECT count(*)::int FROM notification_outbox WHERE state IN ('pending', 'leased')) AS pending_outbox,
             (SELECT count(*)::int FROM notification_rules WHERE installation_id = $1) AS rule_count
      FROM notification_installations i WHERE installation_id = $1
    `,
      [installationId],
    );
    expect(state[0]).toEqual({
      installation_state: "inactive",
      pending_outbox: 0,
      rule_count: 0,
    });
  });

  test("replay re-applies deletion before opening mutation readiness", async () => {
    await first.unsafe(
      `
      UPDATE notification_installations
      SET state = 'active', credential_hash = decode($2, 'hex'), revoked_at = NULL
      WHERE installation_id = $1
    `,
      [installationId, "ab".repeat(32)],
    );
    await first.unsafe(
      `
      INSERT INTO notification_account_links (
        account_link_id, installation_id, network, master_account, target_account,
        proof_version, relationship_result, verified_at, recovery_scope_mac,
        recovery_key_version
      ) SELECT $1, $2, 'testnet', $3, $4, 1, 'master-target', clock_timestamp(),
               scope_mac, key_version
        FROM notification_deletion_tombstones WHERE deletion_id = $5
    `,
      [
        "1f".repeat(16),
        installationId,
        master.address.toLowerCase(),
        `0x${"1e".repeat(20)}`,
        `account_link:${"1f".repeat(16)}:1`,
      ],
    );
    await first.unsafe(
      `
      INSERT INTO notification_alerts (
        alert_id, installation_id, account_link_id, category, network, route_hint
      ) VALUES ($1, $2, $3, 'execution', 'testnet', 'restored')
    `,
      ["61".repeat(16), installationId, "1f".repeat(16)],
    );
    await first.unsafe(
      `
      INSERT INTO notification_outbox (
        outbox_id, alert_id, installation_id, account_link_id, network,
        revocation_generation
      ) SELECT $1, $2, $3, $4, 'testnet', revocation_generation
        FROM notification_installations WHERE installation_id = $3
    `,
      ["62".repeat(16), "61".repeat(16), installationId, "1f".repeat(16)],
    );
    await store.acquireDispatchPermit({
      installationId,
      accountLinkId: "1f".repeat(16),
      outboxId: "62".repeat(16),
      permitId: "63".repeat(16),
    });
    const missingOldKeyStore = new PostgresNotificationStore(second, {
      tokenKeyProvider: new TestPushKeyProvider(),
      tombstoneKeyProvider: new InMemoryTombstoneKeyProvider({
        "tombstone-v2": new Uint8Array(32).fill(8),
      }),
      deletionLedger: ledger,
      tombstoneKeyVersion: "tombstone-v2",
      serviceOrigin: "https://notify.example.com",
    });
    await missingOldKeyStore.prepareRestore(0);
    await expect(missingOldKeyStore.replayRestore()).rejects.toThrow(
      "missing tombstone key version",
    );
    expect((await getNotificationMigrationStatus(first)).mutationsEnabled).toBe(
      false,
    );
    const rotatedStore = new PostgresNotificationStore(first, {
      tokenKeyProvider: new TestPushKeyProvider(),
      tombstoneKeyProvider: tombstoneKeys,
      deletionLedger: ledger,
      tombstoneKeyVersion: "tombstone-v2",
      serviceOrigin: "https://notify.example.com",
    });
    const localTombstone = await first.unsafe<{ scope_mac: string }[]>(
      `SELECT encode(scope_mac, 'hex') AS scope_mac FROM notification_deletion_tombstones WHERE deletion_id = $1`,
      [`account_link:${"1f".repeat(16)}:1`],
    );
    await first.unsafe(
      `UPDATE notification_deletion_tombstones SET scope_mac = decode($2, 'hex') WHERE deletion_id = $1`,
      [`account_link:${"1f".repeat(16)}:1`, "00".repeat(32)],
    );
    await rotatedStore.prepareRestore(0);
    await expect(rotatedStore.replayRestore()).rejects.toThrow(
      "local deletion tombstone conflicts",
    );
    await first.unsafe(
      `UPDATE notification_deletion_tombstones SET scope_mac = decode($2, 'hex') WHERE deletion_id = $1`,
      [`account_link:${"1f".repeat(16)}:1`, localTombstone[0]?.scope_mac ?? ""],
    );
    await rotatedStore.prepareRestore(0);
    await rotatedStore.replayRestore();
    const state = await first.unsafe<
      { state: string; credential_hash: Uint8Array | null }[]
    >(
      `SELECT state, credential_hash FROM notification_installations WHERE installation_id = $1`,
      [installationId],
    );
    expect(state[0]?.state).toBe("inactive");
    expect(state[0]?.credential_hash).toBeNull();
    await expect(
      store.markProviderSubmissionStarted("63".repeat(16)),
    ).rejects.toThrow();
    const restoredWork = await first.unsafe<
      {
        permit_state: string;
        outbox_state: string;
        account_link_scope_id: string | null;
        deletion_id: string | null;
      }[]
    >(
      `
      SELECT p.state AS permit_state, o.state AS outbox_state,
             p.account_link_scope_id, p.deletion_id
      FROM notification_dispatch_permits p
      JOIN notification_outbox o USING (outbox_id)
      WHERE p.permit_id = $1
    `,
      ["63".repeat(16)],
    );
    expect(restoredWork[0]).toEqual({
      permit_state: "expired",
      outbox_state: "cancelled",
      account_link_scope_id: "1f".repeat(16),
      deletion_id: `installation:${installationId}:1`,
    });
    expect((await getNotificationMigrationStatus(first)).mutationsEnabled).toBe(
      true,
    );
  });

  test("cleans retention in bounded retryable batches and supports rollback", async () => {
    await first.unsafe(
      `
      INSERT INTO notification_event_dedupe_keys (event_key, created_at, expires_at)
      VALUES (decode($1, 'hex'), clock_timestamp() - interval '8 days', clock_timestamp() - interval '2 days')
    `,
      ["fe".repeat(32)],
    );
    expect(await store.cleanupRetention(1)).toEqual({
      challenges: 0,
      dedupeKeys: 1,
      deliveryRows: 0,
    });
    expect(await store.cleanupRetention(1)).toEqual({
      challenges: 0,
      dedupeKeys: 0,
      deliveryRows: 0,
    });
    const retainedProviderHistory = await first.unsafe<
      { permit_id: string; permit_state: string; outbox_state: string }[]
    >(
      `
      SELECT p.permit_id, p.state AS permit_state, o.state AS outbox_state
      FROM notification_dispatch_permits p
      JOIN notification_outbox o USING (outbox_id)
      WHERE p.permit_id IN ($1, $2) ORDER BY p.permit_id
    `,
      ["42".repeat(16), "43".repeat(16)],
    );
    expect(retainedProviderHistory).toEqual([
      {
        permit_id: "42".repeat(16),
        permit_state: "finished",
        outbox_state: "provider_accepted",
      },
      {
        permit_id: "43".repeat(16),
        permit_state: "finished",
        outbox_state: "provider_outcome_unknown",
      },
    ]);

    await rollbackNotificationMigrations(first, { target: 2 });
    const status = await getNotificationMigrationStatus(first);
    expect(status.schemaPhase).toBe("migrated");
    expect(status.deliveryEnabled).toBe(false);
    await migrateNotifications(first, { target: 3 });
  });
});
