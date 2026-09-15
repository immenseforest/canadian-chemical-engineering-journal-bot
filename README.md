# Canadian Chemical Engineering Journal Bot

**Discord username:** `ccej_bot` (the service preserves your Discord rename)  
**Application name:** CanadianChemicalEngJournal_bot

## Why this app exists

Created by **wokewarrior / immenseforest** to make chemical-engineering research easier to follow in a university Discord server. It brings journal highlights into the place students already read, with enough concrete detail to help them decide which original articles to open. Discussion can follow naturally; the bot does not manufacture controversy or ask debate questions.

The product rules were developed through an iterative user-prompt conversation. See [Prompt logic and product intent](docs/PROMPT-LOGIC.md) for the decisions, revisions, and acceptance criteria, and [How it works](docs/ARCHITECTURE.md) for their implementation.

## Invite the bot

[Add the running bot to Discord](https://discord.com/oauth2/authorize?client_id=1549241607386046516&scope=bot%20applications.commands&permissions=117776&integration_type=0).

You need Discord's **Manage Server** permission to install it. No Administrator permission is requested for the bot.

Once installed, it creates `#chemical-engineering-journal` and posts one message for each issue in the **current calendar month plus the previous nine months**, oldest first. For an installation in September 2026, this is December 2025–September 2026. An early release with a future cover month waits until that month.

It then checks every **24 hours**. Delivery records survive restarts, so the initial ten messages are not repeated. If no new issue is found, it sends no messages and makes no edits. Previously delivered issues are skipped even if their metadata changes. The initial calendar range is preserved so a missed issue can be picked up later. Use the explicit `/journal refresh` command to update existing messages or add newly available authorized PDFs.

If channel creation is unavailable, the bot uses a writable journal channel, then the server's system channel, then another writable text channel. Use `/journal channel` to select a different destination.

### Every issue post includes

- Wiley issue and highlights links, plus direct links to highlighted articles.
- Plain factual summaries that distinguish experiments, simulations, reviews and editorials.
- Full author names **at the end of each article summary**, in publisher order, including name suffixes.
- Original first-online publication dates when supplied. Print dates and partial dates are explicitly labeled; metadata deposit timestamps are never substituted.
- Journal editorial credits with a linked source and verification date: João B. P. Soares, Editor-in-Chief; Kyra Van Den Bos, Managing Editor; Tiffany Noel, Production Editor; Jacob Lee, Editorial Coordinator. These are journal-level roles, not claims about who handled an individual paper.
- An authorized highlights PDF when available. A publisher access failure leaves a linked summary rather than blocking all posts.

## Moderator commands

Commands require Manage Server permission and reply privately to the moderator.

| Command | Action |
|---|---|
| `/journal status` | Destination, next daily scan, delivery status |
| `/journal channel destination:#channel` | Choose a destination and initialize its issue history |
| `/journal check` | Scan now, preserving duplicate protection |
| `/journal refresh` | Explicitly update existing posts and attach available authorized PDFs |
| `/journal pause` | Pause automatic posts |
| `/journal resume` | Resume and scan now |
| `/journal resolve issue:cjce:104:9 result:MESSAGE_ID` | Confirm an uncertain delivery after checking the channel |
| `/journal resolve issue:cjce:104:9 result:retry` | Retry only after checking that the previous operation was not delivered |

Changing the destination initializes that new channel's history; it does not delete messages from the previous channel. Keep the persistent data directory to preserve duplicate protection.

## Run your own copy

The shared invite uses the owner's running service. This ZIP is a self-hosted distribution for continuing that service or running your own Discord application. **Discord does not host bot code.** One computer or server must keep the process running. Do not run two copies of the same bot against different state directories.

### Windows: portable package

1. Extract the entire ZIP to a permanent folder. It includes Node.js and the Discord SDK; no package installation is needed.
2. Double-click `START-BOT.cmd`. On first start it prints a local Setup URL.
3. Open that URL and paste a **bot token** from Discord Developer Portal → your application → Bot. The token is verified and saved locally. It is not included in this distribution.
4. Follow the displayed invite link. Setup discovers the matching application ID, so it works for your own Discord application too.
5. Keep the process running. For automatic startup, run `INSTALL-AUTOSTART.ps1` in PowerShell from the extracted folder. It starts the bot hidden at Windows login and restarts it after a crash.

Windows needs the signed-in user and an available computer. When the computer wakes or the service restarts, an overdue scan catches up. Logs are in `data/installable/service.log`.

### Node.js on another operating system

Requires Node.js 22 or newer:

```sh
npm ci --omit=dev --ignore-scripts
npm run setup
npm start
```

### Docker

Set `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID` in `.env`. If cloning this repository, create `issues.json` containing `{}` (the portable package supplies it). Then:

```sh
docker compose up -d --build
docker compose logs -f
```

Docker uses a named volume for delivery state. Do not delete that volume if you want to retain duplicate protection. Docker deployment is provided but was not exercised on the Windows development host.

## Sources, summary coverage and PDFs

Public metadata comes from the publisher's Crossref deposits. Reviewed summaries are stored in `src/article-summaries.json`. Coverage includes December 2025–October 2026. New articles without reviewed entries use an explicitly labeled, short publisher-abstract extract. Missing source material is reported rather than replaced by an invented result. To add a reviewed summary, add its DOI and checked text to that JSON file.

Editorial names are a source-verified snapshot, dated in each post, not a promise that a future staffing change has been detected automatically. Update `src/credits.mjs` against [Wiley's editorial board](https://onlinelibrary.wiley.com/page/journal/1939019x/homepage/editorialboard.html) when roles change.

For authorized PDF downloads set `AUTO_WILEY_HIGHLIGHTS=true` and `WILEY_PDF_REDISTRIBUTION_ALLOWED=true` only when redistribution is covered. Wiley may require institutional access; the bot does not inherit your browser login. It still posts summaries and links. To attach a downloaded authorized PDF, put it in `pdfs/` and add a mapping to `issues.json`:

```json
{
  "cjce:104:9": {
    "path": "pdfs/cjce-104-9-highlights.pdf",
    "kind": "highlights",
    "redistributionAllowed": true,
    "permissionNote": "Describe the permission or license covering distribution."
  }
}
```

Use `/journal refresh` to attach it to the existing message. Ordinary daily scans leave existing posts untouched. Never distribute `.env`, bot tokens, saved server state or institutional session data. This package deliberately contains none of those.

## Renaming, token replacement and restarting

Renaming the bot in Discord does not require a code change. After resetting its token, run `npm run setup` (or `runtime/node.exe scripts/setup-bot.mjs` in the portable Windows package) and save the new token through the local form. Restart the Windows task `Canadian Chemical Eng Journal Bot`, or restart your Docker container. Keep `data/installable` intact: it contains the delivery records and scan schedule. Removing a bot from a server requires inviting it again; a token reset alone does not reinstall it.

## Development and verification

```sh
npm test
```

Tests cover author/date attribution, calendar boundaries, ten-message onboarding, daily scheduling, restart deduplication, multi-server isolation, late PDF edits and uncertain-delivery recovery. Discord transport uses the official `discord.js` SDK with the Guilds intent only; it does not read member chat or require privileged intents.

Bundled software retains its original license files. See `runtime/NODE-LICENSE.txt` and licenses inside `node_modules/`.

### Build the portable Windows ZIP

On Windows, install Node.js 22 and Python 3, run `npm ci --omit=dev --ignore-scripts`, then `python scripts/package-turnkey.py`. It bundles source, documentation, dependencies and the Node executable found on PATH (or specified by `NODE_BINARY`). The bundled Node license is in `licenses/NODE-LICENSE.txt`. Output goes to `output/`; credentials and delivery data are excluded. Use a Windows Node executable for the Windows package.
# Alternate thread version

Run `npm run start:threads` or double-click `START-THREADED-BOT.cmd` for one thread per issue, with the introduction first and one message per article. See [thread version setup and recovery](docs/THREADED-VERSION.md). The alternate service uses its own Discord application and `/journal-threads` commands.
