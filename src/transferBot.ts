import { AddressLookupTableAccount, Connection, PublicKey, Transaction, Keypair, VersionedTransaction, TransactionMessage, TransactionInstruction, sendAndConfirmTransaction, sendAndConfirmRawTransaction, SystemProgram  } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction } from '@solana/spl-token';
import fetch from 'cross-fetch'

const RPC_URL = "https://api.mainnet-beta.solana.com"
const WALLET_PAYER = [/* --- */]

// https://spl.solana.com/associated-token-account#finding-the-associated-token-account-address
async function findAssociatedTokenAddress(
    walletAddress: PublicKey,
    tokenMintAddress: PublicKey
  ): Promise<PublicKey> {
    return (await PublicKey.findProgramAddress(
        [
            walletAddress.toBuffer(),
            TOKEN_PROGRAM_ID.toBuffer(),
            tokenMintAddress.toBuffer(),
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
    ))[0];
}

async function transferLamport(connection: Connection, feePayer: Keypair, destination: PublicKey, amount: number, epoch: string): Promise<string>{

  // https://solanacookbook.com/references/basic-transactions.html#how-to-send-sol
  const transferTransaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: feePayer.publicKey,
      toPubkey: destination,
      lamports: amount,
    })
  );

  // https://solanacookbook.com/references/basic-transactions.html#how-to-add-a-memo-to-a-transaction
  await transferTransaction.add(
    new TransactionInstruction({
      keys: [{ pubkey: feePayer.publicKey, isSigner: true, isWritable: true }],
      data: Buffer.from(`luckyStake.xyz:{epoch: ${epoch}, luckyStaker: ${destination.toString()}, amount: ${amount / 10**9}}`, "utf-8"),
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    })
  );

  const txid = await sendAndConfirmTransaction(connection, transferTransaction, [
    feePayer,
  ]);

  return txid
}

async function swapNburn(connection: Connection, feePayer: Keypair, amount: number | bigint, epoch: string): Promise<string>{
  const  {data}  = await (
    await fetch(`https://quote-api.jup.ag/v4/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263&amount=${amount.toString()}&slippageBps=50`)
  ).json()
  const routes = data

  const transactions = await (
    await fetch('https://quote-api.jup.ag/v4/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        route: routes[0],
        userPublicKey: feePayer.publicKey.toString(),  
      })
    })
  ).json()
  
  const { swapTransaction } = transactions

  // https://docs.jup.ag/integrating-jupiter/composing-with-versioned-transactions
  // deserialize the transaction
  const swapTransactionFromJupiterAPI = swapTransaction
  const swapTransactionBuf = Buffer.from(swapTransactionFromJupiterAPI, 'base64')
  var transaction = VersionedTransaction.deserialize(swapTransactionBuf)

  // construct the burn instruction
  const mintPubkey = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263')
  const tokenAccountPubkey = await findAssociatedTokenAddress(feePayer.publicKey, mintPubkey)

  // https://solanacookbook.com/references/token.html#how-to-burn-tokens
  const burnInstruction = createBurnCheckedInstruction(
    tokenAccountPubkey, // token account
    mintPubkey, // mint
    feePayer.publicKey, // owner of token account
    amount, // amount, if your deciamls is 8, 10^8 for 1 token
    5 // decimals
  )

  const transferInstruction = new TransactionInstruction({
    keys: [{ pubkey: feePayer.publicKey, isSigner: true, isWritable: true }],
    data: Buffer.from(`luckyStake.xyz:{epoch: ${epoch}, luckyStaker: Burn $BONK, amount: ${Number(amount) / 10**9}}`, "utf-8"),
    programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
  })

  // get address lookup table accounts
  const addressLookupTableAccounts = await Promise.all(
    transaction.message.addressTableLookups.map(async (lookup) => {
      return new AddressLookupTableAccount({
        key: lookup.accountKey,
        state: AddressLookupTableAccount.deserialize(await connection.getAccountInfo(lookup.accountKey).then((res) => res.data)),
      })
    }))

  // decompile transaction message and add transfer instruction
  var message = TransactionMessage.decompile(transaction.message,{addressLookupTableAccounts: addressLookupTableAccounts})
  message.instructions.push(burnInstruction)
  message.instructions.push(transferInstruction)

  // compile the message and update the transaction
  transaction.message = message.compileToV0Message(addressLookupTableAccounts)

  // sign the transaction
  transaction.sign([feePayer])

  // Execute the transaction
  const rawTransaction = transaction.serialize()
  const txid = await sendAndConfirmRawTransaction(connection, Buffer.from(rawTransaction), {
    skipPreflight: true,
    commitment: 'confirmed',
    maxRetries: 2
  })
  return txid
}

(async () => { 
        
  //ts-node ./src/transferBot.ts --type <BURN|TRANSFER> --destination <SOLANA_ADDRESS> --amount <AMOUNT_IN_SOL> --epoch <EPOCH>
  var argv = require('minimist')(process.argv.slice(2));

  const feePayer = Keypair.fromSecretKey(Uint8Array.from(WALLET_PAYER));
  const amount = Number(argv.amount * 10**9) // amount in lamports
  var txid = 'pending'

  const connection = new Connection(
        RPC_URL,
        "confirmed"
        );

  if (argv.type == 'transfer'){
    const destination = new PublicKey(argv.destination);
    txid = await transferLamport(connection, feePayer, destination, amount, argv.epoch)
  }
  else if (argv.type = 'burn'){
    txid = await swapNburn(connection, feePayer, amount, argv.epoch)
  }

  console.log(txid)

})();