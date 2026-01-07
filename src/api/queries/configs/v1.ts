import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getOnchainAllocator } from "../../../utils/onchain-allocator";

const Schema = {
  response: {
    200: Type.Object({
      configs: Type.Object(
        {
          onchainAllocatorSender: Type.String({
            description: "The wallet sending onchain allocation requests",
          }),
        },
        {
          description: "Current configuration settings",
        }
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/configs/v1",
  schema: Schema,
  handler: async (
    _req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const { walletClient } = await getOnchainAllocator("ethereum");

    return reply.status(200).send({
      configs: {
        onchainAllocatorSender: walletClient.account.address.toLowerCase(),
      },
    });
  },
} as Endpoint;
