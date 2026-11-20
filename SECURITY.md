# Security Policy

## Supported Versions

Only the `main` branch is supported; there are no stable releases yet.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

Please report privately using this repository's GitHub security advisories (Security tab → "Report a vulnerability"), not a public issue. Include reproduction steps and affected routes or files if you can. You'll hear back with a fix timeline.

Fixes for findings shared with the upstream base are developed on a local branch and tracked only in a private, git-ignored tracker until their disclosure window closes; they are never described in public tracking surfaces, including the `backlog/` store. Line for hostile-instance hardening in the public store: crash/display-class items may be tracked publicly; anything that mutates shared state (e.g. prototype pollution) or could affect other stored accounts stays in the private tracker.
