/* BKTeach Recordbook app.
   Sign-in: Google (Firebase), teacher account only, then access code.
   Data: read from the PRIVATE GitHub repo habtoulout17-jpg/recordbook with a read-only key
   kept in Firestore (teacherTools/github, teacher-only). This file holds no recordbook content. */

const FIREBASE = { apiKey: "AIzaSyAw9-cm8tT3l49AI51lUwd5Vn1rzjnDLlg", authDomain: "bkteach-student-room.firebaseapp.com", projectId: "bkteach-student-room", messagingSenderId: "763134070827", appId: "1:763134070827:web:9aac81b4c6507457f05a6e" };
const TEACHER = "habtoulout17@gmail.com";
const DIGEST = "fe2592b42a727e977f055947385b709cc82b16b9a87f88c6abf3900d65d0cdc3";
const GH = "https://api.github.com/repos/habtoulout17-jpg/recordbook";
const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

const $ = id => document.getElementById(id);
const SCREENS = ["loading", "signin", "code", "key", "main"];
const show = id => SCREENS.forEach(s => { $(s).hidden = s !== id; });

/* ---------- small key-value store on this device ---------- */
const idb = new Promise(res => {
  try { const r = indexedDB.open("bk-recordbook-app", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }
  catch (e) { res(null); }
});
async function kvGet(k) { const d = await idb; if (!d) return null; return new Promise(res => { const q = d.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); }); }
async function kvSet(k, v) { const d = await idb; if (!d) return; return new Promise(res => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = res; }); }
async function kvDel(k) { const d = await idb; if (!d) return; d.transaction("kv", "readwrite").objectStore("kv").delete(k); }

async function sha(text) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join(""); }

