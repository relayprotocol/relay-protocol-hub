import { FastifyInstance } from "fastify";

import { Endpoint, errorWrapper } from "./utils";

// Actions
import actionsEscrowDepositsV1 from "./actions/escrow-deposits/v1";
import actionsEscrowWithdrawalsV1 from "./actions/escrow-withdrawals/v1";
import actionsSolverFillsV1 from "./actions/solver-fills/v1";
import actionsSolverRefundsV1 from "./actions/solver-refunds/v1";

// Queries
import queriesBalanceLocksV1 from "./queries/balance-locks/v1";
import queriesBalancesV1 from "./queries/balances/v1";
import queriesWithdrawalRequestsV1 from "./queries/withdrawal-requests/v1";

// Requests
import requestsUnlocksV1 from "./requests/unlocks/v1";
import requestsWithdrawalsV1 from "./requests/withdrawals/v1";

const endpoints = [
  actionsEscrowDepositsV1,
  actionsEscrowWithdrawalsV1,
  actionsSolverFillsV1,
  actionsSolverRefundsV1,
  queriesBalanceLocksV1,
  queriesBalancesV1,
  queriesWithdrawalRequestsV1,
  requestsUnlocksV1,
  requestsWithdrawalsV1,
] as Endpoint[];

export const setupEndpoints = (app: FastifyInstance) => {
  endpoints.forEach((endpoint) =>
    app.route({
      ...endpoint,
      handler: errorWrapper(endpoint.url, endpoint.handler),
    })
  );
};
