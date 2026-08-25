# CI Security — gitleaks & push protection

This repo must never contain secrets. Two layers guard it:

## 1. GitHub push protection (repository setting)

GitHub blocks pushes containing detected secrets *before* they land.

Enable: **Repo → Settings → Code security & analysis → Secret scanning →
Push protection = ON** (requires secret scanning enabled; free for public repos).

Maintainers should also enable **Secret scanning alerts** so anything that slips
through historic history surfaces as an alert.

## 2. gitleaks in CI

Add this job to the workflow (e.g. `.github/workflows/ci.yml`):

```yaml
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history so leaks in old commits are caught
      - name: gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Local pre-commit (optional but recommended)

```sh
brew install gitleaks   # or: go install github.com/gitleaks/gitleaks/v8@latest
gitleaks protect --staged
```

## Handling a blocked push

If push protection blocks you: remove the secret from your commit, **rotate the
exposed credential**, and only then force a clean branch. Never choose
"bypass" for real credentials.
