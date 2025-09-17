import { ITask } from "pg-promise";

import { DbEntry, nvAddress, nvBytes, nvCurrency } from "./utils";
import { getChain } from "../common/chains";
import { db } from "../common/db";

export type Balance = {
  ownerChainId: string;
  owner: string;
  currencyChainId: string;
  currency: string;
  availableAmount: string;
  lockedAmount: string;
};

type BalanceLockSource = "deposit" | "withdrawal";

export type BalanceLock = {
  id: string;
  source: BalanceLockSource;
  ownerChainId: string;
  owner: string;
  currencyChainId: string;
  currency: string;
  amount: string;
  expiration?: number;
  executed?: boolean;
};

const resultToBalance = (result: any): DbEntry<Balance> => ({
  ownerChainId: result.owner_chain_id,
  owner: result.owner,
  currencyChainId: result.currency_chain_id,
  currency: result.currency,
  availableAmount: result.available_amount,
  lockedAmount: result.locked_amount,
  createdAt: result.created_at,
  updatedAt: result.updated_at,
});

// If the balance lock has no explicit expiration, it defaults to 3 days from the moment of creation
const DEFAULT_BALANCE_LOCK_EXPIRATION_PG = "3 days";
const DEFAULT_BALANCE_LOCK_EXPIRATION = 3 * 24 * 60 * 60;

const resultToBalanceLock = (result: any): DbEntry<BalanceLock> => ({
  id: result.id,
  source: result.source,
  ownerChainId: result.owner_chain_id,
  owner: result.owner,
  currencyChainId: result.currency_chain_id,
  currency: result.currency,
  amount: result.amount,
  expiration:
    result.expiration ??
    Math.floor((result.created_at as Date).getTime() / 1000) +
      DEFAULT_BALANCE_LOCK_EXPIRATION,
  executed: result.executed ?? undefined,
  createdAt: result.created_at,
  updatedAt: result.updated_at,
});

