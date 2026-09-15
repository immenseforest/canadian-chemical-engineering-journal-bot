# Research Journal Hub

One Discord coordinator manages five independent journal profiles. There is one application to install and one set of commands to learn. Journals are subscriptions, not separate Discord accounts.

## Start in Discord

Use `/journals help` for the complete guide. Use `/journals catalog`, then `/journals add` to choose a journal and an **existing text channel**. Only that explicit command subscribes a new journal. The bot never creates channels automatically. For chemical engineering, `history:0` (the default for new subscriptions) means the current month plus the previous nine calendar months. Values 1–9 mean the current month plus that many preceding months; `history:9` therefore covers the same ten-month window as zero. The calendar follows `JOURNAL_TIME_ZONE`, including year boundaries. Other journals retain their previous-issue count semantics, with zero meaning latest only. New installations have no subscriptions.

The scan reports the total available issue threads as well as newly created and already-present counts. Repeating the command reuses existing threads. Temporary Windows/OneDrive sharing locks are retried during atomic state saves.

[Invite the live coordinator](https://discord.com/oauth2/authorize?client_id=1549241607386046516&scope=bot%20applications.commands&permissions=309237763072&integration_type=0). Self-hosted instances can print their own matching invite using `npm run invite`.

| ID | Journal | Source handling |
|---|---|---|
| cjce | The Canadian Journal of Chemical Engineering | Original Wiley Issue Highlights, reviewed summaries, editorial team and authorised PDF logic |
| cjece | IEEE Canadian Journal of Electrical and Computer Engineering | Journal metadata, selected articles and optional IEEE abstracts |
| gji | Geophysical Journal International | Oxford University Press metadata and abstracts; open access since 2024 |
| ojcs | IEEE Open Journal of the Computer Society | Continuous volume threads; open access |
| ijfp | International Journal of Fluid Power | River Publishers metadata and abstracts; publication-month collections when issue metadata is missing |

The chemical-engineering profile is deliberately distinct. Its reviewed summary file, source selection and editorial credit functions are reused without modification. Wiley editorial names and PDF labels are not applied to other journals. All profiles share the concise article summary style, author/date attribution and one-message-per-article navigation. Journals without publisher-selected highlights are labelled “Selected articles.”

## Commands

- `/journals help`: introduction and complete command guide.
- `/journals catalog`: five built-in journal profiles.
- `/journals add`: choose a journal and channel, optional history and open-access-only filter. Reusing this command can change the channel or expand the history window. Delivery receipts are retained separately for each channel, so switching back does not duplicate its threads.
- `/journals add-link`: choose a channel, then paste an IEEE Xplore link in the form. Known links resolve immediately. For unfamiliar journals, an optional ISSN from the journal page works without an IEEE key. Otherwise configure the key once for automatic journal identification. Custom subscriptions filter for confirmed open-access articles.
- `/journals list`: subscription IDs, channels and state.
- `/journals status`: next scans, errors and uncertain deliveries.
- `/journals check`: check one subscription or all of them.
- `/journals pause`, `/journals resume`: control one subscription.
- `/journals remove`: stop a subscription; keep its messages and threads. Adding the same journal/channel again resumes it without losing history.
- `/journals resolve`: after checking the channel, supply the pending issue's actual thread/message ID, or `retry` only if the operation did not succeed.
- `/journals intro`: repost the guide in a selected channel.

Only server managers can change subscriptions or trigger posting. The introduction is sent once to an existing writable channel after installation. If no such channel exists, use `/journals help`. Posting needs View Channel, Send Messages, Read Message History, Embed Links, Create Public Threads and Send Messages in Threads. Chemical-engineering PDF attachments also need Attach Files.

## Runtime and data

Run `npm start` (or `npm run start:hub`). By default it upgrades the configured `DISCORD_BOT_TOKEN` identity; stop the original service before starting it. For Windows login startup, use `INSTALL-HUB-AUTOSTART.ps1` after stopping the older service. Set `HUB_DISCORD_BOT_TOKEN` and `HUB_DISCORD_APPLICATION_ID` in `.env.hub` to use a separate identity instead. Do not start two processes under the same bot identity. Runtime locks prevent the hub and original service from running together with the original token. The standalone original is available with `npm run start:legacy`.

Run `npm run migrate:hub` once when upgrading the existing bot. It copies the selected chemical-engineering channel and sent receipts, leaving original state untouched. Old channel messages remain available, but do not count as thread deliveries: the next check creates threads for the selected issue/history window and retains the original message IDs for reference. Other journals remain unsubscribed until explicitly added. State is stored in `data/hub`, or `HUB_BOT_STATE_DIR`. Logs from the service runner go to `data/hub/service.log`.

Checks run every 24 hours and source results are cached for an hour across servers. Confirmed Discord IDs are saved after every operation. Unknown outcomes stop that subscription for review. A source failure does not prevent other subscribed journals from checking. Wiley issues include all publisher-highlighted articles; the fallback selects up to four articles. Continuous volume/collection threads initially select four recent articles, then append up to four newly discovered articles per check without replacing shared messages.

## Metadata and summary limits

Public Xplore pages block unattended page fetching in this environment. The hub uses publisher-deposited Crossref metadata for the built-in journals. Set `IEEE_XPLORE_API_KEY` privately in `.env.hub` to resolve unfamiliar publication numbers and retrieve IEEE abstracts. It uses the official API and never attempts to bypass publisher access controls.

Without that key, IEEE papers whose Crossref metadata omits abstracts retain the original bot's “verified summary is not yet available” wording. Other unseen papers use the existing labelled 24-word publisher abstract extract. No language-model API or paid generation is required. A readable article or an Xplore listing does not itself prove open access: the optional filter uses known fully-open journal policy, IEEE access metadata or an effective Creative Commons licence. No new journal PDFs are redistributed automatically.

Thread titles use the journal abbreviation, supplied volume/issue and supplied cover month/year. A missing month is explicitly labelled; continuous publications use annual volume threads, and articles without volume/issue metadata use labelled publication-month collections. Months, issues and results are never inferred from DOI strings.

Sources: [IEEE metadata fields](https://developer.ieee.org/docs/read/Metadata_API_responses), [IEEE API access](https://developer.ieee.org/io-docs), [GJI open-access policy](https://academic.oup.com/gji/pages/gji-open-access), [River Publishers journal catalogue](https://elibrary.riverpublishers.com/).

## IEEE metadata key and request limits

The bot owner can use /journals api-key to open a private form, validate a replacement key, and activate it without restarting. Other server managers cannot change this shared credential. The key is stored only in ignored local data/hub/ieee-key.json; it is never posted or committed. This command changes the IEEE metadata key, not the Discord bot token.

IEEE requests share a persistent 24-hour cache and a per-key rolling limit of 200 calls in 24 hours. Requests are serialized at least 110 ms apart (under 10 per second); failures count too. The budget covers this installation only, so avoid using the same key in other applications. HTTP 401/403 pauses requests for an hour; HTTP 429 pauses them for 24 hours.

Crossref remains the paginated issue-discovery source. Up to 200 recently indexed IEEE records per journal supplement abstracts and access labels; missing selected IEEE abstracts use DOI lookups under the same budget. Wiley discovery and wording remain separate. If IEEE is unavailable, Crossref metadata remains usable; missing abstracts stay explicitly labelled. An IEEE Developer Inactive response requires account activation at developer.ieee.org.
