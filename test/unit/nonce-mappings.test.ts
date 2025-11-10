import { describe, expect, it, jest } from "@jest/globals";
import { recoverTypedDataAddress, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import saveEndpoint from "../../src/api/actions/nonce-mappings/v1";
import queryEndpoint from "../../src/api/queries/nonce-mappings/v1";
import { saveNonceMapping } from "../../src/models/nonce-mappings";

import { randomHex } from "../common/utils";

const NONCE_MAPPING_DOMAIN = (chainId: number) => ({
  name: "RelayNonceMapping",
  version: "1",
  chainId,
  verifyingContract: zeroAddress,
});

const NONCE_MAPPING_TYPES = {
  NonceMapping: [
    { name: "chainId", type: "string" },
    { name: "wallet", type: "address" },
    { name: "id", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
};

interface NonceMappingMessage extends Record<string, unknown> {
  chainId: string;
  wallet: string;
  id: string;
  nonce: string | number;
}

// Generate a nonce based on current timestamp
const generateNonce = (): string => {
  const timestamp = Date.now();
  return `${timestamp}`;
};

// Generate deposit binding message for signing (used by solver)
const createNonceMappingMessage = (
  chainId: string,
  wallet: string,
  id: string,
  nonce?: string | number
): NonceMappingMessage => {
  return {
    chainId,
    wallet,
    id,
    nonce: nonce || generateNonce(),
  };
};

// Create full EIP-712 typed data for signing (used by solver)
const createNonceMappingTypedData = (
  walletChainId: string,
  wallet: string,
  nonce: string,
  id: string,
  signatureChainId: number
) => {
  const domain = NONCE_MAPPING_DOMAIN(signatureChainId);
  const message = createNonceMappingMessage(walletChainId, wallet, id, nonce);

  return {
    types: NONCE_MAPPING_TYPES,
    primaryType: "NonceMapping",
    domain,
    message,
  };
};

const getNonceMappingSigner = async (
  signature: `0x${string}`,
  domain: any,
  message: NonceMappingMessage
): Promise<`0x${string}`> =>
  recoverTypedDataAddress({
    domain,
    types: NONCE_MAPPING_TYPES,
    primaryType: "NonceMapping",
    message,
    signature,
  });

// Helper to create signature using viem
const createSignature = async (
  walletChainId: string,
  wallet: string,
  id: string,
  nonce: string,
  privateKey: `0x${string}`
) => {
  const typedData = createNonceMappingTypedData(
    walletChainId,
    wallet,
    nonce,
    id,
    1
  );

  const account = privateKeyToAccount(privateKey);
  const signature = await account.signTypedData({
    domain: typedData.domain as any,
    types: typedData.types,
    primaryType: typedData.primaryType as "NonceMapping",
    message: typedData.message,
  });

  return { signature, typedData };
};

// Mock fastify request and reply objects
const createMockReply = () => ({
  status: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
});

const createMockRequest = (body: any = {}, params: any = {}) => ({
  body,
  params,
});

describe("nonce-mappings api handlers", () => {
  it("should handle post /actions/nonce-mappings/v1 with valid signature", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const wallet = account.address.toLowerCase();
    const id = randomHex(32);
    const nonce = generateNonce();
    const chainId = "ethereum";

    // Create signature using helper functions
    const { signature, typedData } = await createSignature(
      chainId,
      wallet,
      id,
      nonce,
      privateKey
    );

    // Verify signature using existing helper
    const recoveredAddress = await getNonceMappingSigner(
      signature as `0x${string}`,
      typedData.domain,
      typedData.message
    );
    expect(recoveredAddress.toLowerCase()).toBe(wallet.toLowerCase());

    // Create mock request and reply
    const req = createMockRequest({
      walletChainId: chainId,
      wallet,
      id,
      nonce,
      signatureChainId: chainId,
      signature,
    });
    const reply = createMockReply();

    // Call the handler
    await saveEndpoint.handler(req as any, reply as any);

    // Verify reply was called correctly
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it("should handle get /queries/nonce-mappings/:walletChainId/:wallet/:nonce/v1", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const wallet = account.address.toLowerCase();
    const id = randomHex(32);
    const nonce = generateNonce();
    const chainId = "ethereum";

    // Create signature
    const { signature } = await createSignature(
      chainId,
      wallet,
      id,
      nonce,
      privateKey
    );

    // Save to database first
    await saveNonceMapping({
      walletChainId: chainId,
      wallet,
      nonce,
      id,
      signatureChainId: chainId,
      signature,
    });

    // Create mock request and reply for query
    const req = createMockRequest(
      {},
      {
        walletChainId: chainId,
        wallet,
        nonce,
      }
    );
    const reply = createMockReply();

    // Call the query handler
    await queryEndpoint.handler(req as any, reply as any);

    // Verify reply was called correctly
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      walletChainId: chainId,
      wallet,
      nonce,
      id,
      signatureChainId: chainId,
      signature,
    });
  });

  it("should handle nonce-mapping not found", async () => {
    const nonce = "999999999";
    const wallet = randomHex(20);
    const chainId = "ethereum";

    const req = createMockRequest(
      {},
      {
        walletChainId: chainId,
        wallet,
        nonce,
      }
    );
    const reply = createMockReply();

    // Call the query handler - should throw error
    await expect(
      queryEndpoint.handler(req as any, reply as any)
    ).rejects.toThrow("Nonce mapping not found");
  });

  it("should handle duplicate nonce-mapping", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const wallet = account.address.toLowerCase();
    const id = randomHex(32);
    const nonce = generateNonce();
    const chainId = "ethereum";

    // Create and save first mapping
    const { signature } = await createSignature(
      chainId,
      wallet,
      id,
      nonce,
      privateKey
    );
    await saveNonceMapping({
      walletChainId: chainId,
      wallet,
      nonce,
      id,
      signatureChainId: chainId,
      signature,
    });

    // Try to create another mapping with same depositor/nonce
    const req = createMockRequest({
      walletChainId: chainId,
      wallet,
      id,
      nonce,
      signatureChainId: chainId,
      signature,
    });
    const reply = createMockReply();

    // Call the handler - should throw error
    await expect(
      saveEndpoint.handler(req as any, reply as any)
    ).rejects.toThrow("Nonce mapping already exists");
  });

  it("should handle user retry scenario - multiple attempts with different nonces", async () => {
    // Generate test data for same wallet
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const wallet = account.address.toLowerCase();
    const chainId = "ethereum";

    // First attempt - user creates mapping but abandons
    const firstId = randomHex(32);
    const firstNonce = generateNonce();
    const { signature: firstSignature } = await createSignature(
      chainId,
      wallet,
      firstId,
      firstNonce,
      privateKey
    );

    // Save first mapping
    const firstSaveReq = createMockRequest({
      walletChainId: chainId,
      wallet,
      nonce: firstNonce,
      id: firstId,
      signatureChainId: chainId,
      signature: firstSignature,
    });
    const firstSaveReply = createMockReply();

    await saveEndpoint.handler(firstSaveReq as any, firstSaveReply as any);

    expect(firstSaveReply.status).toHaveBeenCalledWith(200);

    // Second attempt - user retries with new mapping
    const secondId = randomHex(32);
    const secondNonce = generateNonce();
    const { signature: secondSignature } = await createSignature(
      chainId,
      wallet,
      secondId,
      secondNonce,
      privateKey
    );

    // Save second mapping
    const secondSaveReq = createMockRequest({
      walletChainId: chainId,
      wallet,
      nonce: secondNonce,
      id: secondId,
      signatureChainId: chainId,
      signature: secondSignature,
    });
    const secondSaveReply = createMockReply();

    await saveEndpoint.handler(secondSaveReq as any, secondSaveReply as any);

    expect(secondSaveReply.status).toHaveBeenCalledWith(200);

    // Verify both mappings can be queried independently

    const firstQueryReq = createMockRequest(
      {},
      { walletChainId: chainId, wallet, nonce: firstNonce }
    );
    const firstQueryReply = createMockReply();

    await queryEndpoint.handler(firstQueryReq as any, firstQueryReply as any);

    expect(firstQueryReply.status).toHaveBeenCalledWith(200);
    expect(firstQueryReply.send).toHaveBeenCalledWith({
      walletChainId: chainId,
      wallet,
      nonce: firstNonce,
      id: firstId,
      signatureChainId: chainId,
      signature: firstSignature,
    });

    // Query second binding
    const secondQueryReq = createMockRequest(
      {},
      { walletChainId: chainId, wallet, nonce: secondNonce }
    );
    const secondQueryReply = createMockReply();

    await queryEndpoint.handler(secondQueryReq as any, secondQueryReply as any);

    expect(secondQueryReply.status).toHaveBeenCalledWith(200);
    expect(secondQueryReply.send).toHaveBeenCalledWith({
      walletChainId: chainId,
      wallet,
      nonce: secondNonce,
      id: secondId,
      signatureChainId: chainId,
      signature: secondSignature,
    });
  });
});
