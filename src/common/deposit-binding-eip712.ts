import { zeroAddress } from "viem";

// EIP-712 domain and types for deposit binding
export const DEPOSIT_BINDING_DOMAIN = (
  chainId: number = 42161,
  verifyingContract: `0x${string}` = zeroAddress
) => ({
  name: "RelayDepositBinding",
  version: "1",
  chainId,
  verifyingContract,
});

export const DEPOSIT_BINDING_TYPES = {
  DepositBinding: [
    { name: "depositor", type: "address" },
    { name: "depositId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
};

export interface DepositBindingMessage extends Record<string, unknown> {
  depositor: string;
  depositId: string; // 0x prefixed hex
  nonce: string | number; // milliseconds timestamp
}

// Generate a nonce based on current timestamp
export const generateNonce = (): string => {
  const timestamp = Date.now();
  return `${timestamp}`;
};

// Generate deposit binding message for signing (used by solver)
export function createDepositBindingMessage(
  depositor: string,
  depositId: string,
  nonce?: string | number
): DepositBindingMessage {
  return {
    depositor,
    depositId,
    nonce: nonce || generateNonce(),
  };
}

// Create full EIP-712 typed data for signing (used by solver)
export function createDepositBindingTypedData(
  depositor: string,
  depositId: string,
  nonce?: string | number,
  chainId?: number,
  verifyingContract?: `0x${string}`
) {
  const domain = DEPOSIT_BINDING_DOMAIN(chainId, verifyingContract);
  const message = createDepositBindingMessage(depositor, depositId, nonce);
  
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      ...DEPOSIT_BINDING_TYPES,
    },
    primaryType: "DepositBinding",
    domain,
    message,
  };
}

import { recoverTypedDataAddress } from "viem";

// Verify deposit binding signature using viem
export async function verifyDepositBindingSignature(
  signature: `0x${string}`,
  domain: any,
  message: DepositBindingMessage
): Promise<`0x${string}`> {
  const recovered = await recoverTypedDataAddress({
    domain,
    types: DEPOSIT_BINDING_TYPES,
    primaryType: "DepositBinding",
    message,
    signature,
  });
  return recovered;
}