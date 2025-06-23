import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getAllocatorForChain, getChains } from "../../../common/chains";

const Schema = {
  response: {
    200: Type.Object({
      chains: Type.Array(
        Type.Object({
          id: Type.String({ description: "The id of the chain" }),
          vmType: Type.Union(
            [
              Type.Literal("bitcoin-vm"),
              Type.Literal("ethereum-vm"),
              Type.Literal("hyperliquid-vm"),
              Type.Literal("solana-vm"),
              Type.Literal("sui-vm"),
              Type.Literal("ton-vm"),
              Type.Literal("tron-vm"),
            ],
            {
              description: "The vm type of the chain",
            }
          ),
          depository: Type.Optional(
            Type.String({ description: "The depository address for the chain" })
          ),
          allocator: Type.Optional(
            Type.String({ description: "The allocator address for the chain" })
          ),
        }),
        {
          description: "A list of supported chains",
        }
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/chains/v1",
  schema: Schema,
  handler: async (
    _req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const chains = await getChains();

    return reply.status(200).send({
      chains: await Promise.all(
        Object.keys(chains).map(async (id) => {
          return {
            id,
            vmType: chains[id].vmType,
            depository: chains[id].depository,
            allocator: chains[id].depository
              ? await getAllocatorForChain(id)
              : undefined,
          };
        })
      ),
    });
  },
} as Endpoint;
