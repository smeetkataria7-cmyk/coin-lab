import { COIN, sha256, short, generateWallet, importPrivate, makeTx, coinbaseTx, checkTx, computeChain, pickTxs, pendingTxs,
  quickValidate, blockHash, txId, GENESIS, balanceOf, signMsg, newState, cloneState, applyTx } from "./core.js";
import { net, errText } from "./net.js";

/* ============ Helpers ============ */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const raf = f => requestAnimationFrame(f);
const time = ts => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const clean = t => ({ id: t.id, from: t.from, to: t.to, amount: t.amount, timestamp: t.timestamp, ...(t.pubKey ? { pubKey: t.pubKey, signature: t.signature } : {}) });
const USER_RE = /^[a-z0-9_]{3,16}$/;
const AVATARS = ["😎", "🫶", "😈", "🦄", "🐸", "👾", "🔥", "🤖", "🍕", "🧃", "👻", "🐙", "🦊", "🐼", "🚀", "🎧"];

function toast(msg, bad) {
  const d = document.createElement("div"); d.className = "toast" + (bad ? " bad" : ""); d.textContent = msg;
  $("toasts").appendChild(d); setTimeout(() => d.remove(), 3400);
}
function confetti() {
  const c = $("fx"), x = c.getContext("2d"); c.width = innerWidth; c.height = innerHeight;
  const cols = ["#c8ff3d", "#3df0ff", "#ff4fa3", "#8b5cff", "#ffffff"];
  const ps = Array.from({ length: 150 }, () => ({ x: innerWidth / 2, y: innerHeight * .42, vx: (Math.random() - .5) * 18,
    vy: -Math.random() * 15 - 4, r: 4 + Math.random() * 5, c: cols[Math.random() * cols.length | 0], rot: Math.random() * 6 }));
  let f = 0;
  (function step() {
    x.clearRect(0, 0, c.width, c.height);
    for (const p of ps) { p.vy += .38; p.x += p.vx; p.y += p.vy; p.rot += .2;
      x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.fillStyle = p.c; x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); x.restore(); }
    if (++f < 110) raf(step); else x.clearRect(0, 0, c.width, c.height);
  })();
}

/* ============ State ============ */
const G = { uid: null, profile: null, jwk: null, key: null, users: new Map(), byAddr: new Map(), blocks: [], mempool: [],
  chain: [GENESIS], state: newState(), forks: 0, rejected: 0, mining: false, to: null, lastTx: null,
  posted: new Map(), view: [GENESIS], tampered: false, busy: false, unsub: [] };

const me = () => G.profile?.address;
const label = a => a === "COINBASE" ? "Mining reward" : a === "GENESIS" ? "Genesis" : G.byAddr.get(a) ? "@" + G.byAddr.get(a).username : short(a);
const av = (p, cls = "") => p ? `<span class="av ${cls}" style="--h:${p.hue}">${p.avatar}</span>` : `<span class="av ${cls}" style="--h:200">🤖</span>`;
const avOf = a => av(G.byAddr.get(a));
const balance = a => balanceOf(G.state, a);
function stateWithMine() {   // confirmed state + my own unconfirmed payments (so I can't overspend while waiting)
  const s = cloneState(G.state);
  for (const t of pendingTxs(G.mempool, G.state)) if (t.from === me()) applyTx(s, t);
  return s;
}

