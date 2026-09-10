# Deploying Lingo to Hetzner

The result: `https://lingo.<your-domain>`, served from a Hetzner Cloud server
for roughly €4–5 a month. Caddy sits in front for HTTPS, the app runs as a
systemd service, and the database is backed up nightly.

Allow about an hour the first time. After that, updating is one command.

Commands marked **laptop** run in PowerShell in the project folder; commands
marked **server** run after `ssh root@<server-ip>`.

---

## Before you start

- **A domain.** Any registrar will do (Cloudflare sells at cost). The app only
  needs one subdomain, such as `lingo.yourdomain.com`.
- **A Hetzner Cloud account** at <https://console.hetzner.cloud>.
- **An SSH key on the laptop.** Check with `ls ~/.ssh/*.pub`. If there is
  none, run `ssh-keygen -t ed25519` and press Enter through the prompts. A
  passphrase is optional but sensible.

## 1. Create the server

In the Hetzner console: **New project → Add server**.

| Setting | Choose |
|---|---|
| Location | Falkenstein or Nuremberg — closest to the UK |
| Image | Ubuntu 24.04 |
| Type | The smallest shared plan (e.g. CX22 on Intel/AMD, or CAX11 on ARM). Either works: both compiled dependencies ship builds for both. |
| SSH key | Paste the contents of `~/.ssh/id_ed25519.pub`. With a key added, root password login is off. |
| Firewall | Create one allowing inbound TCP **22, 80, 443**. Everything else is dropped before it reaches the server. |
| Backups | Optional (+20% of the price): daily whole-disk snapshots kept 7 days, the one copy that survives losing the server. You can switch it on later from the server's Backups tab. |

Name it `lingo`, create it, and note its **IPv4 address**.

## 2. Point the domain at it

In your registrar's DNS settings, add an `A` record: name `lingo`, value the
server's IPv4 address. Add an `AAAA` record for its IPv6 address too, if you
like.

Caddy can only get a certificate once this resolves. Check it from the laptop
with `nslookup lingo.yourdomain.com`.

## 3. Base software — server

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
# build-essential and python3 are there in case argon2 or better-sqlite3 has
# to compile its native module rather than use a prebuilt one.
apt install -y nodejs git caddy build-essential python3
node --version                          # v24.x
systemctl status unattended-upgrades    # security updates install themselves
```

## 4. The app, under its own unprivileged user — server

```bash
adduser --system --group --no-create-home --home /opt/lingo lingo
mkdir -p /opt/lingo && chown lingo:lingo /opt/lingo
sudo -u lingo -H git clone https://github.com/benarcher444/lingo.git /opt/lingo
cd /opt/lingo
sudo -u lingo -H npm ci --omit=dev
sudo -u lingo mkdir -p data
```

## 5. Configuration — server

```bash
sudo -u lingo cp env.example .env && chmod 600 .env
nano .env
```

Set at least these:

```
HOST=127.0.0.1              # only Caddy, on this machine, may reach the app
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Then the invite list, one address per line:

```bash
sudo -u lingo nano allowed_emails.csv    # "email,ai" header, then e.g. you@example.com,yes
```

Edits to this list take effect immediately, with no restart. It is gitignored:
the repository is public, and these are people's email addresses.

## 6. Bring your words and history across

**Laptop:**

```powershell
npm run backup
scp data/backups/app-YYYY-MM-DD.db root@<server-ip>:/opt/lingo/data/app.db
```

**Server:** `chown lingo:lingo /opt/lingo/data/app.db`

From here the server's copy is the real one. Stop practising on the laptop's,
or the two will drift apart.

## 7. Start it — server

```bash
cp deploy/lingo.service deploy/lingo-backup.service deploy/lingo-backup.timer /etc/systemd/system/
install -m 755 deploy/deploy.sh /usr/local/bin/lingo-deploy     # the update command
systemctl daemon-reload
systemctl enable --now lingo lingo-backup.timer
systemctl status lingo        # active (running)
journalctl -u lingo -n 20     # expect "Sign-up is open to 1 invited address"
```

## 8. HTTPS — server

```bash
sed "s/lingo.example.com/lingo.yourdomain.com/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl reload caddy
```

Open `https://lingo.yourdomain.com`. The very first load can take a few
seconds while Caddy fetches the certificate. Then sign in.

