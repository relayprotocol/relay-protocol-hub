import { Type } from "@fastify/type-provider-typebox";

import { Endpoint, FastifyReplyTypeBox, FastifyRequestTypeBox } from "../utils";

const Schema = {
  response: {
    200: Type.Object({
      status: Type.String({ description: "The status of the service" }),
    }),
  },
};

export default {
  method: "GET",
  url: "/lives/v1",
  schema: Schema,
  handler: async (
    _req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>,
  ) => {
    return reply.send({
      status: "ok",
    });
  },
} as Endpoint;
