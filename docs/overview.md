## Overview

The Relay Hub is responsible for keeping track of the state of the protocol (eg. balances resulted from deposits into the protocol). It is a stand-alone service which relies on signed oracle messages for updating state. The hub has a public API, structured as follows:

- `/actions`: can be called to trigger various actions which require an oracle signature

  - `/actions/depository-deposits/v1`
    - to be used for letting the hub know of a user deposit
    - if the deposit specifies an order id, the corresponding balance wil be locked to the order id
    - otherwise, the balance will simply be assigned to the depositor
  - `/actions/depository-withdrawals/v1`
    - to be used for letting the hub know of a user withdrawal
    - the locked balance corresponding to the withdrawal request will be cleared
  - `/actions/solver-fills/v1`
    - to be used for letting the hub know of a solver fill
    - if the fill was successful, the balance lock corresponding to the order will be unlocked and re-assigned to the solver
  - `/actions/solver-refunds/v1`
    - to be used for letting the hub know of a solver refund
    - if the refund was successful, the balance lock corresponding to the order will be unlocked and re-assigned to the solver

- `/queries`: read-only access to various data

  - `/queries/balance-locks/:owner/v1`: get all outstanding balance locks of a given owner
  - `/queries/balances/:owner/v1`: get all balances of a given owner
  - `/queries/chains/v1`: get all chains supported by the hub
  - `/queries/withdrawal-requests/:owner/v1`: get all outstanding withdrawal requests of a given owner

- `/requests`: can be called to trigger various actions which do not require an oracle signature

  - `/requests/unlocks/:id/v1`: to be used for unlocking any balance lock which is expired and wasn't yet redeemed
  - `/requests/withdrawals/v1`: to be used for getting a signed withdrawal voucher (which can be send to the corresponding depository contract in order to withdraw funds)
