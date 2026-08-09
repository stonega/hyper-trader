import {
  type AtomicActionReservationInput,
  agentAddressFingerprint,
  allocateNonce,
  assertSignerBinding,
  assertTestnetSigningCapability,
  type ContextEpochAuthority,
  createRetiredSignerTombstone,
  EMPTY_RETIREMENT_CHAIN_ROOT,
  type NonceAndJournalRepository,
  normalizeSignerBinding,
  type PreparedActionRecord,
  type RetiredSignerTombstone,
  type RetiredSignerTombstoneInput,
  type SignerBinding,
  type SignerScopeRegistration,
  serializeSecretFreeIntent,
} from "@hyper-trader/hyperliquid";

import {
  assertPreparedActionFields,
  type ExpoSqliteSyncConnection,
  SqliteActionJournalRepository,
  TERMINAL_JOURNAL_STATES_SQL,
} from "./action-journal";
import {
  assertTime,
  CORRELATION_ID_PATTERN,
  JOURNAL_ID_PATTERN,
  LOWERCASE_HASH_PATTERN,
} from "./validation";

interface SignerScopeRow {
  readonly network: "mainnet" | "testnet";
  readonly agent_address: string;
  readonly master_account: string;
  readonly target_account: string;
  readonly signer_generation: number;
  readonly status: "active" | "retiring" | "retired";
  readonly last_issued_nonce: number | null;
  readonly last_observed_wall_ms: number | null;
  readonly activated_at: number;
  readonly updated_at: number;
}

interface TombstoneHeadRow {
  readonly installation_epoch: string;
  readonly sequence: number;
  readonly chain_root: `0x${string}`;
}

interface TombstoneRow extends TombstoneHeadRow {
  readonly prior_chain_root: `0x${string}`;
  readonly network: "mainnet" | "testnet";
  readonly agent_address_fingerprint: `0x${string}`;
  readonly last_issued_nonce: number;
  readonly signer_generation: number;
  readonly retired_at: number;
  readonly reason: RetiredSignerTombstone["reason"];
}

function assertReservationIdentifiers(
  input: AtomicActionReservationInput["preparedAction"],
): string {
  if (!JOURNAL_ID_PATTERN.test(input.journalId)) {
    throw new TypeError("journalId must be a generated opaque journal ID.");
  }
  if (!CORRELATION_ID_PATTERN.test(input.correlationId)) {
    throw new TypeError("correlationId must be a generated opaque action ID.");
  }
  if (
    !LOWERCASE_HASH_PATTERN.test(input.intentDigest) ||
    !LOWERCASE_HASH_PATTERN.test(input.equivalenceFingerprint)
  ) {
    throw new TypeError(
      "Intent digest and fingerprint must be lowercase hashes.",
    );
  }
  assertPreparedActionFields(input);
  return serializeSecretFreeIntent(input.normalizedSecretFreeIntent);
}

function bindingFromScope(scope: SignerScopeRow): SignerBinding {
  return {
    network: scope.network,
    masterAccount: scope.master_account,
    targetAccount: scope.target_account,
    agentAddress: scope.agent_address,
    generation: scope.signer_generation,
  };
}

export type RetirementManifestComparison =
  | { readonly status: "match" }
  | {
      readonly status: "sqlite_ahead";
      readonly sequence: number;
      readonly chainRoot: `0x${string}`;
    }
  | { readonly status: "quarantine"; readonly reason: string };

