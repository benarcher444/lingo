# The server, and how to put another website on it

This is the guide for hosting **more than one website on the one Hetzner
machine** that already runs Lingo. It is written for an agent (or a person)
who has to do it without having been in the conversation that built Lingo.

`DEPLOY.md` is the from-scratch recipe for Lingo alone. `CLAUDE.md` holds the
reasoning behind Lingo's design. This file is about the *machine*: what is on
it, how requests reach each site, and the exact steps to add a new one without
breaking Lingo.

> **Read "What is verified and what is not" at the bottom first.** This file was
> written from the repository, not from the live server. The repo shows what the
> server was *built* to look like; check it against reality before editing
> anything shared.

---

## 0. Decisions, and what is waiting to be done

### Decided by the owner (2026-10-27, from a phone session)

- **Lingo stays exactly as it is:** `127.0.0.1:3000`, served at
  `https://91-99-202-188.sslip.io`. Further sites take 3001, 3002, … and are
  told apart by hostname, not by port (section 1 explains why).
- **New sites get a real domain name**, not sslip.io. The owner said a name
  "sounds good". **No domain has been bought or chosen yet** as of this entry, so
  the first job is to ask which one. Don't invent a domain, and don't buy one.
- **The new sites are Node websites**, the same shape as Lingo. Section 8.1 and
  the two scripts below are the path; 8.2 and 8.3 are reference only.

### Not done yet — needs a session that can SSH to the server

Nothing below has been run. A phone/cloud session cannot do it (section 4). Do
these in order, from the laptop:

1. **Look before touching.** `cat /etc/caddy/Caddyfile`, `ss -tlnp`, `free -h`.
   Compare with sections 2, 6 and 7, and correct this file where reality differs.
2. **Get the scripts onto the server.** They are in `deploy/` on the branch
   `claude/beautiful-mendel-k1ebks`, so they reach `/opt/lingo` only once that is
   merged to `main` (which deploys Lingo, a routine restart with a pre-deploy
   backup) and `lingo-deploy` has run. Quicker and with no Lingo restart:
   `scp deploy/migrate-caddy.sh deploy/new-site.sh root@91.99.202.188:/root/`.
3. **Run `bash migrate-caddy.sh`** (section 7). It backs up the live Caddyfile,
   validates the new layout, and puts the original back if validation fails.
   Then `curl -sI https://91-99-202-188.sslip.io/login` must still say 200.
4. **Choose and buy the domain**, then in its DNS add an `A` record pointing at
   `91.99.202.188` — ideally a **wildcard** (`*`), so each future site needs no
   DNS step at all. Add `AAAA` too if you want IPv6. Check with
   `nslookup anything.<domain>`. Caddy still fetches one certificate per
   hostname; the wildcard only covers DNS.
5. **Add the first site:** `bash new-site.sh <name> <name>.<domain> 3001 <git-url>`
   (add `--dry-run` first). Then put its secrets in `/opt/<name>/.env`, restart
   it, and fill in the table in section 10.
6. **Optional:** move Lingo itself onto the domain by editing the hostname in
   `/etc/caddy/sites/lingo.caddy` and reloading. Everyone has to sign in again
   (the session cookie belongs to a hostname), and the old sslip.io address stops
   working unless you keep both names in that block.
7. **Update this section** as steps finish, in the same change.

---

## 1. The short version

- One server, one public address, **three public ports: 22 (SSH), 80, 443.**
  Hetzner's firewall drops everything else.
- **Caddy** owns 80 and 443. It reads the hostname of each request and passes it
  to the right app.
- Every app listens on **its own port on `127.0.0.1` only** — Lingo on `3000`,
  the next site on `3001`, and so on. Nothing outside the machine can reach
  those ports directly; only Caddy can.
- So "Lingo on one port, another site on another port" works like this: the
  *internal* ports differ, and the *public* door is always 443. Visitors tell
  the sites apart by **hostname**, not by port number.
- Each app has its own Linux user, its own folder under `/opt`, its own systemd
  service and its own database. Sites cannot read each other's files.

