import { FastifyInstance } from "fastify";

import { Endpoint, errorWrapper } from "./utils";

import escrowDepositsV1 from "./actions/escrow-deposits/v1";
import solverFillV1 from "./actions/solver-fill/v1";

const endpoints = [escrowDepositsV1, solverFillV1] as Endpoint[];

export const setupEndpoints = (app: FastifyInstance) => {
  endpoints.forEach((endpoint) =>
    app.route({
      ...endpoint,
      handler: errorWrapper(endpoint.url, endpoint.handler),
    })
  );
};
