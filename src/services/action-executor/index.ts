import {
  EscrowDepositMessage,
  SolverFillMessage,
  SolverRefundMessage,
} from "@reservoir0x/relay-protocol-sdk";
import { zeroHash } from "viem";

import { db } from "../../common/db";
import { internalError } from "../../common/error";
import {
  Balance,
  getBalanceLock,
  initializeBalance,
  reallocateBalance,
  saveBalanceLock,
  unlockBalanceLock,
} from "../../models/balances";
import { saveOnchainEntryWithBalanceUpdate } from "../../models/onchain-entries";

type ExecutionResult<TSuccess, TFailure> =
  | { status: "success"; details: TSuccess }
  | { status: "failure"; details: TFailure };

export class ActionExecutorService {
  public async executeEscrowDeposit(
    message: EscrowDepositMessage
  ): Promise<
    ExecutionResult<"already-locked" | "already-saved" | "success", "unknown">
  > {
    let result:
      | Awaited<ReturnType<typeof this.executeEscrowDeposit>>
      | undefined;

    // Very important to guarantee atomic execution
    await db
      .tx(async (tx) => {
        // Step 1:
        // Save the deposit
        const saveResult = await saveOnchainEntryWithBalanceUpdate(
          {
            id: message.result.onchainId,
            chainId: message.data.chainId,
            transactionId: message.data.transactionId,
            ownerAddress: message.result.depositor,
            currencyAddress: message.result.currency,
            balanceDiff: message.result.amount,
          },
          tx
        );
        // Verify the save result
        if (!saveResult) {
          result = {
            status: "success",
            details: "already-saved",
          };
          return;
        }

        if (message.result.depositId !== zeroHash) {
          // Step 2:
          // Lock the balance
          const lockResult = await saveBalanceLock(
            {
              id: message.result.onchainId,
              ownerChainId: message.data.chainId,
              ownerAddress: message.result.depositor,
              currencyChainId: message.data.chainId,
              currencyAddress: message.result.currency,
              amount: message.result.amount,
            },
            tx
          );
          // Verify the lock result
          if (!lockResult) {
            result = {
              status: "success",
              details: "already-locked",
            };
            return;
          }
        }
      })
      .catch(() => {
        if (!result) {
          result = {
            status: "failure",
            details: "unknown",
          };
        }
      });

    if (result) {
      return result;
    }

    return {
      status: "success",
      details: "success",
    };
  }

