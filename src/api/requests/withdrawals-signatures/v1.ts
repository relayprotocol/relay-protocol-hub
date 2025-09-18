import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { logger } from "../../../common/logger";
import { RequestHandlerService } from "../../../services/request-handler";

const Schema = {
  body: Type.Object({
    id: Type.String({ description: "The id of the withdrawal" }),
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
  url: "/requests/withdrawals/signatures/v1",
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
    const result = await requestHandler.handleWithdrawalSignature(req.body);

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