/* ============ Auth ============ */
let mode = "signup";
function setMsg(t, ok) { $("authMsg").textContent = t || ""; $("authMsg").className = "msg " + (ok ? "ok" : "bad"); }
function setMode(m) {
  mode = m;
  $("mode").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
  $("fUser").hidden = m !== "signup"; $("aForgot").hidden = m !== "login";
  $("aSubmit").textContent = m === "signup" ? "Create account" : "Log in";
  $("aPass").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("authSub").textContent = m === "signup" ? "Create an account to get your own wallet and join the live network." : "Welcome back. Log in to your wallet.";
  setMsg("");
}
function showAuth(step) {
  $("auth").hidden = false;
  $("authMain").hidden = step !== "main"; $("profileForm").hidden = step !== "profile";
  if (step === "profile") $("authSub").textContent = "You're signed in. Let's set up your wallet.";
}
async function checkUsername(u) {
  if (!USER_RE.test(u)) return "Username must be 3-16 characters: lowercase letters, numbers or _";
  if (await net.usernameTaken(u)) return "That username is taken. Try another.";
  return null;
}
async function makeProfile(uid, username) {
  const w = await generateWallet();
  const profile = { username, address: w.address, pubKey: w.pubHex, avatar: AVATARS[Math.random() * AVATARS.length | 0],
                    hue: parseInt(w.address.slice(-4), 16) % 360 };
  await net.createProfile(uid, profile, w.jwk);
  return profile;
}
async function enterApp(uid) {
  const prof = await net.getProfile(uid);
  if (!prof) { G.uid = uid; showAuth("profile"); return; }
  const jwk = await net.getSecret(uid);
  if (!jwk) throw new Error("Couldn't load your wallet key.");
  G.uid = uid; G.profile = prof; G.jwk = jwk; G.key = await importPrivate(jwk);
  startWatching();
  $("auth").hidden = true; setMsg("");
  toast(`Welcome, @${prof.username} ${prof.avatar}`);
  render();
}
function startWatching() {
  stopWatching();
  G.unsub.push(net.watchBlocks(l => { G.blocks = l; recompute(); }));
  G.unsub.push(net.watchMempool(l => { G.mempool = l; renderLight(); }));
  G.unsub.push(net.watchUsers(l => {
    G.users = new Map(l.map(u => [u._id, u])); G.byAddr = new Map(l.map(u => [u.address, u])); renderLight();
  }));
}
function stopWatching() { G.unsub.forEach(u => u && u()); G.unsub = []; }
function leaveApp() {
  stopWatching(); G.mining = false;
  Object.assign(G, { uid: null, profile: null, jwk: null, key: null, users: new Map(), byAddr: new Map(), blocks: [], mempool: [],
    chain: [GENESIS], state: newState(), to: null, lastTx: null, posted: new Map(), view: [GENESIS], tampered: false });
  $("meChip").hidden = true; setMode("login"); showAuth("main");
}

function wireAuth() {
  $("mode").querySelectorAll("button").forEach(b => b.onclick = () => setMode(b.dataset.m));
  $("gBtn").onclick = async () => {
    if (!net.configured) return;
    try { await net.google(); } catch (e) { setMsg(errText(e)); }
  };
  $("authForm").onsubmit = async e => {
    e.preventDefault();
    if (!net.configured) return;
    const email = $("aEmail").value.trim(), pw = $("aPass").value;
    $("aSubmit").disabled = true; setMsg("");
    try {
      if (mode === "signup") {
        const u = $("aUser").value.trim().toLowerCase();
        const err = await checkUsername(u); if (err) throw { message: err };
        G.busy = true;
        const user = await net.signup(email, pw);
        try { await makeProfile(user.uid, u); }
        catch (e2) { G.busy = false; G.uid = user.uid; showAuth("profile"); setMsg("Account created, but the username step failed: " + errText(e2)); return; }
        G.busy = false;
        await enterApp(user.uid);
      } else {
        await net.login(email, pw);
      }
    } catch (e2) { G.busy = false; setMsg(errText(e2)); }
    finally { $("aSubmit").disabled = false; }
  };
  $("aForgot").onclick = async () => {
    const email = $("aEmail").value.trim();
    if (!email) return setMsg("Type your email above first.");
    try { await net.reset(email); setMsg("Password reset email sent. Check your inbox.", true); } catch (e) { setMsg(errText(e)); }
  };
  $("profileForm").onsubmit = async e => {
    e.preventDefault();
    $("pSubmit").disabled = true; setMsg("");
    try {
      const u = $("pUser").value.trim().toLowerCase();
      const err = await checkUsername(u); if (err) throw { message: err };
      await makeProfile(G.uid, u);
      await enterApp(G.uid);
    } catch (e2) { setMsg(errText(e2)); }
    finally { $("pSubmit").disabled = false; }
  };
  $("pLogout").onclick = () => net.logout();
  $("aUser").oninput = () => { $("aUser").value = $("aUser").value.toLowerCase().replace(/[^a-z0-9_]/g, ""); };
  $("pUser").oninput = () => { $("pUser").value = $("pUser").value.toLowerCase().replace(/[^a-z0-9_]/g, ""); };
}

