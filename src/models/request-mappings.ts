import { ITask } from "pg-promise";

import { DbEntry } from "./utils";
import { db } from "../common/db";

export type RequestIdMapping = {
  chainId: string;
  nonce: string;
  requestId: string;
  wallet: string;
  signature: string;
};

const resultToRequestIdMapping = (result: any): DbEntry<RequestIdMapping> => ({
  chainId: result.chain_id,
  nonce: result.nonce,
  requestId: result.request_id,
  wallet: result.wallet,
  signature: result.signature,
  createdAt: result.created_at,
  updatedAt: result.updated_at,
});

export const getRequestIdMappingByNonce = async (
  nonce: string,
  wallet: string,
  chainId: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<RequestIdMapping> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        request_id_mappings.chain_id,
        request_id_mappings.nonce,
        request_id_mappings.request_id,
        request_id_mappings.wallet,
        request_id_mappings.signature,
        request_id_mappings.created_at,
        request_id_mappings.updated_at
      FROM request_id_mappings
      WHERE request_id_mappings.nonce = $/nonce/ AND request_id_mappings.wallet = $/wallet/ AND request_id_mappings.chain_id = $/chainId/
    `,
    {
      nonce,
      wallet,
      chainId,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToRequestIdMapping(result);
};

export const saveRequestIdMapping = async (
  requestIdMapping: RequestIdMapping,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<RequestIdMapping>> => {
  const result = await (options?.tx ?? db).one(
    `
      INSERT INTO request_id_mappings (
        chain_id,
        nonce,
        request_id,
        wallet,
        signature
      ) VALUES (
        $/chainId/,
        $/nonce/,
        $/requestId/,
        $/wallet/,
        $/signature/
      )
      RETURNING *
    `,
    {
      chainId: requestIdMapping.chainId,
      nonce: requestIdMapping.nonce,
      requestId: requestIdMapping.requestId,
      wallet: requestIdMapping.wallet,
      signature: requestIdMapping.signature,
    }
  );

  return resultToRequestIdMapping(result);
};