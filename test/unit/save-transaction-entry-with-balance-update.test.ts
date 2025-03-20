import { describe, expect, it } from "@jest/globals";

import {
  saveTransactionEntryWithBalanceUpdate,
  TransactionEntry,
} from "../../src/models/transaction-entries";
import { getBalance } from "../../src/models/balances";

import { chains } from "../common/chains";
import { fillArray, iter, randomHex, randomNumber } from "../common/utils";

describe("save-transaction-entry-with-balance-update", () => {
  it("random runs", async () => {
    const chainId = chains[randomNumber(chains.length)].id;

    const ownerChainId = chainId;
    const ownerAddresses = fillArray(3, () => randomHex(20));
    const currencyAddresses = fillArray(3, () => randomHex(20));

    // Save transaction entry updates to both the database and in-memory
    const inMemoryBalances: Record<string, number> = {};
    await iter(500, async () => {
      const ownerAddress = ownerAddresses[randomNumber(ownerAddresses.length)];
      const currencyAddress =
        currencyAddresses[randomNumber(currencyAddresses.length)];
      const balanceDiff = randomNumber(1e10);

      const key = `${chainId}-${ownerAddress}-${currencyAddress}`;
      if (!inMemoryBalances[key]) {
        inMemoryBalances[key] = 0;
      }
      inMemoryBalances[key] = inMemoryBalances[key] + balanceDiff;

      const transactionEntry: TransactionEntry = {
        chainId,
        transactionId: randomHex(32),
        entryId: "0",
        ownerChainId,
        ownerAddress,
        currencyAddress,
        balanceDiff: balanceDiff.toString(),
      };

      // The save method should be idempotent
      await iter(1 + randomNumber(3), () =>
        saveTransactionEntryWithBalanceUpdate(transactionEntry)
      );
    });

    // Ensure the database balances match the in-memory balances
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, ownerAddress, currencyAddress] = key.split("-");

        const dbBalance = await getBalance(
          Number(chainId),
          ownerAddress,
          Number(chainId),
          currencyAddress
        );
        expect(dbBalance).toBeTruthy();
        expect(
          dbBalance?.availableAmount === inMemoryBalances[key].toString()
        ).toBeTruthy();
      })
    );
  });
});
