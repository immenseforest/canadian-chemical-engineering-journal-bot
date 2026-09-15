# How it works

1. `service.mjs` connects to Discord using the Guilds intent and registers moderator commands.
2. `journals.mjs` retrieves publisher metadata from Crossref and matches Issue Highlights references to articles.
3. `calendar.mjs` selects assigned issues from the onboarding month range, excluding future cover months.
4. `discord.mjs` combines reviewed summaries or labeled abstract excerpts with author, publication-date and editorial credits.
5. `attachments.mjs` and `highlights.mjs` attach authorized local or accessible Wiley highlights PDFs. Access failures do not prevent linked summaries.
6. `service-core.mjs` records a pending delivery before sending, then saves Discord's message ID. Already-delivered issues are skipped on ordinary scans.
7. `state.mjs` writes persistent state atomically and locks concurrent access. Uncertain deliveries require receipt inspection rather than blind retries.

The schedule is 24 hours per configured server. A minute timer checks whether a scan is due; it does not publish minute-by-minute status messages. Moderator command replies are ephemeral. Command failures are caught, and the Windows runner logs both process output streams and exit status.

## Hosting and state

Use Node.js 22+, the portable Windows package, or the supplied Docker configuration. Keep one active instance per bot and retain its data directory when migrating. Secrets belong in `.env`, not Git. The public repository contains no live server receipts, institutional sessions or PDFs.

## Verification

Run `npm ci --omit=dev --ignore-scripts` and `npm test`. Tests cover calendar selection, summaries and attribution, quiet repeat scans, partial delivery recovery, PDF failures, event-handler errors and background logging. Live hosting availability is separate from code correctness.