  public async executeSolverFill(
    message: SolverFillMessage
  ): Promise<
    ExecutionResult<
      "success",
      "already-unlocked" | "reallocation-failed" | "unknown"
    >
  > {
    let result: Awaited<ReturnType<typeof this.executeSolverFill>> | undefined;

    // Very important to guarantee atomic execution
    await db
      .tx(async (tx) => {
        // Step 1:
        // Unlock all relevant balance locks
        const unlockResult = await Promise.all(
          message.data.inputs.map(async ({ onchainId }) => {
            const balanceLock = await getBalanceLock(onchainId, tx);
            const newBalance = await unlockBalanceLock(onchainId, tx);
            return { balanceLock, newBalance };
          })
        );
        // Verify the unlock result
        if (unlockResult.some((r) => !r.balanceLock || !r.newBalance)) {
          result = {
            status: "failure",
            details: "already-unlocked",
          };
          throw internalError(result.details);
        }

        // Step 2:
        // Reallocate the payments to the solver
        const reallocatePaymentsResult = await Promise.all(
          unlockResult
            .map((d) => d.balanceLock!)
            .map(async (balanceLock) => {
              // Ensure the solver's balance is initialized before reallocating
              await initializeBalance(
                message.data.order.solver.chainId,
                message.data.order.solver.address,
                balanceLock.currencyChainId,
                balanceLock.currencyAddress,
                tx
              );

              const newBalances = await reallocateBalance(
                {
                  ownerChainId: balanceLock.ownerChainId,
                  ownerAddress: balanceLock.ownerAddress,
                  currencyChainId: balanceLock.currencyChainId,
                  currencyAddress: balanceLock.currencyAddress,
                },
                {
                  ownerChainId: message.data.order.solver.chainId,
                  ownerAddress: message.data.order.solver.address,
                },
                balanceLock.amount,
                tx
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
              r.balanceLock.ownerAddress,
              message.data.order.solver.chainId,
              message.data.order.solver.address
            )
          )
        ) {
          result = {
            status: "failure",
            details: "reallocation-failed",
          };
          throw internalError(result.details);
        }

        // Step 3:
        // Reallocate the fees to the recipients
        const reallocateFeesResult = await Promise.all(
          message.data.order.fees.map(async (fee) => {
            // Ensure the recipient's balance is initialized before reallocating
            await initializeBalance(
              fee.recipientChainId,
              fee.recipientAddress,
              fee.currencyChainId,
              fee.currencyAddress,
              tx
            );

            const newBalances = await reallocateBalance(
              {
                ownerChainId: message.data.order.solver.chainId,
                ownerAddress: message.data.order.solver.address,
                currencyChainId: fee.currencyChainId,
                currencyAddress: fee.currencyAddress,
              },
              {
                ownerChainId: fee.recipientChainId,
                ownerAddress: fee.recipientAddress,
              },
              String(
                BigInt(fee.amount) +
                  (BigInt(fee.amount) *
                    BigInt(message.result.totalWeightedInputPaymentBpsDiff)) /
                    10n ** 18n
              ),
              tx
            );

            return { fee, newBalances };
          })
        );
        // Verify the reallocation result
        if (
          !reallocateFeesResult.every((r) =>
            this._verifyReallocationResult(
              r.newBalances,
              message.data.order.solver.chainId,
              message.data.order.solver.address,
              r.fee.recipientChainId,
              r.fee.recipientAddress
            )
          )
        ) {
          result = {
            status: "failure",
            details: "reallocation-failed",
          };
          throw internalError(result.details);
        }
      })
      .catch(() => {
        if (!result) {
          result = {
            status: "failure",
            details: "unknown",
          };
        }
      });

    if (result) {
      return result;
    }

    return {
      status: "success",
      details: "success",
    };
  }

  public async executeSolverRefund(
    message: SolverRefundMessage
  ): Promise<
    ExecutionResult<
      "success",
      "already-unlocked" | "reallocation-failed" | "unknown"
    >
  > {
    let result:
      | Awaited<ReturnType<typeof this.executeSolverRefund>>
      | undefined;

    // Very important to guarantee atomic execution
    await db
      .tx(async (tx) => {
        // Step 1:
        // Unlock all relevant balance locks
        const unlockResult = await Promise.all(
          message.data.inputs.map(async ({ onchainId }) => {
            const balanceLock = await getBalanceLock(onchainId, tx);
            const newBalance = await unlockBalanceLock(onchainId, tx);
            return { balanceLock, newBalance };
          })
        );
        // Verify the unlock result
        if (unlockResult.some((r) => !r.balanceLock || !r.newBalance)) {
          result = {
            status: "failure",
            details: "already-unlocked",
          };
          throw internalError(result.details);
        }

        // Step 2:
        // Reallocate the payments to the solver
        const reallocatePaymentsResult = await Promise.all(
          unlockResult
            .map((d) => d.balanceLock!)
            .map(async (balanceLock) => {
              const newBalances = await reallocateBalance(
                {
                  ownerChainId: balanceLock.ownerChainId,
                  ownerAddress: balanceLock.ownerAddress,
                  currencyChainId: balanceLock.currencyChainId,
                  currencyAddress: balanceLock.currencyAddress,
                },
                {
                  ownerChainId: message.data.order.solver.chainId,
                  ownerAddress: message.data.order.solver.address,
                },
                balanceLock.amount,
                tx
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
              r.balanceLock.ownerAddress,
              message.data.order.solver.chainId,
              message.data.order.solver.address
            )
          )
        ) {
          result = {
            status: "failure",
            details: "reallocation-failed",
          };
          throw internalError(result.details);
        }
      })
      .catch(() => {
        if (!result) {
          result = {
            status: "failure",
            details: "unknown",
          };
        }
      });

    if (result) {
      return result;
    }

    return {
      status: "success",
      details: "success",
    };
  }

  // Get a unique id for a chain / address combination
  private _getId(chainId: number, address: string) {
    return `${chainId}:${address}`.toLowerCase();
  }

  // Utility for verifying the result of a reallocation
  private _verifyReallocationResult(
    newBalances: Balance[],
    fromChainId: number,
    fromAddress: string,
    toChainId: number,
    toAddress: string
  ) {
    const fromId = this._getId(fromChainId, fromAddress);
    const toId = this._getId(toChainId, toAddress);

    // Ensure that the reallocation resulted in balance changes for the `from` and `to` wallets
    return [fromId, toId].every((id) =>
      newBalances.find(
        (b) => this._getId(b.ownerChainId, b.ownerAddress) === id
      )
    );
  }
}
