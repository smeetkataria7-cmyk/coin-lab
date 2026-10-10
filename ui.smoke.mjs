const els={};
const mkEl=id=>els[id]||(els[id]=new Proxy({id,value:"",checked:false,innerHTML:"",textContent:"",hidden:false,disabled:false,children:{length:0},style:{},classList:{toggle(){},add(){},remove(){}},
  querySelectorAll:()=>[],querySelector:()=>null,prepend(){},appendChild(){},remove(){},setAttribute(){},focus(){},lastChild:{remove(){}}},{get:(t,k)=>k in t?t[k]:()=>{}, set:(t,k,v)=>{t[k]=v;return true}}));
global.document={getElementById:mkEl,querySelectorAll:()=>[],createElement:()=>mkEl("_c"+Math.random()),title:""};
global.window=global; global.scrollTo=()=>{}; global.innerWidth=900; global.innerHeight=700;
global.requestAnimationFrame=f=>setTimeout(f,0);
const errs=[]; process.on("unhandledRejection",e=>errs.push("unhandled: "+e.stack));
const app=await import("file:///C:/Users/smeet/coin-lab/app.js");
const {net}=await import("file:///C:/Users/smeet/coin-lab/net.js");
const C=await import("file:///C:/Users/smeet/coin-lab/core.js");
const {G,render,sendFlow,ATTACKS,attack,mine}=window.CoinLab;
console.log("boot ok; configured:",net.configured, "setupWarn shown:", els.setupWarn.hidden===false);
// fake logged-in world
const A=await C.generateWallet(), B=await C.generateWallet();
const pa={_id:"a",username:"alice",address:A.address,pubKey:A.pubHex,avatar:"😎",hue:10,createdAt:1}, pb={_id:"b",username:"bob",address:B.address,pubKey:B.pubHex,avatar:"🫶",hue:200,createdAt:2};
G.users=new Map([["a",pa],["b",pb]]); G.byAddr=new Map([[A.address,pa],[B.address,pb]]);
G.profile=pa; G.jwk=A.jwk; G.key=A.privateKey;
const b1=C.mineSync(C.GENESIS,[C.coinbaseTx(A.address)],A.address);
G.blocks=[b1]; const r=await C.computeChain(G.blocks); G.chain=r.chain; G.state=r.state; G.view=JSON.parse(JSON.stringify(G.chain));
render(); console.log("render ok, my balance:",C.balanceOf(G.state,A.address));
net.postTx=async t=>{G.mempool.push(t)}; net.postBlock=async b=>{G.blocks.push(b)};
G.to=B.address; document.getElementById("tAmt").value="15";
await sendFlow(); console.log("send ok; mempool:",G.mempool.length, "receipt has verified:", /Broadcast/.test(document.getElementById("tInfo").innerHTML));
for(const k of Object.keys(ATTACKS)){ await attack(...ATTACKS[k]); }
console.log("attacks:", document.getElementById("atkLog").innerHTML.replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,400));
// overspend after pending
document.getElementById("tAmt").value="999"; await sendFlow(); console.log("overspend rejected:", /not enough/.test(document.getElementById("tInfo").innerHTML));
// mining a real block (difficulty 4) through the UI code path
document.getElementById("slow").checked=false; await mine(); console.log("mined via UI path; blocks posted:",G.blocks.length,"result:",document.getElementById("mResult").innerHTML.replace(/<[^>]+>/g,"").slice(0,90));
const r2=await C.computeChain(G.blocks); console.log("chain after mining:",r2.chain.length,"alice:",C.balanceOf(r2.state,A.address),"bob:",C.balanceOf(r2.state,B.address));
G.chain=r2.chain;G.state=r2.state;G.view=JSON.parse(JSON.stringify(G.chain));G.mempool=[]; render();
// tamper path
G.view[1].txs[0].amount=999; document.getElementById("chain").innerHTML=""; render();
console.log("errors:",errs.length?errs:"none");
process.exit(0);

