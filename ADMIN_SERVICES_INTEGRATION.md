# Admin Services Integration Docs

This document explains the admin features integrated into `ai_prompt_generator_backend` from the NutriGuide backend pattern.

## What Was Added

- Admin authentication and protected admin APIs
- User moderation (ban/unban + admin user edits)
- OpenAI token usage tracking per user
- Push notification system (device token registration + admin broadcast)
- Firebase Admin initialization via env JSON or local service account file

## New API Modules

- `routes/adminAuthRoutes.js`
- `routes/adminRoutes.js`
- `routes/notificationRoutes.js`
- `controllers/adminAuthController.js`
- `controllers/adminController.js`
- `controllers/notificationController.js`
- `middlewares/adminAuthMiddleware.js`
- `utils/firebaseAdminInit.js`

## Data Model Changes

### `models/usersModel.js`

Added:

- `isBanned` (Boolean, default `false`)
- `bannedAt` (Date, nullable)
- `bannedReason` (String)
- `deviceTokens[]` (token + device details)
- `openAiUsage`:
  - `promptTokens`
  - `completionTokens`
  - `totalTokens`
  - `requestCount`
  - `lastUsedAt`

### `models/promptGenerationModel.js`

Added `usage` object on each prompt generation:

- `promptTokens`
- `completionTokens`
- `totalTokens`

## Behavior Changes

### Prompt Generation Usage Tracking

In `controllers/promptController.js`:

- `POST /api/prompts/generate` now reads OpenAI usage from the completion response.
- Usage is saved in:
  - Prompt document (`PromptGeneration.usage`)
  - User aggregate counters (`User.openAiUsage`)

### Ban Enforcement

In `middlewares/authMiddleware.js` and auth/login logic:

- Banned users receive HTTP `403`.
- Responses include ban message and `bannedReason` where available.

### Optional Auth for Prompt Generation

- `POST /api/prompts/generate` uses optional auth.
- If authenticated and not banned, usage is tracked against that user.
- If unauthenticated, prompt generation still works but no user usage aggregate is updated.

## Registered Routes

### Admin Auth

- `POST /api/admin/auth/login`

Body:

```json
{
  "email": "admin@gmail.com",
  "password": "admin@gmail.com"
}
```

### Admin (requires Bearer admin token)

- `GET /api/admin/test`
- `GET /api/admin/users`
- `PUT /api/admin/users/:id`
- `PATCH /api/admin/users/:id/ban`
- `PATCH /api/admin/users/:id/toggle` (compat alias)
- `GET /api/admin/usage`
- `POST /api/admin/notifications/broadcast`

#### Ban/Unban Request Example

```json
{
  "isBanned": true,
  "bannedReason": "Abusive usage pattern"
}
```

#### Broadcast Notification Request Example

```json
{
  "title": "System Update",
  "body": "New features are live.",
  "data": {
    "type": "broadcast",
    "screen": "home"
  }
}
```

### Notifications

- `POST /api/notifications/register-token` (optional auth)
- `POST /api/notifications/send` (auth required)
- `GET /api/notifications/tokens` (auth required)
- `DELETE /api/notifications/tokens/:token` (auth required)

## Environment Variables

Added in `.env.example`:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_JWT_SECRET`
- `FIREBASE_SERVICE_ACCOUNT`
- `FIREBASE_SERVICE_ACCOUNT_PATH`

## Firebase Setup

Firebase Admin now supports both:

1. `FIREBASE_SERVICE_ACCOUNT` (JSON string in env), or
2. `firebase-service-account.json` in backend root, or
3. `FIREBASE_SERVICE_ACCOUNT_PATH` to custom file path

Startup log in `index.js` prints Firebase readiness:

- `ready` when initialized
- `not configured` when missing/invalid

## Security Notes

- `firebase-service-account.json` is ignored in `.gitignore`.
- Keep admin credentials strong in production.
- Set a dedicated `ADMIN_JWT_SECRET` in production.
- Do not commit real secrets in `.env`.

## Quick Test Checklist

1. Start backend and verify Firebase readiness log.
2. Login admin: `POST /api/admin/auth/login`.
3. Fetch users: `GET /api/admin/users`.
4. Ban a user: `PATCH /api/admin/users/:id/ban`.
5. Confirm banned user gets `403` for auth-protected APIs and prompt generation.
6. Generate prompts from a normal user and check:
   - `PromptGeneration.usage` saved
   - `User.openAiUsage` counters increase
7. Register device token via `POST /api/notifications/register-token`.
8. Send broadcast via `POST /api/admin/notifications/broadcast`.

## Notes for Admin Dashboard

- Use `GET /api/admin/users` for user table.
- Use `GET /api/admin/usage` for abuse detection and top users by token usage.
- Use `PATCH /api/admin/users/:id/ban` for moderation action.
- Use `POST /api/admin/notifications/broadcast` for announcements.
