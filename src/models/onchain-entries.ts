import { ITask } from "pg-promise";

import { Balance } from "./balances";
import {
  DbEntry,
  nvAddress,
  nvBytes,
  nvCurrency,
  nvTransactionId,
} from "./utils";
import { getChain } from "../common/chains";
import { db } from "../common/db";

export type OnchainEntry = {
  id: string;
  chainId: string;
  transactionId: string;
  owner: string;
  currency: string;
  balanceDiff: string;
};

export const getOnchainEntry = async (
  id: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<OnchainEntry> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        onchain_entries.id,
        onchain_entries.chain_id,
        onchain_entries.transaction_id,
        onchain_entries.owner,
        onchain_entries.currency,
        onchain_entries.balance_diff,
        onchain_entries.created_at,
        onchain_entries.updated_at
      FROM onchain_entries
      WHERE onchain_entries.id = $/id/
    `,
    {
      id,
    }
  );
  if (!result) {
    return undefined;
  }

  return {
    id: result.id,
    chainId: result.chain_id,
    transactionId: result.transaction_id,
    owner: result.owner,
    currency: result.currency,
    balanceDiff: result.balance_diff,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const saveOnchainEntryWithBalanceUpdate = async (
  onchainEntry: OnchainEntry,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const vmType = await getChain(onchainEntry.chainId).then(
    (chain) => chain.vmType
  );

  const result = await (options?.tx ?? db).oneOrNone(
    `
      WITH x AS (
        INSERT INTO onchain_entries (
          id,
          chain_id,
          transaction_id,
          owner,
          currency,
          balance_diff
        ) VALUES (
          $/id/,
          $/chainId/,
          $/transactionId/,
          $/owner/,
          $/currency/,
          $/balanceDiff/
        ) ON CONFLICT DO NOTHING
        RETURNING *
      )
      INSERT INTO balances (
        owner_chain_id,
        owner,
        currency_chain_id,
        currency,
        available_amount
      ) (
        SELECT
          x.chain_id,
          x.owner,
          x.chain_id,
          x.currency,
          x.balance_diff
        FROM x
      )
      ON CONFLICT (owner_chain_id, owner, currency_chain_id, currency)
      DO UPDATE SET
        available_amount = balances.available_amount + EXCLUDED.available_amount,
        updated_at = now()
      RETURNING *
    `,
    {
      id: nvBytes(onchainEntry.id, 32),
      chainId: onchainEntry.chainId,
      transactionId: nvTransactionId(onchainEntry.transactionId, vmType),
      owner: nvAddress(onchainEntry.owner, vmType),
      currency: nvCurrency(onchainEntry.currency, vmType),
      balanceDiff: onchainEntry.balanceDiff,
    }
  );
  if (!result) {
    return undefined;
  }

  return {
    ownerChainId: result.owner_chain_id,
    owner: result.owner,
    currencyChainId: result.currency_chain_id,
    currency: result.currency,
    availableAmount: result.available_amount,
    lockedAmount: result.locked_amount,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};
