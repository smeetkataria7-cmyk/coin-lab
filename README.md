# Coin blockchain: how a new person joins

A small live blockchain that shows the journey of joining an existing one:

1. Find the blockchain (entry point + genesis block)
2. Get a wallet (key pair + address)
3. Download the chain
4. Check every block yourself
5. Take part (receive, send, mine)

Runs on GitHub Pages plus a free Firebase project (login + shared database).

| File | What it does |
|---|---|
| `core.js` | SHA-256 (from scratch), wallets, transactions, blocks, consensus rules |
| `net.js` | Firebase Auth (Google + email/password) and Firestore |
| `app.js`, `index.html` | The three-tab UI: The network, Join, Take part |
| `firestore.rules` | Anyone can read the chain and member list; only members can add blocks and payments; private keys readable only by their owner |

## Firebase setup (one time)

1. Create a project at https://console.firebase.google.com
2. Authentication: enable Google and Email/Password, and add your GitHub Pages domain under Authorized domains.
3. Firestore: create a database, then paste `firestore.rules` into the Rules tab and Publish.
4. Put your web-app config into `firebase-config.js`.

Open through GitHub Pages or `npx http-server`. Opening `index.html` straight from disk won't work (ES modules).

## Settings

Coin name, ticker, reward and difficulty are in `COIN` at the top of `core.js`. If you change the ticker, update the `^VIBE` pattern in `firestore.rules` too.

## Honest limits

- Wallet keys are stored in your private Firestore document so you can log in anywhere. Real wallets keep the key only on your device.
- Firebase is the one centralized part: it only carries messages. All checking happens in each browser.
