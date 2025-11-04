import { describe, expect, it, jest } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import saveBindingEndpoint from "../../src/api/actions/deposits/bindings/v1";
import queryBindingEndpoint from "../../src/api/queries/deposits/by-nonce";
import { saveRequestIdMapping } from "../../src/models/request-mappings";
import {
  createDepositBindingTypedData,
  verifyDepositBindingSignature,
  generateNonce,
} from "../../src/common/deposit-binding-eip712";
import { randomHex } from "../common/utils";

// Helper to create signature using viem
const createSignature = async (depositor: string, depositId: string, nonce: string, privateKey: `0x${string}`) => {
  const typedData = createDepositBindingTypedData(depositor, depositId, nonce);
  
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signTypedData({
    domain: typedData.domain as any,
    types: typedData.types,
    primaryType: typedData.primaryType as "DepositBinding",
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

describe("deposit-bindings API handlers", () => {
  it("should handle POST /actions/deposits/bindings/v1 with valid signature", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const wallet = account.address;
    const requestId = randomHex(32);
    const nonce = generateNonce();
    const chainId = "42161";

    // Create signature using helper functions
    const { signature, typedData } = await createSignature(wallet, requestId, nonce, privateKey);

    // Verify signature using existing helper
    const recoveredAddress = await verifyDepositBindingSignature(
      signature as `0x${string}`,
      typedData.domain,
      typedData.message
    );
    expect(recoveredAddress.toLowerCase()).toBe(wallet.toLowerCase());

    // Create mock request and reply
    const req = createMockRequest({
      depositor: wallet,
      depositId: requestId,
      nonce,
      signature,
      chainId,
    });
    const reply = createMockReply();

    // Call the handler
    await saveBindingEndpoint.handler(req as any, reply as any);

    // Verify reply was called correctly
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      nonce,
      depositId: requestId,
      depositor: wallet,
      bindingSignature: signature,
    });

  });

  it("should handle GET /queries/deposits/by-nonce/:nonce/:depositor/:chainId", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const wallet = account.address;
    const requestId = randomHex(32);
    const nonce = generateNonce();
    const chainId = "42161";

    // Create signature
    const { signature } = await createSignature(wallet, requestId, nonce, privateKey);

    // Save to database first
    await saveRequestIdMapping({
      chainId,
      nonce,
      requestId,
      wallet,
      signature,
    });

    // Create mock request and reply for query
    const req = createMockRequest({}, { nonce, depositor: wallet, chainId });
    const reply = createMockReply();

    // Call the query handler
    await queryBindingEndpoint.handler(req as any, reply as any);

    // Verify reply was called correctly
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      nonce,
      depositId: requestId,
      depositor: wallet,
      bindingSignature: signature,
    });

  });

  it("should handle error case - mapping not found", async () => {
    const nonExistentNonce = "999999999";
    const nonExistentWallet = randomHex(20);
    const chainId = "42161";

    const req = createMockRequest({}, { 
      nonce: nonExistentNonce, 
      depositor: nonExistentWallet,
      chainId
    });
    const reply = createMockReply();

    // Call the query handler - should throw error
    await expect(
      queryBindingEndpoint.handler(req as any, reply as any)
    ).rejects.toThrow("Deposit binding not found");

  });

  it("should handle error case - duplicate nonce", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const depositor = account.address;
    const depositId = randomHex(32);
    const nonce = generateNonce();
    const chainId = "42161";

    // Create and save first mapping
    const { signature } = await createSignature(depositor, depositId, nonce, privateKey);
    await saveRequestIdMapping({
      chainId,
      nonce,
      requestId: depositId,
      wallet: depositor,
      signature,
    });

    // Try to create another mapping with same depositor/nonce
    const req = createMockRequest({
      depositor,
      depositId,
      nonce, // Same nonce
      signature,
      chainId,
    });
    const reply = createMockReply();

    // Call the handler - should throw error
    await expect(
      saveBindingEndpoint.handler(req as any, reply as any)
    ).rejects.toThrow("Nonce already exists");

  });

  it("should handle complete flow - save then query using EIP-712 helpers", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const depositor = account.address;
    const depositId = randomHex(32);
    const nonce = generateNonce();
    const chainId = "42161";

    // Create signature using helper functions
    const { signature, typedData } = await createSignature(depositor, depositId, nonce, privateKey);

    // Verify signature works
    const recoveredAddress = await verifyDepositBindingSignature(
      signature as `0x${string}`,
      typedData.domain,
      typedData.message
    );
    expect(recoveredAddress.toLowerCase()).toBe(depositor.toLowerCase());

    // Step 1: Save via handler
    const saveReq = createMockRequest({
      depositor,
      depositId,
      nonce,
      signature,
      chainId,
    });
    const saveReply = createMockReply();

    await saveBindingEndpoint.handler(saveReq as any, saveReply as any);

    expect(saveReply.status).toHaveBeenCalledWith(200);
    expect(saveReply.send).toHaveBeenCalledWith({
      nonce,
      depositId,
      depositor,
      bindingSignature: signature,
    });

    // Step 2: Query via handler
    const queryReq = createMockRequest({}, { nonce, depositor, chainId });
    const queryReply = createMockReply();

    await queryBindingEndpoint.handler(queryReq as any, queryReply as any);

    expect(queryReply.status).toHaveBeenCalledWith(200);
    expect(queryReply.send).toHaveBeenCalledWith({
      nonce,
      depositId,
      depositor,
      bindingSignature: signature,
    });
  });
});