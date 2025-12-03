import { JsonRpcProvider } from "@near-js/providers";
import bs58 from "bs58";
import {
  Account,
  Address,
  createPublicClient,
  createWalletClient,
  fromHex,
  getContract,
  Hex,
  http,
  parseAbi,
  zeroAddress,
  maxUint256,
} from "viem";
import { privateKeyToAccount, publicKeyToAddress } from "viem/accounts";

import { KmsSigner } from "./viem-kms-signer";
import { getChain } from "../common/chains";
import { externalError } from "../common/error";
import { config } from "../config";
import { getWithdrawalRequest } from "../models/withdrawal-requests";

const getPublicAndWalletClients = async () => {
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

  let account: Account;
  if (
    config.onchainAllocatorSenderAwsKmsKeyId &&
    config.onchainAllocatorSenderAwsKmsKeyRegion
  ) {
    const kmsSigner = new KmsSigner({
      keyId: config.onchainAllocatorSenderAwsKmsKeyId,
      region: config.onchainAllocatorSenderAwsKmsKeyRegion,
    });

    account = await kmsSigner.getAccount();
  } else if (config.onchainAllocatorSenderPk) {
    account = privateKeyToAccount(config.onchainAllocatorSenderPk as Hex);
  } else {
    throw externalError("No available onchain allocator sender");
  }

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(httpRpcUrl),
  });

  return { publicClient, walletClient };
};

const getPayloadBuilder = async (address: string) => {
  const { publicClient, walletClient } = await getPublicAndWalletClients();

  return {
    contract: getContract({
      client: walletClient,
      address: address as Address,
      abi: parseAbi([
        `function hashToSign(uint256 chainId, string depository, bytes unsignedPayload, uint32 index) view returns (bytes32)`,
      ]),
    }),
    publicClient,
    walletClient,
  };
};

export const getOnchainAllocator = async (chainId: string) => {
  let allocator = config.onchainAllocator;
  if (
    process.env.SERVICE === "relay-protocol-hub" &&
    [
      "hyperliquid",
      "eclipse",
      "soon",
      "solana",
      "rari",
      "ancient8",
      "degen",
      "corn",
      "zora",
      "forma",
      "katana",
      "xai",
      "zero",
      "scroll",
      "syndicate",
      "taiko",
      "plume",
      "blast",
      "berachain",
      "anime",
      "bob",
      "linea",
      "ink",
      "superposition",
      "zircuit",
      "gunz",
      // "avalanche",
      "hemi",
      "celo",
      "arbitrum_nova",
      // "arbitrum",
      "mode",
      "funki",
      "apechain",
      "plasma",
    ].includes(chainId)
  ) {
    allocator = "0x7eda04920f22ba6a2b9f2573fd9a6f6f1946ff9f";
  }

  if (!allocator) {
    throw externalError("Onchain allocator not configured");
  }

  const { publicClient, walletClient } = await getPublicAndWalletClients();

  const PayloadParams =
    "(uint256 chainId, string depository, string currency, uint256 amount, address spender, string receiver, bytes data, bytes32 nonce)";
  const GasSettings = "(uint64 signGas, uint64 callbackGas)";

  return {
    contract: getContract({
      client: walletClient,
      address: allocator as Address,
      abi: parseAbi([
        `function submitWithdrawRequest(${PayloadParams} params) returns (bytes32)`,
        `function signWithdrawPayloadHash(${PayloadParams} params, bytes signature, ${GasSettings} gasSettings, uint32 index)`,
        `function payloads(bytes32 payloadId) view returns (bytes unsignedPayload)`,
        `function payloadTimestamps(bytes32 payloadId) view returns (uint256 timestamp)`,
        `function payloadBuilders(uint256 chainId, string depository) view returns (address)`,
        `function signedPayloads(bytes32 payloadId, bytes32 hashToSign) view returns (bytes)`,
      ]),
    }),
    publicClient,
    walletClient,
  };
};

