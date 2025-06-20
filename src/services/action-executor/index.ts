import {
  DepositoryDepositMessage,
  DepositoryWithdrawalMessage,
  DepositoryWithdrawalStatus,
  SolverFillMessage,
  SolverFillStatus,
  SolverRefundMessage,
  SolverRefundStatus,
} from "@reservoir0x/relay-protocol-sdk";
import { zeroHash } from "viem";

import { db } from "../../common/db";
import { externalError } from "../../common/error";
import {
  Balance,
  getBalanceLock,
  initializeBalance,
  reallocateBalance,
  saveBalanceLock,
  unlockBalanceLock,
} from "../../models/balances";
import { saveOnchainEntryWithBalanceUpdate } from "../../models/onchain-entries";
import { markWithdrawalRequestAsExecuted } from "../../models/withdrawal-requests";

export class ActionExecutorService {
  public async executeDepositoryDeposit(
    message: DepositoryDepositMessage
  ): Promise<void> {
    // Very important to guarantee atomic execution
    await db.tx(async (tx) => {
      // Step 1:
      // Save the deposit
      const saveResult = await saveOnchainEntryWithBalanceUpdate(
        {
          id: message.result.onchainId,
          chainId: message.data.chainId,
          transactionId: message.data.transactionId,
          owner: message.result.depositor,
          currency: message.result.currency,
          balanceDiff: message.result.amount,
        },
        { tx }
      );
      // Verify the save result
      if (!saveResult) {
        return;
      }

      if (message.result.depositId !== zeroHash) {
        // Step 2:
        // Lock the balance
        const lockResult = await saveBalanceLock(
          {
            id: message.result.onchainId,
            source: "deposit",
            ownerChainId: message.data.chainId,
            owner: message.result.depositor,
            currencyChainId: message.data.chainId,
            currency: message.result.currency,
            amount: message.result.amount,
          },
          { tx }
        );
        // Verify the lock result
        if (!lockResult) {
          return;
        }
      }
    });
  }

  public async executeDepositoryWithdrawal(
    message: DepositoryWithdrawalMessage
  ): Promise<void> {
    if (message.result.status === DepositoryWithdrawalStatus.PENDING) {
      throw externalError("Depository withdrawal is pending");
    }

    // Very important to guarantee atomic execution
    await db.tx(async (tx) => {
      // Step 1:
      // Mark the corresponding withdrawal request as executed
      const executeResult = await markWithdrawalRequestAsExecuted(
        message.result.withdrawalId,
        { tx }
      );
      if (!executeResult) {
        throw externalError(
          "Corresponding withdrawal request already unlocked"
        );
      }

      // Step 2:
      // Unlock and reduce the balance
      const unlockResult = await (async () => {
        const balanceLock = await getBalanceLock(message.result.withdrawalId, {
          tx,
        });
        const newBalance = await unlockBalanceLock(
          message.result.withdrawalId,
          {
            tx,
            skipAvailableBalanceAdjustment:
              message.result.status === DepositoryWithdrawalStatus.EXECUTED
                ? true
                : false,
          }
        );
        return { balanceLock, newBalance };
      })();
      // Verify the unlock result
      if (!unlockResult.balanceLock || !unlockResult.newBalance) {
        throw externalError("Corresponding balance lock already unlocked");
      }
    });
  }

