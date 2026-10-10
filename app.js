import { COIN, short, generateWallet, importPrivate, makeTx, coinbaseTx, checkTx, computeChain, pickTxs, pendingTxs,
  blockHash, GENESIS, balanceOf, newState, cloneState, applyTx, validateBlock } from "./core.js?v=3";
import { net, errText } from "./net.js?v=3";

/* ============ Helpers ============ */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const raf = f => requestAnimationFrame(f);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = t => ({ id: t.id, from: t.from, to: t.to, amount: t.amount, timestamp: t.timestamp, ...(t.pubKey ? { pubKey: t.pubKey, signature: t.signature } : {}) });
const USER_RE = /^[a-z0-9_]{3,16}$/;
const AVATARS = ["ðŸ˜Ž", "ðŸ«¶", "ðŸ˜ˆ", "ðŸ¦„", "ðŸ¸", "ðŸ‘¾", "ðŸ”¥", "ðŸ¤–", "ðŸ•", "ðŸ§ƒ", "ðŸ‘»", "ðŸ™", "ðŸ¦Š", "ðŸ¼", "ðŸš€", "ðŸŽ§"];

function toast(msg, bad) {
  const d = document.createElement("div"); d.className = "toast" + (bad ? " bad" : ""); d.textContent = msg;
  $("toasts").appendChild(d); setTimeout(() => d.remove(), 3600);
}
function confetti() { try { confettiRun(); } catch { /* cosmetic only */ } }
function confettiRun() {
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
const G = { uid: null, profile: null, jwk: null, key: null, users: new Map(), byAddr: new Map(), usersLoaded: false,
  blocks: [], mempool: [], chain: [GENESIS], state: newState(), chainLoaded: false, freshTip: null,
  mining: false, to: null, verifying: false, dl: false, verified: false, readErr: false, busy: false, unsub: [] };

const me = () => G.profile?.address;
const joined = () => !!G.profile;
const label = a => a === "COINBASE" ? "Mining reward" : a === "GENESIS" ? "Genesis" : G.byAddr.get(a) ? "@" + G.byAddr.get(a).username : short(a);
const av = (p, cls = "") => p ? `<span class="av ${cls}" style="--h:${p.hue}">${p.avatar}</span>` : `<span class="av ${cls}" style="--h:200">ðŸ¤–</span>`;
const balance = a => balanceOf(G.state, a);
const members = () => [...G.users.values()].sort((a, b) => a.createdAt - b.createdAt);
function stateWithMine() {   // confirmed state + my own unconfirmed payments, so I can't overspend while waiting
  const s = cloneState(G.state);
  for (const t of pendingTxs(G.mempool, G.state)) if (t.from === me()) applyTx(s, t);
  return s;
}

/* ============ Network (read the chain: public) ============ */
function onErr() { G.readErr = true; renderLight(); }
function onUsers(l) {
  const next = new Map(l.map(u => [u._id, u]));
  if (G.usersLoaded) for (const [id, u] of next) if (!G.users.has(id) && id !== G.uid) toast(`@${u.username} just joined the network ðŸŽ‰`);
  G.users = next; G.byAddr = new Map(l.map(u => [u.address, u])); G.usersLoaded = true; G.freshUser = null;
  renderLight();
}
function stopWatching() { G.unsub.forEach(u => u && u()); G.unsub = []; }
function startWatching(withMempool) {
  stopWatching(); G.readErr = false;
  G.unsub.push(net.watchBlocks(l => { G.blocks = l; recompute(); }, onErr));
  G.unsub.push(net.watchUsers(onUsers, onErr));
  if (withMempool) G.unsub.push(net.watchMempool(l => { G.mempool = l; renderLight(); }, () => {}));
}

let computing = false, dirty = false;
async function recompute() {
  if (computing) { dirty = true; return; }
  computing = true;
  try {
    do {
      dirty = false;
      const r = await computeChain(G.blocks), prev = G.chain.at(-1), tip = r.chain.at(-1);
      const grew = tip.hash !== prev.hash;
      G.chain = r.chain; G.state = r.state;
      if (grew && G.chainLoaded) {
        G.freshTip = tip.hash;
        if (tip.miner !== me()) toast(`Block #${tip.index} was mined by ${label(tip.miner)}`);
      }
      G.chainLoaded = true;
      renderLight();
    } while (dirty);
  } finally { computing = false; }
}

/* ============ Account + wallet ============ */
let mode = "signup";
function setMsg(t, ok) { $("authMsg").textContent = t || ""; $("authMsg").className = "msg " + (ok ? "ok" : "bad"); }
function setMode(m) {
  mode = m;
  $("mode").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
  $("fUser").hidden = m !== "signup"; $("aForgot").hidden = m !== "login";
  $("aSubmit").textContent = m === "signup" ? "Create my wallet" : "Log in";
  $("aPass").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("authSub").textContent = m === "signup" ? "Create an account. Your browser generates your wallet keys." : "Welcome back. Log in to your wallet.";
  setMsg("");
}
function showAuth(step) { $("authMain").hidden = step !== "main"; $("profileForm").hidden = step !== "profile"; }
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
  startWatching(true);
  setMsg(""); toast(`Welcome, @${prof.username} ${prof.avatar}`);
  go("t2"); render();
  syncVerify();
}
function leaveApp() {
  G.mining = false;
  Object.assign(G, { uid: null, profile: null, jwk: null, key: null, mempool: [], to: null, verifying: false, dl: false, verified: false });
  $("sync").innerHTML = `<div class="empty">Waiting for step 2.</div>`; $("syncDone").innerHTML = ""; $("resync").hidden = true;
  startWatching(false); setMode("login"); showAuth("main"); render();
}
function wireAuth() {
  $("mode").querySelectorAll("button").forEach(b => b.onclick = () => setMode(b.dataset.m));
  $("gBtn").onclick = async () => { if (!net.configured) return; try { await net.google(); } catch (e) { setMsg(errText(e)); } };
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
      } else await net.login(email, pw);
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
      await makeProfile(G.uid, u); await enterApp(G.uid);
    } catch (e2) { setMsg(errText(e2)); }
    finally { $("pSubmit").disabled = false; }
  };
  $("pLogout").onclick = () => net.logout();
  for (const id of ["aUser", "pUser"]) $(id).oninput = () => { $(id).value = $(id).value.toLowerCase().replace(/[^a-z0-9_]/g, ""); };
}

