import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import { bitcoin as bitcoinSdk } from '@reservoir0x/relay-protocol-sdk';

// Initialize ECPair factory with the secp256k1 library
const ECPair = ECPairFactory(ecc);

// Initialize library with required ECC functions
bitcoin.initEccLib(ecc);

// Constants for Bitcoin transaction handling
const MIN_UTXO_VALUE = 546; // Dust threshold in satoshis
const RBF_SEQUENCE = 0xfffffffd; // Enable Replace-By-Fee

/**
 * Creates and signs a Bitcoin transaction
 * @param privateKey - Private key in hex format (without '0x' prefix)
 * @param utxos - List of UTXOs to use as inputs
 * @param recipientAddress - Recipient Bitcoin address
 * @param amount - Amount to send in satoshis
 * @param feeRate - Fee rate in satoshis per byte
 * @param network - Bitcoin network ('bitcoin' for mainnet, 'testnet' for testnet)
 * @param options - Additional options for transaction creation
 * @returns Object containing the transaction hex and transaction ID
 */
export async function createAndSignTransaction(
  privateKey: string,
  utxos: bitcoinSdk.UtxoItem[],
  recipientAddress: string,
  amount: number,
  feeRate: number,
  network: 'bitcoin' | 'testnet',
  options?: {
    enableRBF?: boolean,
    includeMemo?: string
  }
): Promise<{ txHex: string; txId: string }> {
  // Set the network
  const bitcoinNetwork = network === 'bitcoin' 
    ? bitcoin.networks.bitcoin 
    : bitcoin.networks.testnet;

  // Create key pair from private key
  const privateKeyBuffer = Buffer.from(privateKey, 'hex');
  let keyPair = ECPair.fromPrivateKey(privateKeyBuffer);
  
  // Get sender's address from public key
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: bitcoinNetwork,
  });

  if (!address) {
    throw new Error('Failed to derive address from private key');
  }

  // Sort UTXOs by amount (largest first) for input selection
  const sortedUtxos = [...utxos].sort((a, b) => {
    const valueA = BigInt(a.value);
    const valueB = BigInt(b.value);
    return valueB > valueA ? 1 : valueB < valueA ? -1 : 0;
  });
  
  // Track input amounts and selected UTXOs
  let inputAmount = BigInt(0);
  const selectedUtxos: bitcoinSdk.UtxoItem[] = [];
  
  // Convert amount to BigInt
  const amountBigInt = BigInt(amount);
  
  // Select UTXOs until we have enough to cover amount + estimated fee
  // Start with a basic fee estimate that will be refined
  let estimatedFee = BigInt(1000); // Start with 1000 satoshis as base fee
  
  // Calculate number of expected outputs (recipient + change + optional memo)
  const outputCount = options?.includeMemo ? 3 : 2;
  
  for (const utxo of sortedUtxos) {
    // Skip UTXOs that might be dust or correspond to inscriptions
    if (BigInt(utxo.value) < BigInt(MIN_UTXO_VALUE)) {
      continue;
    }
    
    selectedUtxos.push(utxo);
    inputAmount += BigInt(utxo.value);
    
    // Recalculate estimated fee based on current tx size
    // Assuming ~180 bytes per input, ~34 bytes per output, and ~10 bytes fixed overhead
    const estimatedSize = (selectedUtxos.length * 180) + (outputCount * 34) + 10;
    estimatedFee = BigInt(Math.ceil(estimatedSize * feeRate));
    
    // Check if we have enough funds
    if (inputAmount >= amountBigInt + estimatedFee) {
      break;
    }
  }
  
  // Check if we have enough funds
  if (inputAmount < amountBigInt + estimatedFee) {
    throw new Error('Insufficient funds to cover amount and fee');
  }
  
  // Calculate change amount
  const changeAmount = inputAmount - amountBigInt - estimatedFee;
  
  // Create a new transaction using the Psbt API (Partially Signed Bitcoin Transaction)
  const psbt = new bitcoin.Psbt({ network: bitcoinNetwork });
  
  // Add inputs
  for (const utxo of selectedUtxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      // Enable RBF if requested
      sequence: options?.enableRBF ? RBF_SEQUENCE : undefined,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(address, bitcoinNetwork),
        value: Number(BigInt(utxo.value)),
      },
    });
  }
  
  // Add recipient output
  psbt.addOutput({
    address: recipientAddress,
    value: Number(amountBigInt),
  });
  
  // Add change output if there's enough change to be worth it
  // (if change is less than dust limit, just include it in the fee)
  if (changeAmount >= BigInt(MIN_UTXO_VALUE)) {
    psbt.addOutput({
      address: address,
      value: Number(changeAmount),
    });
  }
  
  // Add OP_RETURN output if memo is provided
  if (options?.includeMemo) {
    const embed = bitcoin.payments.embed({ 
      data: [Buffer.from(options.includeMemo, 'utf8')] 
    });
    
    psbt.addOutput({
      script: embed.output!,
      value: 0, // OP_RETURN outputs have zero value
    });
  }
  
  // Sign all inputs
  selectedUtxos.forEach((_, index) => {
    psbt.signInput(index, {
      publicKey: Buffer.from(keyPair.publicKey),
      sign: (hash: Buffer) => {
        return Buffer.from(keyPair.sign(hash));
      }
    });
  });
  
  // Finalize the transaction
  psbt.finalizeAllInputs();
  
  // Extract the transaction
  const tx = psbt.extractTransaction();
  const txHex = tx.toHex();
  const txId = tx.getId();
  
  return { txHex, txId };
}