/* ============ Consensus loop ============ */
let computing = false, dirty = false;
async function recompute() {
  if (computing) { dirty = true; return; }
  computing = true;
  try {
    do {
      dirty = false;
      const r = await computeChain(G.blocks);
      const grew = r.chain.length > G.chain.length || r.chain.at(-1).hash !== G.chain.at(-1).hash;
      G.chain = r.chain; G.state = r.state; G.forks = r.forks; G.rejected = r.rejected;
      if (!G.tampered) G.view = JSON.parse(JSON.stringify(G.chain));
      // did one of my blocks lose the race?
      for (const [h, idx] of G.posted) {
        if (G.chain.some(b => b.hash === h)) G.posted.delete(h);
        else if (G.chain.length - 1 >= idx + 2) { G.posted.delete(h); toast(`Your block #${idx} was orphaned. Someone else's chain won the race.`, true); }
      }
      if (grew) render(); else renderLight();
    } while (dirty);
  } finally { computing = false; }
}

/* ============ Mining ============ */
async function mine() {
  if (G.mining || !G.key) return;
  G.mining = true; setMineUI(true);
  const miner = me(), expected = 16 ** COIN.difficulty, target = "0".repeat(COIN.difficulty);
  let posted = false;
  outer: while (G.mining) {
    const tip = G.chain[G.chain.length - 1];
    const txs = [coinbaseTx(miner), ...(await pickTxs(G.mempool.map(clean), G.state))];
    const b = { index: tip.index + 1, prevHash: tip.hash, timestamp: Date.now(), txs, nonce: 0, miner };
    $("mineSub").textContent = `Mining block #${b.index} on top of ${short(tip.hash)} · ${txs.length - 1} payment${txs.length === 2 ? "" : "s"} included`;
    const t0 = performance.now(); let found = false;
    while (G.mining) {
      if (G.chain[G.chain.length - 1].hash !== tip.hash) {
        toast("Someone else found a block first. Restarting on top of theirs.", true); continue outer;
      }
      const fs = performance.now(); let n = 0;
      do {
        b.hash = blockHash(b); n++;
        if (b.hash.startsWith(target)) { found = true; break; }
        b.nonce++;
      } while ($("slow").checked ? n < 400 : performance.now() - fs < 12);
      const secs = Math.max((performance.now() - t0) / 1000, .001);
      $("mNonce").textContent = (b.nonce + (found ? 1 : 0)).toLocaleString();
      $("mHash").innerHTML = hashHtml(b.hash);
      $("mBar").style.width = Math.min(100, b.nonce / expected * 100) + "%";
      $("mRate").textContent = Math.round(b.nonce / secs).toLocaleString() + " guesses/sec · " + secs.toFixed(1) + "s · on average ~" + expected.toLocaleString() + " guesses needed";
      if (found) break;
      await new Promise(r => raf(r));
    }
    if (!found) break;
    try {
      await net.postBlock({ index: b.index, prevHash: b.prevHash, timestamp: b.timestamp, txs: b.txs.map(clean), nonce: b.nonce, miner, hash: b.hash });
      G.posted.set(b.hash, b.index); posted = true;
      $("mBar").style.width = "100%";
      $("mResult").innerHTML = `<div class="banner ok">🎉 Block #${b.index} found after ${(b.nonce + 1).toLocaleString()} guesses! ${COIN.reward} ${COIN.ticker} coming your way.</div>`;
      toast(`+${COIN.reward} ${COIN.ticker} for you 🤑`);
      try { confetti(); } catch { /* cosmetic only */ }
    } catch (e) {
      $("mResult").innerHTML = `<div class="banner bad">Found a block, but the network refused it: ${esc(errText(e))}</div>`;
    }
    break;
  }
  G.mining = false; setMineUI(false);
  if (!posted && !$("mResult").innerHTML) $("mResult").innerHTML = `<div class="banner bad">Stopped. No block, no reward.</div>`;
}
function setMineUI(on) {
  $("mineBtn").disabled = on; $("stopBtn").disabled = !on;
  $("mineBtn").textContent = on ? "⛏️ Mining…" : "⛏️ Start mining";
  $("mineBtn").classList.toggle("pulse", on);
  if (on) { $("mResult").innerHTML = ""; $("mBar").style.width = "0"; }
  else $("mineSub").textContent = "Reward goes to your wallet.";
}
function hashHtml(h) {
  const z = h.match(/^0*/)[0].length;
  return z ? `<span class="z">${h.slice(0, z)}</span>${h.slice(z)}` : h;
}

