import { describe, expect, it } from "@jest/globals";
import { EscrowDepositMessage } from "@reservoir0x/relay-protocol-sdk";

import { ActionExecutorService } from "../../src/services/action-executor";

import { chains } from "../common/chains";
import {
  fillArray,
  iter,
  randomHex,
  randomNumber,
  wait,
} from "../common/utils";
import { getBalance } from "../../src/models/balances";
import { zeroHash } from "viem";

describe("execute-escrow-deposit", () => {
  it("execute the same deposit multiple times", async () => {
    const message: EscrowDepositMessage = {
      onchainId: randomHex(32),
      data: {
        chainId: chains[randomNumber(chains.length)].id,
        transactionId: randomHex(32),
      },
      result: {
        depositId: randomHex(32),
        escrow: randomHex(20),
        depositor: randomHex(20),
        currency: randomHex(20),
        amount: randomNumber(1000000).toString(),
      },
    };

    const results = await iter(100, async () => {
      // Random delay to avoid overloading the database
      await wait(randomNumber(1000));

      const actionExecutor = new ActionExecutorService();
      return actionExecutor.executeEscrowDeposit(message);
    });
    expect(results.every((r) => r.status === "success")).toBeTruthy();
    expect(
      results.filter((r) => r.status === "success" && r.details === "success")
        .length
    ).toEqual(1);

    const balance = await getBalance(
      message.data.chainId,
      message.result.depositor,
      message.data.chainId,
      message.result.currency
    );
    expect(balance?.availableAmount).toEqual("0");
    expect(balance?.lockedAmount).toEqual(message.result.amount);
  });

  it("random runs", async () => {
    const chainId = chains[randomNumber(chains.length)].id;

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
    await iter(200, async () => {
      // Random delay to avoid overloading the database
      await wait(randomNumber(1000));

      const message: EscrowDepositMessage = {
        onchainId: randomHex(32),
        data: {
          chainId,
          transactionId: randomHex(32),
        },
        result: {
          depositId: randomNumber(100) % 2 === 0 ? randomHex(32) : zeroHash,
          escrow: randomHex(20),
          depositor: ownerAddresses[randomNumber(ownerAddresses.length)],
          currency: currencyAddresses[randomNumber(currencyAddresses.length)],
          amount: randomNumber(1000000).toString(),
        },
      };

      const actionExecutor = new ActionExecutorService();
      const result = await actionExecutor.executeEscrowDeposit(message);
      expect(result.status).toEqual("success");

      const key = `${chainId}-${message.result.depositor}-${message.result.currency}`;
      if (!inMemoryBalances[key]) {
        inMemoryBalances[key] = {
          availableAmount: 0,
          lockedAmount: 0,
        };
      }
      inMemoryBalances[key][
        message.result.depositId === zeroHash
          ? "availableAmount"
          : "lockedAmount"
      ] += Number(message.result.amount);
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
