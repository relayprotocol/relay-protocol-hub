import { describe, expect, it } from "@jest/globals";
import {
  EscrowDepositMessage,
  getOrderId,
  Order,
  SolverRefundMessage,
  SolverRefundStatus,
} from "@reservoir0x/relay-protocol-sdk";

import { getBalance } from "../../src/models/balances";
import { ActionExecutorService } from "../../src/services/action-executor";

import { chains } from "../common/chains";
import {
  fillArray,
  iterNoConcurrency,
  now,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";

describe("execute-solver-refund", () => {
  it("random runs with single input order", async () => {
    const chainId = chains[randomNumber(chains.length)].id;

    const solverAddress = randomHex(20);
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
    await iterNoConcurrency(150, async () => {
      const order: Order = {
        solver: {
          chainId,
          address: solverAddress,
        },
        salt: randomNumber(ONE_BILLION).toString(),
        inputs: [
          {
            payment: {
              chainId,
              currency:
                currencyAddresses[randomNumber(currencyAddresses.length)],
              amount: randomNumber(ONE_BILLION).toString(),
              weight: "1",
            },
            refunds: [
              {
                chainId,
                recipient: ownerAddresses[randomNumber(ownerAddresses.length)],
                currency:
                  currencyAddresses[randomNumber(currencyAddresses.length)],
                minimumAmount: randomNumber(ONE_BILLION).toString(),
                deadline: now() + 3600,
                extraData: "0x",
              },
            ],
          },
        ],
        output: {
          chainId,
          payments: [
            {
              recipient: ownerAddresses[randomNumber(ownerAddresses.length)],
              currency:
                currencyAddresses[randomNumber(currencyAddresses.length)],
              expectedAmount: randomNumber(ONE_BILLION).toString(),
              minimumAmount: randomNumber(ONE_BILLION).toString(),
            },
          ],
          calls: [],
          deadline: now() + 3600,
          extraData: "0x",
        },
        fees:
          randomNumber(10) % 2 === 0
            ? []
            : [
                {
                  recipientChainId: chainId,
                  recipientAddress:
                    ownerAddresses[randomNumber(ownerAddresses.length)],
                  currencyChainId: chainId,
                  currencyAddress:
                    currencyAddresses[randomNumber(currencyAddresses.length)],
                  amount: randomNumber(ONE_BILLION).toString(),
                },
              ],
      };
      const orderId = getOrderId(order, { [chainId]: "ethereum-vm" });

      const actionExecutor = new ActionExecutorService();

      const escrowDepositMessage: EscrowDepositMessage = {
        data: {
          chainId,
          transactionId: randomHex(32),
        },
        result: {
          onchainId: randomHex(32),
          depositId: orderId,
          depositor: ownerAddresses[randomNumber(ownerAddresses.length)],
          currency: order.inputs[0].payment.currency,
          amount: order.inputs[0].payment.amount,
        },
      };
      const escrowDepositResult = await actionExecutor.executeEscrowDeposit(
        escrowDepositMessage
      );
      expect(escrowDepositResult.status).toEqual("success");

      // Update in-memory balances
      {
        const key = `${chainId}-${escrowDepositMessage.result.depositor}-${escrowDepositMessage.result.currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].lockedAmount += Number(
          escrowDepositMessage.result.amount
        );
      }

      const solverRefundMessage: SolverRefundMessage = {
        data: {
          order,
          orderSignature: randomHex(64),
          inputs: [
            {
              transactionId: escrowDepositMessage.data.transactionId,
              onchainId: escrowDepositMessage.result.onchainId,
              inputIndex: 0,
            },
          ],
          refunds: [
            {
              transactionId: randomHex(32),
              inputIndex: 0,
              refundIndex: 0,
            },
          ],
        },
        result: {
          orderId,
          status: SolverRefundStatus.SUCCESSFUL,
          totalWeightedInputPaymentBpsDiff: "0",
        },
      };
      const solverRefundResult = await actionExecutor.executeSolverRefund(
        solverRefundMessage
      );
      expect(solverRefundResult.status).toEqual("success");

      // Update in-memory balances
      {
        const key = `${chainId}-${escrowDepositMessage.result.depositor}-${escrowDepositMessage.result.currency}`;
        inMemoryBalances[key].lockedAmount -= Number(
          escrowDepositMessage.result.amount
        );
      }
      {
        const key = `${chainId}-${order.solver.address}-${escrowDepositMessage.result.currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].availableAmount += Number(
          escrowDepositMessage.result.amount
        );
      }
    });

    // Ensure database balances match in-memory balances
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