## 9. Deploy on every push — GitHub Actions

`.github/workflows/deploy.yml` checks each push to `main` (the typecheck and
unit tests). If they pass, it logs in to the server and runs `lingo-deploy`. The
key it uses can run that one command and nothing else, and `lingo-deploy` is a
copy installed by hand, so a push cannot change what runs as root.

**Laptop.** Make a key just for GitHub. Press Enter at both passphrase prompts
to leave it empty, because Actions cannot type one:

```powershell
ssh-keygen -t ed25519 -C github-deploy -f $HOME\.ssh\lingo_deploy
Get-Content $HOME\.ssh\lingo_deploy.pub        # the public half, for the server
ssh-keyscan -t ed25519 <server-ip>             # the server's identity, for GitHub
```

**Server.** Let that key run the deploy and nothing else. Paste the public key
in place of `ssh-ed25519 AAAA… github-deploy`:

```bash
echo 'command="/usr/local/bin/lingo-deploy",restrict ssh-ed25519 AAAA… github-deploy' >> /root/.ssh/authorized_keys
```

**GitHub.** In the repo, go to **Settings → Secrets and variables → Actions**.

| Secrets tab | Value |
|---|---|
| `DEPLOY_HOST` | the server's IPv4 address |
| `DEPLOY_SSH_KEY` | the **private** key. Copy it with `Get-Content $HOME\.ssh\lingo_deploy -Raw \| Set-Clipboard` |
| `DEPLOY_KNOWN_HOSTS` | the line `ssh-keyscan` printed |

| Variables tab | Value |
|---|---|
| `DEPLOY_ENABLED` | `true` |

Until `DEPLOY_ENABLED` is set, pushes run the checks and skip the deploy. To
test it, push a commit or use **Actions → Deploy → Run workflow**, and watch it
finish with "✓ Lingo is up".

---

## Day to day

| To… | Run |
|---|---|
| Update to the latest code | Push to `main`: GitHub Actions deploys it (step 9). By hand: **laptop:** `ssh root@<server-ip> lingo-deploy` |
| Change `deploy/deploy.sh` itself | **server:** `install -m 755 /opt/lingo/deploy/deploy.sh /usr/local/bin/lingo-deploy` — the installed copy is what runs |
| Invite someone | **laptop:** `ssh root@<server-ip> nano /opt/lingo/allowed_emails.csv`. Add `them@example.com,yes` to let them use Conversation, or `,no` for everything but. |
| Unlock an account (5 wrong passwords) | **server:** `cd /opt/lingo && sudo -u lingo -H npm run unlock -- them@example.com` |
| Reset a forgotten password (also unlocks) | **server:** `cd /opt/lingo && sudo -u lingo -H npm run set-password -- them@example.com 'new password'` |
| Watch the logs | **server:** `journalctl -u lingo -f` |
| Download a backup | **laptop:** `scp root@<server-ip>:/opt/lingo/data/backups/app-YYYY-MM-DD.db .` |

**Backups.** Consistent copies go to `/opt/lingo/data/backups/`:

- **nightly at 03:30:** `app-<date>.db`, 14 kept, from `lingo-backup.timer`. It
  runs at the next boot if the server was off at 03:30.
- **before every deploy:** `pre-deploy-<date>T<time>.db`, 10 kept. These are
  named apart from the nightly copies, so a run of deploys cannot push them out.

Check them with `systemctl list-timers lingo-backup.timer` (next run),
`journalctl -u lingo-backup` (past runs) and `ls /opt/lingo/data/backups`.

These all sit on the server's own disk. They undo mistakes, but they don't
survive losing the server. For that, turn on Hetzner Backups, or download a
copy now and then.

**Restoring.** Stop the service with `systemctl stop lingo`. Copy the backup
over `data/app.db`, delete `data/app.db-wal` and `data/app.db-shm`, then
`chown lingo:lingo data/app.db` and `systemctl start lingo`.

## When something is wrong

- **The site shows 502.** The app is not running. Check `systemctl status lingo`
  and `journalctl -u lingo -n 50`.
- **Certificate errors.** DNS does not point here yet, or port 80 is blocked by
  the firewall. Check `journalctl -u caddy -n 50`.
- **"Nobody can sign up" in the log.** `allowed_emails.csv` is missing or empty.
