import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { externalError } from "../../../common/error";
import { getDepositBindingByNonce } from "../../../models/deposit-bindings";

const Schema = {
  params: Type.Object({
    nonce: Type.String({
      description: "The nonce to lookup",
    }),
    depositor: Type.String({
      description: "The depositor address to lookup",
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
  url: "/queries/deposits/by-nonce/:nonce/:depositor",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const { nonce, depositor } = req.params;

    const binding = await getDepositBindingByNonce(nonce, depositor);
    if (!binding) {
      throw externalError("Deposit binding not found", "DEPOSIT_BINDING_NOT_FOUND");
    }

    return reply.status(200).send({
      nonce: binding.nonce,
      depositId: binding.depositId,
      depositor: binding.depositor,
      bindingSignature: binding.signature,
    });
  },
} as Endpoint;