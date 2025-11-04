import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { externalError } from "../../../common/error";
import { getRequestIdMappingByNonce } from "../../../models/request-mappings";

const Schema = {
  params: Type.Object({
    nonce: Type.String({
      description: "The nonce to lookup",
    }),
    depositor: Type.String({
      description: "The depositor address to lookup",
    }),
    chainId: Type.String({
      description: "The chain ID to lookup",
    }),
  }),
  response: {
    200: Type.Object({
      nonce: Type.String(),
      depositId: Type.String(),
      depositor: Type.String(),
      bindingSignature: Type.String(),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/deposits/by-nonce/:nonce/:depositor/:chainId",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const { nonce, depositor, chainId } = req.params;

    const mapping = await getRequestIdMappingByNonce(nonce, depositor, chainId);
    if (!mapping) {
      throw externalError("Deposit binding not found", "DEPOSIT_BINDING_NOT_FOUND");
    }

    return reply.status(200).send({
      nonce: mapping.nonce,
      depositId: mapping.requestId,
      depositor: mapping.wallet,
      bindingSignature: mapping.signature,
    });
  },
} as Endpoint;