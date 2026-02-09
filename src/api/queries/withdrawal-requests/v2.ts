import { Type } from "@fastify/type-provider-typebox";
import { Hex } from "viem";

import { enhanceEncodedData } from "./utils";
import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import {
  getOnchainAllocator,
  getSignatureFromContract,
  getSigner,
} from "../../../utils/onchain-allocator";
import { logger } from "../../../common/logger";

const Schema = {
  params: Type.Object({
    payloadId: Type.String({
      description: "The payload id of the withdrawal request",
    }),
  }),
  querystring: Type.Object({
    chainId: Type.String({
      description: "The chain id of the depository",
    }),
  }),
  response: {
    200: Type.Object({
      encodedData: Type.String({
        description:
          "The depository payload to be executed on destination chain",
      }),
      signature: Type.Optional(
        Type.String({
          description:
            "The sign data hash to be passed to the depository for execution",
        }),
      ),
      signer: Type.Optional(
        Type.String({
          description: "The MPC signer that signed the depository payload",
        }),
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/withdrawal-requests/:payloadId/v2",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>,
  ) => {
    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Querying if withdrawal exists from the Allocator contract",
        data: req.body,
      }),
    );
    const { contract } = await getOnchainAllocator();

    let signature: string | undefined;
    let signer: string | undefined;
    let encodedData: string = await contract.read.payloads([
      req.params.payloadId as Hex,
    ]);
    if (encodedData !== "0x") {
      signature = await getSignatureFromContract(
        req.query.chainId,
        req.params.payloadId,
        encodedData,
      );
      signer = await getSigner(req.query.chainId);
      encodedData = await enhanceEncodedData(
        req.query.chainId,
        encodedData,
        signature,
      );
    }

    return reply.status(200).send({
      encodedData,
      signature,
      signer,
    });
  },
} as Endpoint;
