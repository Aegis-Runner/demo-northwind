// NORTHWIND FREIGHT — a booking wizard, not a CRUD grid.
//
// Meridian is flat: every entity is one form, one page, one save. A generator
// can do well there by filling whatever it finds. This app is deliberately the
// other shape, because the interesting failures live where Meridian has no
// surface:
//
//   STATE ACROSS PAGES   a booking is assembled over four pages and only
//                        becomes real on the last one. A test that fills page
//                        three in isolation has tested nothing.
//   DERIVED MONEY        the total is computed from line items, a weight-tier
//                        discount, insurance and tax. Nobody types it, so an
//                        oracle has to know what it SHOULD be — the class of
//                        bug that is invisible to "did the form submit".
//   ORDER DEPENDENCE     step 3's options depend on what step 2 declared.
//
// Faults are env-gated so the same image serves as healthy or faulty:
//   wizardamnesia  step 3 silently drops the cargo declared in step 2
//   badtotal       the weight discount is computed and then not applied
//   ghostbooking   confirm returns success without persisting the booking
import express from "express";
import cookieParser from "cookie-parser";
import { DatabaseSync } from "node:sqlite";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

const BUGS = new Set(String(process.env.DEMO_BUGS || "").split(",").map((s) => s.trim()).filter(Boolean));
const RESET_TOKEN = process.env.DEMO_RESET_TOKEN || "frt-reset";
const SESSION = "freight_session_v1";

const USERS = {
  "ops@northwind.test": { password: "ops12345", name: "Dana Ops", role: "ops" },
  "clerk@northwind.test": { password: "clerk12345", name: "Sam Clerk", role: "clerk" },
};

const b64 = (s) => Buffer.from(String(s)).toString("base64url");
const unb64 = (s) => { try { return Buffer.from(String(s || ""), "base64url").toString(); } catch { return ""; } };
function currentUser(req) {
  const email = unb64(req.cookies?.[SESSION]);
  return USERS[email] ? { email, ...USERS[email] } : null;
}

// ── data ─────────────────────────────────────────────────────────────────────
let seq = 500;
const id = () => String(++seq);
const LANES = [
  { code: "NW-1", from: "Seattle", to: "Portland", km: 280, base: 120 },
  { code: "NW-2", from: "Seattle", to: "Boise", km: 800, base: 340 },
  { code: "NW-3", from: "Portland", to: "Sacramento", km: 940, base: 410 },
];
let shippers = [
  { id: "501", name: "Cascade Timber", contact: "ops@cascade.test", terms: "net30" },
  { id: "502", name: "Rainier Foods", contact: "ship@rainier.test", terms: "net15" },
];
let bookings = [];
let drafts = new Map(); // session-scoped wizard state

