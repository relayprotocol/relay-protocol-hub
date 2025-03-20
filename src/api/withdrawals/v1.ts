import { Type } from "@fastify/type-provider-typebox";
import { randomBytes } from "crypto";
import { Address, encodeFunctionData, parseAbi, zeroAddress } from "viem";

import {
  Endpoint,
  ErrorResponses,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../utils";
import { ChainVmType, getChain } from "../../common/chains";
import { getBalance, saveBalanceLock } from "../../models/balances";
import {
  saveWithdrawalRequest,
  WithdrawalRequest,
} from "../../models/withdrawal-requests";
import { signWithdrawalRequestData } from "../../signer";

const Schema = {
  body: Type.Object({
    ownerChainId: Type.Number({ description: "The chain id of the owner" }),
    ownerAddress: Type.String({ description: "The address of the owner" }),
    chainId: Type.Number({
      description: "The chain id to withdraw on",
    }),
    currencyAddress: Type.String({
      description: "The address of the currency to withdraw",
    }),
    amount: Type.String({
      description: "The amount to withdraw",
    }),
    recipientAddress: Type.String({
      description: "The address of the recipient for the withdrawal proceeds",
    }),
  }),
  response: {
    ...ErrorResponses,
    200: Type.Object({
      id: Type.String({ description: "The id of the withdrawal request" }),
      data: Type.Union(
        [
          Type.Object({
            calls: Type.Array(
              Type.Object({
                to: Type.String(),
                data: Type.String(),
                value: Type.String(),
                allowFailure: Type.Boolean(),
              })
            ),
            nonce: Type.String(),
            expiration: Type.Number(),
          }),
        ],
        { description: "VM-specific withdrawal request data" }
      ),
      signature: Type.String({
        description: "The signature for the withdrawal request",
      }),
    }),
  },
};

export default {
  method: "POST",
  url: "/withdrawals/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    // Ensure the user has enough available balance
    const balance = await getBalance(
      req.body.ownerChainId,
      req.body.ownerAddress,
      req.body.chainId,
      req.body.currencyAddress
    );
    if (!balance || BigInt(balance.availableAmount) < BigInt(req.body.amount)) {
      return reply.status(400).send({
        message: "Insufficient balance",
      });
    }

    let data: WithdrawalRequest["data"];

    // Generate withdrawal request
    const chain = await getChain(req.body.chainId);
    switch (chain.vmType) {
      case ChainVmType.EthereumVM: {
        data = {
          calls:
            req.body.currencyAddress === zeroAddress
              ? [
                  {
                    to: req.body.recipientAddress,
                    data: "0x",
                    value: req.body.amount,
                    allowFailure: false,
                  },
                ]
              : [
                  {
                    to: req.body.currencyAddress,
                    data: encodeFunctionData({
                      abi: parseAbi([
                        "function transfer(address to, uint256 amount)",
                      ]),
                      functionName: "transfer",
                      args: [
                        req.body.recipientAddress as Address,
                        BigInt(req.body.amount),
                      ],
                    }),
                    value: "0",
                    allowFailure: false,
                  },
                ],
          nonce: BigInt("0x" + randomBytes(32).toString("hex")).toString(),
          expiration: Math.floor(Date.now() / 1000) + 5 * 60,
        };

        break;
      }

      default: {
        return reply.status(400).send({
          message: `Withdrawal requests are not yet supported for ${chain.vmType}`,
        });
      }
    }

    const { id, signature } = await signWithdrawalRequestData(
      req.body.chainId,
      data
    );

    // Lock balance
    const balanceLock = await saveBalanceLock({
      id,
      ownerChainId: req.body.ownerChainId,
      ownerAddress: req.body.ownerAddress,
      currencyChainId: req.body.chainId,
      currencyAddress: req.body.currencyAddress,
      amount: req.body.amount,
    });
    if (!balanceLock) {
      return reply.status(400).send({
        message: "Failed to lock balance",
      });
    }

    // Save withdrawal request
    const withdrawalRequest = await saveWithdrawalRequest({
      id,
      ownerChainId: req.body.ownerChainId,
      ownerAddress: req.body.ownerAddress,
      chainId: req.body.chainId,
      currencyAddress: req.body.currencyAddress,
      amount: req.body.amount,
      recipientAddress: req.body.recipientAddress,
      data,
      signature,
    });
    if (!withdrawalRequest) {
      return reply.status(400).send({
        message: "Failed to save withdrawal request",
      });
    }

    return reply.send({
      id,
      data,
      signature,
    });
  },
} as Endpoint;
