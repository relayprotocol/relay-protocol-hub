import { describe, expect, it, jest } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import saveBindingEndpoint from "../../src/api/actions/deposits/bindings/v1";
import queryBindingEndpoint from "../../src/api/queries/deposits/by-nonce";
import { saveDepositBinding } from "../../src/models/deposit-bindings";
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
    const depositor = account.address;
    const depositId = randomHex(32);
    const nonce = generateNonce();

    // Create signature using helper functions
    const { signature, typedData } = await createSignature(depositor, depositId, nonce, privateKey);

    // Verify signature using existing helper
    const recoveredAddress = await verifyDepositBindingSignature(
      signature as `0x${string}`,
      typedData.domain,
      typedData.message
    );
    expect(recoveredAddress.toLowerCase()).toBe(depositor.toLowerCase());

    console.log("Test data:");
    console.log("- Depositor:", depositor);
    console.log("- Deposit ID:", depositId);
    console.log("- Nonce:", nonce);
    console.log("- Signature:", signature);

    // Create mock request and reply
    const req = createMockRequest({
      depositor,
      depositId,
      nonce,
      signature,
    });
    const reply = createMockReply();

    // Call the handler
    await saveBindingEndpoint.handler(req as any, reply as any);

    // Verify reply was called correctly
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      nonce,
      depositId,
      depositor,
      bindingSignature: signature,
    });

    console.log("✅ Save handler executed successfully");
  });

  it("should handle GET /queries/deposits/by-nonce/:nonce/:depositor", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const depositor = account.address;
    const depositId = randomHex(32);
    const nonce = generateNonce();

    // Create signature
    const { signature } = await createSignature(depositor, depositId, nonce, privateKey);

    // Save to database first
    await saveDepositBinding({
      nonce,
      depositId,
      depositor,
      signature,
    });

    // Create mock request and reply for query
    const req = createMockRequest({}, { nonce, depositor });
    const reply = createMockReply();

    // Call the query handler
    await queryBindingEndpoint.handler(req as any, reply as any);

    // Verify reply was called correctly
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      nonce,
      depositId,
      depositor,
      bindingSignature: signature,
    });

    console.log("✅ Query handler executed successfully");
  });

  it("should handle error case - binding not found", async () => {
    const nonExistentNonce = "999999999";
    const nonExistentDepositor = randomHex(20);

    const req = createMockRequest({}, { 
      nonce: nonExistentNonce, 
      depositor: nonExistentDepositor 
    });
    const reply = createMockReply();

    // Call the query handler - should throw error
    await expect(
      queryBindingEndpoint.handler(req as any, reply as any)
    ).rejects.toThrow("Deposit binding not found");

    console.log("✅ Error handling works correctly");
  });

  it("should handle error case - duplicate nonce", async () => {
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const depositor = account.address;
    const depositId = randomHex(32);
    const nonce = generateNonce();

    // Create and save first binding
    const { signature } = await createSignature(depositor, depositId, nonce, privateKey);
    await saveDepositBinding({
      nonce,
      depositId,
      depositor,
      signature,
    });

    // Try to create another binding with same nonce/depositor
    const req = createMockRequest({
      depositor,
      depositId: randomHex(32), // Different deposit ID
      nonce, // Same nonce
      signature: randomHex(64), // Different signature
    });
    const reply = createMockReply();

    // Call the handler - should throw error
    await expect(
      saveBindingEndpoint.handler(req as any, reply as any)
    ).rejects.toThrow("Nonce already exists");

    console.log("✅ Duplicate nonce error handling works correctly");
  });

  it("should handle complete flow - save then query using EIP-712 helpers", async () => {
    console.log("\n=== Complete Flow Test with EIP-712 Helpers ===");
    
    // Generate test data
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const depositor = account.address;
    const depositId = randomHex(32);
    const nonce = generateNonce();

    console.log("Generated data:");
    console.log("- Depositor:", depositor);
    console.log("- Deposit ID:", depositId);
    console.log("- Nonce:", nonce);

    // Create signature using helper functions
    const { signature, typedData } = await createSignature(depositor, depositId, nonce, privateKey);

    // Verify signature works
    const recoveredAddress = await verifyDepositBindingSignature(
      signature as `0x${string}`,
      typedData.domain,
      typedData.message
    );
    expect(recoveredAddress.toLowerCase()).toBe(depositor.toLowerCase());
    console.log("✅ Signature verification passed");

    // Step 1: Save via handler
    const saveReq = createMockRequest({
      depositor,
      depositId,
      nonce,
      signature,
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

    console.log("✅ Save handler completed");

    // Step 2: Query via handler
    const queryReq = createMockRequest({}, { nonce, depositor });
    const queryReply = createMockReply();

    await queryBindingEndpoint.handler(queryReq as any, queryReply as any);

    expect(queryReply.status).toHaveBeenCalledWith(200);
    expect(queryReply.send).toHaveBeenCalledWith({
      nonce,
      depositId,
      depositor,
      bindingSignature: signature,
    });

    console.log("✅ Query handler completed");
    console.log("✅ Complete flow test passed with EIP-712 helpers");
  });
});