# Alternate issue-thread bot

Run `npm run start:threads` from the project directory, or run `INSTALL-THREADED-AUTOSTART.ps1` once to start it at login. This alternate service shares the original metadata, article selection, reviewed summaries, abstract fallback, author credits, dates and PDF attachment logic.

Each issue gets one public thread inside the configured text channel:

`Can. J. Chem. Eng. · Vol. 104 · Issue 9 · September 2026`

The first message contains the original issue introduction, publisher links, editorial credit and available PDF. Each following message contains one article and its original summary and credits. Long author-credit continuation fields stay in that article's message.

## Running

Create a separate Discord application and bot. Store its `THREAD_DISCORD_BOT_TOKEN` and `THREAD_DISCORD_APPLICATION_ID` in `.env.threads`. The original `.env` still supplies shared publisher and PDF settings. Both versions can then run concurrently. Use `npm run invite:threads` after saving the application ID. Starting this version initializes its own history (current issue plus nine previous months), so choose the destination deliberately before starting. Existing message history is not migrated.

State defaults to `data/threaded`; override with `THREAD_BOT_STATE_DIR`. The default channel name is `chemical-engineering-journal-threads`. The alternate bot registers `/journal-threads channel`, `check`, `refresh`, `pause`, `resume`, `resolve` and `status`. Automatic channel selection follows the original bot, including fallback to a writable channel if it cannot create its default channel.

Grant View Channel, Send Messages, Read Message History, Embed Links, Create Public Threads and Send Messages in Threads; Attach Files is needed for PDFs. Manage Channels enables automatic channel creation. The startup invite includes the thread permissions. Discord documents thread permissions at https://docs.discord.com/developers/topics/threads.

## Recovery and refresh

Each confirmed thread and message ID is saved before continuing. Daily scans skip delivered issues. `/journal-threads refresh` edits saved message IDs in the same thread and retains a previously attached PDF if unavailable on refresh. Archived threads are reopened when work is needed; locked threads may require moderator intervention.

If a connection fails with an unknown outcome, posting pauses. `/journal-threads status` identifies the issue, operation type and thread ID. Inspect that thread (or the parent channel when thread creation is uncertain), then use `/journal-threads resolve issue:cjce:104:9 result:ID` with the actual thread or message ID for the pending operation. Use `result:retry` only after confirming that operation did not succeed. Run `/journal-threads check` to continue. Never delete state to retry a partial delivery.

The existing renderer's Discord size limits still apply. An oversized issue fails before creating a thread, preserving wording rather than truncating it. If source content changes while an issue is partially delivered, restore the prior source data/PDF before resuming.

If a refresh changes the selected articles or their order, delivery stops for review to preserve existing article links and discussion context.

This version has automated delivery tests; no live Discord posts are made by the tests.