```
 browser ──https──▶ Hetzner firewall (22, 80, 443 only)
                          │
                          ▼
                   Caddy  (ports 80/443, certificates, routes by hostname)
                    │            │              │
   91-99-202-188.sslip.io   blog.91-99-…sslip.io   shop.example.com
                    │            │              │
                    ▼            ▼              ▼
            127.0.0.1:3000  127.0.0.1:3001  127.0.0.1:3002
               lingo           site two        site three
            (user: lingo)   (user: blog)     (user: shop)
```

If you wanted `http://<server-ip>:3001` to open in a browser: it will not, by
design (see section 6). Use a hostname.

---

## 2. The machine

| Thing | Value |
|---|---|
| Host | Hetzner Cloud `cx23` — 2 vCPU (x86), 4 GB RAM, about $8.70/month |
| OS | Ubuntu 26.04 |
| Runtime | Node 24.x (NodeSource), `npm` |
| Reverse proxy | Caddy 2.6.2, installed from apt, runs as the `caddy` systemd unit |
| Public IPv4 | `91.99.202.188` |
| Lingo's address | <https://91-99-202-188.sslip.io> |
| Firewall (Hetzner) | inbound TCP 22, 80, 443 only |
| SSH | `root@91.99.202.188`, **keys only** (password login disabled in `/etc/ssh/sshd_config.d/00-lingo-hardening.conf`) |
| Backups | on the server's own disk only; Hetzner Backups is **off** |
| Source | <https://github.com/benarcher444/lingo> (public repo) |

**sslip.io** is a free DNS service: any name of the form
`<anything>.91-99-202-188.sslip.io` resolves to `91.99.202.188`. It stands in
for a real domain, because Caddy needs a *name* (not an IP) to get an HTTPS
certificate. See section 5 for what that means for new sites.

---

## 3. How Lingo is set up (the pattern to copy)

Lingo is the template for every other site. The repo files and where they land:

| Piece | In the repo | On the server |
|---|---|---|
| App code | the repo | `/opt/lingo` (a git clone) |
| Linux user | — | `lingo`, a system user with no shell and no login |
| Config & secrets | `env.example` | `/opt/lingo/.env`, mode 600, owned by `lingo`, **never committed** |
| Database | — | `/opt/lingo/data/app.db` (SQLite). **This is the real data.** |
| Service | `deploy/lingo.service` | `/etc/systemd/system/lingo.service` |
| Nightly backup | `deploy/lingo-backup.{service,timer}` | `/etc/systemd/system/`, 03:30 daily |
| HTTPS | `deploy/Caddyfile` (a template) | `/etc/caddy/Caddyfile` |
| Update command | `deploy/deploy.sh` | `/usr/local/bin/lingo-deploy` — a **hand-installed copy** |
| Auto-deploy | `.github/workflows/deploy.yml` | runs on GitHub; SSHes in on each push to `main` |

How it runs: systemd starts `/opt/lingo/node_modules/.bin/tsx src/server.ts` as
user `lingo`. There is **no build step** — `tsx` runs the TypeScript directly,
which is why `tsx` is in `dependencies`. The unit is hardened: `NoNewPrivileges`,
`PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`, and the **only** writable
path is `/opt/lingo/data`.

The two settings that make it safe to put behind a proxy, both in `.env`:

- `PORT=3000` — which port it listens on. Defaults to 3000 if unset.
- `HOST=127.0.0.1` — listen on loopback only, so only Caddy can reach it. The
  default `0.0.0.0` is for the home Wi-Fi and must **never** be used on the
  server.

Lingo also sets Fastify `trustProxy` to loopback only, so behind Caddy
`request.ip` is the visitor and `request.protocol` is `https`. A new Fastify or
Express app needs the same idea, or it will think every visitor is `127.0.0.1`
and that every request is plain HTTP.

How a deploy works: push to `main` → GitHub Actions runs typecheck and tests →
it SSHes in with a key whose `authorized_keys` entry is
`command="/usr/local/bin/lingo-deploy",restrict …` → that script backs up the
database, `git pull --ff-only`, `npm ci --omit=dev`, `systemctl restart lingo`,
and waits for `/login` to answer. The key can run that one command and nothing
else, and the command is a hand-installed copy, so a push to the (public) repo
cannot change what runs as root. **Keep that property for every site.**

