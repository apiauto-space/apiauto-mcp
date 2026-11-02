# Security policy

## Reporting a vulnerability

Please do not open a public GitHub issue for security problems in this package or in the
apiauto.space API. Report them privately through the support chat of the Telegram bot
[@apiautospace_bot](https://t.me/apiautospace_bot): describe the problem, how to reproduce it
and which version of `apiauto-mcp` you use. We reply within a few working days.

Never send your API key in a report. If a key may have leaked, rotate it in the bot right away:
the old key keeps working for 24 hours so you can switch without downtime.

## Supported versions

Security fixes go into the latest published version of `apiauto-mcp`.

## What this server protects against

| Threat | Protection |
|---|---|
| The API key leaks | Read only from `APIAUTO_API_KEY`, sent only in a header, removed from results, errors and logs, also when the upstream echoes it; a malformed key is never sent |
| Key or data sent to another host | One fixed host over HTTPS; no tool takes a URL; redirects are not followed |
| A crafted id or query changes the request | Strict input schema, encoding, and a check of the final URL against a list of paths |
| A listing carries instructions for the model | Listing text stays inside `data` as JSON under an explicit notice; hidden characters are removed |
| A listing carries a link or an image that leaks data when rendered | Markdown images and links and URLs other than the API's photos and the sources' pages become `[link removed]`, in every field and field name; `listing_url` is checked and normalized |
| A huge or hanging answer | Timeouts, a response size limit counted after decompression, a limit on what is returned to the model; a client's cancellation stops the request and its retries |
| Quota spent unnoticed | 5 records by default, 20 at most, 10 with `detail=full`; no automatic paging; cost and quota left in each result; an optional cap per process |
| Quota spent twice | A paid request whose outcome is unknown (lost connection, timeout, 500, 502, 504) is not retried, and the error says to check `get_usage` before repeating; only 429, 503 and connections that never opened are retried |
| A malicious dependency update | Exact versions; the whole tree locked with hashes by `npm-shrinkwrap.json`; no install scripts in the tree |
| A tampered release | Versions after 0.1.0 are published from GitHub Actions with npm provenance, from a tag on `main`, after a reviewer's approval. 0.1.0 is published by hand and has no provenance |

## What it cannot do

Marking text as untrusted lowers the risk of prompt injection and does not remove it: the model still reads the text. A bare domain without a scheme stays as text. Use a client that asks before calling tools, and do not give the same assistant dangerous tools while it reads listings.

Paid tools carry `readOnlyHint` because they change nothing, and a client may run such tools without asking. `APIAUTO_MAX_RECORDS_PER_SESSION` puts a cap on what one process can spend.

The key sits in your MCP client's config file in plain text, which is how these clients work today. Protect that file and keep it out of git.

`npx` resolves a command from the current folder first, so a hostile project could replace this server when your client starts it there. See "Working in someone else's repository" in the README.
