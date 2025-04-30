import { Type } from "@fastify/type-provider-typebox";
import { getEscrowWithdrawalMessageId } from "@reservoir0x/relay-protocol-sdk";
import { Address, Hex, verifyMessage } from "viem";

import {
  Endpoint,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { ActionExecutorService } from "../../../services/action-executor";

const Schema = {
  body: Type.Object({
    message: Type.Object({
      data: Type.Object({
        chainId: Type.Number({
          description: "The chain id of the attested transaction",
        }),
        withdrawal: Type.String({
          description: "The encoded withdrawal data",
        }),
      }),
      result: Type.Object({
        withdrawalId: Type.String({
          description: "The id of the attested withdrawal",
        }),
        status: Type.Number({
          description: "The status of the withdrawal",
        }),
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
      code: Type.Union([Type.Literal("SUCCESS")]),
    }),
    400: Type.Object({
      message: Type.String({ description: "Error message" }),
      code: Type.Union([
        Type.Literal("INSUFFICIENT_SIGNATURES"),
        Type.Literal("INVALID_SIGNATURE"),
        Type.Literal("ALREADY_UNLOCKED"),
        Type.Literal("WITHDRAWAL_NOT_EXECUTED"),
        Type.Literal("UNKNOWN"),
      ]),
    }),
  },
};

export default {
  method: "POST",
  url: "/actions/escrow-withdrawal/v1",
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
    const messageId = getEscrowWithdrawalMessageId(message);

    // TODO: Keep track of allowed oracles for every chain

    for (const { oracleAddress, signature } of signatures) {
      const isSignatureValid = await verifyMessage({
        address: oracleAddress as Address,
        message: {
          raw: messageId,
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

    const actionExecutor = new ActionExecutorService();
    const result = await actionExecutor.executeEscrowWithdrawal(message);
    if (result.status === "success") {
      const resultToExternalResponse = {
        success: { message: "Success", code: "SUCCESS" },
      } as const;

      return reply.status(200).send({
        message: resultToExternalResponse[result.details].message,
        code: resultToExternalResponse[result.details].code,
      });
    } else {
      const resultToExternalResponse = {
        "already-unlocked": {
          message: "Withdrawal already unlocked",
          code: "ALREADY_UNLOCKED",
        },
        "not-executed": {
          message: "Withdrawal not executed",
          code: "WITHDRAWAL_NOT_EXECUTED",
        },
        unknown: {
          message: "Unknown error",
          code: "UNKNOWN",
        },
      } as const;

      return reply.status(400).send({
        message: resultToExternalResponse[result.details].message,
        code: resultToExternalResponse[result.details].code,
      });
    }
  },
} as Endpoint;
