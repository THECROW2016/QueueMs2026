# Day-to-day operation

## First-time setup (administrator)

1. Sign in with the account created by `create-admin`; change the password under *My account*.
2. **Departments & routing → Counters & rooms**: add or rename the counters/rooms staff will use.
3. **Departments & routing → Routing rules**: choose which departments may send patients to which. Tick *reason required* where a justification must be recorded, *emergency only* for routes reserved for the emergency pathway.
4. **Users**: create staff accounts, choose their role(s) and department(s). A temporary password forces a change at first sign-in. *Reset password* issues a one-time token to give to the user.
5. **Settings**: hospital name, display message, voice language, whether urgent patients are called first.

## Reception

*Register patient* checks for a probable duplicate before saving; choose the existing record when it is the same person. Submitting twice (double click, bad network) cannot create two visits. The ticket slip contains only the ticket number, department, people ahead and the hospital's message. Pick *My counter*, then **Call next patient**.

## Clinical and support departments

Choose your room, call the next patient, **Start service**, then **Complete…** and pick where the patient goes next (one or several departments; the choices come from the routing rules). Other actions: Recall, Hold/Resume, Absent/Restore (restore is allowed for a limited time), Skip, Cancel, Transfer (reasons are required and logged). Triage and Consultation can change priority and use the emergency pathway. Laboratory and Radiology set a result/report status; the department that requested it is notified when it becomes available.

## Accounts

Open the visit → *Billing*: add an invoice, record a payment only after the money has been received (reference required for non-cash), then **Mark billing cleared** and **Close visit**.

## Waiting-room TV (public display)

The page `https://<your-address>/display` needs no sign-in and shows only ticket numbers, counters, department names and queue sizes.

1. Connect the TV's browser (or a small PC / streaming stick / Raspberry Pi in kiosk mode) to the hospital network and open `/display` full-screen (F11, or `chromium --kiosk https://<your-address>/display`).
2. **Click “Enable voice announcements” once.** Browsers refuse to speak until someone has interacted with the page; after a reboot repeat this step. Use *Voice settings* for speed and language and *Test voice* to check the volume.
3. If the TV's browser has no speech engine the page says so and still flashes each call on screen.
4. If the connection drops the screen shows “Reconnecting…”, keeps the last known state, and refreshes automatically.
5. Each call is spoken once, even after a reconnect. A **Recall** is spoken again.

## Reports

Reports → choose dates (up to 93 days) and department. Cancelled visits are excluded unless ticked. Definitions: *wait* = first call − arrival; *service* = completion − start of service; *turnaround* = visit close − visit opening; days follow the hospital's local time (`HOSPITAL_UTC_OFFSET_MINUTES`). CSV export contains aggregates only and every export is recorded in the audit log.

## Retention

Nothing is deleted automatically. Decide, with your data-protection adviser, how long patient, visit and audit records are kept, and how backups are expired.
