# ADR-001: Layered Architecture

## Status
Accepted

## Context
Finch requires a maintainable, testable architecture that can scale from a single business owner to enterprise deployments. We need clear separation of concerns to enable modular development and future expansion.

## Decision
We will use a **Clean Architecture / Layered Architecture** pattern with the following layers (from outer to inner):

```
┌─────────────────────────────────────────────────────────────────┐
│                      Presentation Layer                          │
│  (React Components, Ant Design UI, Electron Main Process)     │
└─────────────────────────────────────────────────────────────────┘
                                 │
┌─────────────────────────────────────────────────────────────────┐
│                    Application Layer                             │
│  (Use Cases, Controllers, Routing, Session Management)          │
└─────────────────────────────────────────────────────────────────┘
                                 │
┌─────────────────────────────────────────────────────────────────┐
│                   Business Logic Layer                         │
│  (Domain Models, Business Rules, Calculations)                │
└─────────────────────────────────────────────────────────────────┘
                                 │
┌─────────────────────────────────────────────────────────────────┐
│                     Service Layer                                │
│  (AI Service, Sync Service, Auth Service, Notification Service) │
└─────────────────────────────────────────────────────────────────┘
                                 │
┌─────────────────────────────────────────────────────────────────┐
│                Infrastructure Layer                              │
│  (SQLite, Supabase, File System, Networking, Encryption)      │
└─────────────────────────────────────────────────────────────────┘
```

## Consequences

### Positive
- **Testability**: Each layer can be tested independently
- **Maintainability**: Changes in one layer don't affect others
- **Scalability**: New features can be added without architecture changes
- **Offline-first**: Local infrastructure layer enables offline operation
- **Swap implementations**: Database or UI can be swapped without affecting business logic

### Negative
- **Initial complexity**: More files and interfaces than monolithic approach
- **Indirection**: More code to understand data flow

## Implementation Notes

### Dependency Direction
- Dependencies point **inward** (outer layers depend on inner)
- Use interfaces/abstract classes to invert dependencies
- Dependency injection for service layer

### Layer Responsibilities

| Layer | Responsibilities | Technologies |
|-------|-----------------|--------------|
| Presentation | UI, User Interaction | React, Ant Design, Electron |
| Application | Use Cases, Controllers, Session | React Router, Zustand |
| Business Logic | Domain Rules, Calculations | TypeScript Classes |
| Service | External APIs, Sync, AI | Supabase, OpenAI API |
| Infrastructure | Data Storage, Networking | SQLite, PostgreSQL |

## Related Decisions
- [ADR-002](./adr-002-database-design.md) - Database Design
- [ADR-003](./adr-003-auth-architecture.md) - Authentication Architecture
- [ADR-004](./adr-004-state-management.md) - State Management

## References
- Clean Architecture by Robert C. Martin
- Domain-Driven Design by Eric Evans
- TRD Chapter 3: System Architecture