---

## 4. Getting in

| To… | Do |
|---|---|
| Open a shell | `ssh root@91.99.202.188` (needs the owner's private key on the machine you are on) |
| See what is listening | `ss -tlnp` — expect Caddy on 80/443, Lingo on `127.0.0.1:3000`, sshd on 22 |
| Lingo's status / logs | `systemctl status lingo` · `journalctl -u lingo -f` |
| Caddy's status / logs | `systemctl status caddy` · `journalctl -u caddy -n 50` |
| Memory and disk | `free -h` · `df -h /` |

**A cloud session (claude.ai/code, the phone app) cannot reach this server.**
It runs in an isolated container with no SSH key and no route in. It can read
and edit the repo and open a pull request, but it **cannot** create users,
touch `/etc`, run `systemctl`, or deploy a new site. If you are an agent in one
of those sessions: write the files, then hand the owner the exact commands to
run from a laptop session, and say plainly that none of it has been applied.
Do not report a site as "live" because you wrote its config.

Merging to `main` in the Lingo repo **deploys Lingo to the live site**.

---

## 5. Names: how each site gets a hostname and a certificate

Caddy gets an HTTPS certificate for a name once DNS for that name points at the
server and ports 80/443 are open. Two options:

1. **Another sslip.io name — free, immediate, no DNS work.**
   `blog.91-99-202-188.sslip.io` resolves to the same server, so Caddy can
   serve and certify it straight away. Fine for personal projects and testing.
   Caveats: the names are ugly, and Let's Encrypt rate-limits certificates per
   registered domain (`sslip.io` is shared by the whole world), so a name can
   occasionally fail to issue. If it does, wait a while or use option 2.
2. **A real domain — the right answer for anything lasting.** Buy one, add an
   `A` record per site (`blog`, `shop`, … or the bare domain) pointing at
   `91.99.202.188`, plus an `AAAA` if you want IPv6. Check with
   `nslookup blog.example.com` before reloading Caddy. Lingo can move to a
   domain the same way: change one line in its Caddy file.

Never point two sites at the same hostname.

---

## 6. Ports: the rules

| Port | Who | Notes |
|---|---|---|
| 22 | sshd | public |
| 80, 443 | Caddy | public. 80 must stay open: Caddy uses it for certificates and redirects |
| 2019 | Caddy admin API | loopback only. Don't reuse it |
| **3000** | **Lingo** | keep it. The deploy script's health check, `deploy/deploy.sh`, curls `127.0.0.1:3000` |
| 3001, 3002, … | the next sites | one per site, in order, never reused |

Rules:

- **Every app binds `127.0.0.1`, never `0.0.0.0`.** That is what makes the
  firewall and Caddy the only way in.
- **Do not open extra ports in the Hetzner firewall** to "expose" a site. The
  whole design is that 80/443 + hostname is the only public surface. Opening
  3001 would bypass Caddy, HTTPS and the security headers.
- **Keep a port register.** Add each site to the table above (or in a comment at
  the top of its Caddy file) so the next agent does not pick a taken port. Check
  what is free with `ss -tlnp` before choosing.

---

## 7. One-time change: let Caddy hold several sites

The repo's `deploy/Caddyfile` is a **single-site template**, and DEPLOY.md
step 8 installs it with `sed … > /etc/caddy/Caddyfile`, which **overwrites the
whole file**. Re-running that on a server with other sites would delete them.

The safe layout is one small file per site, pulled in by the main Caddyfile.
**The easy way:** `bash deploy/migrate-caddy.sh` does all of this. It moves the
live Caddyfile, unchanged, to `sites/lingo.caddy` (so nothing about Lingo's block
is guessed), writes the small new Caddyfile, validates, restores the original if
validation fails, then reloads. It does nothing if already migrated. What follows
is the same thing by hand, which is also how to understand what it did.

Do this once, as root on the server, and **check the live file first** — it
should hold one site block for `91-99-202-188.sslip.io`, but read it:

```bash
cat /etc/caddy/Caddyfile                       # what is actually live
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
mkdir -p /etc/caddy/sites
```

`/etc/caddy/sites/lingo.caddy` — Lingo's block, with the live hostname (and
anything else the live file had that this does not):

