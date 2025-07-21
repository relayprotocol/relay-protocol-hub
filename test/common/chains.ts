import { Chain } from "../../src/common/chains";

import { randomHex } from "./utils";

export const chains: Chain[] = [
  {
    id: "ethereum",
    vmType: "ethereum-vm",
    depository: randomHex(20),
    metadata: {
      chainId: 1,
    },
  },
  {
    id: "bitcoin-testnet",
    vmType: "bitcoin-vm",
    depository: "tb1q4ay9q4g7nh28lkyj6m3f2kw5kw8xlqurk6y33t",
    metadata: {
      httpRpcUrl: "https://mempool.space/testnet/api",
    },
  },
];