/* ============ Step 2: download and check the chain ============ */
async function syncVerify() {
  if (G.verifying) return;
  G.verifying = true; G.dl = false; G.verified = false; renderJourney(); $("resync").hidden = true; $("syncDone").innerHTML = "";
  const box = $("sync"), chain = G.chain.slice();
  box.innerHTML = `<div class="r wait"><b class="t">â€¦</b><span>Step 3 Â· Downloading every block from the networkâ€¦</span></div>`;
  await sleep(700);
  G.dl = true; renderJourney();
  box.innerHTML = `<div class="r"><b class="t">âœ“</b><span>Block #0 Â· genesis<small>Step 4 Â· Built into every copy. It matches the chain's ID.</small></span></div>`;
  const st = newState(); let bad = null;
  const pause = Math.max(60, Math.min(450, 3200 / Math.max(1, chain.length - 1)));
  for (let i = 1; i < chain.length; i++) {
    const b = chain[i];
    box.insertAdjacentHTML("beforeend", `<div class="r wait" id="vr${i}"><b class="t">â€¦</b><span>Step 4 Â· Checking block #${i}â€¦</span></div>`);
    box.scrollTop = box.scrollHeight;
    await sleep(pause);
    const err = await validateBlock(b, chain[i - 1], st);
    const row = $("vr" + i);
    if (err) { bad = { i, err }; row.className = "r bad"; row.innerHTML = `<b class="t">âœ—</b><span>Block #${i} rejected<small>${esc(err)}</small></span>`; break; }
    row.className = "r";
    row.innerHTML = `<b class="t">âœ“</b><span>Block #${i} Â· mined by ${esc(label(b.miner))} Â· ${b.txs.length - 1} payment${b.txs.length === 2 ? "" : "s"}<small>hash ${short(b.hash)} Â· links to #${i - 1} Â· work done Â· signatures valid</small></span>`;
    box.scrollTop = box.scrollHeight;
  }
  const mine = members().findIndex(u => u.address === me()) + 1;
  $("syncDone").innerHTML = bad
    ? `<div class="banner bad">Block #${bad.i} failed the check, so this copy stops there.</div>`
    : chain.length === 1
      ? `<div class="banner info">The chain only has its genesis block so far. You can mine the first real block in step 3.</div>`
      : `<div class="banner ok">âœ… ${chain.length - 1} block${chain.length === 2 ? "" : "s"} checked. You hold a full, verified copy of the blockchain${mine ? ` and you're member #${mine}` : ""}. You didn't have to ask anyone whether the chain was honest. You checked it yourself.</div>`;
  $("n2").classList.add("done"); $("n2").textContent = "âœ“";
  G.verifying = false; G.verified = !bad; renderJourney(); $("resync").hidden = false;
  if (!bad) confetti();
}

/* ============ Step 3: take part ============ */
async function mine() {
  if (G.mining || !G.key) return;
  G.mining = true; setMineUI(true);
  const miner = me(), expected = 16 ** COIN.difficulty, target = "0".repeat(COIN.difficulty);
  let posted = false;
  outer: while (G.mining) {
    const tip = G.chain.at(-1);
    const txs = [coinbaseTx(miner), ...(await pickTxs(G.mempool.map(clean), G.state))];
    const b = { index: tip.index + 1, prevHash: tip.hash, timestamp: Date.now(), txs, nonce: 0, miner };
    const t0 = performance.now(); let found = false;
    while (G.mining) {
      if (G.chain.at(-1).hash !== tip.hash) { toast("Someone else found a block first. Restarting on top of theirs.", true); continue outer; }
      const fs = performance.now();
      do { b.hash = blockHash(b); if (b.hash.startsWith(target)) { found = true; break; } b.nonce++; } while (performance.now() - fs < 12);
      $("mBar").style.width = Math.min(100, b.nonce / expected * 100) + "%";
      $("mText").textContent = `Guess #${b.nonce.toLocaleString()} Â· block #${b.index} Â· ${txs.length - 1} payment${txs.length === 2 ? "" : "s"} included Â· ${((performance.now() - t0) / 1000).toFixed(1)}s`;
      if (found) break;
      await new Promise(r => raf(r));
    }
    if (!found) break;
    try {
      await net.postBlock({ index: b.index, prevHash: b.prevHash, timestamp: b.timestamp, txs: b.txs.map(clean), nonce: b.nonce, miner, hash: b.hash });
      posted = true; $("mBar").style.width = "100%";
      $("mResult").innerHTML = `<div class="banner ok">ðŸŽ‰ Block #${b.index} added to the chain! ${COIN.reward} ${COIN.ticker} sent to you.</div>`;
      toast(`+${COIN.reward} ${COIN.ticker} for you ðŸ¤‘`);
      confetti();
    } catch (e) { $("mResult").innerHTML = `<div class="banner bad">The network refused the block: ${esc(errText(e))}</div>`; }
    break;
  }
  G.mining = false; setMineUI(false);
  if (!posted && !$("mResult").innerHTML) $("mResult").innerHTML = `<div class="banner bad">Stopped. No block, no reward.</div>`;
}
function setMineUI(on) {
  $("mineBtn").disabled = on; $("stopBtn").disabled = !on;
  $("mineBtn").textContent = on ? "â›ï¸ Miningâ€¦" : "â›ï¸ Mine a block";
  $("mineBtn").classList.toggle("pulse", on);
  if (on) { $("mResult").innerHTML = ""; $("mBar").style.width = "0"; }
}
async function sendFlow() {
  if (!G.to) return toast("Pick a member to pay first", true);
  const amt = Math.floor(Number($("tAmt").value));
  if (!(amt > 0)) return toast("Enter an amount above 0", true);
  $("sendBtn").disabled = true;
  try {
    const t = await makeTx(G.key, G.profile.pubKey, G.to, amt);
    let err = await checkTx(t, stateWithMine());
    if (!err) { try { await net.postTx(clean(t)); } catch (e) { err = errText(e); } }
    if (err) { $("sendMsg").innerHTML = `<div class="banner bad">Rejected: ${esc(err)}</div>`; toast("Rejected: " + err, true); }
    else {
      $("sendMsg").innerHTML = `<div class="banner ok">Signed with your private key and sent to ${esc(label(G.to))}. It's confirmed once a block is mined. <button class="btn ghost small" id="mineNow" style="margin-left:6px">Mine it now</button></div>`;
      $("mineNow").onclick = () => { $("mineBtn").scrollIntoView({ behavior: "smooth", block: "center" }); mine(); };
      toast(`${amt} ${COIN.ticker} sent to ${label(G.to)} ðŸ’¸`);
    }
  } finally { $("sendBtn").disabled = false; }
  renderLight();
}

