import {
  Address,
  createPublicClient,
  createWalletClient,
  fromHex,
  getContract,
  Hex,
  http,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { externalError } from "./error";
import { config } from "../config";
import { getWithdrawalRequest } from "../models/withdrawal-requests";
import { getChain } from "./chains";

const getPublicAndWalletClients = () => {
  const httpRpcUrl = "https://mainnet.aurora.dev";
  const chain = {
    id: 1313161554,
    name: "Aurora",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [httpRpcUrl],
      },
    },
  };

  const publicClient = createPublicClient({
    chain,
    transport: http(httpRpcUrl),
  });
  const walletClient = createWalletClient({
    account: privateKeyToAccount(config.onchainAllocatorSenderPk as Hex),
    chain,
    transport: http(httpRpcUrl),
  });

  return { publicClient, walletClient };
};

const getPayloadBuilder = (address: string) => {
  const { publicClient, walletClient } = getPublicAndWalletClients();

  return {
    contract: getContract({
      client: walletClient,
      address: address as Address,
      abi: parseAbi([
        `function hashesToSign(uint256 chainId, string depository, bytes unsignedPayload) view returns (bytes32[])`,
      ]),
    }),
    publicClient,
    walletClient,
  };
};

export const getOnchainAllocator = () => {
  if (!config.onchainAllocator || !config.onchainAllocatorSenderPk) {
    throw externalError("Onchain allocator not configured");
  }

  const { publicClient, walletClient } = getPublicAndWalletClients();

  const PayloadParams =
    "(uint256 chainId, string depository, string currency, uint256 amount, address spender, string receiver, bytes data, bytes32 nonce)";
  const GasSettings = "(uint64 signGas, uint64 callbackGas)";

  return {
    contract: getContract({
      client: walletClient,
      address: config.onchainAllocator as Address,
      abi: parseAbi([
        `function submitWithdrawRequest(${PayloadParams} params) returns (bytes32)`,
        `function signWithdrawPayload(bytes32 payloadId, bytes signature, ${GasSettings} gasSettings)`,
        `function payloads(bytes32 payloadId) view returns (${PayloadParams} params, bytes unsignedPayload)`,
        `function payloadTimestamps(bytes32 payloadId) view returns (uint256 timestamp)`,
        `function payloadBuilders(uint256 chainId, string depository) view returns (address)`,
        `function signedPayloads(bytes32 payloadId, bytes32 hashToSign) view returns (bytes)`,
      ]),
    }),
    publicClient,
    walletClient,
  };
};

const extractEcdsaSignature = (
  signature: string
): { r: string; s: string; v: number } => {
  const parsedSignature = JSON.parse(fromHex(signature as Hex, "string"));

  const {
    big_r: { affine_point },
    s: { scalar },
    recovery_id,
  } = parsedSignature;

  const r = affine_point.substring(2);
  const s = scalar;
  const v = recovery_id + 27;

  return { r, s, v };
};

export const getSignature = async (id: string) => {
  const withdrawalRequest = await getWithdrawalRequest(id);
  if (!withdrawalRequest) {
    throw externalError("Could not find withdrawal request");
  }

  const chain = await getChain(withdrawalRequest.chainId);
  if (!chain.depository || !chain.metadata.allocatorChainId) {
    throw externalError(
      "Depository or allocator chain id not configured for chain"
    );
  }

  const onchainAllocator = getOnchainAllocator();
  const payloadBuilderAddress =
    await onchainAllocator.contract.read.payloadBuilders([
      BigInt(chain.metadata.allocatorChainId),
      chain.depository,
    ]);
  if (payloadBuilderAddress === zeroAddress) {
    throw externalError("No payload builder configured for chain");
  }

  const payloadBuilder = getPayloadBuilder(payloadBuilderAddress);

  const hashesToSign = await payloadBuilder.contract.read.hashesToSign([
    BigInt(chain.metadata.allocatorChainId),
    chain.depository,
    withdrawalRequest.encodedData as Hex,
  ]);

  switch (chain.vmType) {
    case "ethereum-vm": {
      const hashToSign = hashesToSign[0];

      const signature = await onchainAllocator.contract.read.signedPayloads([
        withdrawalRequest.payloadId as Hex,
        hashToSign,
      ]);
      if (signature === "0x") {
        return undefined;
      } else {
        const { v, r, s } = extractEcdsaSignature(signature);
        return `0x${r}${s}${v.toString(16).padStart(2, "0")}`.toLowerCase();
      }
    }

    case "solana-vm": {
      const hashToSign = hashesToSign[0];

      const signature = await onchainAllocator.contract.read.signedPayloads([
        withdrawalRequest.payloadId as Hex,
        hashToSign,
      ]);
      if (signature === "0x") {
        return undefined;
      } else {
        // Temporary value
        return "0x12";
      }
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};
