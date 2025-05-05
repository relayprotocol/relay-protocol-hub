import { describe, expect, it, jest } from "@jest/globals";

import { getBalance, getBalanceLock } from "../../src/models/balances";
import { RequestHandlerService } from "../../src/services/request-handler";

import { chains } from "../common/chains";
import {
  fillArray,
  iter,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";
import {
  OnchainEntry,
  saveOnchainEntryWithBalanceUpdate,
} from "../../src/models/onchain-entries";

jest.mock("../../src/config", () => {
  const { config: originalConfig } = jest.requireActual(
    "../../src/config"
  ) as typeof import("../../src/config");

  return {
    config: {
      ...originalConfig,
      ecdsaPrivateKey: "0x" + "12".repeat(32),
    },
  };
});

describe("handle-withdrawal", () => {
  it("random runs", async () => {
    const chain = chains[randomNumber(chains.length)];

    const ownerAddresses = fillArray(10, () => randomHex(20));
    const currencyAddresses = fillArray(10, () => randomHex(20));

    // Save updates to both the database and in-memory
    const inMemoryBalances: Record<
      string,
      {
        availableAmount: number;
        lockedAmount: number;
      }
    > = {};
    await iter(100, async () => {
      const onchainEntry: OnchainEntry = {
        id: randomHex(32),
        chainId: chain.id,
        transactionId: randomHex(32),
        ownerAddress: ownerAddresses[randomNumber(ownerAddresses.length)],
        currencyAddress:
          currencyAddresses[randomNumber(currencyAddresses.length)],
        balanceDiff: randomNumber(ONE_BILLION).toString(),
      };
      expect(
        await saveOnchainEntryWithBalanceUpdate(onchainEntry)
      ).toBeTruthy();

      // Update in-memory balances
      {
        const key = `${onchainEntry.chainId}-${onchainEntry.ownerAddress}-${onchainEntry.currencyAddress}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].availableAmount += Number(
          onchainEntry.balanceDiff
        );
      }

      const requestHandler = new RequestHandlerService();
      const response = await requestHandler.handleWithdrawal({
        ownerChainId: onchainEntry.chainId,
        owner: onchainEntry.ownerAddress,
        chainId: onchainEntry.chainId,
        currency: onchainEntry.currencyAddress,
        amount: onchainEntry.balanceDiff,
        recipient: randomHex(20),
      });

      expect(await getBalanceLock(response.id)).toBeTruthy();

      // Update in-memory balances
      {
        const key = `${onchainEntry.chainId}-${onchainEntry.ownerAddress}-${onchainEntry.currencyAddress}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].availableAmount -= Number(
          onchainEntry.balanceDiff
        );
        inMemoryBalances[key].lockedAmount += Number(onchainEntry.balanceDiff);
      }
    });

    // Ensure database balances match in-memory balances
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, ownerAddress, currencyAddress] = key.split("-");

        const dbBalance = await getBalance(
          chainId,
          ownerAddress,
          chainId,
          currencyAddress
        );
        expect(dbBalance).toBeTruthy();
        expect(
          dbBalance?.availableAmount ===
            inMemoryBalances[key].availableAmount.toString()
        ).toBeTruthy();
        expect(
          dbBalance?.lockedAmount ===
            inMemoryBalances[key].lockedAmount.toString()
        ).toBeTruthy();
      })
    );
  });
});