/* ============ Rendering ============ */
function renderStats() {
  $("sBlocks").textContent = G.chain.length;
  $("sUsers").textContent = G.users.size;
  $("sSupply").textContent = (G.chain.length - 1) * COIN.reward;
  if (joined()) {
    $("meChip").hidden = false;
    $("meChip").innerHTML = `${av(G.profile)}<div><b>@${esc(G.profile.username)}</b><small>${balance(me())} ${COIN.ticker}</small></div><button id="logoutBtn">Log out</button>`;
    $("logoutBtn").onclick = () => net.logout();
  } else $("meChip").hidden = true;
}
function renderChain() {
  $("netNote").innerHTML = G.readErr
    ? `<div class="banner bad" style="margin:0 0 12px">Couldn't read the chain. Publish the latest <code>firestore.rules</code> so the chain is public, then refresh.</div>` : "";
  const last = G.chain.slice(-8), first = G.chain.length - last.length;
  $("chain").innerHTML = last.map((b, k) => (k ? `<div class="link">ðŸ”—</div>` : "") + `
    <div class="blk ${b.hash === G.freshTip ? "fresh" : ""}">
      <div class="head"><b>#${b.index}</b>${b.index ? "" : '<span class="pill">genesis</span>'}</div>
      ${b.index ? `<div class="k">mined by</div><div class="who">${esc(label(b.miner))}</div>` : ""}
      <div class="k">hash</div><div class="mono">${short(b.hash)}</div>
      <div class="k">payments</div><div>${b.index ? b.txs.length - 1 : 0}</div>
    </div>`).join("");
  if (first > 0) $("chain").insertAdjacentHTML("afterbegin", `<div class="link" style="flex-basis:44px;color:var(--muted);font-size:12px">+${first}</div>`);
}
function renderMembers() {
  const list = members(), shown = list.slice(0, 12);
  $("members").innerHTML = shown.map((u, i) => `<div class="lb ${u.address === me() ? "you" : ""}"><span class="rank">#${i + 1}</span>${av(u)}
    <div class="n"><b>@${esc(u.username)}${u.address === me() ? " (you)" : ""}</b><span>${short(u.address)}</span></div>
    <div class="amt">${balance(u.address)}<small>${COIN.ticker}</small></div></div>`).join("")
    + (list.length > 12 ? `<div class="empty">â€¦and ${list.length - 12} more</div>` : "")
    || `<div class="empty">${G.readErr ? "" : "No members yet. Be the first to join!"}</div>`;
}
function renderJoin() {
  $("setupWarn").hidden = net.configured;
  $("authBox").hidden = joined(); $("walletBox").hidden = !joined();
  $("n1").classList.toggle("done", joined()); $("n1").textContent = joined() ? "âœ“" : "2";
  if (!joined()) return;
  const p = G.profile;
  $("walletBox").innerHTML = `<div class="row" style="margin:0 0 4px">${av(p, "lg")}<div><b style="font-size:18px">@${esc(p.username)}</b><div class="hint" style="margin:0">This is your identity on the network.</div></div></div>
    <span class="lbl">Address (your account number)</span><div class="hash">${p.address}</div>
    <span class="lbl">Public key (anyone can see it)</span><div class="hash" style="font-size:11px">${p.pubKey}</div>
    <span class="lbl">Private key (secret, tap to reveal)</span><div class="hash secret" id="kPriv">${esc(G.jwk.d)}</div>`;
  $("kPriv").onclick = e => e.currentTarget.classList.toggle("show");
}
function renderPart() {
  $("gate").hidden = joined(); $("part").hidden = !joined();
  if (!joined()) return;
  $("myBal").innerHTML = `${balance(me())} <small>${COIN.ticker}</small>`;
  $("myAddr").textContent = me();
  const others = members().filter(u => u.address !== me());
  $("toChips").innerHTML = others.slice(0, 24).map(u => `<button class="chip ${G.to === u.address ? "on" : ""}" data-a="${u.address}">${av(u)}<span><b>@${esc(u.username)}</b><small>${balance(u.address)} ${COIN.ticker}</small></span></button>`).join("")
    || `<div class="empty">No other members yet. Ask a classmate to join.</div>`;
  $("toChips").querySelectorAll(".chip").forEach(c => c.onclick = () => { G.to = c.dataset.a; renderPart(); });
  const items = [];
  for (let i = G.chain.length - 1; i > 0 && items.length < 10; i--) {
    const b = G.chain[i];
    for (const t of b.txs.slice(1).reverse()) items.push(`<div><span class="who">${esc(label(t.from))}</span> â†’ <span class="who">${esc(label(t.to))}</span>: <b>${t.amount} ${COIN.ticker}</b> Â· block #${i}</div>`);
    items.push(`<div>â›ï¸ Block #${i} mined by <span class="who">${esc(label(b.miner))}</span></div>`);
  }
  const pend = pendingTxs(G.mempool, G.state).map(t => `<div>â³ <span class="who">${esc(label(t.from))}</span> â†’ <span class="who">${esc(label(t.to))}</span>: <b>${t.amount} ${COIN.ticker}</b> Â· waiting for a block</div>`);
  $("feed").innerHTML = pend.concat(items).slice(0, 12).join("") || `<div class="empty">Nothing yet. Mine a block or send some coins.</div>`;
}
function renderJourney() {
  const done = [G.chainLoaded && G.usersLoaded, joined(), joined() && G.dl, joined() && G.verified, joined() && balance(me()) > 0];
  const first = done.findIndex(d => !d);
  document.querySelectorAll("#journey .j").forEach((el, i) => {
    el.className = "j" + (done[i] ? " done" : i === first ? " active" : "");
    el.querySelector("i").textContent = done[i] ? "âœ“" : String(i + 1);
  });
}
function renderLight() { renderJourney(); renderStats(); renderChain(); renderMembers(); renderJoin(); renderPart(); }
function render() { renderLight(); }

