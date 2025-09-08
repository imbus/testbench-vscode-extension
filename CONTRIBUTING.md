# Contributing

Thanks for taking the time to contribute to this project! 🧡

## 🐞 Reporting Bugs

If you encounter a bug, please [open a GitHub issue](https://github.com/imbus/testbench-vs-code-extension/issues) and include the following information to help us debug it:

- **VS Code version** (e.g., `1.96.0`)
- **OS and version** (e.g., Windows 11 / macOS Ventura / Ubuntu 22.04)
- **Extension version** (find it in the Extensions panel)
- **Steps to reproduce the issue** (screenshots or GIFs help!)
- **Expected behavior** What you expected to happen
- **Actual behavior** What actually happened
- **Relevant logs/output** You can find extension logs in .testbench/logs folder in your workspace. Reproducing the issue in trace log level will provide more detailed information in the logs.

## 💡 Suggesting Enhancements

Have an idea for a new feature or improvement? Please open an issue with the `enhancement` label and include:

- A clear description of the proposed feature
- The problem it solves or the use-case it improves
- Any mockups or examples (if applicable)

## 🛠️ Contributing Code

Pull requests are welcome! If you want to work on something:

1. Check the [open issues](https://github.com/imbus/testbench-vs-code-extension/issues)
2. Comment on the issue to let us know you're working on it
3. Fork the repo, create a new branch, and open a pull request when ready

Please follow the coding conventions and include tests if applicable.

## ✍️ Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/). Use one of the following prefixes:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect meaning (white-space, formatting)
- `refactor`: Code changes that neither fix a bug nor add a feature
- `perf`: Performance improvements
- `test`: Adding missing tests or correcting existing ones
- `chore`: Other changes that don’t modify src or test files
- `build`: Changes that affect the build system or external dependencies

**Examples:**

- `feat: add test result import support`
- `fix: resolve issue with automatic login`
- `chore: update dependencies`

## Release Process & Semantic Versioning

This project uses [semantic-release](https://semantic-release.gitbook.io/) with [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and releases.

### How Versioning Works

Your commit messages automatically determine the version bump:

| Commit Type                           | Version Bump              | Example                              |
| ------------------------------------- | ------------------------- | ------------------------------------ |
| `fix:`                                | **Patch** (0.4.0 → 0.4.1) | `fix: resolve login timeout`         |
| `feat:`                               | **Minor** (0.4.0 → 0.5.0) | `feat: add test import feature`      |
| `feat!:` or `BREAKING CHANGE:`        | **Major** (0.4.0 → 1.0.0) | `feat!: redesign authentication API` |
| Other types (`docs:`, `chore:`, etc.) | **No release**            | Won't trigger a new version          |

### Multi-Branch Release Strategy

We support releases from multiple branches:

- **`main`**: Production releases (`1.2.3`)
- **`prerelease`**: Beta versions (`1.2.3-prerelease.1`)
- **`feature`**: Feature previews (`1.2.3-feature.1`)
- **`feature/*`**: Branch-specific builds (`1.2.3-feature-auth.1`)

> **Note**: The `.1`, `.2`, `.3` etc. are prerelease counters, not part of the main semantic version. Only commits to `main` branch increase the base version numbers (1.2.3). Prerelease branches increment only the counter while previewing the next planned version.

### Development Workflow

1. **Feature Development**: Work on `feature/your-feature-name` branches

    ```bash
    git checkout -b feature/new-authentication
    git commit -m "feat: add OAuth2 support"
    # → Automatic release: 0.5.0-feature-new-authentication.1
    ```

2. **Integration Testing**: Merge to `prerelease` for beta testing

    ```bash
    git checkout prerelease
    git merge feature/new-authentication
    # → Automatic release: 0.5.0-prerelease.1
    ```

3. **Production Release**: Merge to `main` for stable release
    ```bash
    git checkout main
    git merge prerelease
    # → Automatic release: 0.5.0
    ```

### Release Automation

When commits are pushed to release branches, the system automatically:

- ✅ Analyzes commit messages to determine version bump
- ✅ Updates `package.json` version and `CHANGELOG.md`
- ✅ Builds and packages the VSIX extension
- ✅ Creates GitHub release with VSIX attachment
- ✅ Commits changes back to the repository

### Manual Releases

For emergency releases or special cases, use the manual release workflow:

1. Go to **Actions** → **Manual Release** in GitHub
2. Enter the version number and release type
3. The workflow will handle the rest

---

Thanks contributing!
