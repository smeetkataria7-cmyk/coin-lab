# Coin Lab

A from-scratch mini cryptocurrency for a guest lecture on development and fintech. Real accounts, a shared live blockchain, proof-of-work mining and signed peer-to-peer payments. Runs on GitHub Pages plus a free Firebase project.

## How it works

| Piece | What it does |
|---|---|
| `core.js` | SHA-256 (written from scratch), ECDSA wallets, transactions, blocks and the consensus rules. Every browser runs this, so every browser is a full node. |
| `net.js` | Firebase Auth (Google + email/password) and Firestore. |
| `app.js` / `index.html` | The UI: Mint, Mine, Send, Ledger. |
| `firestore.rules` | Append-only blocks, you can only spend from your own address, private keys readable only by their owner. |

Consensus: every browser downloads all blocks, re-verifies hashes, proof of work, signatures and balances, and follows the longest valid chain. Invalid blocks are ignored by everyone.

## One-time Firebase setup

1. Create a project at https://console.firebase.google.com (Analytics off).
2. Authentication -> Sign-in method: enable Google and Email/Password.
3. Authentication -> Settings -> Authorized domains: add your GitHub Pages domain.
4. Firestore Database -> Create database (production mode).
5. Firestore -> Rules: paste the contents of `firestore.rules` and Publish.
6. Project settings -> Your apps -> Web app: copy the config into `firebase-config.js`.

Open the site through GitHub Pages or a local server (`npx http-server`). Opening `index.html` straight from disk won't work because it uses ES modules.

## Settings

Coin name, ticker, reward and difficulty live in `COIN` at the top of `core.js`.
If you change the ticker, also update the `^VIBE` pattern in `firestore.rules`.

## Limits worth telling the class

- Wallet keys are stored in your private Firestore document so you can log in from any device. Real wallets keep the key only on your device.
- With no server of our own, a cheater can add junk to the database, but every honest browser rejects it.
