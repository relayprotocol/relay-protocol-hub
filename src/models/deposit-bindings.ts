import { ITask } from "pg-promise";

import { DbEntry } from "./utils";
import { db } from "../common/db";

export type DepositBinding = {
  nonce: string;
  depositId: string;
  depositor: string;
  signature: string;
};

const resultToDepositBinding = (result: any): DbEntry<DepositBinding> => ({
  nonce: result.nonce,
  depositId: result.deposit_id,
  depositor: result.depositor,
  signature: result.signature,
  createdAt: result.created_at,
  updatedAt: result.updated_at,
});

export const getDepositBindingByNonce = async (
  nonce: string,
  depositor: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<DepositBinding> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        deposit_bindings.nonce,
        deposit_bindings.deposit_id,
        deposit_bindings.depositor,
        deposit_bindings.signature,
        deposit_bindings.created_at,
        deposit_bindings.updated_at
      FROM deposit_bindings
      WHERE deposit_bindings.nonce = $/nonce/ AND deposit_bindings.depositor = $/depositor/
    `,
    {
      nonce,
      depositor,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToDepositBinding(result);
};

export const saveDepositBinding = async (
  depositBinding: DepositBinding,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<DepositBinding>> => {
  const result = await (options?.tx ?? db).one(
    `
      INSERT INTO deposit_bindings (
        nonce,
        deposit_id,
        depositor,
        signature
      ) VALUES (
        $/nonce/,
        $/depositId/,
        $/depositor/,
        $/signature/
      )
      RETURNING *
    `,
    {
      nonce: depositBinding.nonce,
      depositId: depositBinding.depositId,
      depositor: depositBinding.depositor,
      signature: depositBinding.signature,
    }
  );

  return resultToDepositBinding(result);
};