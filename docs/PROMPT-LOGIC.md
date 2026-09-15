# Prompt logic and product intent

This document summarizes the creator's instructions and how they became product behavior. It is an edited requirements record, not a raw transcript. Account setup, credentials, private server details and login conversations are omitted.

## Intention

Bring useful research from **The Canadian Journal of Chemical Engineering** into a university Discord server. Make it easy to read a concise summary, identify an interesting result, credit its authors, and follow the original Wiley article. The purpose is research discovery and informed conversation among students.

## How the prompts evolved

1. **Start with journal sharing.** The initial idea covered chemical engineering and electrical/computer engineering journals, with issue PDFs and publisher links.
2. **Narrow the scope.** The creator removed the electrical/IEEE component. The final bot covers only the Canadian chemical-engineering journal.
3. **Use issue highlights.** An Issue Highlights PDF is sufficient; the bot does not need a full-issue PDF. When Wiley denies access, send summaries and original links, with authorized PDFs added later.
4. **Revise the writing style.** An early request for provocative icebreakers was explicitly replaced by plain, precise engineering summaries. No hot takes, debate invitations or invented controversy.
5. **Explain the evidence.** Highlight eye-catching facts without losing their context: distinguish experimental measurements, simulations, reviews and editorial opinions. Include important limits, units and conditions.
6. **Credit the source.** Put original author names at the end of every article summary. Show the first publication date when available, and identify the journal's editorial team with a source and verification date.
7. **Make installation useful immediately.** When added to a new server, send the current calendar month's issue plus the previous nine months, as separate messages. That final requirement means ten calendar months, superseding the earlier nine-post request.
8. **Keep maintenance quiet.** Scan every 24 hours. If there is no newly detected issue, send no post and make no edit. Preserve delivery history through restarts, renames and token replacement.
9. **Recover safely.** If delivery is interrupted, preserve confirmed posts and investigate uncertain receipts before retrying. A failed command reply must not disconnect the bot.

## Final acceptance criteria

| Requirement | Observable behavior |
|---|---|
| One journal | Only CJCE issue discovery is configured |
| Automatic onboarding | One message per available issue in the current month and nine prior months |
| Publisher links | Issue, highlights and highlighted-article links appear in each issue post |
| Accurate attribution | Author names end each summary; dates retain the source's precision |
| Factual language | Measured results retain units and context; simulated results are labeled |
| Honest gaps | Missing abstracts, PDFs or verified details are not filled with invented facts |
| Quiet daily scan | Delivered issues are skipped, even when metadata changes |
| Explicit updates | `/journal refresh` can update existing posts and attach available authorized PDFs |
| Moderator control | Channel selection, status, checks, pause, resume and recovery commands |
| Restart safety | Persistent message receipts prevent replaying completed history |

## Summary generation is bounded

The bot does not send these prompts to an AI model at runtime. Reviewed DOI-specific summaries are stored in `src/article-summaries.json`. New articles without reviewed summaries receive a short, explicitly labeled publisher-abstract excerpt; absent source text is reported. Editorial credits are a dated verified snapshot and require maintenance when staff changes.

## Install

[Add ccej_bot to your Discord server](https://discord.com/oauth2/authorize?client_id=1549241607386046516&scope=bot%20applications.commands&permissions=117776&integration_type=0). Installation requires Manage Server permission. A running host is required; GitHub stores the project but does not run the bot continuously.