```caddy
91-99-202-188.sslip.io {
	import common
	header X-Frame-Options "DENY"
	reverse_proxy 127.0.0.1:3000
}
```

`/etc/caddy/Caddyfile` — now only shared settings and the import:

```caddy
# Shared by every site. Each site file says `import common`.
(common) {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
}

import /etc/caddy/sites/*.caddy
```

Apply it, **validating first** — a failed `reload` leaves the old config
serving, but a failed `restart` takes every site down:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -sI https://91-99-202-188.sslip.io/login | head -1     # HTTP/2 200
```

If it misbehaves: `cp /etc/caddy/Caddyfile.bak /etc/caddy/Caddyfile && systemctl reload caddy`.

From then on, **never** re-run DEPLOY.md step 8 on this machine. If you change
`deploy/Caddyfile` in the repo, treat it as documentation, not as something to
copy over the live file.

---

## 8. Adding a new site — the checklist

Below, `<name>` is a short lowercase word (`blog`), and `<port>` is the next
free port from section 6 (`3001`). Everything runs as root on the server unless
stated.

### 8.1 A Node app (the same shape as Lingo)

**The easy way:** `bash deploy/new-site.sh [--dry-run] <name> <hostname> <port> <git-url>`
runs steps 1, 2, 3, 5 and 6 below: it checks the name, port and hostname are
free, then creates the user, clone, `.env`, service and Caddy file. It waits for
the app to answer on `127.0.0.1:<port>` *before* touching Caddy, so a broken app
cannot affect Lingo, and it prints undo commands if it fails part-way. It needs
`migrate-caddy.sh` to have been run. `START_CMD` sets how the app starts
(default `npm start`). It does not add secrets or set up auto-deploy: step 2 and
section 8.4 are still yours. The steps below are what it does, for when it
doesn't fit.

**1. A user and a folder.**

```bash
adduser --system --group --no-create-home --home /opt/<name> <name>
mkdir -p /opt/<name> && chown <name>:<name> /opt/<name>
sudo -u <name> -H git clone <repo-url> /opt/<name>
cd /opt/<name>
sudo -u <name> -H npm ci --omit=dev
sudo -u <name> mkdir -p data
```

A private repo needs a read-only deploy key for that repo; do not put a
personal GitHub token on the server.

**2. Configuration.** `sudo -u <name> nano /opt/<name>/.env`, then
`chmod 600 /opt/<name>/.env`:

```
PORT=<port>
HOST=127.0.0.1
NODE_ENV=production
```

…plus whatever the app needs. **Secrets live only here**, never in git, and
never copied from Lingo's `.env` — each site gets its own keys, so one leak does
not reach the others. (Notably: Lingo's `ANTHROPIC_API_KEY` is billed money. Do
not reuse it.)

Make sure the app reads `PORT` and `HOST` from the environment, as Lingo's
`src/server.ts` does. If it hard-codes a port, change that in the app rather
than working around it.

**3. A systemd service.** `/etc/systemd/system/<name>.service`, copied from
`deploy/lingo.service` with the names and `ExecStart` changed:

```ini
[Unit]
Description=<name> web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<name>
Group=<name>
WorkingDirectory=/opt/<name>
EnvironmentFile=/opt/<name>/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=3

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/<name>/data

