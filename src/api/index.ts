import { FastifyInstance } from "fastify";

import { Endpoint, errorWrapper } from "./utils";

import withdrawalsV1 from "./withdrawals/v1";

const endpoints = [withdrawalsV1] as Endpoint[];

export const setupEndpoints = (app: FastifyInstance) => {
  endpoints.forEach((endpoint) =>
    app.route({
      ...endpoint,
      handler: errorWrapper(endpoint.url, endpoint.handler),
    })
  );
};