export const getBalance = async (
  ownerChainId: string,
  owner: string,
  currencyChainId: string,
  currency: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        balances.owner_chain_id,
        balances.owner,
        balances.currency_chain_id,
        balances.currency,
        balances.available_amount,
        balances.locked_amount,
        balances.created_at,
        balances.updated_at
      FROM balances
      WHERE balances.owner_chain_id = $/ownerChainId/
        AND balances.owner = $/owner/
        AND balances.currency_chain_id = $/currencyChainId/
        AND balances.currency = $/currency/
    `,
    {
      ownerChainId,
      owner,
      currencyChainId,
      currency,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToBalance(result);
};

export const getBalancesByOwner = async (
  owner: string,
  ownerChainId?: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance>[]> => {
  const results = await (options?.tx ?? db).manyOrNone(
    `
      SELECT
        balances.owner_chain_id,
        balances.owner,
        balances.currency_chain_id,
        balances.currency,
        balances.available_amount,
        balances.locked_amount,
        balances.created_at,
        balances.updated_at
      FROM balances
      WHERE balances.owner = $/owner/
        AND (balances.available_amount > 0 OR balances.locked_amount > 0)
        ${ownerChainId ? " AND balances.owner_chain_id = $/ownerChainId/" : ""}
    `,
    {
      owner,
      ownerChainId,
    }
  );

  return results.map(resultToBalance);
};

export const initializeBalance = async (
  ownerChainId: string,
  owner: string,
  currencyChainId: string,
  currency: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const ownerVmType = await getChain(ownerChainId).then(
    (chain) => chain.vmType
  );
  const currencyVmType = await getChain(currencyChainId).then(
    (chain) => chain.vmType
  );

  const result = await (options?.tx ?? db).oneOrNone(
    `
      INSERT INTO balances (
        owner_chain_id,
        owner,
        currency_chain_id,
        currency,
        available_amount,
        locked_amount
      ) VALUES (
        $/ownerChainId/,
        $/owner/,
        $/currencyChainId/,
        $/currency/,
        0,
        0
      ) ON CONFLICT DO NOTHING
    `,
    {
      ownerChainId,
      owner: nvAddress(owner, ownerVmType),
      currencyChainId,
      currency: nvCurrency(currency, currencyVmType),
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToBalance(result);
};

export const getBalanceLock = async (
  balanceLockId: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<BalanceLock> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        balance_locks.id,
        balance_locks.source,
        balance_locks.owner_chain_id,
        balance_locks.owner,
        balance_locks.currency_chain_id,
        balance_locks.currency,
        balance_locks.amount,
        balance_locks.executed,
        balance_locks.expiration,
        balance_locks.created_at,
        balance_locks.updated_at
      FROM balance_locks
      WHERE balance_locks.id = $/balanceLockId/
    `,
    {
      balanceLockId,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToBalanceLock(result);
};

export const getPendingBalanceLocksByOwner = async (
  owner: string,
  ownerChainId?: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<BalanceLock>[]> => {
  const results = await (options?.tx ?? db).manyOrNone(
    `
      SELECT
        balance_locks.id,
        balance_locks.source,
        balance_locks.owner_chain_id,
        balance_locks.owner,
        balance_locks.currency_chain_id,
        balance_locks.currency,
        balance_locks.amount,
        balance_locks.executed,
        balance_locks.expiration,
        balance_locks.created_at,
        balance_locks.updated_at
      FROM balance_locks
      WHERE balance_locks.owner = $/owner/
        AND NOT balance_locks.executed
        ${
          ownerChainId
            ? " AND balance_locks.owner_chain_id = $/ownerChainId/"
            : ""
        }
    `,
    {
      owner,
      ownerChainId,
    }
  );

  return results.map(resultToBalanceLock);
};

export const saveBalanceLock = async (
  balanceLock: BalanceLock,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const ownerVmType = await getChain(balanceLock.ownerChainId).then(
    (chain) => chain.vmType
  );
  const currencyVmType = await getChain(balanceLock.currencyChainId).then(
    (chain) => chain.vmType
  );

  const result = await (options?.tx ?? db).oneOrNone(
    `
      WITH x AS (
        INSERT INTO balance_locks (
          id,
          source,
          owner_chain_id,
          owner,
          currency_chain_id,
          currency,
          amount,
          expiration
        ) VALUES (
          $/id/,
          $/source/,
          $/ownerChainId/,
          $/owner/,
          $/currencyChainId/,
          $/currency/,
          $/amount/,
          $/expiration/
        ) ON CONFLICT DO NOTHING
        RETURNING *
      )
      UPDATE balances SET
        available_amount = balances.available_amount - x.amount,
        locked_amount = balances.locked_amount + x.amount,
        updated_at = now()
      FROM x
      WHERE balances.owner_chain_id = x.owner_chain_id
        AND balances.owner = x.owner
        AND balances.currency_chain_id = x.currency_chain_id
        AND balances.currency = x.currency
      RETURNING *
    `,
    {
      id: nvBytes(balanceLock.id, 32),
      source: balanceLock.source,
      ownerChainId: balanceLock.ownerChainId,
      owner: nvAddress(balanceLock.owner, ownerVmType),
      currencyChainId: balanceLock.currencyChainId,
      currency: nvCurrency(balanceLock.currency, currencyVmType),
      amount: balanceLock.amount,
      expiration: balanceLock.expiration ?? null,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToBalance(result);
};

export const unlockBalanceLock = async (
  balanceLockId: string,
  options?: {
    // When set, this results in the total balance being reduced,
    // otherwise the total balance stays the same, while only the
    // available / locked ratio changes
    skipAvailableBalanceAdjustment?: boolean;
    // When set, the balance lock expiration is checked before unlocking
    checkExpiration?: boolean;
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      WITH
        x AS (
          UPDATE balance_locks SET
            executed = TRUE,
            updated_at = now()
          WHERE balance_locks.id = $/balanceLockId/
            AND NOT balance_locks.executed
            ${
              options?.checkExpiration
                ? `
                  AND COALESCE(
                    to_timestamp(balance_locks.expiration),
                    balance_locks.created_at + interval '${DEFAULT_BALANCE_LOCK_EXPIRATION_PG}'
                  ) < now()
                `
                : ""
            }
          RETURNING
            balance_locks.owner_chain_id,
            balance_locks.owner,
            balance_locks.currency_chain_id,
            balance_locks.currency,
            balance_locks.amount
        )
        UPDATE balances SET
          ${
            options?.skipAvailableBalanceAdjustment
              ? ""
              : "available_amount = balances.available_amount + x.amount,"
          }
          locked_amount = balances.locked_amount - x.amount,
          updated_at = now()
        FROM x
        WHERE balances.owner_chain_id = x.owner_chain_id
          AND balances.owner = x.owner
          AND balances.currency_chain_id = x.currency_chain_id
          AND balances.currency = x.currency
        RETURNING *
    `,
    {
      balanceLockId,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToBalance(result);
};

export const reallocateBalance = async (
  from: Pick<
    Balance,
    "ownerChainId" | "owner" | "currencyChainId" | "currency"
  >,
  to: Pick<Balance, "ownerChainId" | "owner">,
  amount: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance>[]> => {
  const fromOwnerVmType = await getChain(from.ownerChainId).then(
    (chain) => chain.vmType
  );
  const fromCurrencyVmType = await getChain(from.currencyChainId).then(
    (chain) => chain.vmType
  );
  const toOwnerVmType = await getChain(to.ownerChainId).then(
    (chain) => chain.vmType
  );

  const results = await (options?.tx ?? db).manyOrNone(
    `
      WITH
        x(owner_chain_id, owner, currency_chain_id, currency, balance_diff) AS (
          VALUES
            (
              $/fromOwnerChainId/::TEXT,
              $/fromowner/::TEXT,
              $/fromCurrencyChainId/::TEXT,
              $/fromcurrency/::TEXT,
              -$/amount/::NUMERIC(78, 0)
            ),
            (
              $/toOwnerChainId/,
              $/toowner/,
              $/fromCurrencyChainId/,
              $/fromcurrency/,
              $/amount/
            )
        )
        UPDATE balances SET
          available_amount = balances.available_amount + x.balance_diff,
          updated_at = now()
        FROM x
        WHERE balances.owner_chain_id = x.owner_chain_id
          AND balances.owner = x.owner
          AND balances.currency_chain_id = x.currency_chain_id
          AND balances.currency = x.currency
        RETURNING *
    `,
    {
      fromOwnerChainId: from.ownerChainId,
      fromowner: nvAddress(from.owner, fromOwnerVmType),
      fromCurrencyChainId: from.currencyChainId,
      fromcurrency: nvCurrency(from.currency, fromCurrencyVmType),
      toOwnerChainId: to.ownerChainId,
      toowner: nvAddress(to.owner, toOwnerVmType),
      amount,
    }
  );

  return results.map(resultToBalance);
};
