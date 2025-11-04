import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import {
  getChains,
  getOffchainAllocatorForChain,
  getOnchainAllocatorForChain,
} from "../../../common/chains";

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
          allocatorMode: Type.Optional(
            Type.Union([Type.Literal("offchain"), Type.Literal("onchain")], {
              description: "The vm type of the chain",
            })
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
          const allocatorMode = chains[id].metadata.allocatorChainId
            ? "onchain"
            : "offchain";
          return {
            id,
            vmType: chains[id].vmType,
            depository: chains[id].depository,
            allocator: chains[id].depository
              ? allocatorMode === "offchain"
                ? await getOffchainAllocatorForChain(id)
                : await getOnchainAllocatorForChain(id)
              : undefined,
            allocatorMode: chains[id].depository ? allocatorMode : undefined,
          };
        })
      ),
    });
  },
} as Endpoint;
