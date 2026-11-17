# Running S-ERP: office server or server edition

S-ERP comes as one program that can be run in two ways. Both use the same screens and the same data, and you can move from one to the other later by restoring a backup. Staff on other computers, tablets and phones use S-ERP in a web browser (Chrome, Edge, Safari). They can also "Install app" from the browser menu to get an icon.

| | **Option 1 – Office server** (desktop app) | **Option 2 – Server edition** |
|---|---|---|
| What it is | The normal S-ERP installer on one office PC. Tick *Settings → Access & security → This computer is the office server*. | S-ERP runs as a background service on a server: Windows (the same installer, then *Install S-ERP Server*), Linux, or Docker / cloud. |
| Starts | When someone signs in to that PC (S-ERP starts with Windows and waits in the tray) | When the server starts. No one needs to sign in, and it restarts itself if it stops. |
| Database | Built-in MySQL 8, backed up every day (14 days kept) | Built-in MySQL (Windows, 30 days of backups) or your own MySQL / MariaDB server |
| HTTPS | Through a secure tunnel or VPN (see below) | Built in: load your certificate (.pfx or .pem), or put Caddy / IIS / nginx in front |
| Users | Up to about 25 people at one site | Many sites and many users |
| Best for | Shops, restaurants, bars, clinics, schools, small companies and NGOs: one site, no IT staff | Companies with branches or depots, parastatals and utilities (e.g. water), government bodies, organisations with an IT team, anyone whose staff must work from anywhere |
| Needs | A Windows 10/11 PC that stays on during working hours | A server or VM (Windows Server 2016+ or Linux, 4 GB RAM or more), a fixed address, ideally a domain name |

## Option 1 – Office server

1. Install S-ERP on the PC that will hold the data, choose *Use the built-in database* and finish the set-up wizard **on that PC**.
2. Go to *Settings → Access & security* and tick **This computer is the office server**.
3. Other computers open the address shown there, e.g. `http://192.168.1.20:8069`. Other PCs with S-ERP installed can also choose *Connect to a server* on their first start.
4. Closing the window keeps S-ERP running in the tray. Use *Stop S-ERP* in the tray menu to really stop it.

## Option 2 – Server edition

### Windows Server
1. Run the S-ERP installer as an administrator. Install into `C:\Program Files\S-ERP` (not a user folder).
2. Start menu → *S-ERP → Server edition → Install S-ERP Server* → right-click → *Run as administrator*. This:
   - registers a background task that starts with Windows as SYSTEM and restarts itself if it stops;
   - opens the firewall for ports 8069, 80 and 443;
   - creates `C:\ProgramData\Maluti ERP\server.json` (settings), where the database, backups and `server.log` are also kept.
3. On the server open `http://localhost:8069` and complete the set-up wizard. The wizard only runs from the office network or with the set-up key.
4. **HTTPS:** put your certificate in `server.json` and run *Restart S-ERP Server*:
   ```json
   { "port": 443, "http_redirect_port": 80,
     "tls": { "pfx_file": "C:\\certs\\erp.pfx", "passphrase": "…" },
     "db": { "embedded": true } }
   ```
   PEM files work too: `"tls": { "cert_file": "…fullchain.pem", "key_file": "…privkey.pem" }`.
5. To use your own MySQL server, replace `"db"` with `{ "host": "…", "port": 3306, "user": "…", "password": "…", "database": "maluti_erp" }`.

### Linux / cloud (Docker)
```
cp .env.example .env        # set the passwords, MALUTI_SETUP_KEY and PUBLIC_DOMAIN
docker compose --profile https up -d
```
Caddy gets a free certificate for `PUBLIC_DOMAIN` automatically. Without Docker: `npm ci --omit=dev && npm run server` with the same environment variables (`DB_HOST`, `MALUTI_TLS_CERT`, `MALUTI_TLS_KEY`, `MALUTI_SETUP_KEY`…; see the top of `server/standalone.js`).

## Signing in from anywhere

Choose one way in:

* **Private network (VPN)**: Tailscale, WireGuard or your company VPN on the server and on staff laptops and phones. Nothing is opened to the internet. Works with option 1 and 2.
* **Secure tunnel**: Cloudflare Tunnel (`cloudflared`) on the server PC gives an https address such as `https://erp.yourcompany.co.ls` without changing the router. Works with option 1 and 2.
* **Your own domain**: point a domain name at the server, open port 443 and use the built-in HTTPS or Caddy / IIS. Server edition.

S-ERP always knows whether someone is in the office. It uses the office networks listed in *Settings → Access & security*; people coming through a tunnel, a proxy or the internet count as "away from the office". Away from the office:

* **Two-step sign-in:** a code from an authenticator app (Microsoft Authenticator, Google Authenticator, Authy) is required. By default this applies to managers, accountants and auditors; you can require it for everyone, or always. People set it up themselves at their first sign-in by scanning a QR code.
* **Who may sign in:** everyone, only chosen roles, or nobody.
* **No PIN sign-in:** the staff PIN screen and the staff list are not shown; people sign in with username and password.
* **Shorter sessions:** they end after 12 hours, or after 60 idle minutes (both can be changed).
* **Lock-out:** after 5 wrong passwords an account is locked for 15 minutes.
* **Sessions:** everyone can see where they are signed in (*My account*) and sign other devices out. Administrators see all sessions and can end them, or reset two-step sign-in for someone who lost their phone (*Settings → Users*).
* **Audit:** every sign-in, failed attempt and change is in the audit trail with its address.

The *Access & security* page shows a checklist of what to finish before staff work from outside: HTTPS, the public address, two-step sign-in, no PIN from outside, idle sign-out, lock-out and daily backups.