export class SqliteNonceAndJournalRepository
  extends SqliteActionJournalRepository
  implements NonceAndJournalRepository
{
  constructor(
    database: ExpoSqliteSyncConnection,
    private readonly contextEpochAuthority: ContextEpochAuthority,
  ) {
    super(database);
  }

  registerActiveSignerScope(input: SignerScopeRegistration): void {
    const binding = normalizeSignerBinding(input.binding);
    assertTestnetSigningCapability(binding.network);
    assertTime(input.activatedAt, "activatedAt");
    this.immediate(() => {
      const fingerprint = agentAddressFingerprint(binding.agentAddress);
      const retired = this.database.getFirstSync<{ one: number }>(
        `SELECT 1 AS one FROM retired_signer_tombstones
         WHERE network = ? AND agent_address_fingerprint = ?`,
        [binding.network, fingerprint],
      );
      if (retired !== null) {
        throw new Error(
          "A retired agent address can never become active again.",
        );
      }
      const existing = this.scope(binding.network, binding.agentAddress);
      if (existing !== null) {
        assertSignerBinding(binding, bindingFromScope(existing));
        if (existing.status !== "active") {
          throw new Error("The signer scope is not active.");
        }
        return;
      }
      this.database.runSync(
        `INSERT INTO signer_scopes (
          network, agent_address, master_account, target_account,
          signer_generation, status, last_issued_nonce,
          last_observed_wall_ms, activated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)`,
        [
          binding.network,
          binding.agentAddress,
          binding.masterAccount,
          binding.targetAccount,
          binding.generation,
          input.activatedAt,
          input.activatedAt,
        ],
      );
    });
  }

  reservePreparedAction(
    input: AtomicActionReservationInput,
  ): PreparedActionRecord {
    const binding = normalizeSignerBinding(input.binding);
    assertTestnetSigningCapability(binding.network);
    if (
      !Number.isSafeInteger(input.capturedContextEpoch) ||
      input.capturedContextEpoch < 0
    ) {
      throw new TypeError(
        "capturedContextEpoch must be a non-negative integer.",
      );
    }
    const serializedIntent = assertReservationIdentifiers(input.preparedAction);
    return this.contextEpochAuthority.commitIfCurrent(
      { binding, capturedContextEpoch: input.capturedContextEpoch },
      () => {
        const record = this.immediate(() => {
          const scope = this.scope(binding.network, binding.agentAddress);
          if (scope === null) {
            throw new Error("The signer scope is not registered.");
          }
          assertSignerBinding(binding, bindingFromScope(scope));
          if (scope.status !== "active") {
            throw new Error("The signer scope cannot issue another nonce.");
          }
          const allocation = allocateNonce({
            ...input.clock,
            lastIssuedNonce: scope.last_issued_nonce,
            lastObservedWallMs: scope.last_observed_wall_ms,
          });
          const scopeUpdate = this.database.runSync(
            `UPDATE signer_scopes
         SET last_issued_nonce = ?, last_observed_wall_ms = ?, updated_at = ?
         WHERE network = ? AND agent_address = ? AND status = 'active'
           AND signer_generation = ?`,
            [
              allocation.nonce,
              allocation.observedWallMs,
              allocation.observedWallMs,
              binding.network,
              binding.agentAddress,
              binding.generation,
            ],
          );
          if (scopeUpdate.changes !== 1) {
            throw new Error(
              "The signer scope changed during nonce reservation.",
            );
          }
          const action = input.preparedAction;
          const now = allocation.observedWallMs;
          this.database.runSync(
            `INSERT INTO action_journal (
          journal_id, correlation_id, network, master_account, target_account,
          agent_address, signer_generation, captured_context_epoch, action_type,
          intent_version, normalized_secret_free_intent, intent_digest,
          equivalence_fingerprint, nonce, expires_after_ms, cloid, asset_id,
          target_oid, reconciliation_key, prepared_at, state,
          submission_started_at, last_result_class, lease_owner,
          lease_expires_at, reconciliation_attempts, next_reconciliation_at,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'prepared', NULL, NULL, NULL, NULL, 0, ?, ?, ?
        )`,
            [
              action.journalId,
              action.correlationId,
              binding.network,
              binding.masterAccount,
              binding.targetAccount,
              binding.agentAddress,
              binding.generation,
              input.capturedContextEpoch,
              action.actionType,
              action.intentVersion,
              serializedIntent,
              action.intentDigest,
              action.equivalenceFingerprint,
              allocation.nonce,
              allocation.expiresAfterMs,
              action.cloid,
              action.assetId,
              action.targetOid,
              action.reconciliationKey,
              now,
              now,
              now,
              now,
            ],
          );
          return this.requireAction(action.journalId);
        });
        this.registerCurrentProcessReservation(
          record.journalId,
          record.expiresAfterMs,
          record.preparedAt,
        );
        return record;
      },
    );
  }

  markSignerRetiring(bindingInput: SignerBinding, now: number): void {
    const binding = normalizeSignerBinding(bindingInput);
    assertTestnetSigningCapability(binding.network);
    assertTime(now, "now");
    this.immediate(() => {
      const scope = this.scope(binding.network, binding.agentAddress);
      if (scope === null) {
        throw new Error("The signer scope does not exist.");
      }
      assertSignerBinding(binding, bindingFromScope(scope));
      if (scope.status === "retiring") {
        return;
      }
      if (scope.status !== "active") {
        throw new Error("Only an active signer can begin retirement.");
      }
      this.database.runSync(
        `UPDATE signer_scopes SET status = 'retiring', updated_at = ?
         WHERE network = ? AND agent_address = ? AND status = 'active'`,
        [now, binding.network, binding.agentAddress],
      );
    });
  }

  retireSignerScope(
    bindingInput: SignerBinding,
    input: RetiredSignerTombstoneInput,
  ): RetiredSignerTombstone {
    const binding = normalizeSignerBinding(bindingInput);
    assertTestnetSigningCapability(binding.network);
    return this.immediate(() => {
      const scope = this.scope(binding.network, binding.agentAddress);
      if (scope === null) {
        throw new Error("The signer scope does not exist.");
      }
      assertSignerBinding(binding, bindingFromScope(scope));
      if (scope.status !== "retiring") {
        throw new Error("The signer must be locked for retirement first.");
      }
      if (input.reason === "rotated" || input.reason === "expired") {
        const pending = this.database.getFirstSync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM action_journal
           WHERE network = ? AND agent_address = ?
             AND state NOT IN (${TERMINAL_JOURNAL_STATES_SQL})`,
          [binding.network, binding.agentAddress],
        );
        if ((pending?.count ?? 0) !== 0) {
          throw new Error(
            "Ordinary signer retirement requires terminal actions.",
          );
        }
      }
      const chain = this.verifyTombstoneChain();
      if (chain.status === "invalid") {
        throw new Error(`The retirement chain is corrupt: ${chain.reason}.`);
      }
      const head = chain.head;
      const expectedSequence = (head?.sequence ?? 0) + 1;
      const expectedPriorRoot = head?.chain_root ?? EMPTY_RETIREMENT_CHAIN_ROOT;
      const expectedFingerprint = agentAddressFingerprint(binding.agentAddress);
      if (
        input.installationEpoch !==
          (head?.installation_epoch ?? input.installationEpoch) ||
        input.sequence !== expectedSequence ||
        input.priorChainRoot !== expectedPriorRoot ||
        input.network !== binding.network ||
        input.agentAddressFingerprint !== expectedFingerprint ||
        input.lastIssuedNonce !== (scope.last_issued_nonce ?? 0) ||
        input.generation !== binding.generation
      ) {
        throw new Error(
          "The signer retirement tombstone does not match durable state.",
        );
      }
      const tombstone = createRetiredSignerTombstone(input);
      this.database.runSync(
        `INSERT INTO retired_signer_tombstones (
          installation_epoch, sequence, prior_chain_root, chain_root, network,
          agent_address_fingerprint, last_issued_nonce, signer_generation,
          retired_at, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tombstone.installationEpoch,
          tombstone.sequence,
          tombstone.priorChainRoot,
          tombstone.chainRoot,
          tombstone.network,
          tombstone.agentAddressFingerprint,
          tombstone.lastIssuedNonce,
          tombstone.generation,
          tombstone.retiredAt,
          tombstone.reason,
        ],
      );
      const result = this.database.runSync(
        `UPDATE signer_scopes SET status = 'retired', updated_at = ?
         WHERE network = ? AND agent_address = ? AND status = 'retiring'`,
        [tombstone.retiredAt, binding.network, binding.agentAddress],
      );
      if (result.changes !== 1) {
        throw new Error("The signer retirement lost its compare-and-swap.");
      }
      return tombstone;
    });
  }

  compareRetirementManifest(input: {
    readonly installationEpoch: string;
    readonly sequence: number;
    readonly chainRoot: `0x${string}`;
  }): RetirementManifestComparison {
    if (
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 0 ||
      !LOWERCASE_HASH_PATTERN.test(input.chainRoot) ||
      input.installationEpoch.length < 16 ||
      input.installationEpoch.length > 128
    ) {
      return { status: "quarantine", reason: "invalid_manifest" };
    }
    const chain = this.verifyTombstoneChain();
    if (chain.status === "invalid") {
      return { status: "quarantine", reason: chain.reason };
    }
    const head = chain.head;
    if (head === null) {
      return input.sequence === 0 &&
        input.chainRoot === EMPTY_RETIREMENT_CHAIN_ROOT
        ? { status: "match" }
        : { status: "quarantine", reason: "manifest_ahead_or_sqlite_restored" };
    }
    if (head.installation_epoch !== input.installationEpoch) {
      return { status: "quarantine", reason: "installation_epoch_mismatch" };
    }
    if (
      head.sequence === input.sequence &&
      head.chain_root === input.chainRoot
    ) {
      return { status: "match" };
    }
    if (head.sequence === input.sequence + 1) {
      const prior = this.database.getFirstSync<{
        prior_chain_root: `0x${string}`;
      }>(
        `SELECT prior_chain_root FROM retired_signer_tombstones
         WHERE installation_epoch = ? AND sequence = ?`,
        [head.installation_epoch, head.sequence],
      );
      if (prior?.prior_chain_root === input.chainRoot) {
        return {
          status: "sqlite_ahead",
          sequence: head.sequence,
          chainRoot: head.chain_root,
        };
      }
    }
    return { status: "quarantine", reason: "retirement_chain_mismatch" };
  }

  private scope(
    network: "mainnet" | "testnet",
    agentAddress: string,
  ): SignerScopeRow | null {
    return this.database.getFirstSync<SignerScopeRow>(
      `SELECT * FROM signer_scopes WHERE network = ? AND agent_address = ?`,
      [network, agentAddress],
    );
  }

  private verifyTombstoneChain():
    | { readonly status: "valid"; readonly head: TombstoneHeadRow | null }
    | { readonly status: "invalid"; readonly reason: string } {
    const rows = this.database.getAllSync<TombstoneRow>(
      `SELECT installation_epoch, sequence, prior_chain_root, chain_root,
              network, agent_address_fingerprint, last_issued_nonce,
              signer_generation, retired_at, reason
       FROM retired_signer_tombstones
       ORDER BY sequence`,
    );
    if (rows.length === 0) {
      return { status: "valid", head: null };
    }
    const installationEpoch = rows[0]?.installation_epoch;
    let priorChainRoot: `0x${string}` = EMPTY_RETIREMENT_CHAIN_ROOT;
    for (const [index, row] of rows.entries()) {
      if (
        row.installation_epoch !== installationEpoch ||
        row.sequence !== index + 1 ||
        row.prior_chain_root !== priorChainRoot
      ) {
        return { status: "invalid", reason: "retirement_chain_gap_or_link" };
      }
      try {
        const recomputed = createRetiredSignerTombstone({
          installationEpoch: row.installation_epoch,
          sequence: row.sequence,
          priorChainRoot: row.prior_chain_root,
          network: row.network,
          agentAddressFingerprint: row.agent_address_fingerprint,
          lastIssuedNonce: row.last_issued_nonce,
          generation: row.signer_generation,
          retiredAt: row.retired_at,
          reason: row.reason,
        });
        if (recomputed.chainRoot !== row.chain_root) {
          return {
            status: "invalid",
            reason: "retirement_chain_root_mismatch",
          };
        }
      } catch {
        return { status: "invalid", reason: "retirement_chain_invalid_row" };
      }
      priorChainRoot = row.chain_root;
    }
    const head = rows.at(-1);
    return head === undefined
      ? { status: "valid", head: null }
      : {
          status: "valid",
          head: {
            installation_epoch: head.installation_epoch,
            sequence: head.sequence,
            chain_root: head.chain_root,
          },
        };
  }
}
