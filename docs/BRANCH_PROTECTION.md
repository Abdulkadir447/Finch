# Branch Protection Rules

This document describes the branch protection rules for the Co-op repository.

## Protected Branches

### `main`
Production-ready branch. **Protected** with the following rules:

| Rule | Value |
|------|-------|
| Require pull request reviews | 1 approval required |
| Dismiss stale pull request approvals | ✓ |
| Require code owner reviews | ✓ |
| Require status checks to pass | ✓ |
| Required checks: | lint, test, build, security |
| Restrict who can push | Maintainers only |
| Include administrators | ✓ |
| Allow force pushes | ✗ |
| Allow deletions | ✗ |

### `develop`
Integration branch. **Protected** with the following rules:

| Rule | Value |
|------|-------|
| Require pull request reviews | 1 approval required |
| Dismiss stale pull request approvals | ✓ |
| Require status checks to pass | ✓ |
| Required checks: | lint, test |
| Restrict who can push | Developers, Maintainers |
| Include administrators | ✓ |
| Allow force pushes | ✗ |
| Allow deletions | ✗ |

## Branch Naming Convention

All feature branches must follow these naming patterns:

| Branch Type | Pattern | Example |
|-------------|---------|---------|
| Feature | `feature/<name>` | `feature/order-management` |
| Bugfix | `bugfix/<name>` | `bugfix/login-error` |
| Hotfix | `hotfix/<name>` | `hotfix/critical-security-patch` |
| Release | `release/v<version>` | `release/v1.0.0` |

## Merge Requirements

Before any pull request can be merged:

1. **CI Checks Pass**
   - Lint check passes
   - All tests pass (80%+ coverage)
   - Build succeeds
   - Security scan passes

2. **Code Review**
   - At least 1 approval from a reviewer
   - No unresolved comments
   - AI review completed (for changes > 50 lines)

3. **Documentation**
   - README updated if applicable
   - API documentation updated for new endpoints

4. **Conventional Commits**
   - Commit messages follow Conventional Commits format
   - PR title follows the same format

## Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (whitespace, formatting) |
| `refactor` | Code refactoring |
| `perf` | Performance improvement |
| `test` | Adding tests |
| `chore` | Maintenance tasks |
| `build` | Build system changes |
| `ci` | CI/CD changes |
| `revert` | Reverting a commit |

### Examples

```
feat(auth): add Google OAuth support

fix(orders): resolve sync conflict on order update

docs(api): update authentication guide

refactor(ui): simplify sidebar component

test(products): add edge case tests for low stock
```

## Protection Setup

To configure branch protection rules on GitHub:

1. Go to **Settings > Code and automation > Branches**
2. Click **Add rule**
3. Enter branch pattern (`main` or `develop`)
4. Configure rules as specified above
5. Click **Create**

## Enforcement

These rules are enforced through:

- **GitHub Branch Protection API** (configured manually)
- **Pre-commit hooks** (local development)
- **CI/CD pipeline** (automated checks)
- **Commitlint** (commit message validation)