[Install]
WantedBy=multi-user.target
```

`ExecStart` depends on the app: `node_modules/.bin/tsx src/server.ts` for a
`tsx` app like Lingo, `/usr/bin/node dist/server.js` for a built one, or
whatever `npm start` runs. Use absolute paths; systemd has no `PATH` to speak
of. If the app writes anywhere besides `data/` (uploads, a cache), add that path
to `ReadWritePaths`, or it fails with a read-only filesystem error.

```bash
systemctl daemon-reload
systemctl enable --now <name>
systemctl status <name>                      # active (running)
journalctl -u <name> -n 30
curl -sI http://127.0.0.1:<port>/ | head -1  # answers locally before Caddy is involved
```

Get it answering on loopback **before** touching Caddy; that splits "the app is
broken" from "the proxy is broken".

**4. A hostname.** Pick one (section 5). If it is a real domain, confirm DNS
resolves to `91.99.202.188` first.

**5. A Caddy site file.** `/etc/caddy/sites/<name>.caddy`:

```caddy
blog.91-99-202-188.sslip.io {
	import common
	header X-Frame-Options "DENY"
	reverse_proxy 127.0.0.1:<port>
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
curl -sI https://blog.91-99-202-188.sslip.io/ | head -1
```

The first request can take a few seconds while Caddy fetches the certificate.

**6. Check you did not break Lingo.**

```bash
curl -sI https://91-99-202-188.sslip.io/login | head -1
systemctl is-active lingo caddy <name>
```

**7. Record it.** Add the site to the port table in section 6, and to the list
in section 10.

### 8.2 A static site (HTML/CSS/JS, no server process)

No user, no service, no port. Caddy serves the files itself:

```bash
mkdir -p /var/www/<name>        # put the files here, e.g. with scp or git
```

```caddy
# /etc/caddy/sites/<name>.caddy
docs.91-99-202-188.sslip.io {
	import common
	root * /var/www/<name>
	file_server
}
```

Then the same `caddy validate` and `systemctl reload caddy`. Make sure the
`caddy` user can read the folder (`chmod -R a+rX /var/www/<name>`).

### 8.3 Something that is not Node (Python, Docker, …)

Same shape: **the app listens on `127.0.0.1:<port>`, systemd (or a container
published as `127.0.0.1:<port>:<inner>`, never plain `<port>:<inner>`) keeps it
running, Caddy proxies to it.** Docker's `-p 3001:3001` binds all interfaces and
*bypasses the host firewall rules on the machine itself* — always write
`-p 127.0.0.1:3001:3001`. Docker is not installed; adding it is a decision for
the owner (it costs disk and memory on a 4 GB machine).

### 8.4 Auto-deploy on push (optional, per site)

Mirror Lingo's setup, but with **its own key and its own command** — never share
Lingo's deploy key:

1. Copy `deploy/deploy.sh` to the new repo and change `APP`, the user in the
   `sudo -u` lines, the service name, and the health-check URL/port. Drop the
   database backup line if the site has no database.
2. Install it by hand, root-owned, not writable by the app user:
   `install -m 755 /opt/<name>/deploy/deploy.sh /usr/local/bin/<name>-deploy`
3. Make a new key pair for that repo. Append the public half to
   `/root/.ssh/authorized_keys` as
   `command="/usr/local/bin/<name>-deploy",restrict ssh-ed25519 AAAA… <name>-deploy`
4. Copy `.github/workflows/deploy.yml` into the new repo; set its secrets
   (`DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`) and the
   `DEPLOY_ENABLED` variable.

The forced command is the security boundary. A public repo is writable by
anyone who gets into the maintainer's GitHub account; that must never become
"runs anything as root".

---

## 9. Rules for not breaking Lingo

- **Lingo's data is real.** `/opt/lingo/data/app.db` holds the owner's
  vocabulary and learning history. Don't touch it, don't restart Lingo without
  reason, and take a backup (`cd /opt/lingo && sudo -u lingo -H npm run backup`)
  before any risky change to the server.
- **Never overwrite `/etc/caddy/Caddyfile` with a template** once section 7 is
  done. Add or edit files in `/etc/caddy/sites/` instead.
- **`caddy validate` before every `reload`**, and `reload`, not `restart`.
- **One app per user, per folder, per port, per hostname.** No sharing.
- **Don't change the firewall, `sshd` settings, or `authorized_keys` entries you
  did not add.** A mistake there can lock the owner out of the machine, and the
  fix is the Hetzner web console.
- **Don't run `apt upgrade` or reboot casually.** Unattended security updates are
  on. A reboot is safe (everything is enabled in systemd) but takes every site
  down for a minute.
- **Don't put secrets in git, in a Caddy file, or in a unit file.** Only in a
  mode-600 `.env` owned by that site's user.
- **Watch capacity.** Two vCPUs and 4 GB is plenty for a few small apps. Check
  `free -h` and `systemctl status <name>` (Memory:) after adding one. Several
  Node apps plus a build can run it out of memory; don't run `npm run build` or a
  big `npm install` on the server for a heavy project without checking.

---

## 10. Sites on this server

Keep this current. Update it in the same change that adds or removes a site.

| Site | Hostname | Port | User | Folder | Service |
|---|---|---|---|---|---|
| Lingo | `91-99-202-188.sslip.io` | 3000 | `lingo` | `/opt/lingo` | `lingo` |

---

## 11. When something is wrong

| Symptom | Likely cause | Check |
|---|---|---|
| **502 Bad Gateway** on a site | the app is down, or Caddy's port is wrong | `systemctl status <name>`, then `curl http://127.0.0.1:<port>/` |
| **Certificate error / site not found** | DNS for that name doesn't point here, or 80/443 blocked | `nslookup <host>`; `journalctl -u caddy -n 50` |
| `address already in use` | two apps on one port | `ss -tlnp \| grep <port>` |
| App starts, then dies: `read-only file system` | it writes outside `ReadWritePaths` | add the path to the unit, `daemon-reload`, restart |
| `caddy validate` fails | typo or duplicate hostname | the message names the file and line |
| Every site is down | Caddy is stopped or its config is invalid | `systemctl status caddy`; restore `Caddyfile.bak` |
| Locked out over SSH | a firewall or sshd change | use the Hetzner web console (Rescue / Console) |
| Wrong visitor IP in the app's logs | the app doesn't trust the proxy | trust `127.0.0.1` only, as Lingo's `trustProxy` does |

---

## 12. What is verified and what is not

Written 2026-10-27 from the repo, in a cloud session with **no access to the
server**.

**Read straight from the repo (reliable):** the `PORT`/`HOST` behaviour of
`src/server.ts`, `deploy/lingo.service`, `deploy/deploy.sh`,
`deploy/Caddyfile`, `deploy/lingo-backup.*`, the GitHub workflow, and DEPLOY.md.

**Taken from CLAUDE.md, not checked live:** the server specs, the sslip.io
hostname, the SSH hardening, and the Caddy and Node versions.

**The two scripts** (`deploy/migrate-caddy.sh`, `deploy/new-site.sh`) were
written in the same session. See the end of this section for how far they were
tested.

**Not known — verify before relying on it:**

- The contents of the live `/etc/caddy/Caddyfile`. It was installed by hand and
  may differ from `deploy/Caddyfile`. Read it before section 7.
- Whether anything else is already listening on 3001 and up (`ss -tlnp`).
- Whether Caddy's `import` glob, `caddy validate` and snippets behave as
  described on 2.6.2. They are standard and old, but none of this has been run
  on the machine.
- Lingo's actual memory use, which decides how many more sites fit.
- That Let's Encrypt will issue for a given `*.91-99-202-188.sslip.io` name. It
  is rate-limited per registered domain, and that domain is shared.

**How far the scripts were tested.** In the cloud session, with every path
redirected into a temp folder and `caddy` replaced by a stand-in:

- `new-site.sh --dry-run`: 13 cases pass — usage, not-yet-migrated Caddy, a
  valid request, port 3000, a non-numeric port, a bad or reserved name, a bad
  hostname or repo URL, a port or hostname already in a site file, an existing
  folder, and a port with something listening.
- `migrate-caddy.sh`: 12 cases pass — migrating, Lingo's block moved
  byte-for-byte, the backup, a second run changing nothing, the original put back
  when validation fails, and a missing Caddyfile refused.

**Never run for real:** the live path of `new-site.sh` (creating the user,
cloning, `npm`, `systemctl`, the real `caddy validate` and `reload`) and the real
Caddy reload in `migrate-caddy.sh`. Both need root on the actual server. Use
`--dry-run` first, and expect to read an error or two the first time.

Nothing in this file has been applied to the server.