/* ============ Rendering ============ */
function renderStats() {
  $("sBlocks").textContent = G.chain.length;
  $("sUsers").textContent = G.users.size;
  $("sSupply").textContent = (G.chain.length - 1) * COIN.reward;
  $("sPending").textContent = pendingTxs(G.mempool, G.state).length;
  if (G.profile) {
    $("meChip").hidden = false;
    $("meChip").innerHTML = `${av(G.profile)}<div><b>@${esc(G.profile.username)}</b><small>${balance(me())} ${COIN.ticker}</small></div><button id="logoutBtn">Log out</button>`;
    $("logoutBtn").onclick = () => net.logout();
    $("myBal").innerHTML = `${balance(me())} <small>${COIN.ticker}</small>`;
  }
}
function renderWallet() {
  const p = G.profile; if (!p) return;
  $("wDetail").innerHTML = `<div class="row" style="margin:0">${av(p, "lg")}<div><b style="font-size:18px">@${esc(p.username)}</b><div class="hint" style="margin:0">tap the blurred key to reveal it</div></div></div>
    <span class="lbl">Private key (never share!)</span><div class="hash secret" id="kPriv">${esc(G.jwk.d)}</div>
    <span class="lbl">Public key</span><div class="hash" style="font-size:11px">${p.pubKey}</div>
    <span class="lbl">Address</span><div class="hash">${p.address}</div>`;
  $("kPriv").onclick = e => e.currentTarget.classList.toggle("show");
}
function renderBoard() {
  const rows = [...G.users.values()].map(u => ({ u, b: balance(u.address) })).sort((a, c) => c.b - a.b || a.u.createdAt - c.u.createdAt);
  const shown = rows.slice(0, 10), mine = rows.findIndex(r => r.u.address === me());
  const line = (r, i) => `<div class="lb ${r.u.address === me() ? "you" : ""}"><span class="rank">${i + 1}</span>${av(r.u)}
    <div class="n"><b>@${esc(r.u.username)}${r.u.address === me() ? " (you)" : ""}</b><span>${short(r.u.address)}</span></div>
    <div class="amt">${r.b}<small>${COIN.ticker}</small></div></div>`;
  $("bal2").innerHTML = shown.map(line).join("") + (mine >= 10 ? line(rows[mine], mine) : "") || `<div class="empty">No users yet.</div>`;
}
function renderRecent() {
  const last = G.chain.slice(-6).reverse();
  $("recent").innerHTML = last.map(b => b.index === 0
    ? `<div>#0 · genesis block</div>`
    : `<div><b>#${b.index}</b> · mined by <span class="who">${esc(label(b.miner))}</span> · ${b.txs.length - 1} payment${b.txs.length === 2 ? "" : "s"}<br><code>${short(b.hash)}</code> · ${time(b.timestamp)}</div>`).join("");
}
function renderPeople() {
  const q = $("toSearch").value.trim().toLowerCase();
  const list = [...G.users.values()].filter(u => u.address !== me() && u.username.includes(q)).slice(0, 30);
  $("toChips").innerHTML = list.map(u => `<button class="chip ${G.to === u.address ? "on" : ""}" data-a="${u.address}">${av(u)}<span><b>@${esc(u.username)}</b><small>${balance(u.address)} ${COIN.ticker}</small></span></button>`).join("")
    || `<div class="empty">${G.users.size <= 1 ? "You're the only one here so far. Share the link with your class!" : "No matches."}</div>`;
  $("toChips").querySelectorAll(".chip").forEach(c => c.onclick = () => { G.to = c.dataset.a; renderPeople(); });
}
function renderPool() {
  const p = pendingTxs(G.mempool, G.state).sort((a, b) => b.timestamp - a.timestamp);
  $("pool").innerHTML = p.map(t => `<div><span class="who">${esc(label(t.from))}</span> → <span class="who">${esc(label(t.to))}</span>: <b>${t.amount} ${COIN.ticker}</b><br><code>${short(t.id)}</code></div>`).join("")
    || `<div class="empty">Nothing waiting. Send some coins first.</div>`;
}
function renderFeed() {
  const items = [];
  for (let i = G.chain.length - 1; i > 0 && items.length < 12; i--)
    for (const t of G.chain[i].txs.slice(1)) items.push({ t, i });
  $("feed").innerHTML = items.slice(0, 12).map(({ t, i }) => `<div><span class="who">${esc(label(t.from))}</span> → <span class="who">${esc(label(t.to))}</span>: <b>${t.amount} ${COIN.ticker}</b> · block #${i}</div>`).join("")
    || `<div class="empty">No payments yet. Be the first!</div>`;
}
function renderChain() {
  const view = G.view, bad = quickValidate(view), badMap = new Map(bad.map(x => [x.i, x.reasons]));
  $("chainStatus").className = "status " + (bad.length ? "bad" : "ok");
  $("chainStatus").innerHTML = bad.length
    ? `🚨 Chain invalid. Your node rejects ${bad.length} block${bad.length > 1 ? "s" : ""}. To fix it you'd have to re-mine every one of them before anyone notices.`
    : `✅ Chain valid · ${view.length} block${view.length > 1 ? "s" : ""} · every hash and link checks out. Try editing an amount below.`;
  $("forkNote").textContent = `${G.forks} block${G.forks === 1 ? "" : "s"} lost a race (orphaned) · ${G.rejected} invalid block${G.rejected === 1 ? "" : "s"} ignored`;
  const start = Math.max(0, view.length - 10);
  $("chain").innerHTML = view.slice(start).map((b, k) => {
    const bi = start + k, rc = blockHash(b), broken = badMap.has(bi);
    return (k ? `<div class="link">${broken ? "💔" : "🔗"}</div>` : "") + `
    <div class="blk ${broken ? "broken" : ""}">
      <div class="head"><b>Block #${b.index}</b><span class="pill">${b.index ? "nonce " + b.nonce.toLocaleString() : "genesis"}</span></div>
      ${b.index ? `<div class="k">mined by</div><div class="who">${esc(label(b.miner))}</div>` : ""}
      <div class="k">prev hash</div><div class="mono">${short(b.prevHash)}</div>
      <div class="k">saved hash</div><div class="mono">${short(b.hash)}</div>
      <div class="k">recalculated hash</div><div class="mono ${rc === b.hash ? "ok" : "bad"}">${short(rc)}</div>
      <div class="k">transactions</div>
      ${b.txs.map((t, ti) => `<div class="tx"><span>${esc(label(t.from))} → ${esc(label(t.to))}</span>
        <input type="number" value="${t.amount}" data-b="${bi}" data-t="${ti}"></div>`).join("") || '<div class="empty">none</div>'}
      ${broken ? `<div class="why">❌ ${badMap.get(bi)[0]}</div>` : ""}
    </div>`;
  }).join("");
  $("chain").querySelectorAll("input").forEach(inp => inp.oninput = () => {
    G.tampered = true; G.view[inp.dataset.b].txs[inp.dataset.t].amount = Number(inp.value);
    renderChain();
    const again = $("chain").querySelector(`input[data-b="${inp.dataset.b}"][data-t="${inp.dataset.t}"]`);
    if (again) again.focus();
  });
}
function renderLight() { renderStats(); renderBoard(); renderRecent(); renderPeople(); renderPool(); renderFeed(); }
function render() { renderLight(); renderWallet(); renderChain(); }

