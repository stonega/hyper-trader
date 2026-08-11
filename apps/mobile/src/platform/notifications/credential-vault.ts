const SERVICE = "hypertrader.notification-installation.v1";
const ID = /^[0-9a-f]{32}$/;
const CREDENTIAL = /^[0-9a-f]{64}$/;

interface SecureStoreOptionsLike {
  readonly keychainService: string;
  readonly requireAuthentication?: boolean;
  readonly keychainAccessible?: number;
}

export interface NotificationSecureStorePort {
  readonly whenPasscodeSetThisDeviceOnly?: number;
  setItem(
    key: string,
    value: string,
    options: SecureStoreOptionsLike,
  ): Promise<void>;
  getItem(key: string, options: SecureStoreOptionsLike): Promise<string | null>;
  deleteItem(key: string, options: SecureStoreOptionsLike): Promise<void>;
}

export interface NotificationCredentialVault {
  write(input: {
    readonly installationId: string;
    readonly credential: string;
  }): Promise<void>;
  read(installationId: string): Promise<string | null>;
  remove(installationId: string): Promise<void>;
}

export function createNotificationCredentialVault(options: {
  readonly store: NotificationSecureStorePort;
}): NotificationCredentialVault {
  const secureOptions: SecureStoreOptionsLike = {
    keychainService: SERVICE,
    requireAuthentication: false,
    ...(options.store.whenPasscodeSetThisDeviceOnly === undefined
      ? {}
      : {
          keychainAccessible: options.store.whenPasscodeSetThisDeviceOnly,
        }),
  };
  return {
    async write(input) {
      assertInstallationId(input.installationId);
      if (!CREDENTIAL.test(input.credential)) malformed();
      await options.store.setItem(
        credentialKey(input.installationId),
        input.credential,
        secureOptions,
      );
    },
    async read(installationId) {
      assertInstallationId(installationId);
      const credential = await options.store.getItem(
        credentialKey(installationId),
        secureOptions,
      );
      if (credential !== null && !CREDENTIAL.test(credential)) malformed();
      return credential;
    },
    async remove(installationId) {
      assertInstallationId(installationId);
      await options.store.deleteItem(
        credentialKey(installationId),
        secureOptions,
      );
    },
  };
}

function credentialKey(installationId: string): string {
  return `installation.${installationId}`;
}

function assertInstallationId(value: string): void {
  if (!ID.test(value)) malformed();
}

function malformed(): never {
  throw new TypeError("The notification installation credential is malformed.");
}
