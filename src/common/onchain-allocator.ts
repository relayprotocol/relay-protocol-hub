import {
  Address,
  createPublicClient,
  createWalletClient,
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

export const getPayloadBuilder = async (address: string) => {
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

export const getOnchainAllocator = async () => {
  if (!config.onchainAllocator || !config.onchainAllocatorSenderPk) {
    throw externalError("Onchain allocator not configured");
  }

  const { publicClient, walletClient } = getPublicAndWalletClients();

  const PayloadParams =
    "(uint256 chainId, string depository, string currency, uint256 amount, address spender, string receiver, bytes data)";
  const GasSettings = "(uint64 signGas, uint64 callbackGas)";

  return {
    contract: getContract({
      client: walletClient,
      address: config.onchainAllocator as Address,
      abi: parseAbi([
        `function submitWithdrawRequest(${PayloadParams} params) returns (bytes32)`,
        `function signWithdrawPayload(uint256 chainId, string depository, bytes32 payloadId, ${GasSettings} gasSettings)`,
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

export const getSignature = async (id: string) => {
  const withdrawalRequest = await getWithdrawalRequest(id);
  if (!withdrawalRequest) {
    throw externalError("Could not find withdrawal request");
  }

  const chain = await getChain(withdrawalRequest.chainId);
  if (!chain.depository || !chain.metadata.onchainId) {
    throw externalError("Depository or onchain id not configured for chain");
  }

  const onchainAllocator = await getOnchainAllocator();
  const payloadBuilderAddress =
    await onchainAllocator.contract.read.payloadBuilders([
      BigInt(chain.metadata.onchainId),
      chain.depository,
    ]);
  if (payloadBuilderAddress === zeroAddress) {
    throw externalError("No payload builder configured for chain");
  }

  const payloadBuilder = await getPayloadBuilder(payloadBuilderAddress);

  const hashesToSign = await payloadBuilder.contract.read.hashesToSign([
    BigInt(chain.metadata.onchainId),
    chain.depository,
    withdrawalRequest.encodedData as Hex,
  ]);

  switch (chain.vmType) {
    case "ethereum-vm": {
      const hashToSign = hashesToSign[0];

      const signature = await onchainAllocator.contract.read.signedPayloads([
        id as Hex,
        hashToSign,
      ]);
      if (signature === "0x") {
        return undefined;
      } else {
        return signature;
      }
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};
