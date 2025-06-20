import {
  encodeWithdrawal,
  getDecodedWithdrawalId,
} from "@reservoir0x/relay-protocol-sdk";
import { randomBytes } from "crypto";
import {
  Address,
  createWalletClient,
  encodeFunctionData,
  Hex,
  http,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ChainMetadataEthereumVm, getChain } from "../../common/chains";
import { db } from "../../common/db";
import { externalError } from "../../common/error";
import { config } from "../../config";
import {
  getBalanceLock,
  saveBalanceLock,
  unlockBalanceLock,
} from "../../models/balances";
import { saveWithdrawalRequest } from "../../models/withdrawal-requests";

type WithdrawalRequest = {
  ownerChainId: string;
  owner: string;
  chainId: string;
  currency: string;
  amount: string;
  recipient: string;
};

type UnlockRequest = {
  id: string;
};

export class RequestHandlerService {
  public async handleWithdrawal(request: WithdrawalRequest) {
    const chain = await getChain(request.chainId);
    switch (chain.vmType) {
      case "ethereum-vm": {
        const data = {
          calls:
            request.currency === zeroAddress
              ? [
                  {
                    to: request.recipient,
                    data: "0x",
                    value: request.amount,
                    allowFailure: false,
                  },
                ]
              : [
                  {
                    to: request.currency,
                    data: encodeFunctionData({
                      abi: parseAbi([
                        "function transfer(address to, uint256 amount)",
                      ]),
                      functionName: "transfer",
                      args: [
                        request.recipient as Address,
                        BigInt(request.amount),
                      ],
                    }),
                    value: "0",
                    allowFailure: false,
                  },
                ],
          nonce: BigInt("0x" + randomBytes(32).toString("hex")).toString(),
          expiration: Math.floor(Date.now() / 1000) + 5 * 60,
        };

        const walletClient = createWalletClient({
          account: privateKeyToAccount(config.ecdsaPrivateKey as Hex),
          // Viem will error if we pass no URL to the `http` transport, so here we
          // just pass a mock URL, which isn't even going to be used since we only
          // use `walletClient` for signing messages offchain
          transport: http("http://localhost:1"),
        });

        const eip712TypedData = {
          domain: {
            name: "RelayDepository",
            version: "1",
            chainId: (chain.metadata as ChainMetadataEthereumVm).chainId,
            verifyingContract: chain.depository as Address,
          },
          types: {
            CallRequest: [
              { name: "calls", type: "Call[]" },
              { name: "nonce", type: "uint256" },
              { name: "expiration", type: "uint256" },
            ],
            Call: [
              { name: "to", type: "address" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
              { name: "allowFailure", type: "bool" },
            ],
          },
          primaryType: "CallRequest",
          message: {
            calls: data.calls.map((c) => ({
              to: c.to as Address,
              data: c.data as Hex,
              value: BigInt(c.value),
              allowFailure: c.allowFailure,
            })),
            nonce: BigInt(data.nonce),
            expiration: BigInt(data.expiration),
          },
        } as const;

        const encodedData = encodeWithdrawal({
          vmType: chain.vmType,
          withdrawal: data,
        });
        const signature = await walletClient.signTypedData(eip712TypedData);

        const id = getDecodedWithdrawalId({
          vmType: chain.vmType,
          withdrawal: data,
        });

        await db.tx(async (tx) => {
          const newBalance = await saveBalanceLock(
            {
              id,
              source: "withdrawal",
              ownerChainId: request.ownerChainId,
              owner: request.owner,
              currencyChainId: request.chainId,
              currency: request.currency,
              amount: request.amount,
              expiration: data.expiration,
            },
            { tx }
          );
          if (!newBalance) {
            throw externalError("Failed to save balance lock");
          }

          const withdrawalRequest = await saveWithdrawalRequest(
            {
              id,
              ownerChainId: request.ownerChainId,
              owner: request.owner,
              chainId: request.chainId,
              currency: request.currency,
              amount: request.amount,
              recipient: request.recipient,
              encodedData,
              signature,
            },
            { tx }
          );
          if (!withdrawalRequest) {
            throw externalError("Failed to save withdrawal request");
          }
        });

        return {
          id,
          encodedData,
          signature,
        };
      }

      default:
        throw externalError("Vm type not implemented");
    }
  }

  public async handleUnlock(request: UnlockRequest) {
    const balanceLock = await getBalanceLock(request.id);
    if (!balanceLock) {
      throw externalError("Balance lock does not exist");
    }
    if (balanceLock.source !== "deposit") {
      throw externalError(
        "Only 'deposit' balance locks can be unlocked via this flow"
      );
    }

    const newBalance = await unlockBalanceLock(request.id);
    if (!newBalance) {
      throw externalError("Failed to unlock balance");
    }
  }
}
