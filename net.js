/* Network layer: Firebase Auth + Firestore. The rest of the app only talks to `net`. */
import { firebaseConfig } from "./firebase-config.js";

const V = "10.14.1", CDN = `https://www.gstatic.com/firebasejs/${V}`;
export const configured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE");

let auth, db, fb = {};
if (configured) {
  const [app, au, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`)]);
  const a = app.initializeApp(firebaseConfig);
  auth = au.getAuth(a); db = fs.getFirestore(a); fb = { ...au, ...fs };
}

const nice = e => {
  const c = e?.code || "";
  if (c.includes("email-already-in-use")) return "That email already has an account. Try logging in.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password.";
  if (c.includes("weak-password")) return "Password needs at least 6 characters.";
  if (c.includes("invalid-email")) return "That email doesn't look right.";
  if (c.includes("popup-closed")) return "Google sign-in was closed before finishing.";
  if (c.includes("unauthorized-domain")) return "This website isn't in Firebase's Authorized domains yet.";
  if (c.includes("too-many-requests")) return "Too many attempts. Wait a minute and try again.";
  if (c.includes("permission-denied")) return "The database refused this (check the Firestore rules).";
  return e?.message || "Something went wrong.";
};
export const errText = nice;

function watch(name, cb) {
  const map = new Map();
  return fb.onSnapshot(fb.collection(db, name), snap => {
    snap.docChanges().forEach(c => c.type === "removed" ? map.delete(c.doc.id) : map.set(c.doc.id, c.doc.data()));
    cb([...map.entries()].map(([id, d]) => ({ _id: id, ...d })));
  }, err => console.error("watch " + name, err));
}

export const net = {
  configured,
  onAuth: cb => fb.onAuthStateChanged(auth, cb),
  async google() {
    const p = new fb.GoogleAuthProvider();
    try { return (await fb.signInWithPopup(auth, p)).user; }
    catch (e) { if (e.code === "auth/popup-blocked") { await fb.signInWithRedirect(auth, p); return null; } throw e; }
  },
  async signup(email, pw) { return (await fb.createUserWithEmailAndPassword(auth, email, pw)).user; },
  async login(email, pw) { return (await fb.signInWithEmailAndPassword(auth, email, pw)).user; },
  reset: email => fb.sendPasswordResetEmail(auth, email),
  logout: () => fb.signOut(auth),
  async usernameTaken(name) { return (await fb.getDoc(fb.doc(db, "usernames", name))).exists(); },
  async getProfile(uid) { const s = await fb.getDoc(fb.doc(db, "users", uid)); return s.exists() ? s.data() : null; },
  async getSecret(uid) { const s = await fb.getDoc(fb.doc(db, "users", uid, "secret", "key")); return s.exists() ? JSON.parse(s.data().jwk) : null; },
  async createProfile(uid, profile, jwk) {
    const b = fb.writeBatch(db);
    b.set(fb.doc(db, "usernames", profile.username), { uid });
    b.set(fb.doc(db, "users", uid), { ...profile, createdAt: Date.now() });
    b.set(fb.doc(db, "users", uid, "secret", "key"), { jwk: JSON.stringify(jwk) });
    await b.commit();
  },
  watchBlocks: cb => watch("blocks", cb),
  watchMempool: cb => watch("mempool", cb),
  watchUsers: cb => watch("users", cb),
  postBlock: b => fb.setDoc(fb.doc(db, "blocks", b.hash), b),
  postTx: t => fb.setDoc(fb.doc(db, "mempool", t.id), t)
};
