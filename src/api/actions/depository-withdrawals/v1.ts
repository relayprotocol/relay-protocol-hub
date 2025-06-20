import { Type } from "@fastify/type-provider-typebox";
import { getDepositoryWithdrawalMessageId } from "@reservoir0x/relay-protocol-sdk";
import { Address, Hex, verifyMessage } from "viem";

import { getSdkChainsConfig } from "../../../common/chains";
import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { ActionExecutorService } from "../../../services/action-executor";

const Schema = {
  body: Type.Object({
    message: Type.Object({
      data: Type.Object({
        chainId: Type.String({
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
        depository: Type.String({
          description: "The depository address of the withdrawal",
        }),
        status: Type.Number({
          description: "The status of the withdrawal",
        }),
      }),
      signatures: Type.Array(
        Type.Object({
          oracle: Type.String({
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
  }),
  response: {
    200: Type.Object({
      message: Type.String({ description: "Success message" }),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "POST",
  url: "/actions/depository-withdrawals/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const message = req.body.message;

    const signatures = message.signatures;
    if (!signatures.length) {
      return reply.status(400).send({
        message: "At least one signature is required",
        code: "INSUFFICIENT_SIGNATURES",
      });
    }

    const messageId = getDepositoryWithdrawalMessageId(
      message,
      await getSdkChainsConfig()
    );

    // TODO: Keep track of allowed oracles for every chain

    for (const { oracle, signature } of signatures) {
      const isSignatureValid = await verifyMessage({
        address: oracle as Address,
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
    await actionExecutor.executeDepositoryWithdrawal(message);

    return reply.status(200).send({ message: "Success" });
  },
} as Endpoint;
