# Security

reqochet is a desktop app without a server: it reads and writes files in your own Git repository and runs your own
`git` program. Still, a mistake in it could harm your data or your PC — please tell us privately.

## Reporting a problem

Use GitHub's **private vulnerability reporting**: on this repository's page open **Security → Report a
vulnerability**. Only the maintainers see the report. Please do not open a public issue for a security problem.

Helpful to include: the version (Settings → Environment), what you did, what happened, and a small project or file that
shows it (made-up content only — never real requirements).

## What we do

We confirm the report, fix it in a new version (installed copies update themselves) and say in the release notes what
was fixed once the update is out. There is no bug bounty.

## Supported versions

Only the newest version gets fixes; the app updates itself.

## Known limits

- **The installer and its updates are not code-signed** (signing needs a paid certificate). Windows SmartScreen may
  warn on the first install. Each update is checked against the SHA-512 checksum published with its GitHub release,
  and every release is approved by the maintainer before it is built.
