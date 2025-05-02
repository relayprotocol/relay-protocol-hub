import { describe, expect, it } from "@jest/globals";
import { EscrowDepositMessage } from "@reservoir0x/relay-protocol-sdk";
import { zeroHash } from "viem";

import { getBalance } from "../../src/models/balances";
import { ActionExecutorService } from "../../src/services/action-executor";

import { chains } from "../common/chains";
import {
  fillArray,
  iter,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";

describe("execute-escrow-deposit", () => {
  it("execute the same deposit multiple times", async () => {
    const chain = chains[randomNumber(chains.length)];

    const message: EscrowDepositMessage = {
      data: {
        chainId: chain.id,
        transactionId: randomHex(32),
      },
      result: {
        onchainId: randomHex(32),
        escrow: chain.escrow,
        depositId: randomHex(32),
        depositor: randomHex(20),
        currency: randomHex(20),
        amount: randomNumber(ONE_BILLION).toString(),
      },
    };

    await iter(100, async () => {
      const actionExecutor = new ActionExecutorService();
      await expect(
        actionExecutor.executeEscrowDeposit(message)
      ).resolves.not.toThrowError();
    });

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
    await iter(250, async () => {
      const message: EscrowDepositMessage = {
        data: {
          chainId: chain.id,
          transactionId: randomHex(32),
        },
        result: {
          onchainId: randomHex(32),
          escrow: chain.escrow,
          depositId: randomNumber(100) % 2 === 0 ? randomHex(32) : zeroHash,
          depositor: ownerAddresses[randomNumber(ownerAddresses.length)],
          currency: currencyAddresses[randomNumber(currencyAddresses.length)],
          amount: randomNumber(ONE_BILLION).toString(),
        },
      };

      const actionExecutor = new ActionExecutorService();
      await expect(
        actionExecutor.executeEscrowDeposit(message)
      ).resolves.not.toThrowError();

      // Update in-memory balances
      {
        const key = `${chain.id}-${message.result.depositor}-${message.result.currency}`;
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
