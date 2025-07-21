import axios from 'axios';
import { randomBytes } from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import { createAndSignTransaction } from '../../src/common/vm/bitcoin-vm/utils/transaction';
import { bitcoin as bitcoinSdk } from '@reservoir0x/relay-protocol-sdk';
import { describe, expect, it, jest } from "@jest/globals";

// Initialize ECPair factory with the secp256k1 library
const ECPair = ECPairFactory(ecc);

// Initialize library with required ECC functions
bitcoin.initEccLib(ecc);

const HUB_URL = 'http://localhost:3002';
const ORACLE_URL = 'http://localhost:3031';
const OWNER_ADDRESS = 'tb1q9xq6tn35y5hfmt790cpsphx5wja2m696dza48v';
const BITCOIN_RECIPIENT = 'tb1q4wrz9duxm6epxqjt5ehgh9upmvr5dtuc9t6ajq';
const CURRENCY = 'tb1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqtlc5af'; // Testnet currency

// Bitcoin testnet configuration
const BITCOIN_NETWORK = bitcoin.networks.testnet;
const BITCOIN_TEST_PRIVATE_KEY = process.env.BITCOIN_TEST_PRIVATE_KEY!
const BITCOIN_RPC_URL = process.env.BITCOIN_RPC_URL!

describe('Bitcoin VM Flow Test', () => {
  jest.setTimeout(60 * 1000 * 50);

  let depositoryAddress: string;
  let depositId: string;
  let depositTxId: string;
  let withdrawalId: string;
  let withdrawalTxId: string;

  // Helper function to create Bitcoin RPC client
  const createBitcoinRpcClient = () => {
    return bitcoinSdk.createProvider(BITCOIN_RPC_URL);
  };

  // Helper function to create a Bitcoin deposit transaction with OP_RETURN data
  async function createDepositTransaction(
    toAddress: string, 
    amount: number, 
    depositIdHex: string
  ): Promise<{ txHex: string; txId: string }> {
    const bitcoinRpc = createBitcoinRpcClient();
    
    // Convert WIF private key to ECPair
    const keyPair = ECPair.fromPrivateKey(Buffer.from(BITCOIN_TEST_PRIVATE_KEY, 'hex'), { network: BITCOIN_NETWORK });
    const privateKeyHex = Buffer.from(keyPair.privateKey!).toString('hex');

    // Get sender's address
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: BITCOIN_NETWORK,
    });
    
    if (!address) {
      throw new Error('Failed to derive address from private key');
    }
    
    console.log(`Sending from address: ${address}`);
    
    // Get UTXOs for the sender's address
    const utxos = await bitcoinRpc.getUtxos(address, true);
    
    if (!utxos.length) {
      throw new Error(`No UTXOs found for address ${address}. Please fund this address first.`);
    }
    
    // Get fee rate
    const feeRateResponse = await bitcoinRpc.estimateSmartFee(2, 'conservative');
    const feeRate = Math.ceil(feeRateResponse.feerate * 100000000 / 1000); // Convert BTC/kB to sat/byte
    
    // Create and sign transaction with OP_RETURN data
    return createAndSignTransaction(
      privateKeyHex,
      utxos,
      toAddress,
      amount,
      feeRate,
      'testnet',
      {
        enableRBF: true,
        includeMemo: depositIdHex,
      }
    );
  }

  // Helper function to broadcast a transaction
  async function broadcastTransaction(txHex: string): Promise<string> {
    const bitcoinRpc = createBitcoinRpcClient();
    return bitcoinRpc.sendRawTransaction(txHex);
  }

  // Helper function to wait for transaction confirmation
  async function waitForConfirmation(txId: string, minConfirmations = 1, maxAttempts = 30): Promise<void> {
    const bitcoinRpc = createBitcoinRpcClient();
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tx = await bitcoinRpc.getRawTransaction(txId);
        console.log(`Transaction ${txId} has ${tx.confirmations || 0} confirmations`);
        
        if (tx.confirmations && tx.confirmations >= minConfirmations) {
          return;
        }
      } catch (error) {
        console.log(`Error checking transaction ${txId}: ${error}`);
      }
      
      console.log(`Waiting for confirmation... (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 30 * 1000)); // Wait 30 seconds between checks
    }
    
    throw new Error(`Transaction ${txId} did not reach ${minConfirmations} confirmations after ${maxAttempts} attempts`);
  }

  it('Complete Bitcoin VM flow from deposit to withdrawal', async () => {
    // 1. Get depository address
    console.log('1. Getting Bitcoin depository address...');
    const chainResponse = await axios.get(`${ORACLE_URL}/chains/v1`);
    console.log(chainResponse.data)
    depositoryAddress = chainResponse.data.chains.find((chain: any) => chain.id === 'bitcoin-testnet')?.depository;
    console.log(`Depository address: ${depositoryAddress}`);

    // depositId = '0xd1b12da776b2a915a05258c546420bf98b6f59a9d94f4dd9cbe5d9fd1e792f73';
    // depositTxId = 'beb6edd8c47b0751458e5a0dd9fe7e19414eee93d0e861acd84d7f66dba3bd75';

    if (!depositId) {
      // 2. Generate deposit ID
      depositId = '0x' + randomBytes(32).toString('hex');
    }
    console.log(`Deposit ID: ${depositId}`);
    
    // 3. Create and broadcast deposit transaction
    console.log(`3. Creating and broadcasting Bitcoin transaction to ${depositoryAddress} with OP_RETURN data: ${depositId}`);

    if (!depositTxId) {
      try {
        const depositAmount = 3000; // 0.00003 BTC in satoshis
        const depositTx = await createDepositTransaction(depositoryAddress, depositAmount, depositId.slice(2)); // Remove '0x' prefix
        depositTxId = depositTx.txId;
        console.log(`Created transaction with ID: ${depositTxId}`);
        await broadcastTransaction(depositTx.txHex);
        console.log(`Transaction broadcast successfully: ${depositTxId}`);
      } catch (error) {
        console.error('Failed to create or broadcast deposit transaction:', error);
        throw error;
      }
    }
    
    // 4. Wait for deposit transaction confirmation
    console.log('4. Waiting for deposit transaction confirmation...');
    await waitForConfirmation(depositTxId, 1);
    
    // 5. Check Oracle deposit detection
    console.log('5. Checking Oracle deposit detection...');
    let depositDetected = false;
    let maxAttempts = 10;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const depositsResponse = await axios.post(`${ORACLE_URL}/attestations/depository-deposits/v1`, {
        chainId: 'bitcoin-testnet',
        transactionId: depositTxId,
      });
      console.log(`Deposits response: ${JSON.stringify(depositsResponse.data)}`);
      
      if (depositsResponse.data.messages && depositsResponse.data.messages.length > 0) {
        const foundDeposit = depositsResponse.data.messages.find((message: any) => 
          message.result.depositId === depositId || message.data.transactionId === depositTxId
        );
        
        if (foundDeposit) {
          depositDetected = true;
          console.log(`Deposit detected: ${JSON.stringify(foundDeposit)}`);
          
          // Send the deposit message to the Hub
          await axios.post(`${HUB_URL}/actions/depository-deposits/v1`, {
            message: {
              data: foundDeposit.data,
              result: foundDeposit.result,
              signatures: [foundDeposit.signature],
            },
          });
          
          break;
        }
      }
      
      console.log(`Deposit not detected yet, waiting... (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 30 * 1000)); // Wait 30 seconds between checks
    }
    
    expect(depositDetected).toBe(true);
    
    // 6. Check Hub balance
    console.log('6. Checking Hub balance...');
    let balanceUpdated = false;
    maxAttempts = 10;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const balanceResponse = await axios.get(`${HUB_URL}/queries/balances/${OWNER_ADDRESS}/v1`, {
        params: { chainId: 'bitcoin-testnet' }
      });
      console.log(`Balances: ${JSON.stringify(balanceResponse.data.balances)}`);
      
      const bitcoinBalance = balanceResponse.data.balances.find((b: any) => 
        b.currencyChainId === 'bitcoin-testnet'
      );
      
      if (bitcoinBalance && Number(bitcoinBalance.availableAmount) > 0) {
        balanceUpdated = true;
        console.log(`Bitcoin balance found: ${bitcoinBalance.availableAmount}`);
        break;
      }
      
      console.log(`Balance not updated yet, waiting... (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 30 * 1000)); // Wait 30 seconds between checks
    }
    
    expect(balanceUpdated).toBe(true);
    
    // 7. Create withdrawal request
    console.log('7. Creating withdrawal request...');
    const withdrawalResponse = await axios.post(`${HUB_URL}/requests/withdrawals/v1`, {
      ownerChainId: 'bitcoin-testnet',
      owner: OWNER_ADDRESS,
      chainId: 'bitcoin-testnet',
      currency: CURRENCY,
      amount: '300', // 0.000001 BTC
      recipient: BITCOIN_RECIPIENT
    });
    
    withdrawalId = withdrawalResponse.data.id;
    console.log(`Withdrawal request created with ID: ${withdrawalId}`);
    
    // 8. Check withdrawal request details
    console.log('8. Checking withdrawal request details...');
    let withdrawalDetails;
    let signatureAvailable = false;
    const maxAttemptsForSignature = 10;

    for (let attempt = 0; attempt < maxAttemptsForSignature; attempt++) {
      const response = await axios.get(`${HUB_URL}/queries/withdrawal-requests/${OWNER_ADDRESS}/v1`);
      const withdrawalRequests = response.data.withdrawalRequests;
      
      // Find the specific withdrawal request by ID
      withdrawalDetails = withdrawalRequests.find((w: any) => w.id === withdrawalId);
      
      if (withdrawalDetails) {
        console.log(`Found withdrawal with ID: ${withdrawalId}`);
        console.log(withdrawalDetails);
        
        if (withdrawalDetails.signature) {
          console.log(`Signature: ${withdrawalDetails.signature.slice(0, 20)}...`);
          signatureAvailable = true;
          break;
        }
      }
      
      // Wait before trying again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    expect(signatureAvailable).toBe(true);
    
    if (!withdrawalDetails) {
      throw new Error("Failed to get withdrawal details with signature");
    }
    
    // 9. Manually broadcast transaction (simulating Solver's action)
    console.log('9. Manually broadcasting transaction (simulating Solver)...');
    
    // The signature field contains the signed transaction hex
    const signedTxHex = withdrawalDetails.signature;
    console.log(`Broadcasting signed transaction: ${signedTxHex.slice(0, 20)}...`);
    
    try {
      // Use our helper function to broadcast the transaction
      withdrawalTxId = await broadcastTransaction(signedTxHex.slice(2));
      console.log(`Transaction broadcast successful. TxId: ${withdrawalTxId}`);
    } catch (error) {
      console.error('Failed to broadcast transaction:', error);
      throw error;
    }
    
    // 12. Wait for transaction confirmation
    console.log('12. Waiting for transaction confirmation...');
    await waitForConfirmation(withdrawalTxId, 1);

    // 13. Get the status of the withdrawal from the oracle
    const depositoryWithdrawalMessage = await axios
      .post(`${ORACLE_URL}/attestations/depository-withdrawals/v1`, {
        chainId: 'bitcoin-testnet',
        withdrawal: withdrawalDetails.encodedData,
      })
      .then((response) => response.data.message);

    console.log(
      JSON.stringify({
        msg: "Got depository withdrawal attestation from oracle",
        depositoryWithdrawalMessage,
      })
    );

    // Return test results
    return {
      depositId,
      depositTxId,
      withdrawalId,
      withdrawalTxId,
      finalStatus: depositoryWithdrawalMessage.result.status,
    };
  });
});