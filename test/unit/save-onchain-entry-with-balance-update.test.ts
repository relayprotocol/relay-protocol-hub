import { describe, expect, it } from "@jest/globals";

import { getBalance } from "../../src/models/balances";
import {
  saveOnchainEntryWithBalanceUpdate,
  OnchainEntry,
} from "../../src/models/onchain-entries";

import { chains } from "../common/chains";
import {
  fillArray,
  iter,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";

describe("save-onchain-entry-with-balance-update", () => {
  it("random runs", async () => {
    const chainId = chains[randomNumber(chains.length)].id;

    const owneres = fillArray(3, () => randomHex(20));
    const currencyes = fillArray(3, () => randomHex(20));

    // Save transaction entry updates to both the database and in-memory
    const inMemoryBalances: Record<string, number> = {};
    await iter(250, async () => {
      const owner = owneres[randomNumber(owneres.length)];
      const currency = currencyes[randomNumber(currencyes.length)];
      const balanceDiff = randomNumber(ONE_BILLION);

      // Update in-memory balances
      {
        const key = `${chainId}-${owner}-${currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = 0;
        }
        inMemoryBalances[key] = inMemoryBalances[key] + balanceDiff;
      }

      const onchainEntry: OnchainEntry = {
        id: randomHex(32),
        chainId,
        transactionId: randomHex(32),
        owner,
        currency,
        balanceDiff: balanceDiff.toString(),
      };

      // The save method should be idempotent
      await iter(1 + randomNumber(3), () =>
        saveOnchainEntryWithBalanceUpdate(onchainEntry)
      );
    });

    // Ensure database balances match in-memory balances
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, owner, currency] = key.split("-");

        const dbBalance = await getBalance(chainId, owner, chainId, currency);
        expect(dbBalance).toBeTruthy();
        expect(
          dbBalance?.availableAmount === inMemoryBalances[key].toString()
        ).toBeTruthy();
      })
    );
  });
});
