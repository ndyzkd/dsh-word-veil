# Security and privacy

## Data location

- Wordbook, inbox, and backups: `~/.dsh/plugins-data/dsh-word-veil/`.
- Data never leaves the machine. The plugin has no telemetry and makes no runtime network requests.

## Auto-capture

- Off by default; the first-run setup asks before enabling it.
- When enabled, the Host reads `user/message` events and stores only a candidate word plus a short context fragment (not the whole message).
- You can disable it, clear the inbox, or delete the data directory at any time.

## Local routes

- The Host exposes a prefix route under `/dsh-word-veil`.
- Requests from non-loopback addresses are rejected with 403.
- Request bodies are capped; malformed input returns a JSON error and never crashes the Host.

## Reporting

Use GitHub's private vulnerability reporting on the repository's **Security** tab for anything that could expose user data or allow code execution through pack data. Do not open a public issue with exploit details.

## Pack data

- Packs are JSON data only; the Host validates them and never evaluates code from a pack.
- Pack text is rendered as text, not HTML.
