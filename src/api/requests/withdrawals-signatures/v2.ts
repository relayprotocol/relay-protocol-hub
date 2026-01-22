import { Type } from "@fastify/type-provider-typebox";

import {
  AdditionalDataSchema,
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { logger } from "../../../common/logger";
import { RequestHandlerService } from "../../../services/request-handler";

const Schema = {
  body: Type.Object({
    payloadId: Type.String({
      description: "The payload id of the withdrawal request",
    }),
    payloadParams: Type.Object({
      chainId: Type.String({
        description: "The chain id to withdraw on",
      }),
      currency: Type.String({
        description: "The address of the currency to withdraw",
      }),
      amount: Type.String({
        description: "The amount to withdraw",
      }),
      recipient: Type.String({
        description: "The address of the recipient for the withdrawal proceeds",
      }),
      spender: Type.String({
        description:
          "The address of the spender (usually the withdrawal address)",
      }),
      nonce: Type.String({
        description:
          "The nonce to be used when submitting the withdrawal request to the allocator",
      }),
      additionalData: Type.Optional(AdditionalDataSchema)
    }),
  }),
  response: {
    200: Type.Object({
      encodedData: Type.String({
        description:
          "The depository payload to be executed on destination chain",
      }),
      signer: Type.String({
        description: "The (MPC) signer address from the allocator",
      }),
      signature: Type.Optional(
        Type.String({
          description:
            "The sign data hash to be passed to the depository on exeuction",
        })
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "POST",
  url: "/requests/withdrawals/signatures/v2",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executing `withdrawal-signature` request (v2)",
        data: req.body,
      })
    );

    const requestHandler = new RequestHandlerService();
    const result = await requestHandler.handleOnChainWithdrawalSignature(
      req.body
    );

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executed `withdrawal-signature` request",
        data: req.body,
        result,
      })
    );

    return reply.status(200).send(result);
  },
} as Endpoint;
