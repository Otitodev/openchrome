// OpenChrome deterministic test app. No deps. Run: node examples/test-app/serve.mjs [port=3000]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);

const shell = (title, body) =>
  `<!doctype html><html><head><title>${title}</title><meta charset="utf-8"></head><body>${body}</body></html>`;

const index = shell("OpenChrome test app", `<h1>OpenChrome test app</h1><ul>
<li><a href="/login">login</a></li><li><a href="/signup">signup</a></li>
<li><a href="/dashboard">dashboard</a></li><li><a href="/form">form</a></li>
<li><a href="/modal">modal</a></li><li><a href="/js-error">js-error</a></li>
<li><a href="/api-error">api-error</a></li></ul>`);

const signup = shell("Create Account", `<h1>Create Account</h1>
<form id="f"><label>Email <input name="email" type="email" aria-label="Email"></label><br>
<label>Password <input name="password" type="password" aria-label="Password"></label><br>
<button type="submit">Create account</button></form><div id="msg" role="status"></div>
<script>document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();
const e2=new FormData(e.target).get('email');console.log('signup submit',e2);
const r=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e2})});
document.getElementById('msg').textContent=r.ok?'Welcome, '+e2:'Signup failed: '+r.status;};</script>`);

const login = shell("Log in", `<h1>Log in</h1>
<form id="f"><label>Email <input name="email" type="email" aria-label="Email"></label><br>
<label>Password <input name="password" type="password" aria-label="Password"></label><br>
<button type="submit">Log in</button></form><div id="msg" role="status"></div>
<script>document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();
const e2=new FormData(e.target).get('email');console.log('login submit',e2);
document.getElementById('msg').textContent='Logged in as '+e2;};</script>`);

const dashboard = shell("Dashboard", `<h1>Dashboard</h1><button>Create</button> <a href="/settings">Settings</a>`);
const form = shell("Form", `<h1>Contact form</h1><form><label>Name <input aria-label="Name"></label><br>
<label><input type="checkbox" aria-label="Remember me"> Remember me</label><br><button>Send</button></form>`);
const modal = shell("Modal", `<h1>Modal demo</h1><button id="o">Open dialog</button>
<dialog id="d"><p>Dialog content</p><button id="c">Close</button></dialog>
<script>o.onclick=()=>d.showModal();c.onclick=()=>d.close();</script>`);
const jserr = shell("JS error", `<h1>JS error demo</h1><script>console.error('demo boot error');setTimeout(()=>{throw new Error('demo uncaught exception')},300);</script>`);
const apierr = shell("API error", `<h1>API error demo</h1><button id="b">Trigger 500</button><div id="m" role="status"></div>
<script>b.onclick=async()=>{const r=await fetch('/api/broken',{method:'POST'});m.textContent='status '+r.status;};</script>`);

const routes = { "/": index, "/signup": signup, "/login": login, "/dashboard": dashboard, "/form": form, "/modal": modal, "/js-error": jserr, "/api-error": apierr };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "POST" && url.pathname === "/api/users") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (body.includes("fail")) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "boom" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/broken") {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "broken" }));
    return;
  }
  const page = routes[url.pathname];
  if (!page) {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(shell("404", "<h1>404</h1><p>The requested path could not be found</p>"));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(page);
}).listen(port, () => console.log(`test app on http://localhost:${port}/`));
