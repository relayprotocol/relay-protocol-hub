import { getChainVmType } from "@reservoir0x/relay-protocol-sdk/dist/utils";
import { ITask } from "pg-promise";

import { DbEntry, nvAddress } from "./utils";
import { getSdkChainsConfig } from "../common/chains";
import { db } from "../common/db";

export type NonceMapping = {
  walletChainId: string;
  wallet: string;
  nonce: string;
  id: string;
  signatureChainId: string;
  signature: string;
};

const resultToNonceMapping = (result: any): DbEntry<NonceMapping> => ({
  walletChainId: result.wallet_chain_id,
  wallet: result.wallet,
  nonce: result.nonce,
  id: result.id,
  signatureChainId: result.signature_chain_id,
  signature: result.signature,
  createdAt: result.created_at,
  updatedAt: result.updated_at,
});

export const getNonceMapping = async (
  walletChainId: string,
  wallet: string,
  nonce: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<NonceMapping> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        nonce_mappings.wallet_chain_id,
        nonce_mappings.wallet,
        nonce_mappings.nonce,
        nonce_mappings.id,
        nonce_mappings.signature_chain_id,
        nonce_mappings.signature,
        nonce_mappings.created_at,
        nonce_mappings.updated_at
      FROM nonce_mappings
      WHERE nonce_mappings.wallet_chain_id = $/walletChainId/
        AND nonce_mappings.wallet = $/wallet/
        AND nonce_mappings.nonce = $/nonce/
    `,
    {
      walletChainId,
      wallet: nvAddress(
        wallet,
        getChainVmType(walletChainId, await getSdkChainsConfig())
      ),
      nonce,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToNonceMapping(result);
};

export const saveNonceMapping = async (
  nonceMapping: NonceMapping,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<NonceMapping> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      INSERT INTO nonce_mappings (
        wallet_chain_id,
        wallet,
        nonce,
        id,
        signature_chain_id,
        signature
      ) VALUES (
        $/walletChainId/,
        $/wallet/,
        $/nonce/,
        $/id/,
        $/signatureChainId/,
        $/signature/
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    {
      walletChainId: nonceMapping.walletChainId,
      wallet: nvAddress(
        nonceMapping.wallet,
        getChainVmType(nonceMapping.walletChainId, await getSdkChainsConfig())
      ),
      nonce: nonceMapping.nonce,
      id: nonceMapping.id,
      signatureChainId: nonceMapping.signatureChainId,
      signature: nonceMapping.signature,
    }
  );
  if (!result) {
    return undefined;
  }

  return resultToNonceMapping(result);
};
