import { FastifyInstance } from "fastify";

import { Endpoint, errorWrapper } from "./utils";

// Actions
import actionsDepositoryDepositsV1 from "./actions/depository-deposits/v1";
import actionsDepositoryWithdrawalsV1 from "./actions/depository-withdrawals/v1";
import actionsNonceMappingsV1 from "./actions/nonce-mappings/v1";
import actionsSolverFillsV1 from "./actions/solver-fills/v1";
import actionsSolverRefundsV1 from "./actions/solver-refunds/v1";

// Queries
import queriesBalanceLocksV1 from "./queries/balance-locks/v1";
import queriesBalancesV1 from "./queries/balances/v1";
import queriesChainsV1 from "./queries/chains/v1";
import queriesConfigsV1 from "./queries/configs/v1";
import queriesNonceMappingsV1 from "./queries/nonce-mappings/v1";
import queriesPayloadIdsV1 from "./queries/payload-ids/v1";
import queriesWithdrawalRequestsV1 from "./queries/withdrawal-requests/v1";
import queriesWithdrawalRequestsV2 from "./queries/withdrawal-requests/v2";

// Requests
import requestsUnlocksV1 from "./requests/unlocks/v1";
import requestsWithdrawalsV1 from "./requests/withdrawals/v1";
import requestsWithdrawalsV2 from "./requests/withdrawals/v2";
import requestsWithdrawalsSignaturesV1 from "./requests/withdrawals-signatures/v1";
import requestsWithdrawalsSignaturesV2 from "./requests/withdrawals-signatures/v2";

const endpoints = [
  actionsDepositoryDepositsV1,
  actionsDepositoryWithdrawalsV1,
  actionsNonceMappingsV1,
  actionsSolverFillsV1,
  actionsSolverRefundsV1,
  queriesBalanceLocksV1,
  queriesBalancesV1,
  queriesChainsV1,
  queriesConfigsV1,
  queriesNonceMappingsV1,
  queriesPayloadIdsV1,
  queriesWithdrawalRequestsV1,
  queriesWithdrawalRequestsV2,
  requestsUnlocksV1,
  requestsWithdrawalsV1,
  requestsWithdrawalsV2,
  requestsWithdrawalsSignaturesV1,
  requestsWithdrawalsSignaturesV2,
] as Endpoint[];

export const setupEndpoints = (app: FastifyInstance) => {
  endpoints.forEach((endpoint) =>
    app.route({
      ...endpoint,
      handler: errorWrapper(endpoint.url, endpoint.handler),
    })
  );
};
