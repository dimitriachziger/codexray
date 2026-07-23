# Contributing to Codexray

Thank you for helping improve Codexray.

## Development workflow

Use Node.js 22 or 24 and start from a current branch:

```sh
npm ci
npm test
```

Keep changes focused and add tests for public CLI or JSON behavior. Before
opening a pull request, run:

```sh
npm run build
npm test
npm pack --dry-run
```

Describe the user-visible effect, note any rollout format assumptions, and
update the JSON schema and changelog when a public contract changes.

## Rollout fixtures and privacy

Never commit an unredacted Codex rollout, even in a private fork or draft pull
request. Rollouts may contain prompts, source code, shell commands, tool output,
filesystem paths, credentials, and other personal or confidential data.

Fixtures must be synthetic or manually minimized and redacted. Before
committing one:

1. Replace session identifiers, usernames, home directories, repository names,
   commands, prompts, tool output, URLs, and tokens with unmistakably synthetic
   values.
2. Keep only the records needed to exercise the behavior.
3. Search the file for your username, home path, project names, hosts, email
   addresses, and common secret prefixes.
4. Inspect the complete staged diff manually.

If a real rollout is necessary to reproduce a security or privacy bug, do not
attach it to a public issue. Follow the private process in
[SECURITY.md](SECURITY.md).

## Pull requests

Pull requests should include tests, avoid unrelated formatting or dependency
changes, and pass CI on Node.js 22 and 24. By contributing, you agree that your
work is provided under the repository's MIT License.
