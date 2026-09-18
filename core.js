/* Coin Lab core: hashing, wallets, transactions, blocks and consensus.
   Pure logic: no DOM, no Firebase. Every browser runs this same code, so every browser is a "node". */

export const COIN = { name: "VibeCoin", ticker: "VIBE", reward: 50, difficulty: 4, maxTx: 20 };

/* ============ SHA-256 (implemented from scratch) ============ */
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const H0 = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
export const enc = new TextEncoder();
const ror = (x, n) => (x >>> n) | (x << (32 - n));
export function sha256(str) {
  const bytes = enc.encode(str), l = bytes.length;
  const size = ((l + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(size); buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(size - 4, (l * 8) >>> 0); dv.setUint32(size - 8, Math.floor(l / 0x20000000));
  const h = H0.slice(), w = new Uint32Array(64);
  for (let i = 0; i < size; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15], b = w[t - 2];
      w[t] = w[t - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[t - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
export const unhex = s => new Uint8Array(s.match(/../g).map(b => parseInt(b, 16)));
export const short = s => s.length > 20 ? s.slice(0, 10) + "…" + s.slice(-6) : s;

/* ============ Wallets (ECDSA P-256 via Web Crypto) ============ */
const ALGO = { name: "ECDSA", namedCurve: "P-256" }, SIG = { name: "ECDSA", hash: "SHA-256" };
export const addressOf = pubHex => COIN.ticker + sha256(pubHex).slice(0, 40);
export const ADDR_RE = new RegExp("^" + COIN.ticker + "[0-9a-f]{40}$");

export async function generateWallet() {
  const keys = await crypto.subtle.generateKey(ALGO, true, ["sign", "verify"]);
  const pubHex = hex(await crypto.subtle.exportKey("raw", keys.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  return { jwk, pubHex, address: addressOf(pubHex), privateKey: keys.privateKey };
}
export const importPrivate = jwk => crypto.subtle.importKey("jwk", jwk, ALGO, false, ["sign"]);
export async function signMsg(privateKey, msg) { return hex(await crypto.subtle.sign(SIG, privateKey, enc.encode(msg))); }

const pubCache = new Map(), verifyCache = new Map();
export async function verifySig(pubHex, msg, sigHex) {
  const ck = pubHex + "|" + msg + "|" + sigHex;
  if (verifyCache.has(ck)) return verifyCache.get(ck);
  let ok = false;
  try {
    let key = pubCache.get(pubHex);
    if (!key) { key = await crypto.subtle.importKey("raw", unhex(pubHex), ALGO, false, ["verify"]); pubCache.set(pubHex, key); }
    ok = await crypto.subtle.verify(SIG, key, unhex(sigHex), enc.encode(msg));
  } catch { ok = false; }
  verifyCache.set(ck, ok); return ok;
}

/* ============ Transactions ============ */
export const txId = t => sha256(t.from + t.to + t.amount + t.timestamp);
export async function makeTx(privateKey, pubHex, to, amount, timestamp = Date.now()) {
  const t = { from: addressOf(pubHex), to, amount: Number(amount), timestamp, pubKey: pubHex };
  t.id = txId(t); t.signature = await signMsg(privateKey, t.id); return t;
}
export function coinbaseTx(to, timestamp = Date.now()) {
  const t = { from: "COINBASE", to, amount: COIN.reward, timestamp };
  t.id = txId(t); return t;
}

/* ============ Ledger state: balances are computed, never stored ============ */
export const newState = () => ({ bal: new Map(), seen: new Set() });
export const cloneState = s => ({ bal: new Map(s.bal), seen: new Set(s.seen) });
export const balanceOf = (s, a) => s.bal.get(a) || 0;
export function applyTx(s, t) {
  if (t.from !== "COINBASE") s.bal.set(t.from, balanceOf(s, t.from) - t.amount);
  s.bal.set(t.to, balanceOf(s, t.to) + t.amount);
  s.seen.add(t.id);
}

/* The network's rules for accepting a transaction. Returns an error string, or null if valid. */
export async function checkTx(t, s, extraSeen) {
  if (!t || t.from === "COINBASE") return "only miners can create new coins";
  if (!Number.isInteger(t.amount) || t.amount <= 0) return "amount must be a positive whole number";
  if (!ADDR_RE.test(t.to || "")) return "invalid receiver address";
  if (t.from === t.to) return "you can't send coins to yourself";
  if (txId(t) !== t.id) return "the ID doesn't match the contents, so it was edited after signing";
  if (addressOf(t.pubKey || "") !== t.from) return "that public key doesn't belong to the sender's address";
  if (!(await verifySig(t.pubKey, t.id, t.signature || ""))) return "invalid signature: not signed by the sender's private key";
  if (s.seen.has(t.id) || (extraSeen && extraSeen.has(t.id))) return "double-spend: this exact transaction was already used";
  if (balanceOf(s, t.from) < t.amount) return "not enough coins (balance too low)";
  return null;
}

/* ============ Blocks ============ */
/* Canonical text for the transactions. Firestore doesn't keep key order, so we never hash JSON. */
export const canonTxs = txs => txs.map(t => [t.id, t.from, t.to, t.amount, t.timestamp, t.pubKey || "", t.signature || ""].join("|")).join(";");
export const blockHash = b => sha256([b.index, b.prevHash, b.timestamp, canonTxs(b.txs), b.nonce, b.miner].join("#"));

export const GENESIS = (() => {
  const b = { index: 0, prevHash: "0".repeat(64), timestamp: 1758153600000, txs: [], nonce: 0, miner: "GENESIS" };
  b.hash = blockHash(b); return b;
})();

export async function validateBlock(b, parent, s) {
  if (!b || typeof b.hash !== "string") return "malformed";
  if (b.index !== parent.index + 1) return "wrong height";
  if (b.prevHash !== parent.hash) return "doesn't link to its parent";
  if (blockHash(b) !== b.hash) return "hash doesn't match contents";
  if (!b.hash.startsWith("0".repeat(COIN.difficulty))) return "no proof of work";
  if (!Array.isArray(b.txs) || b.txs.length < 1 || b.txs.length > COIN.maxTx + 1) return "bad transaction list";
  const cb = b.txs[0];
  if (cb.from !== "COINBASE" || cb.to !== b.miner || cb.amount !== COIN.reward || txId(cb) !== cb.id || !ADDR_RE.test(b.miner)) return "bad mining reward";
  if (s.seen.has(cb.id)) return "duplicate reward";
  applyTx(s, cb);
  for (let i = 1; i < b.txs.length; i++) {
    const err = await checkTx(b.txs[i], s);
    if (err) return "invalid transaction: " + err;
    applyTx(s, b.txs[i]);
  }
  return null;
}

/* Consensus: among all valid chains that grow from genesis, follow the longest one.
   Ties go to the block that appeared first. Invalid blocks are simply ignored by every node. */
export async function computeChain(allBlocks) {
  const byPrev = new Map();
  for (const b of allBlocks) {
    if (!b || typeof b.prevHash !== "string") continue;
    if (!byPrev.has(b.prevHash)) byPrev.set(b.prevHash, []);
    byPrev.get(b.prevHash).push(b);
  }
  for (const list of byPrev.values()) list.sort((a, b) => a.timestamp - b.timestamp || (a.hash < b.hash ? -1 : 1));
  let best = [GENESIS]; const valid = new Set([GENESIS.hash]);
  const better = (path) => {
    if (path.length !== best.length) return path.length > best.length;
    const a = path[path.length - 1], b = best[best.length - 1];
    return a.timestamp < b.timestamp || (a.timestamp === b.timestamp && a.hash < b.hash);
  };
  async function walk(path, state) {
    if (better(path)) best = path.slice();
    const kids = byPrev.get(path[path.length - 1].hash) || [];
    for (const k of kids) {
      const st = kids.length > 1 ? cloneState(state) : state;
      const err = await validateBlock(k, path[path.length - 1], st);
      if (!err) { valid.add(k.hash); path.push(k); await walk(path, st); path.pop(); }
    }
  }
  await walk([GENESIS], newState());
  const state = newState();
  for (const b of best.slice(1)) for (const t of b.txs) applyTx(state, t);
  const onChain = new Set(best.map(b => b.hash));
  const total = allBlocks.filter(b => b && b.hash).length;
  return { chain: best, state, forks: [...valid].filter(h => !onChain.has(h)).length, rejected: total - (valid.size - 1) };
}

/* Which mempool transactions can go into the next block? */
export async function pickTxs(mempool, state) {
  const s = cloneState(state), out = [];
  const sorted = [...mempool].sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : 1));
  for (const t of sorted) {
    if (out.length >= COIN.maxTx) break;
    if (s.seen.has(t.id)) continue;
    if ((await checkTx(t, s)) === null) { applyTx(s, t); out.push(t); }
  }
  return out;
}
export const pendingTxs = (mempool, state) => mempool.filter(t => !state.seen.has(t.id));

/* Quick, synchronous integrity check used by the tamper demo (hashes and links only). */
export function quickValidate(chain) {
  const bad = []; let first = -1;
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i], r = [];
    if (blockHash(b) !== b.hash) r.push("its contents no longer match its hash");
    if (i > 0 && b.prevHash !== blockHash(chain[i - 1])) r.push("the block before it was changed");
    for (const t of b.txs) if (txId(t) !== t.id) r.push("a transaction was altered");
    if (r.length && first < 0) first = i;
    if (!r.length && first >= 0) r.push("it's built on broken block #" + first);
    if (r.length) bad.push({ i, reasons: r });
  }
  return bad;
}

/* Mine a block synchronously (used by tests and for quick demos). */
export function mineSync(prev, txs, miner, timestamp = Date.now()) {
  const b = { index: prev.index + 1, prevHash: prev.hash, timestamp, txs, nonce: 0, miner };
  const target = "0".repeat(COIN.difficulty);
  for (;; b.nonce++) { b.hash = blockHash(b); if (b.hash.startsWith(target)) return b; }
}
