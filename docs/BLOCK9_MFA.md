# Block 9: SSR and CSR permissions and MFA (Authenticator)

## Start and use your phone

Restart both servers after this update:

```sh
npm run dev
npm run dev:ssr
```

Sign in, open the avatar menu, choose **Bảo mật tài khoản**. Enter your password,
start setup, scan the QR in your Authenticator (or enter the secret manually), and
enter the six-digit code. MFA remains off until confirmation succeeds. Save the
10 recovery codes separately: they are shown once and each works once.
The Authenticator code is different from the activation code delivered by email.
Enable automatic date/time on your phone if codes are repeatedly rejected.

When MFA is enabled, password verification alone creates only an SSR pending
session or API challenge. Finish with Authenticator or a recovery code to get a
full session/JWT. Do not share the QR/secret/recovery codes. No real account was
automatically enrolled or promoted during this update.

Configuration currently falls back from SSR to the API database when no
SSR_DATABASE_URL is set. When the account tables are shared, both servers must use
the same MFA_ENCRYPTION_KEY, and one enrollment works for both. If configured with
separate account databases, enroll separately (labels distinguish SSR and SPA).

## Permissions

SSR and CSR admin read is available to Viewer/Editor/Admin. Viewer cannot write; Editor
can create/update but cannot delete. Editor can update dishes only when the
persisted chefId matches the account chef_id and status is draft. Editor-created
dishes get that chef and draft status from the server. Only Admin changes dish
owner/status. Editors without a chef are blocked from dish create/update.

Checks cover GET forms and direct writes, including reload of the user and dish
under row locks inside transactions for writes. Role/owner/status fields supplied
by a client never grant permission. Validation failures roll back inline parent
creation. Permission checks run before upload or relation writes.

CSR admin reads and form checks use `GET /api/admin/:resource` and its detail,
`new`, `edit`, and `delete` routes. The API returns current permissions for the
interface. The existing API mutation routes enforce those same rules on every
write. A missing or invalid JWT returns `401`. Insufficient permissions return
`403` with `FORBIDDEN`. The public catalog still reads dishes through
`GET /api/dishes` and `GET /api/dishes/:id`.

## Security behavior

- OTPAuth implements SHA-1 TOTP, six digits/30 seconds, window ±1 step. The
  accepted step is recorded atomically; an accepted code cannot be replayed.
- Secrets use AES-256-GCM with user-id AAD and a separate base64 32-byte
  MFA_ENCRYPTION_KEY. No active secret is exposed after enrollment.
- Setup lasts ten minutes and requires password plus existing MFA proof when
  replacing a device. Cancelling deletes the temporary setup. The old secret
  remains active until replacement confirmation.
- Five failed MFA proofs lock MFA attempts for 15 minutes per user. Re-login does
  not reset the count. Failures are committed rather than rolled back.
- Ten random recovery codes are stored as SHA-256 hashes; original codes are
  shown only upon creation. Regeneration invalidates the old set.
- Disable/replace/regenerate require password and one current TOTP/recovery code.
- SSR pending sessions and API challenges expire after five minutes. Challenges
  are random, hashed, single-use, and cannot be used as Bearer tokens.
- Password reset does not disable MFA; it invalidates pending challenges through
  the account version. Existing fully authenticated JWTs retain the previous
  15-minute expiry policy after reset. MFA configuration changes increment the
  separate MFA version and revoke old JWTs and SSR sessions immediately.
- JWT signature verification still has no DB dependency. Account loading checks
  the MFA version after cryptographic verification.
- SSR keeps CSRF/Origin/HttpOnly-cookie protections. Security pages/API responses
  are no-store. Keys, credentials and MFA secrets must not appear in logs/bundles.

## Operations

`block9:migrate` was run for API and SSR. It adds MFA tables/columns, the dish
status and constraints, without resetting data. Existing dishes default to
published. Prisma Client was regenerated.

```sh
npm --prefix api run block9:migrate
npm --prefix legacy run block9:migrate
# Explicit opt-in demo seed, never overwrites existing account credentials:
BLOCK9_ALLOW_DEMO_SEED=true npm --prefix api run block9:seed
BLOCK9_ALLOW_DEMO_SEED=true npm --prefix legacy run block9:seed
```

Demo users are block9-viewer/admin/editor-a/editor-b@example.test. Passwords are
in gitignored `.local-backups/block9-api-credentials.json` (or a separate legacy
file when using another DB). Do not commit these files. Demo seed was prepared;
no email is sent to those example.test addresses. Run seed serially for shared DB.

SSR endpoints: GET /account/security; POST /account/mfa/setup, /confirm, /cancel,
/disable, /recovery/regenerate; GET/POST /mfa. All SSR POSTs require CSRF.
API endpoints: GET /api/auth/mfa; POST /api/auth/mfa with challenge + otp or
recoveryCode; POST /api/auth/mfa/setup, /confirm, /cancel, /disable,
/recovery/regenerate authenticated by Bearer. Login returns data.next="mfa"
without accessToken for enrolled users. Configuration mutations return a new JWT
because old MFA versions are invalid. Settings proofs require password and, when
already enrolled, otp or recoveryCode. Business errors use INVALID_OTP and
INVALID_MFA_CHALLENGE; lockouts use HTTP 429/RATE_LIMITED with Retry-After.

No passkeys, external MFA service, or administrative MFA bypass is included.
No assignment evidence bundle was generated.
