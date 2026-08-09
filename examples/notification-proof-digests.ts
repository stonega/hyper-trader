import { operationDigest, sha256Hex } from "@hyper-trader/notifications";

const installationId = "11".repeat(16);
const accountLinkId = "22".repeat(16);
const provider = "expo" as const;
const pushToken = "ExponentPushToken[local-documentation-fixture]";
const tokenFingerprint = await sha256Hex(pushToken);

const rebindDigest = await operationDigest("push-token-rebind/v1", {
  installationId,
  accountLinkId,
  provider,
  tokenFingerprint,
});

const lostInstallationDigest = await operationDigest(
  "lost-installation-revoke/v1",
  {
    requestingInstallationId: installationId,
    operationId: "33".repeat(16),
    network: "testnet",
    masterAccount: `0x${"44".repeat(20)}`,
    targetAccount: `0x${"55".repeat(20)}`,
    selectedInstallationIds: ["66".repeat(16), "77".repeat(16)],
  },
);

console.log(
  JSON.stringify(
    {
      proofPurpose: "notification-push-token-rebind",
      tokenFingerprint,
      rebindDigest,
      lostInstallationDigest,
    },
    null,
    2,
  ),
);
