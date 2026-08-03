# cerro-bot

Telegram bot that monitors Cerro Catedral ski status (medios/pistas) via Puppeteer and notifies a chat when anything changes. Checks every 2 minutes.

## Requirements

- Ubuntu 24.04 (or similar recent Debian/Ubuntu)
- Node.js **≥ 22.12** (Puppeteer 25)
- System libraries for headless Chrome
- A Telegram bot token and chat ID

## Fresh Ubuntu 24.04 setup

### 1. System packages + Node 22

```bash
sudo apt update
sudo apt install -y git curl ca-certificates fonts-liberation \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcairo2 libcups2t64 \
  libdbus-1-3 libdrm2 libgbm1 libgtk-3-0t64 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils unzip
```

Install Node 22 with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
node -v   # should be v22.12+
```

### 2. App setup

```bash
git clone <your-repo-url> ~/cerro-bot
cd ~/cerro-bot
npm install
cp .env.example .env
nano .env
```

Fill in:

```
TELEGRAM_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
API_PUBLIC_KEY=your_api_public_key
```

Smoke test:

```bash
node index.js
```

You should see `Bot observer iniciado` and a Telegram startup message. Ctrl+C to stop.

If Chrome fails to launch:

```bash
npx puppeteer browsers install chrome
# or, as root, also install Chrome system deps:
# npx puppeteer browsers install chrome --install-deps
```

### 3. Keep it alive with systemd

Create `/etc/systemd/system/cerro-bot.service` (adjust `User`, paths, and the Node binary from `which node`):

```ini
[Unit]
Description=Cerro Catedral Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=franco
WorkingDirectory=/home/franco/cerro-bot
Environment=NODE_ENV=production
Environment=HOME=/home/franco
ExecStart=/home/franco/.nvm/versions/node/v22.14.0/bin/node index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cerro-bot
sudo systemctl status cerro-bot
journalctl -u cerro-bot -f
```

That restarts on crash and on reboot.

**Alternative:** `npm i -g pm2`, then `pm2 start index.js --name cerro-bot`, then `pm2 startup` and `pm2 save`.

## Ops

| Goal | Command |
|------|---------|
| Logs | `journalctl -u cerro-bot -f` |
| Restart | `sudo systemctl restart cerro-bot` |
| Stop | `sudo systemctl stop cerro-bot` |
| Update | `cd ~/cerro-bot && git pull && npm install && sudo systemctl restart cerro-bot` |

State is stored in `estado_catedral.json` next to the app so the bot can detect changes across restarts.
