import { Type } from "@fastify/type-provider-typebox";
import { getEscrowDepositMessageHash } from "@reservoir0x/relay-protocol-sdk";
import { Address, Hex, verifyMessage, zeroHash } from "viem";

import {
  Endpoint,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getSdkChainsConfig } from "../../../common/chains";
import { db } from "../../../common/db";
import { saveBalanceLock } from "../../../models/balances";
import { saveOnchainEntryWithBalanceUpdate } from "../../../models/onchain-entries";

const Schema = {
  body: Type.Object({
    message: Type.Object({
      onchainId: Type.String({
        description: "The onchain id of the deposit",
      }),
      data: Type.Object({
        chainId: Type.Number({
          description: "The chain id of the attested transaction",
        }),
        transactionId: Type.String({
          description: "The id of the attested transaction",
        }),
      }),
      result: Type.Object({
        depositId: Type.String({
          description: "The id associated to the deposit",
        }),
        escrow: Type.String({
          description: "The escrow address the deposit occured on",
        }),
        depositor: Type.String({
          description: "The address of the depositor",
        }),
        currency: Type.String({
          description: "The address of the deposited currency",
        }),
        amount: Type.String({ description: "The deposited amount" }),
      }),
    }),
    signatures: Type.Array(
      Type.Object({
        oracleAddress: Type.String({
          description: "The ethereum-vm address of the signing oracle",
        }),
        signature: Type.String({
          description: "The corresponding oracle signature",
        }),
      }),
      {
        minItems: 1,
      }
    ),
  }),
  response: {
    200: Type.Object({
      message: Type.String({ description: "Success message" }),
      code: Type.Union([
        Type.Literal("ALREADY_SAVED"),
        Type.Literal("ALREADY_LOCKED"),
        Type.Literal("SUCCESS"),
      ]),
    }),
    400: Type.Object({
      message: Type.String({ description: "Error message" }),
      code: Type.Union([
        Type.Literal("INSUFFICIENT_SIGNATURES"),
        Type.Literal("INVALID_SIGNATURE"),
      ]),
    }),
  },
};

export default {
  method: "POST",
  url: "/actions/escrow-deposits/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const signatures = req.body.signatures;
    if (!signatures.length) {
      return reply.status(400).send({
        message: "At least one signature is required",
        code: "INSUFFICIENT_SIGNATURES",
      });
    }

    const message = req.body.message;
    const messageHash = getEscrowDepositMessageHash(
      message,
      await getSdkChainsConfig()
    );

    // TODO: Keep track of allowed oracles for every chain

    for (const { oracleAddress, signature } of signatures) {
      const isSignatureValid = await verifyMessage({
        address: oracleAddress as Address,
        message: {
          raw: messageHash,
        },
        signature: signature as Hex,
      });
      if (!isSignatureValid) {
        return reply.status(400).send({
          message: "Invalid signature",
          code: "INVALID_SIGNATURE",
        });
      }
    }

    await db.tx(async (tx) => {
      // Save the deposit
      const saveResult = await saveOnchainEntryWithBalanceUpdate(
        {
          id: message.onchainId,
          chainId: message.data.chainId,
          transactionId: message.data.transactionId,
          ownerAddress: message.result.depositor,
          currencyAddress: message.result.currency,
          balanceDiff: message.result.amount,
        },
        tx
      );
      if (!saveResult) {
        return reply.status(200).send({
          message: "Deposit already saved",
          code: "ALREADY_SAVED",
        });
      }

      // Lock the balance
      if (message.result.depositId !== zeroHash) {
        const lockResult = await saveBalanceLock(
          {
            id: message.onchainId,
            ownerChainId: message.data.chainId,
            ownerAddress: message.result.depositor,
            currencyChainId: message.data.chainId,
            currencyAddress: message.result.currency,
            amount: message.result.amount,
          },
          tx
        );
        if (!lockResult) {
          return reply.status(200).send({
            message: "Deposit already locked",
            code: "ALREADY_LOCKED",
          });
        }
      }

      return reply.status(200).send({
        message: "Success",
        code: "SUCCESS",
      });
    });
  },
} as Endpoint;
