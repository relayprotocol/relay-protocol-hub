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
    id: Type.String({
      description: "The id of the balance lock to unlock",
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
  url: "/requests/unlocks/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const requestHandler = new RequestHandlerService();
    await requestHandler.handleUnlock(req.body);

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executed `unlock` request",
        data: req.body,
      })
    );

    return reply.status(200).send({ message: "Success" });
  },
} as Endpoint;
