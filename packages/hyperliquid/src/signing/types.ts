import type { HyperliquidNetwork } from "../network";

export interface SignerBinding {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly agentAddress: string;
  readonly generation: number;
}

export interface Eip712Field {
  readonly name: string;
  readonly type: string;
}

export interface Eip712Payload {
  readonly domain: {
    readonly name: string;
    readonly version: string;
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
  };
  readonly types: Readonly<Record<string, readonly Eip712Field[]>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}

export interface NetworkTypedData {
  readonly network: HyperliquidNetwork;
  readonly typedData: Eip712Payload;
}

export interface Eip712Signature {
  readonly r: `0x${string}`;
  readonly s: `0x${string}`;
  readonly v: 27 | 28;
}

export interface InjectedTypedDataSigner {
  readonly binding: SignerBinding;
  signTypedData(payload: Eip712Payload): Promise<Eip712Signature>;
}

export interface InjectedBytesSigner {
  readonly binding: SignerBinding;
  signBytes(payload: Uint8Array): Promise<Eip712Signature>;
}