  public async executeSolverFill(message: SolverFillMessage): Promise<void> {
    if (message.result.status !== SolverFillStatus.SUCCESSFUL) {
      throw externalError("Solver fill is not successful");
    }

    // Very important to guarantee atomic execution
    await db.tx(async (tx) => {
      // Step 1:
      // Unlock all relevant balance locks
      const unlockResult = await Promise.all(
        message.data.inputs.map(async ({ onchainId }) => {
          const balanceLock = await getBalanceLock(onchainId, { tx });
          const newBalance = await unlockBalanceLock(onchainId, { tx });
          return { balanceLock, newBalance };
        })
      );
      // Verify the unlock result
      if (unlockResult.some((r) => !r.balanceLock || !r.newBalance)) {
        throw externalError("Corresponding balance lock(s) already unlocked");
      }

      // Step 2:
      // Reallocate the payments to the solver
      const reallocatePaymentsResult = await Promise.all(
        unlockResult
          .map((d) => d.balanceLock!)
          .map(async (balanceLock) => {
            // Ensure the solver's balance is initialized before reallocating
            await initializeBalance(
              message.data.order.solverChainId,
              message.data.order.solver,
              balanceLock.currencyChainId,
              balanceLock.currency,
              { tx }
            );

            const newBalances = await reallocateBalance(
              {
                ownerChainId: balanceLock.ownerChainId,
                owner: balanceLock.owner,
                currencyChainId: balanceLock.currencyChainId,
                currency: balanceLock.currency,
              },
              {
                ownerChainId: message.data.order.solverChainId,
                owner: message.data.order.solver,
              },
              balanceLock.amount,
              { tx }
            );

            return { balanceLock, newBalances };
          })
      );
      // Verify the reallocation result
      if (
        !reallocatePaymentsResult.every((r) =>
          this._verifyReallocationResult(
            r.newBalances,
            r.balanceLock.ownerChainId,
            r.balanceLock.owner,
            message.data.order.solverChainId,
            message.data.order.solver
          )
        )
      ) {
        throw externalError("Payment balance reallocation failed");
      }

      // Step 3:
      // Reallocate the fees to the recipients
      const reallocateFeesResult = await Promise.all(
        message.data.order.fees.map(async (fee) => {
          // Ensure the recipient's balance is initialized before reallocating
          await initializeBalance(
            fee.recipientChainId,
            fee.recipient,
            fee.currencyChainId,
            fee.currency,
            { tx }
          );

          const newBalances = await reallocateBalance(
            {
              ownerChainId: message.data.order.solverChainId,
              owner: message.data.order.solver,
              currencyChainId: fee.currencyChainId,
              currency: fee.currency,
            },
            {
              ownerChainId: fee.recipientChainId,
              owner: fee.recipient,
            },
            String(
              BigInt(fee.amount) +
                (BigInt(fee.amount) *
                  BigInt(message.result.totalWeightedInputPaymentBpsDiff)) /
                  10n ** 18n
            ),
            { tx }
          );

          return { fee, newBalances };
        })
      );
      // Verify the reallocation result
      if (
        !reallocateFeesResult.every((r) =>
          this._verifyReallocationResult(
            r.newBalances,
            message.data.order.solverChainId,
            message.data.order.solver,
            r.fee.recipientChainId,
            r.fee.recipient
          )
        )
      ) {
        throw externalError("Fee balance reallocation failed");
      }
    });
  }

  public async executeSolverRefund(
    message: SolverRefundMessage
  ): Promise<void> {
    if (message.result.status !== SolverRefundStatus.SUCCESSFUL) {
      throw externalError("Solver refund is not successful");
    }

    // Very important to guarantee atomic execution
    await db.tx(async (tx) => {
      // Step 1:
      // Unlock all relevant balance locks
      const unlockResult = await Promise.all(
        message.data.inputs.map(async ({ onchainId }) => {
          const balanceLock = await getBalanceLock(onchainId, { tx });
          const newBalance = await unlockBalanceLock(onchainId, { tx });
          return { balanceLock, newBalance };
        })
      );
      // Verify the unlock result
      if (unlockResult.some((r) => !r.balanceLock || !r.newBalance)) {
        throw externalError("Corresponding balance lock(s) already unlocked");
      }

      // Step 2:
      // Reallocate the payments to the solver
      const reallocatePaymentsResult = await Promise.all(
        unlockResult
          .map((d) => d.balanceLock!)
          .map(async (balanceLock) => {
            // Ensure the solver's balance is initialized before reallocating
            await initializeBalance(
              message.data.order.solverChainId,
              message.data.order.solver,
              balanceLock.currencyChainId,
              balanceLock.currency,
              { tx }
            );

            const newBalances = await reallocateBalance(
              {
                ownerChainId: balanceLock.ownerChainId,
                owner: balanceLock.owner,
                currencyChainId: balanceLock.currencyChainId,
                currency: balanceLock.currency,
              },
              {
                ownerChainId: message.data.order.solverChainId,
                owner: message.data.order.solver,
              },
              balanceLock.amount,
              { tx }
            );

            return { balanceLock, newBalances };
          })
      );
      // Verify the reallocation result
      if (
        !reallocatePaymentsResult.every((r) =>
          this._verifyReallocationResult(
            r.newBalances,
            r.balanceLock.ownerChainId,
            r.balanceLock.owner,
            message.data.order.solverChainId,
            message.data.order.solver
          )
        )
      ) {
        throw externalError("Payment balance reallocation failed");
      }
    });
  }

  // Get a unique id for a chain / address combination
  private _getId(chainId: string, address: string) {
    return `${chainId}:${address}`.toLowerCase();
  }

  // Utility for verifying the result of a reallocation
  private _verifyReallocationResult(
    newBalances: Balance[],
    fromChainId: string,
    fromAddress: string,
    toChainId: string,
    toAddress: string
  ) {
    const fromId = this._getId(fromChainId, fromAddress);
    const toId = this._getId(toChainId, toAddress);

    // Ensure that the reallocation resulted in balance changes for the `from` and `to` wallets
    return [fromId, toId].every((id) =>
      newBalances.find((b) => this._getId(b.ownerChainId, b.owner) === id)
    );
  }
}
