# Contributing Guide

Thank you for your interest in contributing to Finch! This document explains how to contribute to this project.

## Prerequisites

Before contributing, please ensure you have:

- **Node.js** version 22 or higher
- **pnpm** (package manager)
- **Git** (version control)
- **Docker** (optional, for development with SQLite)

## Development Setup

### Clone the Repository

```bash
gh repo clone finch-project/your-username/finch
cd finch
```

### Install Dependencies

```bash
pnpm install
```

### Environment Setup

Create a `.env` file with sensitive environment variables:

```bash
cat > .env <<EOF
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key
OPENAI_API_KEY=your_openai_key
SECRET_KEY=your_jwt_secret
EOF
```

### Pre-commit Hooks

The project uses `husky` for pre-commit hooks.

```bash
pnpm prepare
```

## Project Structure

The project is organized as follows:

```
Finch/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── routes/
│   │   ├── stores/
│   │   └── api/
│   ├── theme.ts
│   ├── theme.d.ts
│   └── index.html
│
├── backend/
│   ├── models/
│   ├── schemas/
│   ├── services/
│   └── routes/
│
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
│
├── .github/workflows/
├── .husky/
├── docs/
├── package*.json
├── .pre-commit-config.yaml
├── .commitlintrc.json
└── .eslintrc.cjs
```

## Development Workflow

### Branch Naming

All branches must follow the conventional format:

- `feature/<short-description>`
- `bugfix/<short-description>`
- `hotfix/<short-description>`
- `release/<version>`

Example:

```bash
feature/add-user-dashboard
bugfix/login-session-timeout
```

### Committing Code

#### Committing Standards

1. **Use Conventional Commits format**

```bash
git add .
git commit -m "feat(user): add profile picture upload"
git commit -m "fix(orders): resolve order synchronization issue"
```

2. **Verify commit messages with commitlint**

```bash
cipanic --edit $(git log --format=%H -n1)
```

3. **Push to feature branch**

```bash
git push origin feature/add-user-dashboard
```

### Pull Request Process

1. **Create a pull request** from your feature branch to `develop`

2. **Follow the PR template**:

   - **Description**: Clear summary of changes
   - **Background**: Problem and context
   - **Changes**: List of files changed with purposes
   - **Testing**: Test results
   - **Documentation**: Any documentation updates

3. **Resolve required CI checks**:

   - Linting and formatting
   - Unit and integration tests
   - Build compilation
   - Security scan

4. **Request review from team members**

5. **Address feedback**

6. **Merge to `develop`** (after team approval)

### Coding Standards

#### TypeScript

- Use strict mode (`--strict`)
- Interface-based typing
- Use `// comments` instead of `/* comments */`
- Limit `any` type usage

#### JavaScript

- ES6+ syntax
- No trailing whitespace
- Consistent indentation (2 spaces)

#### File Organization

- Each module should have:
  - A clear, readable file structure
  - Focus on single responsibility
  - Appropriate TypeScript interfaces for data structures
  - Comprehensive tests

### Testing

#### Unit Tests

```bash
pnpm --filter ./backend test:unit
pnpm --filter ./frontend test:unit
```

- Minimum **80% code coverage**
- Use Jest for frontend tests
- Use pytest for backend tests

#### Integration Tests

```bash
pnpm --filter ./backend test:integration
```

- Test API endpoints
- Test database interactions
- Test authentication flows

#### E2E Tests

```bash
pnpm --filter ./frontend test:e2e
```

- Use Cypress or Playwright
- Test critical user journeys
- Parallel execution for efficiency

### Building and Deployment

#### Building

```bash
pnpm build
```

- Frontend: builds with Vite
- Backend: builds with TypeScript

#### Deployment

1. **Staging**: Deploy to staging server for testing
2. **Production**: Use `git tag` followed by CD pipeline

### GitHub Actions

The project uses GitHub Actions for CI/CD:

- **Linting**: Code style and type checking
- **Testing**: Unit and integration tests
- **Building**: Build the application
- **Security**: Security vulnerability scanning

## Code Review Guidelines

### What to Review

1. **Code Quality**
   - Readability and maintainability
   - Adherence to coding standards
   - Appropriate use of design patterns

2. **Functionality**
   - Correctness of implementation
   - Edge cases and error handling
   - Performance considerations

3. **Architecture**
   - Consistency with project principles
   - Layer separation
   - Dependency management

4. **Testing**
   - Test coverage adequacy
   - Test effectiveness
   - Test organization

5. **Documentation**
   - API documentation
   - Code comments
   - User guides

### Review Process

1. **Initial review**: Check if code meets basic standards
2. **Deep review**: Focused on architecture and design
3. **Final review**: Ensure no breaking changes

## Contributing Workflow

1. Fork the repository
2. Create a feature branch from `develop`
3. Implement your feature or fix
4. Update documentation if needed
5. Commit your changes
6. Push to your fork
7. Create a pull request
8. Wait for review and approvals
9. Merge after meeting requirements

## Troubleshooting

### Common Issues and Solutions

1. **"Could not resolve dependency"**
   - Run `pnpm install`
   - Check `package.json` for version conflicts

2. **"Linting errors"**
   - Run `pnpm lint` to identify specific issues
   - Fix code according to linting rules

3. **"Tests failing"**
   - Run specific failing tests with more details
   - Check logs for error messages

4. **"Build errors"**
   - Check TypeScript compilation errors
   - Verify environment variable setup

## Support

For questions or issues:

- **GitHub Issues**: Report bugs or request features
- **Discussions**: Ask questions and share ideas
- **Slack/Discord**: Real-time communication (if available)

## Code of Conduct

Please respect all contributors and maintain a professional, inclusive environment. Harassment, discrimination, or inappropriate behavior will not be tolerated.

## License

This project is licensed under the MIT License.

---

_Generated based on Finch project architecture and IPD Chapter 2 requirements_
_Updated with comprehensive guidelines for new contributors_