let _allowanceCache: bigint | undefined;
export const handleOneTimeApproval = async (chainId: string) => {
  const { walletClient } = await getPublicAndWalletClients();

  const allocator = await getOnchainAllocator(chainId).then(
    (a) => a.contract.address
  );

  const wNearContract = getContract({
    client: walletClient,
    address: "0xc42c30ac6cc15fac9bd938618bcaa1a1fae8501d",
    abi: parseAbi([
      `function approve(address spender, uint256 amount)`,
      `function allowance(address owner, address spender) view returns (uint256)`,
    ]),
  });
  if (_allowanceCache === undefined) {
    _allowanceCache = await wNearContract.read.allowance([
      walletClient.account.address,
      allocator,
    ]);
  }

  if (_allowanceCache === 0n) {
    await wNearContract.write.approve([allocator as Address, maxUint256]);
    _allowanceCache = maxUint256;
  }
};

const extractEcdsaSignature = (rawNearSignature: string): string => {
  const parsedSignature = JSON.parse(
    fromHex(rawNearSignature as Hex, "string")
  );

  const {
    big_r: { affine_point },
    s: { scalar },
    recovery_id,
  } = parsedSignature;

  const r = affine_point.substring(2);
  const s = scalar;
  const v = recovery_id + 27;

  return `0x${r}${s}${v.toString(16).padStart(2, "0")}`.toLowerCase();
};

const extractEddsaSignature = (rawNearSignature: string): string => {
  const parsedSignature = JSON.parse(
    fromHex(rawNearSignature as Hex, "string")
  );

  const { signature } = parsedSignature;

  return `0x${Buffer.from(signature).toString("hex")}`.toLowerCase();
};

let _getSignerCache = new Map<string, string>();
export const getSigner = async (chainId: string) => {
  if (_getSignerCache.has(chainId)) {
    return _getSignerCache.get(chainId)!;
  }

  const vmType = await getChain(chainId).then((c) => c.vmType);

  let domainId: number | undefined;
  switch (vmType) {
    case "ethereum-vm":
    case "hyperliquid-vm": {
      domainId = 0;
      break;
    }

    case "solana-vm": {
      domainId = 1;
      break;
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }

  const { contract } = await getOnchainAllocator(chainId);

  const args = {
    domain_id: domainId,
    path: contract.address.toLowerCase(),
    predecessor: `${contract.address.slice(2).toLowerCase()}.aurora`,
  };

  const nearRpc = new JsonRpcProvider({
    url: "https://free.rpc.fastnear.com",
  });
  const result = await nearRpc.callFunction(
    "v1.signer",
    "derived_public_key",
    args
  );

  const [, publicKey] = result!.toString().split(":");
  switch (vmType) {
    case "ethereum-vm":
    case "hyperliquid-vm": {
      _getSignerCache.set(
        chainId,
        publicKeyToAddress(
          `0x04${Buffer.from(bs58.decode(publicKey)).toString("hex")}`
        ).toLowerCase()
      );

      break;
    }

    case "solana-vm": {
      _getSignerCache.set(chainId, publicKey);

      break;
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }

  return _getSignerCache.get(chainId)!;
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

  const onchainAllocator = await getOnchainAllocator(chain.id);
  const payloadBuilderAddress =
    await onchainAllocator.contract.read.payloadBuilders([
      BigInt(chain.metadata.allocatorChainId),
      chain.depository,
    ]);
  if (payloadBuilderAddress === zeroAddress) {
    throw externalError("No payload builder configured for chain");
  }

  const payloadBuilder = await getPayloadBuilder(payloadBuilderAddress);

  switch (chain.vmType) {
    case "ethereum-vm":
    case "hyperliquid-vm": {
      const hashToSign = await payloadBuilder.contract.read.hashToSign([
        BigInt(chain.metadata.allocatorChainId),
        chain.depository,
        withdrawalRequest.encodedData as Hex,
        0,
      ]);

      const signature = await onchainAllocator.contract.read.signedPayloads([
        withdrawalRequest.payloadId as Hex,
        hashToSign,
      ]);
      if (signature === "0x") {
        return undefined;
      } else {
        return extractEcdsaSignature(signature);
      }
    }

    case "solana-vm": {
      const hashToSign = await payloadBuilder.contract.read.hashToSign([
        BigInt(chain.metadata.allocatorChainId),
        chain.depository,
        withdrawalRequest.encodedData as Hex,
        0,
      ]);

      const signature = await onchainAllocator.contract.read.signedPayloads([
        withdrawalRequest.payloadId as Hex,
        hashToSign,
      ]);
      if (signature === "0x") {
        return undefined;
      } else {
        return extractEddsaSignature(signature);
      }
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};
