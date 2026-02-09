import { JsonRpcProvider } from "@near-js/providers";
import * as bitcoin from "bitcoinjs-lib";
import bs58 from "bs58";
import TronWeb from "tronweb";
import {
  Account,
  Address,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
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

export const getOnchainAllocator = async () => {
  const allocator = config.onchainAllocator;
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
export const handleOneTimeApproval = async () => {
  const { walletClient } = await getPublicAndWalletClients();

  const allocator = await getOnchainAllocator().then((a) => a.contract.address);

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
    fromHex(rawNearSignature as Hex, "string"),
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
    fromHex(rawNearSignature as Hex, "string"),
  );

  const { signature } = parsedSignature;

  return `0x${Buffer.from(signature).toString("hex")}`.toLowerCase();
};

let _getSignerCache = new Map<string, string>();
let _getBitcoinSignerPubkeyCache = new Map<string, Buffer>();
export const getSigner = async (chainId: string) => {
  if (_getSignerCache.has(chainId)) {
    return _getSignerCache.get(chainId)!;
  }

  const vmType = await getChain(chainId).then((c) => c.vmType);

  let domainId: number | undefined;
  switch (vmType) {
    case "bitcoin-vm":
    case "ethereum-vm":
    case "hyperliquid-vm":
    case "tron-vm": {
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

  const { contract } = await getOnchainAllocator();

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
    args,
  );

  const [, publicKey] = result!.toString().split(":");
  switch (vmType) {
    case "bitcoin-vm": {
      const raw = Buffer.from(bs58.decode(publicKey));

      const x = raw.subarray(0, 32);
      const y = raw.subarray(32, 64);
      const yIsEven = (y[31] & 1) === 0;
      const prefix = yIsEven ? 0x02 : 0x03;
      const pubKeyCompressed = Buffer.concat([
        Buffer.from([prefix]),
        Buffer.from(x),
      ]);
      _getBitcoinSignerPubkeyCache.set(chainId, pubKeyCompressed);

      _getSignerCache.set(
        chainId,
        bitcoin.payments.p2pkh({
          network: bitcoin.networks.bitcoin,
          pubkey: pubKeyCompressed,
        }).address!,
      );

      break;
    }

    case "ethereum-vm":
    case "hyperliquid-vm":
    case "tron-vm": {
      _getSignerCache.set(
        chainId,
        publicKeyToAddress(
          `0x04${Buffer.from(bs58.decode(publicKey)).toString("hex")}`,
        ).toLowerCase(),
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

export const getBitcoinSignerPubkey = async (chainId: string) => {
  const vmType = await getChain(chainId).then((c) => c.vmType);
  if (vmType !== "bitcoin-vm") {
    throw externalError("Chain is not bitcoin-vm");
  }

  if (!_getBitcoinSignerPubkeyCache.has(chainId)) {
    await getSigner(chainId);
  }

  if (!_getBitcoinSignerPubkeyCache.has(chainId)) {
    throw externalError("Bitcoin signer pubkey not found");
  }

  return Buffer.from(_getBitcoinSignerPubkeyCache.get(chainId)!);
};

export const getSignatureFromContract = async (
  chainId: string,
  payloadId: string,
  encodedData: string,
) => {
  const chain = await getChain(chainId);
  if (!chain.depository || !chain.metadata.allocatorChainId) {
    throw externalError(
      "Depository or allocator chain id not configured for chain",
    );
  }

  const allocatorChainId = chain.metadata.allocatorChainId;

  let depository =
    chain.vmType === "tron-vm"
      ? TronWeb.utils.address
          .toHex(chain.depository)
          .replace(TronWeb.utils.address.ADDRESS_PREFIX_REGEX, "0x")
      : chain.depository;
  if (chain.vmType === "bitcoin-vm") {
    depository = "1KT3zCYUrmQxjcveUNs1Rs7WcXDcPQZ4av";
  }

  const onchainAllocator = await getOnchainAllocator();
  const payloadBuilderAddress =
    await onchainAllocator.contract.read.payloadBuilders([
      BigInt(allocatorChainId),
      depository,
    ]);
  if (payloadBuilderAddress === zeroAddress) {
    throw externalError("No payload builder configured for chain");
  }

  const payloadBuilder = await getPayloadBuilder(payloadBuilderAddress);

  switch (chain.vmType) {
    case "ethereum-vm":
    case "hyperliquid-vm":
    case "tron-vm": {
      const hashToSign = await payloadBuilder.contract.read.hashToSign([
        BigInt(allocatorChainId),
        depository,
        encodedData as Hex,
        0,
      ]);

      const signature = await onchainAllocator.contract.read.signedPayloads([
        payloadId as Hex,
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
        BigInt(allocatorChainId),
        depository,
        encodedData as Hex,
        0,
      ]);

      const signature = await onchainAllocator.contract.read.signedPayloads([
        payloadId as Hex,
        hashToSign,
      ]);
      if (signature === "0x") {
        return undefined;
      } else {
        return extractEddsaSignature(signature);
      }
    }

    case "bitcoin-vm": {
      const unsignedPayload = await onchainAllocator.contract.read.payloads([
        payloadId as Hex,
      ]);

      const decodeBitcoinTransactionData = (encodedData: Hex) =>
        decodeAbiParameters(
          [
            {
              type: "tuple",
              components: [
                {
                  type: "tuple[]",
                  name: "inputs",
                  components: [
                    { type: "bytes", name: "txid" },
                    { type: "bytes", name: "index" },
                    { type: "bytes", name: "script" },
                    { type: "bytes", name: "value" },
                  ],
                },
                {
                  type: "tuple[]",
                  name: "outputs",
                  components: [
                    { type: "bytes", name: "value" },
                    { type: "bytes", name: "script" },
                  ],
                },
              ],
            },
          ],
          encodedData,
        )[0] as {
          inputs: { txid: Hex; index: Hex; script: Hex; value: Hex }[];
          outputs: { value: Hex; script: Hex }[];
        };

      const transactionData = decodeBitcoinTransactionData(
        unsignedPayload as Hex,
      );

      const signatures = await Promise.all(
        transactionData.inputs.map(async (_, index) => {
          const hashToSign = await payloadBuilder.contract.read.hashToSign([
            BigInt(allocatorChainId),
            depository,
            unsignedPayload as Hex,
            index,
          ]);

          const signature = await onchainAllocator.contract.read.signedPayloads(
            [payloadId as Hex, hashToSign],
          );

          if (signature === "0x") {
            return undefined;
          }

          return extractEcdsaSignature(signature) as Hex;
        }),
      );

      if (signatures.some((signature) => !signature)) {
        return undefined;
      }

      const finalizedSignatures = signatures.filter(
        (signature): signature is Hex => !!signature,
      );

      return encodeAbiParameters([{ type: "bytes[]" }], [finalizedSignatures]);
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};

export const getSignature = async (id: string) => {
  const withdrawalRequest = await getWithdrawalRequest(id);
  if (!withdrawalRequest) {
    throw externalError("Could not find withdrawal request");
  }

  return getSignatureFromContract(
    withdrawalRequest.chainId,
    withdrawalRequest.payloadId!,
    withdrawalRequest.encodedData,
  );
};
