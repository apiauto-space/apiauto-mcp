# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-11-03

### Added

- Read-only MCP server over stdio for the apiauto.space API v1: `search_cars`, `get_car`,
  `get_changes`, `list_brands`, `list_models`, `get_dictionaries`, `get_markets`, `get_usage`.
- 5 records per call by default, 20 at most, 10 with `detail=full`, explicit paging by cursor, and
  `records_charged`, `records_returned` and the quota left in each result.
- Optional `APIAUTO_MAX_RECORDS_PER_SESSION` cap on the records one server process can spend.
- Listing text returned as marked untrusted data, cleaned of hidden characters, with Markdown
  images and links and foreign URLs replaced by `[link removed]`.
- Timeouts, a response size limit, cancellation, and bounded retries that do not repeat a request
  that may already have been charged.

[0.1.0]: https://github.com/apiauto-space/apiauto-mcp/releases/tag/v0.1.0
