import { Type } from "@fastify/type-provider-typebox";
import { verifyTypedData } from "viem";
import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { logger } from "../../../common/logger";
import { externalError } from "../../../common/error";
import { DEPOSIT_BINDING_DOMAIN, DEPOSIT_BINDING_TYPES } from "../../../common/deposit-binding-eip712";
import { saveRequestIdMapping } from "../../../models/request-mappings";

const Schema = {
  body: Type.Object({
    depositor: Type.String({
      description: "The address of the depositor",
    }),
    depositId: Type.String({
      description: "The deposit ID to bind",
    }),
    nonce: Type.String({
      description: "The unique nonce for this binding",
    }),
    signature: Type.String({
      description: "The EIP-712 signature from the depositor",
    }),
    chainId: Type.String({
      description: "The chain ID",
    }),
    signatureChainId: Type.String({
      description: "The chain ID of the signature",
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
  method: "POST",
  url: "/actions/deposit-bindings/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const { depositor, depositId, nonce, signature, chainId, signatureChainId } = req.body;

    // Verify EIP-712 signature
    const message = {
      depositor: depositor as `0x${string}`,
      depositId: depositId as `0x${string}`,
      nonce: BigInt(nonce),
    };

    const isValid = await verifyTypedData({
      address: depositor as `0x${string}`,
      domain: DEPOSIT_BINDING_DOMAIN(Number(signatureChainId)),
      types: DEPOSIT_BINDING_TYPES,
      primaryType: "DepositBinding",
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      throw externalError(
        "Invalid signature",
        "INVALID_SIGNATURE"
      );
    }

    // Save the request ID mapping
    try {
      const savedMapping = await saveRequestIdMapping(
        {
          chainId,
          nonce,
          requestId: depositId,
          wallet: depositor,
          signature,
        },
      );
  
      logger.info(
        "tracking",
        JSON.stringify({
          msg: "Created deposit binding",
          nonce,
          depositId,
          depositor,
          chainId,
          signatureChainId,
        })
      );
  
      return reply.status(200).send({
        nonce: savedMapping.nonce,
        depositId: savedMapping.requestId,
        depositor: savedMapping.wallet,
        bindingSignature: savedMapping.signature,
      });
    } catch (error) {
      // Handle duplicate key value violates unique constraint error
      if (error.code === "23505") {
        throw externalError("Nonce already exists", "NONCE_ALREADY_EXISTS");
      }

      logger.error(
        "tracking",
        JSON.stringify({
          msg: "Failed to create deposit binding",
          nonce,
          depositId,
          depositor,
          chainId,
          signatureChainId,
          error,
        })
      );
      throw error;
    }
  },
} as Endpoint;