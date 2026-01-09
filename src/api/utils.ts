import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type {
  ContextConfigDefault,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { RouteGenericInterface } from "fastify/types/route";
import type { FastifySchema } from "fastify/types/schema";

import { logger } from "../common/logger";
import { isExternalError } from "../common/error";

export type FastifyRequestTypeBox<TSchema extends FastifySchema> =
  FastifyRequest<
    RouteGenericInterface,
    RawServerDefault,
    RawRequestDefaultExpression,
    TSchema,
    TypeBoxTypeProvider
  >;

export type FastifyReplyTypeBox<TSchema extends FastifySchema> = FastifyReply<
  RouteGenericInterface,
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  ContextConfigDefault,
  TSchema,
  TypeBoxTypeProvider
>;

export type Endpoint = {
  url: string;
  method: HTTPMethods;
  schema: FastifySchema;
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
};

export const ErrorResponse = {
  400: Type.Object({
    message: Type.String({ description: "Error message" }),
    code: Type.Optional(
      Type.String({ description: "Standardized error code" })
    ),
  }),
};

export const errorWrapper = (
  url: string,
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
): ((req: FastifyRequest, reply: FastifyReply) => Promise<void>) => {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await handler(req, reply);
    } catch (error) {
      logger.error(
        url,
        JSON.stringify({
          msg: "Request failed",
          error,
          errorMsg: error.msg,
          errorResponse: error.response?.data ?? error.response?.body,
          errorStack: error.stack,
        })
      );

      if (isExternalError(error)) {
        return reply.status(400).send({
          message: error.message,
          code: error.externalErrorCode,
        });
      }

      return reply.status(400).send({
        message: "An unknown error occured",
        code: "UNKNOWN",
      });
    }
  };
};

export const buildContinuation = (...components: string[]) =>
  Buffer.from(components.join("_")).toString("base64");

export const splitContinuation = (continuation: string) =>
  Buffer.from(continuation, "base64").toString("ascii").split("_");

// schema for allocator submitWithdrawRequest
export const SubmitWithdrawalRequestParamsSchema = Type.Object({
  chainId: Type.String({
    description: "The chain id of the allocator",
  }),
  depository: Type.String({
    description: "The depository address of the allocator",
  }),
  currency: Type.String({
    description: "The currency to withdraw",
  }),
  amount: Type.String({
    description: "The amount to withdraw",
  }),
  spender: Type.String({
    description: "The address of the spender",
  }),
  receiver: Type.String({
    description: "The address of the receiver on the depository chain",
  }),
  data: Type.String({
    description: "The data to include in the withdrawal request",
  }),
  nonce: Type.String({
    description: "The nonce to include in the withdrawal request",
  }),
});
