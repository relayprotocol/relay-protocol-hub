import { Chain } from "../../src/common/chains";

import { randomHex } from "./utils";

export const chains: Chain[] = [
  {
    id: "ethereum",
    vmType: "ethereum-vm",
    escrow: randomHex(20),
    metadata: {
      chainId: 1,
    },
  },
];
