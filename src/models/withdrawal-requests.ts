import { ITask } from "pg-promise";

import { DbEntry } from "./utils";
import { db } from "../common/db";

export type PayloadParams = {
  chainId: number;
  depository: string;
  currency: string;
  amount: string;
  spender: string;
  receiver: string;
  data: string;
  nonce: string;
};

export type WithdrawalRequest = {
  id: string;
  ownerChainId: string;
  owner: string;
  chainId: string;
  currency: string;
  amount: string;
  recipient: string;
  encodedData: string;
  signature?: string;
  executed?: boolean;
  // These are only used when using "onchain" allocator mode
  payloadId?: string;
  payloadParams?: PayloadParams;
};

const resultToWithdrawalRequest = (
  result: any
): DbEntry<WithdrawalRequest> => ({
  id: result.id,
  ownerChainId: result.owner_chain_id,
  owner: result.owner,
  chainId: result.chain_id,
  currency: result.currency,
  amount: result.amount,
  recipient: result.recipient,
  encodedData: result.encoded_data,
  signature: result.signature ?? undefined,
  executed: result.executed ?? undefined,
  payloadId: result.payload_id ?? undefined,
  payloadParams: result.payload_params
    ? JSON.parse(result.payload_params)
    : undefined,
  createdAt: result.created_at,
  updatedAt: result.updated_at,
});

export const getWithdrawalRequest = async (
  id: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<WithdrawalRequest> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        withdrawal_requests.id,
        withdrawal_requests.owner_chain_id,
        withdrawal_requests.owner,
        withdrawal_requests.chain_id,
        withdrawal_requests.currency,
        withdrawal_requests.amount,
        withdrawal_requests.recipient,
        withdrawal_requests.encoded_data,
        withdrawal_requests.signature,
        withdrawal_requests.executed,
        withdrawal_requests.payload_id,
        withdrawal_requests.payload_params,
        withdrawal_requests.created_at,
        withdrawal_requests.updated_at
      FROM withdrawal_requests
      WHERE withdrawal_requests.id = $/id/
    `,
    {
      id,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToWithdrawalRequest(result);
};

export const getPendingWithdrawalRequestsByOwner = async (
  owner: string,
  ownerChainId?: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<WithdrawalRequest>[]> => {
  const results = await (options?.tx ?? db).manyOrNone(
    `
      SELECT
        withdrawal_requests.id,
        withdrawal_requests.owner_chain_id,
        withdrawal_requests.owner,
        withdrawal_requests.chain_id,
        withdrawal_requests.currency,
        withdrawal_requests.amount,
        withdrawal_requests.recipient,
        withdrawal_requests.encoded_data,
        withdrawal_requests.signature,
        withdrawal_requests.executed,
        withdrawal_requests.payload_id,
        withdrawal_requests.payload_params,
        withdrawal_requests.created_at,
        withdrawal_requests.updated_at
      FROM withdrawal_requests
      WHERE withdrawal_requests.owner = $/owner/
        AND NOT withdrawal_requests.executed
        ${
          ownerChainId
            ? " AND withdrawal_requests.owner_chain_id = $/ownerChainId/"
            : ""
        }
    `,
    {
      owner,
      ownerChainId,
    }
  );
  return results.map(resultToWithdrawalRequest);
};

export const saveWithdrawalRequest = async (
  withdrawalRequest: WithdrawalRequest,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<WithdrawalRequest> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      INSERT INTO withdrawal_requests (
        id,
        owner_chain_id,
        owner,
        chain_id,
        currency,
        amount,
        recipient,
        encoded_data,
        signature,
        payload_id,
        payload_params
      ) VALUES (
        $/id/,
        $/ownerChainId/,
        $/owner/,
        $/chainId/,
        $/currency/,
        $/amount/,
        $/recipient/,
        $/encodedData/,
        $/signature/,
        $/payloadId/,
        $/payloadParams/
      ) ON CONFLICT DO NOTHING
      RETURNING *
    `,
    {
      id: withdrawalRequest.id,
      ownerChainId: withdrawalRequest.ownerChainId,
      owner: withdrawalRequest.owner,
      chainId: withdrawalRequest.chainId,
      currency: withdrawalRequest.currency,
      amount: withdrawalRequest.amount,
      recipient: withdrawalRequest.recipient,
      encodedData: withdrawalRequest.encodedData,
      signature: withdrawalRequest.signature ?? null,
      payloadId: withdrawalRequest.payloadId ?? null,
      payloadParams: withdrawalRequest.payloadParams ?? null,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToWithdrawalRequest(result);
};

export const markWithdrawalRequestAsExecuted = async (
  id: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<WithdrawalRequest> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      UPDATE withdrawal_requests SET
        executed = TRUE,
        updated_at = now()
      WHERE withdrawal_requests.id = $/id/
        AND NOT withdrawal_requests.executed
      RETURNING *
    `,
    { id }
  );
  if (!result) {
    return undefined;
  }

  return resultToWithdrawalRequest(result);
};
