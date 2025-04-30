import { FastifyInstance } from "fastify";

import { Endpoint, errorWrapper } from "./utils";

import actionsEscrowDepositsV1 from "./actions/escrow-deposits/v1";
import actionsEscrowWithdrawalV1 from "./actions/escrow-withdrawal/v1";
import actionsSolverFillV1 from "./actions/solver-fill/v1";
import actionsSolverRefundV1 from "./actions/solver-refund/v1";

const endpoints = [
  actionsEscrowDepositsV1,
  actionsEscrowWithdrawalV1,
  actionsSolverFillV1,
  actionsSolverRefundV1,
] as Endpoint[];

export const setupEndpoints = (app: FastifyInstance) => {
  endpoints.forEach((endpoint) =>
    app.route({
      ...endpoint,
      handler: errorWrapper(endpoint.url, endpoint.handler),
    })
  );
};