/* ============ Tabs + boot ============ */
const TABS = ["t1", "t2", "t3"];
function go(tab, focus) {
  document.querySelectorAll(".tab").forEach(b => {
    const on = b.dataset.tab === tab; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  document.querySelectorAll("section").forEach(s => s.classList.toggle("on", s.id === tab));
  scrollTo({ top: 0 });
}
function wire() {
  document.querySelectorAll(".tab").forEach(b => {
    b.onclick = () => go(b.dataset.tab);
    b.onkeydown = e => {
      const i = TABS.indexOf(b.dataset.tab);
      if (e.key === "ArrowRight") go(TABS[(i + 1) % 3], true);
      if (e.key === "ArrowLeft") go(TABS[(i + 2) % 3], true);
    };
  });
  $("toJoin").onclick = () => go("t2");
  $("bigToggle").onclick = () => {
    const on = document.body.classList.toggle("big");
    try { localStorage.setItem("big", on ? "1" : ""); } catch { /* private mode */ }
  };
  try { if (localStorage.getItem("big")) document.body.classList.add("big"); } catch { /* private mode */ }
  $("gateBtn").onclick = () => go("t2");
  $("resync").onclick = syncVerify;
  $("mineBtn").onclick = mine;
  $("stopBtn").onclick = () => { G.mining = false; };
  $("sendBtn").onclick = sendFlow;
  $("copyAddr").onclick = async () => { try { await navigator.clipboard.writeText(me()); toast("Address copied"); } catch { toast("Couldn't copy. Select it and copy by hand.", true); } };
}

(function boot() {
  document.title = COIN.name + " blockchain";
  $("genHash").textContent = GENESIS.hash;
  document.querySelectorAll(".coinName").forEach(e => e.textContent = COIN.name);
  document.querySelectorAll(".tk").forEach(e => e.textContent = COIN.ticker);
  wire(); wireAuth(); setMode("signup"); render();
  if (!net.configured) return;
  startWatching(false);                       // the chain is public: anyone can read it before joining
  net.onAuth(async user => {
    if (G.busy) return;
    if (!user) { if (G.uid || G.profile) leaveApp(); return; }
    try { await enterApp(user.uid); } catch (e) { showAuth("main"); setMsg(errText(e)); }
  });
})();
window.CoinLab = { G, render, sendFlow, mine, syncVerify, enterApp, go };
