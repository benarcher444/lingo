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
| Backups | Tick it (+20% of the price): daily whole-disk snapshots, kept 7 days. That is the off-server copy of the nightly database backups. |

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
apt install -y nodejs git caddy
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
sudo -u lingo cp allowed_emails.example.csv allowed_emails.csv
nano allowed_emails.csv
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

---

## Day to day

| To… | Run |
|---|---|
| Update to the latest code (after pushing from the laptop) | **laptop:** `ssh root@<server-ip> bash /opt/lingo/deploy/deploy.sh` |
| Invite someone | **laptop:** `ssh root@<server-ip> nano /opt/lingo/allowed_emails.csv` |
| Unlock an account (5 wrong passwords) | **server:** `cd /opt/lingo && sudo -u lingo -H npm run unlock -- them@example.com` |
| Reset a forgotten password (also unlocks) | **server:** `cd /opt/lingo && sudo -u lingo -H npm run set-password -- them@example.com 'new password'` |
| Watch the logs | **server:** `journalctl -u lingo -f` |
| Download a backup | **laptop:** `scp root@<server-ip>:/opt/lingo/data/backups/app-YYYY-MM-DD.db .` |

**Backups.** A consistent copy goes to `/opt/lingo/data/backups/` nightly at
03:30 and before every deploy, and the last 14 are kept. Hetzner's daily
snapshots then hold them off the server.

**Restoring.** Stop the service with `systemctl stop lingo`. Copy the backup
over `data/app.db`, delete `data/app.db-wal` and `data/app.db-shm`, then
`chown lingo:lingo data/app.db` and `systemctl start lingo`.

## When something is wrong

- **The site shows 502.** The app is not running. Check `systemctl status lingo`
  and `journalctl -u lingo -n 50`.
- **Certificate errors.** DNS does not point here yet, or port 80 is blocked by
  the firewall. Check `journalctl -u caddy -n 50`.
- **"Nobody can sign up" in the log.** `allowed_emails.csv` is missing or empty.
