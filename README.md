<img width="1992" height="1127" alt="image" src="https://github.com/user-attachments/assets/5fc03258-955a-47df-a65f-84bef7c2b984" />




# PD2 SP Armory

Web-based character viewer for Project Diablo 2 singleplayer. Drop your `.d2s` save files in and browse your characters — equipment, inventory, stats, and skills — with Diablo II-styled item tooltips and wiki item images.

PD2 data files and wiki images are included — just clone, install, and run.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+

### Install & Run

```bash
git clone https://github.com/bmberirl/pd2-sp-armory.git
cd pd2-sp-armory
npm install
```

Point `SAVES_DIR` at your PD2 save folder and start the server:

```bash
# Windows Command Prompt
set SAVES_DIR=C:\Program Files (x86)\Diablo II\Save
node server.js

# PowerShell
$env:SAVES_DIR = "C:\Program Files (x86)\Diablo II\Save"
node server.js
```

Or simply copy your `.d2s` files into the `saves/` folder and run:

```bash
node server.js
```

Open **http://localhost:3001** in your browser. Characters appear automatically and update live via WebSocket when save files change.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `SAVES_DIR` | `./saves` | Directory containing `.d2s` save files |
| `DATA_DIR` | `./data` | Directory containing PD2 TXT data files |

## Linux Server Deployment

For running the armory on a separate Linux machine (e.g. always-on home server):

```bash
chmod +x setup.sh
sudo ./setup.sh
```

This installs the armory to `/opt/pd2-armory`, sets up a systemd service, and installs npm dependencies. Then start it:

```bash
sudo systemctl start pd2-armory
journalctl -u pd2-armory -f   # view logs
```

### Syncing Saves from Windows

Use the included sync scripts to copy `.d2s` files from your Windows PC to the Linux server via SCP:

- **`sync-saves.bat`** — One-shot sync (double-click or schedule via Task Scheduler)
- **`sync-saves.ps1`** — PowerShell with `-Watch` mode for continuous sync
- **`sync-saves.vbs`** — Silent wrapper for `sync-saves.bat` (no console window)

Edit the scripts to set your server IP and save directory before use.

## Twitch Extension

Show your PD2 characters live on your Twitch channel as a panel extension. Viewers can browse your equipped items, stats, and skills directly from your stream page.

### How It Works

1. Your PD2 Armory server watches for save file changes
2. When you Save & Exit in PD2, the server pushes character data to a cloud backend (Cloudflare Worker)
3. The Twitch panel extension fetches and displays your characters to viewers

### Setup

#### 1. Install the PD2 Armory server

Follow the [Quick Start](#quick-start) above to get the server running locally.

#### 2. Install the Twitch Extension

Go to your Twitch channel and install the **PD2 Armory Singleplayer** extension from the Extensions menu. Add it as a **Panel** under your stream.

#### 3. Get your credentials

Open the extension's **Configure** page (gear icon on the extension in your Twitch dashboard). Your unique credentials will be generated automatically:

```
TWITCH_CHANNEL_ID=your_channel_id
TWITCH_PUSH_SECRET=your_unique_token
TWITCH_EBS_URL=https://ebs.bmberirl.com
```

#### 4. Configure your server

Add the three environment variables to your server. If running via systemd on Linux:

```bash
sudo mkdir -p /etc/systemd/system/pd2-armory.service.d
sudo tee /etc/systemd/system/pd2-armory.service.d/twitch.conf << 'EOF'
[Service]
Environment=TWITCH_CHANNEL_ID=your_channel_id
Environment=TWITCH_PUSH_SECRET=your_unique_token
Environment=TWITCH_EBS_URL=https://ebs.bmberirl.com
EOF
sudo systemctl daemon-reload
sudo systemctl restart pd2-armory
```

If running directly with Node.js on Windows:

```bash
# PowerShell
$env:TWITCH_CHANNEL_ID = "your_channel_id"
$env:TWITCH_PUSH_SECRET = "your_unique_token"
$env:TWITCH_EBS_URL = "https://ebs.bmberirl.com"
node server.js
```

#### 5. Play PD2

Save & Exit in PD2 — your characters will appear in the Twitch panel within seconds. The panel auto-refreshes every 2 minutes.

## Updating Wiki Images

To re-download or update wiki images:

```bash
node download-wiki-images.js
```

This fetches PNGs from the PD2 wiki into `public/img/wiki/`. It skips existing files, so it's safe to re-run.