/* ============ Mint tab ============ */
function updateHash() {
  const a = $("hA").value, b = $("hB").value, h1 = sha256(a), h2 = sha256(b);
  $("hOutA").textContent = h1;
  $("hOutB").innerHTML = [...h2].map((c, i) => c === h1[i] ? c : `<span class="d">${c}</span>`).join("");
  let bits = 0;
  for (let i = 0; i < 64; i++) { let x = parseInt(h1[i], 16) ^ parseInt(h2[i], 16); while (x) { bits += x & 1; x >>= 1; } }
  $("hBar").style.width = bits / 256 * 100 + "%";
  $("hBits").textContent = a === b ? "Same message, same fingerprint. Now change a letter in B."
    : `${bits} of 256 bits flipped (~128 is typical). Tiny change, totally different fingerprint.`;
}
function mintId() {
  const others = [...G.users.values()].filter(u => u.address !== me());
  const to = others.length ? others[Math.random() * others.length | 0] : G.profile;
  const t = { from: me(), to: to.address, amount: 1 + Math.floor(Math.random() * 50), timestamp: Date.now() };
  const d = document.createElement("div");
  d.innerHTML = `@${esc(G.profile.username)} → @${esc(to.username)} · ${t.amount} ${COIN.ticker} · ${t.timestamp}<br><code>${txId(t)}</code>`;
  $("idLog").prepend(d); while ($("idLog").children.length > 6) $("idLog").lastChild.remove();
}

