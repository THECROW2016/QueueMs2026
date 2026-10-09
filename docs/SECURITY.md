# Security and privacy notes

## Controls implemented

* **Passwords**: Argon2id; minimum length enforced; no composition tricks; changing a password ends other sessions.
* **Sessions**: random token in an HttpOnly, SameSite=Lax cookie (Secure in production); only its SHA-256 is stored; idle (30 min) and absolute (12 h) expiry; logout deletes the session.
* **CSRF**: Origin check plus a per-session token required in `X-CSRF-Token` on every state-changing request.
* **Brute force**: per-IP rate limit on sign-in and password reset, and per-account lockout after repeated failures, with generic error messages.
* **Authorisation**: every endpoint checks permission **and** department membership on the server; clients cannot choose their own scope. Patient identity and clinical notes are separate permissions. Visits are only reachable by users whose department has handled the patient (need-to-know), except reception/administration as configured.
* **Concurrency**: row locks and unique indexes protect ticket numbers, call-next, counters, invoices and payments; creation endpoints accept idempotency keys.
* **Audit log**: sign-ins, failures, user/role/settings changes, patient search and views, status changes, billing, exports. Secrets (passwords, tokens) are scrubbed before logging. Entries are append-only through the application.
* **Public display**: a separate unauthenticated read-only endpoint and socket namespace that are tested to contain no names, phone numbers, IDs, MRNs or visit identifiers.
* **Transport and headers**: Helmet with a restrictive Content-Security-Policy; HSTS in production; HTTPS is expected in front (see DEPLOYMENT).
* **Database**: not published on the network by the provided Compose file; use a dedicated least-privilege database user.
* **Secrets**: only placeholders in `.env.example`; `.env` is ignored by git; the first administrator's password is read from a hidden prompt or environment variable, never from command-line arguments.

## Not implemented / your responsibility

* Encryption at rest of the database volume and of backups (use disk or volume encryption and encrypt backup files).
* Multi-factor authentication, single sign-on and IP allow-listing.
* Antivirus, patching of the host and Docker images, network segmentation, physical security of the TV and workstations.
* Retention schedules, subject-access and correction procedures, breach response, staff training and confidentiality agreements.
* Penetration testing and an independent security review.

## Data-protection notes for Kenya (not legal advice)

Patient records are personal data, and health data is sensitive personal data, under Kenya's Data Protection Act, 2019 and its regulations. Typical obligations include: registering as a data controller/processor with the Office of the Data Protection Commissioner, a lawful basis and clear notices for processing, collecting only what is needed, keeping data accurate, limiting retention, safeguards proportionate to the risk, restrictions on transfers outside Kenya (including cloud hosting location), and notifying breaches within the statutory periods. Health-sector rules may add requirements.

This application provides technical supports for those duties (access control, audit trail, minimal data on public screens, no data sent to third parties by the software itself). **It does not make a hospital compliant by itself, and no claim of compliance or certification is made.** Have the deployment, hosting location, retention rules and notices reviewed by qualified legal and compliance advisers before processing real patient data. Use synthetic data for development and testing.