/* ---------- Firebase ---------- */
let fb = null;
async function firebase() {
  const base = "https://www.gstatic.com/firebasejs/12.3.0/";
  const [A, U, F] = await Promise.all(["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map(f => import(base + f)));
  const app = A.initializeApp(FIREBASE);
  return { A, U, F, auth: U.getAuth(app), db: F.getFirestore(app) };
}
const isTeacher = u => !!(u && u.emailVerified && u.email === TEACHER);

/* ---------- GitHub ---------- */
let token = "";
async function gh(path, raw) {
  const r = await fetch(GH + path, { headers: { Authorization: "Bearer " + token, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json" }, cache: "no-store" });
  if (!r.ok) { const e = Error("github " + r.status); e.status = r.status; throw e; }
  return raw ? r.text() : r.json();
}
async function loadFromGitHub() {
  const tree = await gh("/git/trees/main?recursive=1"), pm = {};
  tree.tree.forEach(t => { const m = /^pages\/(\d+)\.svg$/.exec(t.path); if (m) pm[m[1]] = t.sha; });
  const js = await gh("/contents/app.js?ref=main", true), m = js.match(/const BOOK=(\{[\s\S]*?\});\(function/);
  if (!m) throw Error("book");
  return { book: JSON.parse(m[1]), pages: pm };
}

/* ---------- pages ---------- */
let book = null, pageMap = {}, current = 0, activeDate = "", scrollWanted = 0, loadTicket = 0;
const urls = new Map();
async function pageSvg(n) {
  const hash = pageMap[n]; if (!hash) throw Error("missing");
  const key = "page_" + n + "_" + hash;
  let svg = await kvGet(key);
  if (!svg) { svg = await gh("/contents/pages/" + n + ".svg?ref=main", true); kvSet(key, svg); }
  return svg;
}
async function pageURL(n) {
  const key = n + "_" + pageMap[n];
  if (urls.has(key)) return urls.get(key);
  const url = URL.createObjectURL(new Blob([await pageSvg(n)], { type: "image/svg+xml" }));
  urls.set(key, url); return url;
}

/* ---------- viewer ---------- */
const mobile = () => matchMedia("(max-width: 760px)").matches;
const longDate = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
function fit() {
  if (!book) return;
  const p = book.pages[current], w = p.width * 4 / 3, h = p.height * 4 / 3;
  const k = $("zoom").value === "fit" ? ($("paper-view").clientWidth - (mobile() ? 0 : 26)) / w : Number($("zoom").value);
  Object.assign($("paper").style, { width: w + "px", height: h + "px", transform: "scale(" + k + ")" });
  Object.assign($("paper-stage").style, { width: w * k + "px", height: h * k + "px" });
}
function choose(i, date = "") {
  current = Math.max(0, Math.min(book.pages.length - 1, i));
  if (!date) { const fd = book.dates.find(x => x.page === current + 1); date = fd ? fd.date : ""; }
  activeDate = date;
  const p = book.pages[current], ticket = ++loadTicket;
  $("paper").removeAttribute("src");
  $("viewer-status").textContent = "Loading page…";
  pageURL(p.number).then(u => { if (ticket === loadTicket) { $("paper").src = u; $("viewer-status").textContent = ""; } })
    .catch(e => { if (ticket === loadTicket) $("viewer-status").textContent = e.message === "missing" ? "This page is not in the recordbook yet." : "This page could not load. Check your internet connection."; });
  $("paper").alt = p.label;
  $("page").value = String(current);
  $("page-title").textContent = date ? longDate(date) : p.label;
  $("page-status").textContent = p.number + " / " + book.pages.length;
  $("prev").disabled = $("m-prev").disabled = current === 0;
  $("next").disabled = $("m-next").disabled = current === book.pages.length - 1;
  $("date").value = date; $("date-status").textContent = "";
  $("dates").querySelectorAll("button").forEach(b => b.dataset.date === date ? b.setAttribute("aria-current", "date") : b.removeAttribute("aria-current"));
  $("m-date").textContent = date ? shortDate(date) : p.label;
  $("m-page").textContent = "Page " + p.number + " / " + book.pages.length;
  const chip = date && $("dates").querySelector('button[data-date="' + date + '"]');
  if (chip) chip.scrollIntoView({ block: "nearest", inline: "center" });
  const d = book.dates.find(x => x.date === date);
  scrollWanted = d && d.table === 1 ? .495 : 0;
  fit();
  [current - 1, current + 1].forEach(j => { if (book.pages[j]) pageURL(book.pages[j].number).catch(() => {}); });
}
function navigation() {
  $("page").replaceChildren(); $("dates").replaceChildren();
  book.pages.forEach((p, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = p.number + ". " + p.label; $("page").appendChild(o); });
  let month = "";
  book.dates.forEach(d => {
    const m = new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    if (m !== month) { month = m; const h = document.createElement("h2"); h.textContent = m; $("dates").appendChild(h); }
    const b = document.createElement("button"); b.type = "button"; b.dataset.date = d.date;
    b.textContent = (d.kind === "holiday" ? "Holiday · " : "") + shortDate(d.date);
    b.onclick = () => choose(d.page - 1, d.date);
    $("dates").appendChild(b);
  });
}
function today() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const v = k => parts.find(p => p.type === k).value; return v("year") + "-" + v("month") + "-" + v("day");
}
function openLatest() {
  const t = today();
  const latest = book.dates.find(d => d.date === t) || [...book.dates].reverse().find(d => d.date <= t) || book.dates[0];
  latest ? choose(latest.page - 1, latest.date) : choose(0);
}
function render(data, first) {
  const same = book && JSON.stringify(book) === JSON.stringify(data.book) && JSON.stringify(pageMap) === JSON.stringify(data.pages);
  book = data.book; pageMap = data.pages;
  if (same) return;
  navigation();
  if (first) openLatest(); else choose(current, activeDate);
}

/* ---------- opening ---------- */
let opened = false;
async function openBook() {
  show("main");
  if (!token) token = (await kvGet("token")) || "";
  if (!token) {
    try { const k = await fb.F.getDoc(fb.F.doc(fb.db, "teacherTools", "github")); token = k.exists() ? (k.data().token || "") : ""; } catch (e) {}
    if (token) kvSet("token", token);
  }
  if (!token) { show("key"); return; }
  const cached = await kvGet("book");
  if (cached && !opened) { render(cached, true); opened = true; }
  await refresh(!opened);
}
async function refresh(first) {
  $("top-status").textContent = "Updating…";
  try {
    const data = await loadFromGitHub();
    kvSet("book", data);
    render(data, first || !opened); opened = true;
    $("top-status").textContent = "";
  } catch (e) {
    $("top-status").textContent = "";
    if (e.status === 401 || e.status === 403 || e.status === 404) { token = ""; kvDel("token"); $("key-status").textContent = "GitHub did not accept the saved key. Paste a new one."; show("key"); }
    else if (opened) $("top-status").textContent = "Offline: showing the last saved version.";
    else $("viewer-status").textContent = "The recordbook could not load. Check your internet connection and tap Refresh.";
  }
}

/* ---------- PDF ---------- */
let jspdfReady = null;
const loadJsPDF = () => jspdfReady || (jspdfReady = new Promise((res, rej) => { const s = document.createElement("script"); s.src = JSPDF; s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => { jspdfReady = null; rej(Error("lib")); }; document.head.appendChild(s); }));
function weekPages() {
  const d = activeDate || today(), dt = new Date(d + "T12:00:00"), day = (dt.getDay() + 6) % 7;
  const mon = new Date(dt); mon.setDate(dt.getDate() - day);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  const set = [...new Set(book.dates.filter(x => x.date >= iso(mon) && x.date <= iso(sun)).map(x => x.page))].sort((a, b) => a - b);
  return { pages: set.length ? set : [book.pages[current].number], name: "Recordbook-week-" + iso(mon) };
}
async function makePdf(kind) {
  const say = t => { $("pdf-status").textContent = t; };
  let list, name;
  if (kind === "page") { list = [book.pages[current].number]; name = "Recordbook-page-" + list[0]; }
  else if (kind === "week") ({ pages: list, name } = weekPages());
  else { list = book.pages.map(p => p.number); name = "Recordbook-2026-2027"; }
  list = list.filter(n => pageMap[n]);
  if (!list.length) { say("This page is not in the recordbook yet."); return; }
  document.querySelectorAll("[data-pdf]").forEach(b => b.disabled = true);
  try {
    say("Preparing…");
    const jsPDF = await loadJsPDF();
    let pdf = null;
    for (const [i, n] of list.entries()) {
      say("Page " + (i + 1) + " of " + list.length + "…");
      const p = book.pages.find(x => x.number === n), W = p.width, H = p.height, S = 2;
      const img = new Image(); img.src = await pageURL(n); await img.decode();
      const c = document.createElement("canvas"); c.width = Math.round(W * S); c.height = Math.round(H * S);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const jpg = c.toDataURL("image/jpeg", 0.9);
      if (!pdf) pdf = new jsPDF({ unit: "pt", format: [W, H], orientation: "portrait", compress: true }); else pdf.addPage([W, H], "portrait");
      pdf.addImage(jpg, "JPEG", 0, 0, W, H);
    }
    say("Saving…");
    pdf.save(name + ".pdf");
    say("Done. Check your downloads.");
  } catch (e) { say("The PDF could not be made. Check your internet connection and try again."); }
  document.querySelectorAll("[data-pdf]").forEach(b => b.disabled = false);
}

/* ---------- wiring ---------- */
$("signin-btn").onclick = async () => {
  $("signin-status").textContent = "";
  try { await fb.U.signInWithPopup(fb.auth, new fb.U.GoogleAuthProvider()); }
  catch (e) { $("signin-status").textContent = "Sign-in did not finish. Please try again."; }
};
$("signout-btn").onclick = () => fb.U.signOut(fb.auth);
$("code-form").onsubmit = async e => {
  e.preventDefault();
  const v = $("code-input").value; $("code-input").value = "";
  if (await sha(v) === DIGEST) { sessionStorage.setItem("bk-open", "1"); openBook(); }
  else $("code-status").textContent = "Incorrect code.";
};
$("key-form").onsubmit = async e => {
  e.preventDefault();
  const v = $("key-input").value.trim(); if (!v) return;
  $("key-status").textContent = "Checking the key…"; token = v;
  try {
    await gh("/git/trees/main");
    await fb.F.setDoc(fb.F.doc(fb.db, "teacherTools", "github"), { token: v, savedAt: fb.F.serverTimestamp() });
    await kvSet("token", v); $("key-input").value = ""; $("key-status").textContent = ""; openBook();
  } catch (err) { token = ""; $("key-status").textContent = "GitHub did not accept that key. Check it and try again."; }
};
$("lock").onclick = () => { sessionStorage.removeItem("bk-open"); show("code"); setTimeout(() => $("code-input").focus(), 50); };
$("refresh").onclick = () => refresh(false);
$("pdf").onclick = () => { $("pdf-status").textContent = ""; $("pdf-dialog").showModal(); };
$("pdf-close").onclick = () => $("pdf-dialog").close();
document.querySelectorAll("[data-pdf]").forEach(b => b.onclick = () => makePdf(b.dataset.pdf));
$("date").onchange = () => { const d = book.dates.find(x => x.date === $("date").value); d ? choose(d.page - 1, d.date) : ($("date-status").textContent = "No entry for this date."); };
$("page").onchange = () => choose(Number($("page").value));
$("prev").onclick = $("m-prev").onclick = () => choose(current - 1);
$("next").onclick = $("m-next").onclick = () => choose(current + 1);
$("zoom").onchange = fit;
addEventListener("resize", fit);
let sw = null;
$("paper-view").addEventListener("touchstart", e => { sw = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
$("paper-view").addEventListener("touchend", e => { if (!sw || $("zoom").value !== "fit") return; const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y; sw = null; if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) choose(current + (dx < 0 ? 1 : -1)); }, { passive: true });
$("paper").onload = () => {
  fit();
  const v = mobile() ? document.scrollingElement : $("paper-view");
  if (mobile()) v.scrollTop = scrollWanted ? $("paper-stage").offsetTop + $("paper-stage").clientHeight * scrollWanted - 8 : 0;
  else v.scrollTop = $("paper-stage").clientHeight * scrollWanted;
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && opened && token) refresh(false); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

firebase().then(f => {
  fb = f;
  fb.U.onAuthStateChanged(fb.auth, u => {
    if (!u) { $("signout-btn").hidden = true; show("signin"); return; }
    if (!isTeacher(u)) { $("signin-status").textContent = "This app is only for the teacher's account."; $("signout-btn").hidden = false; show("signin"); return; }
    if (sessionStorage.getItem("bk-open")) openBook();
    else { show("code"); setTimeout(() => $("code-input").focus(), 50); }
  });
}).catch(() => { $("loading").querySelector("p").textContent = "Could not start. Check your internet connection and reopen the app."; });