/* ============ Send tab ============ */
async function sendFlow() {
  if (!G.to) return toast("Pick who you're paying first", true);
  const amt = Math.floor(Number($("tAmt").value));
  if (!(amt > 0)) return toast("Enter an amount above 0", true);
  $("sendBtn").disabled = true;
  try {
    const t = await makeTx(G.key, G.profile.pubKey, G.to, amt);
    let err = await checkTx(t, stateWithMine());
    if (!err) { try { await net.postTx(clean(t)); G.lastTx = t; } catch (e) { err = errText(e); } }
    $("tInfo").innerHTML = `<div class="steps">
      <div class="step" style="--d:0s"><i>1</i><div><b>Make the ID</b><small>SHA256(from + to + amount + time)</small><code>${t.id}</code></div></div>
      <div class="step" style="--d:.45s"><i>2</i><div><b>Sign with your private key</b><small>Only you can produce this</small><code>${short(t.signature)}</code></div></div>
      <div class="step ${err ? "bad" : "ok"}" style="--d:.9s"><i>${err ? "✗" : "✓"}</i><div><b>${err ? "Network rejected it" : "Broadcast to the network"}</b>
        <small>${err ? esc(err) : "Every node checked the signature. Now waiting for a miner to confirm it."}</small></div></div></div>`;
    if (err) toast("Rejected: " + err, true); else toast(`${amt} ${COIN.ticker} sent to ${label(G.to)} 💸`);
  } finally { $("sendBtn").disabled = false; }
  renderLight();
}
const atkLogs = [];
async function attack(name, build) {
  if (!G.to) return toast("Pick a receiver first", true);
  const t = await build();
  if (!t) return toast("Send a payment first, then replay it", true);
  const err = await checkTx(t, stateWithMine());
  atkLogs.unshift(`<div><b>${name}</b><br>${err ? `<span class="ok">🛡️ Blocked:</span> ${esc(err)}` : `<span class="bad">⚠️ got through?!</span>`}</div>`);
  $("atkLog").innerHTML = atkLogs.slice(0, 8).join("");
}
const ATTACKS = {
  atkForge: ["Forged signature", async () => { const thief = await generateWallet(); const t = await makeTx(G.key, G.profile.pubKey, G.to, 1); t.signature = await signMsg(thief.privateKey, t.id); return t; }],
  atkTamper: ["Edited after signing", async () => { const t = await makeTx(G.key, G.profile.pubKey, G.to, 1); t.amount = 1000; return t; }],
  atkOver: ["Overspend", () => makeTx(G.key, G.profile.pubKey, G.to, balance(me()) + 1000)],
  atkDouble: ["Double-spend", async () => {
    const chainTx = G.chain.flatMap(b => b.txs).reverse().find(t => t.from === me());
    const last = G.lastTx || chainTx; return last ? { ...last } : null; }]
};

