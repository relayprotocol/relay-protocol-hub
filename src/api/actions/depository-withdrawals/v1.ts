import { Type } from "@fastify/type-provider-typebox";
import { getDepositoryWithdrawalMessageId } from "@relay-protocol/settlement-sdk";

import { checkOracleSignatures } from "../utils";
import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getSdkChainsConfig } from "../../../common/chains";
import { logger } from "../../../common/logger";
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
    const messageId = getDepositoryWithdrawalMessageId(
      message,
      await getSdkChainsConfig()
    );

    await checkOracleSignatures(messageId, message.signatures);

    const actionExecutor = new ActionExecutorService();
    await actionExecutor.executeDepositoryWithdrawal(message);

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executed `depository-withdrawal` action",
        action: message,
      })
    );

    return reply.status(200).send({ message: "Success" });
  },
} as Endpoint;