const DB_PATH = process.env.FREIGHT_DB || "/data/freight.db";
let db = null;
try {
  db = new DatabaseSync(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
} catch { db = null; }
function persist() {
  if (!db) return;
  try {
    db.prepare(`INSERT INTO kv(k,v) VALUES('state',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
      .run(JSON.stringify({ seq, shippers, bookings }));
  } catch {}
}
function load() {
  if (!db) return;
  try {
    const row = db.prepare(`SELECT v FROM kv WHERE k='state'`).get();
    if (row?.v) { const s = JSON.parse(row.v); seq = s.seq; shippers = s.shippers; bookings = s.bookings; }
  } catch {}
}
load();

// ── the money, in one place ──────────────────────────────────────────────────
// Every rate here is visible in the UI, so a test CAN know what the total ought
// to be. That is the point: a bug in this function is a silent money bug, and
// nothing about the page looks broken when it happens.
function weightDiscountPct(totalKg) {
  if (totalKg >= 5000) return 15;
  if (totalKg >= 2000) return 10;
  if (totalKg >= 500) return 5;
  return 0;
}
function priceBooking(lane, lines, insured) {
  const totalKg = lines.reduce((n, l) => n + Number(l.kg || 0), 0);
  const laneRate = LANES.find((l) => l.code === lane) || LANES[0];
  const freight = laneRate.base + Math.round(totalKg * 0.08);
  const discountPct = weightDiscountPct(totalKg);
  const discount = Math.round((freight * discountPct) / 100);
  // BADTOTAL: the discount is computed, shown to the user, and then not
  // subtracted. The line item is right, the total is wrong, and every page
  // renders without complaint.
  const discounted = BUGS.has("badtotal") ? freight : freight - discount;
  const insurance = insured ? Math.round(discounted * 0.04) : 0;
  const tax = Math.round((discounted + insurance) * 0.09);
  return { totalKg, freight, discountPct, discount, insurance, tax, total: discounted + insurance + tax };
}

// ── chrome ───────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STYLE = `
:root {
  --primary: #1e3a8a;
  --primary-hover: #172554;
  --primary-light: #eff6ff;
  --primary-text: #1e3a8a;
  --bg: #f8fafc;
  --card-bg: #ffffff;
  --text: #0f172a;
  --text-muted: #64748b;
  --border: #e2e8f0;
  --success: #059669;
  --success-light: #ecfdf5;
  --success-text: #065f46;
  --warning-light: #fef3c7;
  --warning-text: #92400e;
  --danger: #b91c1c;
  --danger-light: #fee2e2;
  --danger-text: #991b1b;
}
body {
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
header {
  background: linear-gradient(135deg, #071e3d 0%, #0a2540 100%);
  color: #fff;
  padding: 14px 20px;
  display: flex;
  gap: 18px;
  align-items: center;
  box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
}
header strong {
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  background: linear-gradient(to right, #38bdf8, #60a5fa);
  -webkit-background-clip: text;-webkit-text-fill-color: transparent;
}
header a {
  color: #cbd5e1;
  text-decoration: none;
  font-weight: 500;
  font-size: 0.925rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  transition: all 0.2s;
}
header a:hover {
  color: #fff;
  background: rgba(255,255,255,0.1);
}
header a.on {
  color: #fff;
  background: rgba(255,255,255,0.15);
  font-weight: 600;
}
main {
  max-width: 940px;
  width: 100%;
  margin: 22px auto;
  padding: 0 16px;
  box-sizing: border-box;
  flex-grow: 1;
}
h1 {
  font-size: 1.875rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #071e3d;
}
.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 18px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05),0 2px 4px -2px rgba(0,0,0,0.05);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th, td {
  text-align: left;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
th {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
td {
  font-size: 14px;
}
tr:last-child td {
  border-bottom: none;
}
label {
  display: block;
  margin: 12px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
input, select {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 230px;
  font-size: 14px;
  transition: all 0.2s;
  background-color: #f1f5f9;
  width: 100%;
  max-width: 400px;
  box-sizing: border-box;
}
input:focus, select:focus {
  outline: none;
  border-color: #071e3d;
  box-shadow: 0 0 0 3px #bfdbfe;
  background-color: #fff;
}
button, .btn {
  background: #0f2d4a;
  color: #fff;
  border: 0;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
  transition: all 0.2s;
  text-align: center;
  box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);
}
button:hover, .btn:hover {
  background: #1e3a8a;
  transform: translateY(-1px);
}
button:active, .btn:active {
  transform: translateY(0);
}
.btn.ghost {
  background: #fff;
  color: #0f2d4a;
  border: 1px solid var(--border);
}
.btn.ghost:hover {
  background: #eff6ff;
  border-color: #0f2d4a;
}
.steps {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}
.steps span {
  padding: 6px 16px;
  border-radius: 9999px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid #e2e8f0;
}
.steps span.now {
  background: #0f2d4a;
  color: #fff;
  border-color: #0f2d4a;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
}
.err {
  background: var(--danger-light);
  border: 1px solid #fca5a5;
  color: var(--danger-text);
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 12px;
}
.tot {
  font-size: 24px;
  font-weight: 700;
  color: #0f2d4a;
}
.muted {
  color: var(--text-muted);
  font-size: 13px;
}`;
function layout(active, title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(title)} · Northwind Freight</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>${STYLE}</style>
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen flex flex-col font-sans">
  <div id="react-root"></div>
  <div id="server-content" style="display:none;">${body}</div>
  <script type="text/babel">
    const { useState, useEffect } = React;
    
    function App() {
      const [content, setContent] = useState('');
      useEffect(() => {
        setContent(document.getElementById('server-content').innerHTML);
      }, []);
      
      const navItems = [
        ["/", "Dashboard"],
        ["/bookings", "Bookings"],
        ["/shippers", "Shippers"],
        ["/book/step1", "New booking"]
      ];
      
      return (
        <div className="flex flex-col min-h-screen">
          <header className="bg-gradient-to-r from-[#071e3d] to-[#0a2540] text-white p-4 flex items-center gap-6 shadow-lg">
            <strong className="text-xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-300">Northwind Freight</strong>
            <nav className="flex gap-4 ml-4">
              {navItems.map(([href, label]) => {
                const on = "${active}" === href;
                return (
                  <a key={href} href={href} className={"text-sm font-semibold px-3 py-1.5 rounded-md transition-all " + (on ? "bg-white/10 text-white font-bold" : "text-slate-300 hover:text-white")}>
                    {label}
                  </a>
                );
              })}
            </nav>
            <span className="ml-auto text-sm text-slate-300"><a href="/logout" className="hover:text-white transition-all">Sign out</a></span>
          </header>
          <main className="max-w-[940px] w-full mx-auto p-6 flex-grow">
            <h1 className="text-3xl font-black text-[#071e3d] mb-6">${esc(title)}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
          </main>
          <footer className="mt-auto text-center py-6 border-t border-slate-200 bg-white text-xs text-slate-400">
            &copy; 2026 Northwind Freight. Powered by <strong>React 18 SPA</strong> and modern styling selectors.
          </footer>
        </div>
      );
    }
    
    ReactDOM.createRoot(document.getElementById('react-root')).render(<App />);
  </script>
</body>
</html>`;
}

// ── auth ─────────────────────────────────────────────────────────────────────
app.get("/healthz", (_q, r) => r.type("text").send("ok"));
app.use((req, res, next) => {
  if (["/login", "/healthz", "/api/reset"].includes(req.path)) return next();
  if (!currentUser(req)) return res.redirect("/login");
  next();
});
app.get("/login", (_q, res) => res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Sign in · Northwind Freight</title><style>${STYLE}</style></head><body>
<main><div class="card" style="max-width:380px;margin:60px auto"><h1>Sign in</h1>
<form method="post" action="/login">
<label for="email">Email</label><input id="email" name="email" type="email" value="ops@northwind.test">
<label for="password">Password</label><input id="password" name="password" type="password" value="ops12345">
<p><button type="submit">Sign in</button></p></form></div></main></body></html>`));
app.post("/login", (req, res) => {
  const u = USERS[String(req.body.email || "").toLowerCase()];
  if (!u || u.password !== req.body.password) return res.status(401).send(`<p class="err">Wrong email or password.</p><a href="/login">Back</a>`);
  res.cookie(SESSION, b64(String(req.body.email).toLowerCase()), { httpOnly: true });
  res.redirect("/");
});
app.get("/logout", (_q, res) => { res.clearCookie(SESSION); res.redirect("/login"); });

// ── dashboard / lists ────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const open = bookings.filter((b) => b.status !== "delivered").length;
  const revenue = bookings.reduce((n, b) => n + Number(b.total || 0), 0);
  res.send(layout("/", "Dashboard", `<div class="card"><table>
<tr><th>Bookings</th><td>${bookings.length}</td></tr>
<tr><th>Open</th><td>${open}</td></tr>
<tr><th>Booked value</th><td>$${revenue}</td></tr></table></div>
<div class="card"><p><a class="btn" href="/book/step1">Start a booking</a></p></div>`));
});
app.get("/shippers", (_q, res) => res.send(layout("/shippers", "Shippers",
  `<div class="card"><table><tr><th>Name</th><th>Contact</th><th>Terms</th></tr>
${shippers.map((s) => `<tr><td><a href="/shippers/${s.id}">${esc(s.name)}</a></td><td>${esc(s.contact)}</td><td>${esc(s.terms)}</td></tr>`).join("")}</table></div>`)));
app.get("/shippers/:id", (req, res) => {
  const s = shippers.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).send(layout("/shippers", "Not found", `<div class="card">No such shipper.</div>`));
  res.send(layout("/shippers", s.name, `<div class="card"><table>
<tr><th>Name</th><td>${esc(s.name)}</td></tr><tr><th>Contact</th><td>${esc(s.contact)}</td></tr>
<tr><th>Terms</th><td>${esc(s.terms)}</td></tr></table></div>`));
});
app.get("/bookings", (_q, res) => res.send(layout("/bookings", "Bookings",
  `<div class="card"><table><tr><th>Ref</th><th>Shipper</th><th>Lane</th><th>Weight</th><th>Total</th><th>Status</th></tr>
${bookings.map((b) => `<tr><td><a href="/bookings/${b.id}">${esc(b.ref)}</a></td><td>${esc(b.shipperName)}</td>
<td>${esc(b.lane)}</td><td>${esc(b.totalKg)} kg</td><td>$${esc(b.total)}</td><td>${esc(b.status)}</td></tr>`).join("")
  || `<tr><td colspan="6" class="muted">No bookings yet.</td></tr>`}</table></div>`)));
app.get("/bookings/:id", (req, res) => {
  const b = bookings.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).send(layout("/bookings", "Not found", `<div class="card">No such booking.</div>`));
  res.send(layout("/bookings", `Booking ${b.ref}`, `<div class="card"><table>
<tr><th>Reference</th><td>${esc(b.ref)}</td></tr>
<tr><th>Shipper</th><td>${esc(b.shipperName)}</td></tr>
<tr><th>Lane</th><td>${esc(b.lane)}</td></tr>
<tr><th>Cargo lines</th><td>${b.lines.length}</td></tr>
<tr><th>Total weight</th><td>${esc(b.totalKg)} kg</td></tr>
<tr><th>Freight</th><td>$${esc(b.freight)}</td></tr>
<tr><th>Discount</th><td>${esc(b.discountPct)}% (&minus;$${esc(b.discount)})</td></tr>
<tr><th>Insurance</th><td>$${esc(b.insurance)}</td></tr>
<tr><th>Tax</th><td>$${esc(b.tax)}</td></tr>
<tr><th>Total</th><td class="tot">$${esc(b.total)}</td></tr>
<tr><th>Status</th><td>${esc(b.status)}</td></tr></table></div>
<div class="card"><h3>Cargo</h3><table><tr><th>Description</th><th>Weight</th></tr>
${b.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td>${esc(l.kg)} kg</td></tr>`).join("") || `<tr><td colspan="2" class="muted">No cargo recorded.</td></tr>`}</table></div>`));
});

// ── the wizard ───────────────────────────────────────────────────────────────
function draftFor(req) {
  const key = req.cookies?.[SESSION] || "anon";
  if (!drafts.has(key)) drafts.set(key, { shipperId: "", lane: "", lines: [], insured: false });
  return drafts.get(key);
}
const stepBar = (n) => `<div class="steps">${["Route", "Cargo", "Options", "Review"].map((s, i) =>
  `<span class="${i + 1 === n ? "now" : ""}">${i + 1}. ${s}</span>`).join("")}</div>`;

app.get("/book/step1", (req, res) => {
  const d = draftFor(req);
  res.send(layout("/book/step1", "New booking", `${stepBar(1)}<div class="card"><form method="post" action="/book/step1">
<label for="shipperId">Shipper</label><select id="shipperId" name="shipperId">
${shippers.map((s) => `<option value="${s.id}" ${d.shipperId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
<label for="lane">Lane</label><select id="lane" name="lane">
${LANES.map((l) => `<option value="${l.code}" ${d.lane === l.code ? "selected" : ""}>${l.code} — ${l.from} to ${l.to} (${l.km} km)</option>`).join("")}</select>
<p><button type="submit">Continue to cargo</button></p></form></div>`));
});
app.post("/book/step1", (req, res) => {
  const d = draftFor(req);
  d.shipperId = String(req.body.shipperId || "");
  d.lane = String(req.body.lane || "");
  res.redirect("/book/step2");
});

app.get("/book/step2", (req, res) => {
  const d = draftFor(req);
  if (!d.lane) return res.redirect("/book/step1");
  res.send(layout("/book/step1", "Cargo", `${stepBar(2)}
<div class="card"><table><tr><th>Description</th><th>Weight</th></tr>
${d.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td>${esc(l.kg)} kg</td></tr>`).join("") || `<tr><td colspan="2" class="muted">Nothing added yet.</td></tr>`}</table></div>
<div class="card"><form method="post" action="/book/step2">
<label for="desc">Description</label><input id="desc" name="desc" placeholder="Kiln-dried cedar">
<label for="kg">Weight (kg)</label><input id="kg" name="kg" type="number" value="600">
<p><button type="submit" name="op" value="add">Add cargo line</button>
<button type="submit" name="op" value="next" class="btn ghost">Continue to options</button></p></form></div>`));
});
app.post("/book/step2", (req, res) => {
  const d = draftFor(req);
  if (String(req.body.op) === "add") {
    const desc = String(req.body.desc || "").trim();
    const kg = Number(req.body.kg || 0);
    if (!desc) return res.status(400).send(layout("/book/step1", "Cargo", `${stepBar(2)}<div class="err">Description is required.</div><p><a class="btn" href="/book/step2">Back</a></p>`));
    if (!(kg > 0)) return res.status(400).send(layout("/book/step1", "Cargo", `${stepBar(2)}<div class="err">Weight must be greater than zero.</div><p><a class="btn" href="/book/step2">Back</a></p>`));
    d.lines.push({ desc, kg });
    return res.redirect("/book/step2");
  }
  if (!d.lines.length) return res.status(400).send(layout("/book/step1", "Cargo", `${stepBar(2)}<div class="err">Add at least one cargo line before continuing.</div><p><a class="btn" href="/book/step2">Back</a></p>`));
  res.redirect("/book/step3");
});

app.get("/book/step3", (req, res) => {
  const d = draftFor(req);
  if (!d.lines.length) return res.redirect("/book/step2");
  // WIZARDAMNESIA: the cargo assembled on step 2 is discarded on arrival at
  // step 3. Nothing errors. The review page still prices a booking — just an
  // empty one — so only a test that carried its own values through all four
  // pages can see it.
  if (BUGS.has("wizardamnesia")) d.lines = [];
  const p = priceBooking(d.lane, d.lines, d.insured);
  res.send(layout("/book/step1", "Options", `${stepBar(3)}<div class="card">
<p class="muted">${d.lines.length} cargo line(s), ${p.totalKg} kg — qualifies for ${p.discountPct}% weight discount.</p>
<form method="post" action="/book/step3">
<label for="insured">Insurance</label>
<select id="insured" name="insured"><option value="no">No cover</option><option value="yes" ${d.insured ? "selected" : ""}>Insure at 4% of freight</option></select>
<p><button type="submit">Continue to review</button></p></form></div>`));
});
app.post("/book/step3", (req, res) => {
  const d = draftFor(req);
  d.insured = String(req.body.insured) === "yes";
  res.redirect("/book/review");
});

app.get("/book/review", (req, res) => {
  const d = draftFor(req);
  if (!d.lane) return res.redirect("/book/step1");
  const p = priceBooking(d.lane, d.lines, d.insured);
  const shipper = shippers.find((s) => s.id === d.shipperId) || shippers[0];
  res.send(layout("/book/step1", "Review", `${stepBar(4)}<div class="card"><table>
<tr><th>Shipper</th><td>${esc(shipper.name)}</td></tr>
<tr><th>Lane</th><td>${esc(d.lane)}</td></tr>
<tr><th>Cargo lines</th><td>${d.lines.length}</td></tr>
<tr><th>Total weight</th><td>${p.totalKg} kg</td></tr>
<tr><th>Freight</th><td>$${p.freight}</td></tr>
<tr><th>Discount</th><td>${p.discountPct}% (&minus;$${p.discount})</td></tr>
<tr><th>Insurance</th><td>$${p.insurance}</td></tr>
<tr><th>Tax</th><td>$${p.tax}</td></tr>
<tr><th>Total</th><td class="tot">$${p.total}</td></tr></table></div>
<div class="card"><table><tr><th>Description</th><th>Weight</th></tr>
${d.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td>${esc(l.kg)} kg</td></tr>`).join("") || `<tr><td colspan="2" class="muted">No cargo.</td></tr>`}</table></div>
<div class="card"><form method="post" action="/book/confirm"><button type="submit">Confirm booking</button></form></div>`));
});
app.post("/book/confirm", (req, res) => {
  const d = draftFor(req);
  if (!d.lane) return res.redirect("/book/step1");
  const p = priceBooking(d.lane, d.lines, d.insured);
  const shipper = shippers.find((s) => s.id === d.shipperId) || shippers[0];
  const bid = id();
  const booking = {
    id: bid, ref: "NW" + bid, shipperId: shipper.id, shipperName: shipper.name,
    lane: d.lane, lines: d.lines.slice(), insured: d.insured, status: "booked", ...p,
  };
  // GHOSTBOOKING: the confirmation page renders and the reference is issued,
  // but the booking never reaches the list. The user leaves believing it
  // worked; only re-opening the list disagrees.
  if (!BUGS.has("ghostbooking")) { bookings.push(booking); persist(); }
  drafts.delete(req.cookies?.[SESSION] || "anon");
  res.redirect(`/book/done?ref=${encodeURIComponent(booking.ref)}&total=${booking.total}`);
});
app.get("/book/done", (req, res) => res.send(layout("/bookings", "Booking confirmed", `<div class="card">
<p>Booking <strong>${esc(req.query.ref)}</strong> is confirmed.</p>
<p class="tot">$${esc(req.query.total)}</p>
<p><a class="btn" href="/bookings">See all bookings</a></p></div>`)));

// ── reset ────────────────────────────────────────────────────────────────────
app.post("/api/reset", (req, res) => {
  if (req.get("X-Reset-Token") !== RESET_TOKEN) return res.status(403).json({ error: "bad token" });
  seq = 500;
  shippers = [
    { id: "501", name: "Cascade Timber", contact: "ops@cascade.test", terms: "net30" },
    { id: "502", name: "Rainier Foods", contact: "ship@rainier.test", terms: "net15" },
  ];
  bookings = [];
  drafts = new Map();
  persist();
  res.json({ ok: true, counts: { shippers: shippers.length, bookings: bookings.length } });
});

app.listen(Number(process.env.PORT || 3000), () => {
  console.log(`northwind-freight listening on ${process.env.PORT || 3000}; bugs=${[...BUGS].join(",") || "none"}`);
});