/* ============ Wiring ============ */
const TABS = ["t1", "t2", "t3", "t4"];
function go(tab, focus) {
  document.querySelectorAll(".tab").forEach(b => {
    const on = b.dataset.tab === tab; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  document.querySelectorAll("section").forEach(s => s.classList.toggle("on", s.id === tab));
  if (tab === "t4") renderChain();
  scrollTo({ top: 0 });
}
function wire() {
  document.querySelectorAll(".tab").forEach(b => {
    b.onclick = () => go(b.dataset.tab);
    b.onkeydown = e => {
      const i = TABS.indexOf(b.dataset.tab);
      if (e.key === "ArrowRight") go(TABS[(i + 1) % 4], true);
      if (e.key === "ArrowLeft") go(TABS[(i + 3) % 4], true);
    };
  });
  $("hA").oninput = $("hB").oninput = updateHash;
  $("genId").onclick = () => G.profile && mintId();
  $("mineBtn").onclick = mine;
  $("stopBtn").onclick = () => { G.mining = false; };
  $("sendBtn").onclick = sendFlow;
  $("toSearch").oninput = renderPeople;
  $("quick").innerHTML = [5, 10, 25].map(n => `<button class="btn ghost" style="margin:0;padding:6px 14px" data-n="${n}">${n}</button>`).join("")
    + `<button class="btn ghost" style="margin:0;padding:6px 14px" data-n="max">Max</button>`;
  $("quick").querySelectorAll("button").forEach(b => b.onclick = () => {
    $("tAmt").value = b.dataset.n === "max" ? Math.max(0, balanceOf(stateWithMine(), me())) : b.dataset.n; });
  for (const id in ATTACKS) $(id).onclick = () => attack(...ATTACKS[id]);
  $("goMine").onclick = () => go("t2");
  $("repair").onclick = () => { G.tampered = false; G.view = JSON.parse(JSON.stringify(G.chain)); renderChain(); toast("History restored"); };
}

(function boot() {
  document.title = COIN.name + " Lab";
  document.querySelectorAll(".coinName").forEach(e => e.textContent = COIN.name);
  document.querySelectorAll(".tk").forEach(e => e.textContent = COIN.ticker);
  $("zeroTxt").textContent = "0".repeat(COIN.difficulty);
  $("genesis").innerHTML = `index: 0<br>prevHash: ${GENESIS.prevHash}<br>time: ${GENESIS.timestamp}<br>hash: <span class="z">${GENESIS.hash}</span>`;
  wire(); wireAuth(); updateHash(); setMode("signup"); render();
  if (!net.configured) { $("setupWarn").hidden = false; return; }
  net.onAuth(async user => {
    if (G.busy) return;
    if (!user) { leaveApp(); return; }
    try { await enterApp(user.uid); } catch (e) { showAuth("main"); setMsg(errText(e)); }
  });
})();

window.CoinLab = { G, render, sendFlow, mine, ATTACKS, attack };
