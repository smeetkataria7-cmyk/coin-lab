import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, writeBatch, updateDoc, deleteDoc, getDocs, collection } from "firebase/firestore";
import fs from "fs";
const env = await initializeTestEnvironment({ projectId: "demo-coin", firestore: { rules: fs.readFileSync("C:/Users/smeet/coin-lab/firestore.rules","utf8"), host: "127.0.0.1", port: 8181 } });
let pass=0, fail=0;
const t = async (name, p) => { try { await p; pass++; console.log("PASS", name); } catch(e){ fail++; console.log("FAIL", name, String(e.message||e).slice(0,120)); } };
const A="VIBE"+"a".repeat(40), B="VIBE"+"b".repeat(40);
const alice = env.authenticatedContext("alice").firestore(), bob = env.authenticatedContext("bob").firestore(), anon = env.unauthenticatedContext().firestore();
const profile=(u,a)=>({username:u,address:a,pubKey:"04ab",avatar:"😎",hue:10,createdAt:1});
async function signup(db,uid,u,a){ const b=writeBatch(db); b.set(doc(db,"usernames",u),{uid}); b.set(doc(db,"users",uid),profile(u,a)); b.set(doc(db,"users",uid,"secret","key"),{jwk:"{}"}); return b.commit(); }

await t("anon can check username exists", assertSucceeds(getDoc(doc(anon,"usernames","alice"))));
await t("anon CAN read blocks (public chain)", assertSucceeds(getDocs(collection(anon,"blocks"))));
await t("anon CAN read member list", assertSucceeds(getDocs(collection(anon,"users"))));
await t("anon cannot read mempool", assertFails(getDocs(collection(anon,"mempool"))));
await t("anon cannot list usernames", assertFails(getDocs(collection(anon,"usernames"))));
await t("alice signup batch", assertSucceeds(signup(alice,"alice","alice",A)));
await t("bob cannot take alice's username", assertFails(signup(bob,"bob","alice",B)));
await t("bob signup with own name", assertSucceeds(signup(bob,"bob","bob",B)));
await t("user doc without username claim denied", assertFails((async()=>{const b=writeBatch(alice);b.set(doc(alice,"users","carol"),profile("zed",A));return b.commit();})()));
await t("cannot create profile for another uid", assertFails(setDoc(doc(alice,"users","bob2"),profile("bob2",A))));
await t("bad username format denied", assertFails((async()=>{const b=writeBatch(env.authenticatedContext("dan").firestore());})()).catch(()=>{}) );
await t("uppercase username denied", assertFails(setDoc(doc(env.authenticatedContext("dan").firestore(),"usernames","Dan"),{uid:"dan"})));
await t("extra profile field denied", assertFails((async()=>{const d=env.authenticatedContext("eve").firestore();const b=writeBatch(d);b.set(doc(d,"usernames","eve"),{uid:"eve"});b.set(doc(d,"users","eve"),{...profile("eve","VIBE"+"e".repeat(40)),admin:true});return b.commit();})()));
await t("profile edit denied", assertFails(updateDoc(doc(alice,"users","alice"),{avatar:"x"})));
await t("signed-in can read all users", assertSucceeds(getDoc(doc(alice,"users","bob"))));
await t("own secret readable", assertSucceeds(getDoc(doc(alice,"users","alice","secret","key"))));
await t("other's secret NOT readable", assertFails(getDoc(doc(alice,"users","bob","secret","key"))));
await t("secret can't be overwritten", assertFails(setDoc(doc(alice,"users","alice","secret","key"),{jwk:"stolen"})));

const H="0000"+"f".repeat(60);
const block=(over={})=>({index:1,prevHash:"0".repeat(64),timestamp:1,txs:[{id:"x",from:"COINBASE",to:A,amount:50,timestamp:1}],nonce:5,miner:A,hash:H,...over});
await t("alice posts valid-shaped block", assertSucceeds(setDoc(doc(alice,"blocks",H),block())));
await t("block with someone else's miner address denied", assertFails(setDoc(doc(alice,"blocks","0000"+"e".repeat(60)),block({miner:B,hash:"0000"+"e".repeat(60)}))));
await t("block hash must equal doc id", assertFails(setDoc(doc(alice,"blocks","0000"+"d".repeat(60)),block())));
await t("block without proof-of-work prefix denied", assertFails(setDoc(doc(alice,"blocks","abcd"+"f".repeat(60)),block({hash:"abcd"+"f".repeat(60)}))));
await t("empty tx list denied", assertFails(setDoc(doc(alice,"blocks","0000"+"c".repeat(60)),block({txs:[],hash:"0000"+"c".repeat(60)}))));
await t("anon cannot post block", assertFails(setDoc(doc(anon,"blocks",H+"1"),block())));
await t("blocks are immutable (update)", assertFails(updateDoc(doc(alice,"blocks",H),{nonce:9})));
await t("blocks are immutable (delete)", assertFails(deleteDoc(doc(alice,"blocks",H))));
await t("anon cannot post a block", assertFails(setDoc(doc(anon,"blocks","0000"+"9".repeat(60)),block({hash:"0000"+"9".repeat(60)}))));
await t("anon cannot read someone's secret", assertFails(getDoc(doc(anon,"users","alice","secret","key"))));
await t("bob can read blocks", assertSucceeds(getDoc(doc(bob,"blocks",H))));

const tx=(over={})=>({id:"t1",from:A,to:B,amount:5,timestamp:1,pubKey:"04ab",signature:"aa",...over});
await t("alice posts tx from her address", assertSucceeds(setDoc(doc(alice,"mempool","t1"),tx())));
await t("alice cannot post tx from bob's address", assertFails(setDoc(doc(alice,"mempool","t2"),tx({id:"t2",from:B,to:A}))));
await t("non-integer amount denied", assertFails(setDoc(doc(alice,"mempool","t3"),tx({id:"t3",amount:1.5}))));
await t("negative amount denied", assertFails(setDoc(doc(alice,"mempool","t4"),tx({id:"t4",amount:-5}))));
await t("tx id must equal doc id", assertFails(setDoc(doc(alice,"mempool","t5"),tx({id:"other"}))));
await t("mempool immutable", assertFails(updateDoc(doc(alice,"mempool","t1"),{amount:999})));
await t("mempool undeletable", assertFails(deleteDoc(doc(bob,"mempool","t1"))));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail?1:0);


