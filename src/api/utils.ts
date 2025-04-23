import {
  TLiteral,
  TUnion,
  Type,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
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

export const ErrorResponse = (codes: TUnion<TLiteral[]>) => ({
  400: Type.Object({
    message: Type.String({ description: "Error message" }),
    code: codes,
  }),
});

export type Endpoint = {
  url: string;
  method: HTTPMethods;
  schema: FastifySchema;
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
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

      throw new Error("Something went wrong");
    }
  };
};

export const buildContinuation = (...components: string[]) =>
  Buffer.from(components.join("_")).toString("base64");

export const splitContinuation = (continuation: string) =>
  Buffer.from(continuation, "base64").toString("ascii").split("_");
