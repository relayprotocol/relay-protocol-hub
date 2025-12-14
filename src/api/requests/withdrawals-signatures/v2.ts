import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
  SubmitWithdrawalRequestParamsSchema,
} from "../../utils";
import { logger } from "../../../common/logger";
import { RequestHandlerService } from "../../../services/request-handler";

const Schema = {
  body: Type.Object({
    chainId: Type.String({
      description: "The chain id of the withdrawal",
    }),
    payloadId: Type.String({
      description: "The payload id of the withdrawal request",
    }),
    payloadParams: SubmitWithdrawalRequestParamsSchema,
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
      signature: Type.String({
        description:
          "The sign data hash to be passed to the depository on exeuction",
      }),
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
        msg: "Executing `withdrawal-signature` request",
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

    return reply.status(200).send({
      message: "Success",
    });
  },
} as Endpoint;
