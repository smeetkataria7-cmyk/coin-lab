import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, writeBatch, collection, getDocs } from "firebase/firestore";
import * as C from "file:///C:/Users/smeet/coin-lab/core.js";
const ok=(n,c)=>{console.log((c?"PASS":"FAIL")+" "+n); if(!c) process.exitCode=1;};
async function client(name){
  const app=initializeApp({apiKey:"x",projectId:"demo-coin",authDomain:"localhost"},name);
  const auth=getAuth(app); connectAuthEmulator(auth,"http://127.0.0.1:9199",{disableWarnings:true});
  const db=getFirestore(app); connectFirestoreEmulator(db,"127.0.0.1",8181);
  return {auth,db};
}
async function join(name,username){
  const {auth,db}=await client(name);
  const uid=(await createUserWithEmailAndPassword(auth,username+"@test.com","secret123")).user.uid;
  const w=await C.generateWallet();
  const profile={username,address:w.address,pubKey:w.pubHex,avatar:"😎",hue:5};
  const b=writeBatch(db);
  b.set(doc(db,"usernames",username),{uid}); b.set(doc(db,"users",uid),{...profile,createdAt:Date.now()});
  b.set(doc(db,"users",uid,"secret","key"),{jwk:JSON.stringify(w.jwk)}); await b.commit();
  return {db,auth,uid,w,profile};
}
const clean=t=>({id:t.id,from:t.from,to:t.to,amount:t.amount,timestamp:t.timestamp,...(t.pubKey?{pubKey:t.pubKey,signature:t.signature}:{})});
const allBlocks=async db=>(await getDocs(collection(db,"blocks"))).docs.map(d=>d.data());
const allPool=async db=>(await getDocs(collection(db,"mempool"))).docs.map(d=>d.data());

const alice=await join("a","alice"), bob=await join("b","bob");
ok("two users joined",true);
// login again & load secret roundtrip
await signInWithEmailAndPassword(alice.auth,"alice@test.com","secret123");
const sec=JSON.parse((await getDoc(doc(alice.db,"users",alice.uid,"secret","key"))).data().jwk);
const k=await C.importPrivate(sec); ok("private key restored from Firestore",!!k);

// alice mines block 1 and posts it
let r=await C.computeChain(await allBlocks(alice.db));
let tip=r.chain.at(-1);
const b1=C.mineSync(tip,[C.coinbaseTx(alice.w.address)],alice.w.address);
const post=b=>({index:b.index,prevHash:b.prevHash,timestamp:b.timestamp,txs:b.txs.map(clean),nonce:b.nonce,miner:b.miner,hash:b.hash});
await setDoc(doc(alice.db,"blocks",b1.hash),post(b1));
// bob's browser reads chain from Firestore
r=await C.computeChain(await allBlocks(bob.db));
ok("bob sees alice's block after Firestore roundtrip",r.chain.length===2 && C.balanceOf(r.state,alice.w.address)===50);
// alice pays bob 20
const tx=await C.makeTx(k,alice.profile.pubKey,bob.w.address,20);
await setDoc(doc(alice.db,"mempool",tx.id),clean(tx));
// bob mines including pending tx
const pool=await allPool(bob.db);
const picked=await C.pickTxs(pool,r.state); ok("bob's miner picks alice's payment",picked.length===1);
const b2=C.mineSync(r.chain.at(-1),[C.coinbaseTx(bob.w.address),...picked.map(clean)],bob.w.address);
await setDoc(doc(bob.db,"blocks",b2.hash),post(b2));
r=await C.computeChain(await allBlocks(alice.db));
ok("balances after payment: alice 30, bob 70",C.balanceOf(r.state,alice.w.address)===30 && C.balanceOf(r.state,bob.w.address)===70 && r.chain.length===3);
ok("pending list now empty",C.pendingTxs(await allPool(alice.db),r.state).length===0);
// cheater tries: bob posts block stealing alice's coins with his own signature (invalid) -> chain ignores
const steal=await C.makeTx(bob.w.privateKey,bob.profile.pubKey,bob.w.address,1); // self-send invalid
const evil=C.mineSync(r.chain.at(-1),[C.coinbaseTx(bob.w.address),{...tx,id:"zzz",to:bob.w.address}],bob.w.address);
await setDoc(doc(bob.db,"blocks",evil.hash),post(evil));
r=await C.computeChain(await allBlocks(alice.db));
ok("network ignores block with forged tx",r.chain.length===3 && r.rejected===1);
// rules: alice can't post a block claiming bob as miner
let denied=false; try{ await setDoc(doc(alice.db,"blocks","0000"+"1".repeat(60)),{...post(b2),hash:"0000"+"1".repeat(60)}); }catch(e){denied=true}
ok("rules block impersonated miner",denied);
denied=false; try{ await setDoc(doc(bob.db,"mempool","q"),{...clean(tx),id:"q"}); }catch(e){denied=true}
ok("rules block spending someone else's address",denied);
process.exit(process.exitCode||0);
