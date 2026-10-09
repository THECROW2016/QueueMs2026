# QueueMS

A queue management system for service halls, banks, clinics and offices.
Customers take a numbered ticket, staff call them to a counter, a TV screen
shows who to go where, and customers can get SMS alerts as their turn approaches.

## Screens

| Path | Who uses it | What it does |
|------|-------------|--------------|
| `/` or `/login` | Staff | AfriQueue sign-in page. **Admin** goes to Setup, **User** goes to the counter panel |
| `/kiosk` | Customers | Pick a service, optionally enter a phone number, get a ticket (e.g. `A007`) |
| `/counter` | Staff (signed in) | Choose the counter, then **Call next**, Recall, Start serving, Skip (no-show), Complete |
| `/display` | Waiting-area TV | Live board of each counter's current ticket, recent calls and waiting counts; flashes, chimes and announces each call (click **Enable sound** once) |
| `/admin` | Admins (signed in) | Add services, counters and staff accounts; links to every screen |
| `/portal` | Patients | Enter a ticket number (e.g. `A007`) to follow it live |
| `/ticket/:id` | Customers | Live status of one ticket |

Updates are pushed to every screen in real time over Socket.IO.
The kiosk, display, portal and ticket pages are public; the counter panel and
setup require signing in.

## Sign-in and accounts

- On first start the server creates an admin account. Set `ADMIN_USERNAME` /
  `ADMIN_PASSWORD` to choose it; otherwise a random password is printed once in
  the server log. Change it after signing in (**Change password** in the top bar).
- Admins add staff accounts on the Setup page, with role *Staff / Healthcare
  Provider* or *Administrator*.
- Choosing **Admin** on the login page only works for administrator accounts.
  Administrators can also sign in as **User** to go straight to the counter.
- Passwords are hashed with scrypt; sessions are httpOnly cookies. **Remember me**
  keeps you signed in for 30 days, otherwise until the browser closes (max 12 hours).
- Sign-in is limited to 10 failed attempts per 15 minutes per IP address.

## SMS notifications

Uses [Africa's Talking](https://africastalking.com). Customers who leave a phone
number get a text when they take a ticket, when they are within `NOTIFY_AHEAD`
places of the front, and when they are called to a counter. Local numbers like
`0712 345 678` are converted to `+254712345678` (change `SMS_COUNTRY_CODE` for
other countries).

Without `AT_USERNAME` / `AT_API_KEY` set, messages are printed to the server log
instead, so everything works without an SMS account. Use `AT_USERNAME=sandbox`
with a sandbox key to test.

## Tech

- **server/** Node.js, Express, Socket.IO, SQLite (better-sqlite3)
- **client/** React 18, Vite, React Router

## Run locally

Requires Node.js 20+.

```bash
npm run install:all
cp server/.env.example server/.env   # optional, edit as needed

# two terminals
npm run dev:server    # API on http://localhost:4000
npm run dev:client    # UI on http://localhost:5173
```

The database is created at `server/data/queuems.db` and seeded with three
services (General Enquiries `A`, Payments `B`, Customer Care `C`) and three counters.

## Production / deploy

```bash
npm run build   # installs everything and builds the React app
npm start       # serves API + UI on $PORT
```

On Railway (or any Node host): build command `npm run build`, start command
`npm start`. Attach a volume and set `DATABASE_PATH` to a file on it (e.g.
`/data/queuems.db`) so tickets survive redeploys.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | HTTP port |
| `DATABASE_PATH` | `server/data/queuems.db` | SQLite file |
| `ORG_NAME` | `QueueMS` | Name shown in SMS messages |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | `admin`, random | First admin account |
| `NODE_ENV` | – | Set to `production` so session cookies are HTTPS-only |
| `AT_USERNAME`, `AT_API_KEY` | – | Africa's Talking credentials |
| `AT_SENDER_ID` | – | Optional registered sender ID |
| `SMS_COUNTRY_CODE` | `254` | Used to convert local numbers |
| `NOTIFY_AHEAD` | `3` | Send the "turn is near" text at this many people ahead |

## API

| Method | Path | Body |
|--------|------|------|
| POST | `/api/auth/login` | `{ username, password, role, rememberMe }` |
| POST | `/api/auth/logout` · GET `/api/auth/me` | – |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` |
| GET/POST | `/api/users` (admin) | `{ username, full_name, password, role }` |
| GET | `/api/queue` | – full live snapshot |
| GET/POST | `/api/services` (POST: admin) | `{ name, prefix }` |
| GET/POST | `/api/counters` (POST: admin) | `{ name }` |
| POST | `/api/tickets` | `{ serviceId, phone? }` |
| GET | `/api/tickets/:id` · `/api/tickets/lookup?code=A007` | – |
| POST | `/api/counters/:id/call-next` (staff) | `{ serviceIds? }` |
| POST | `/api/tickets/:id/recall` \| `serve` \| `skip` \| `complete` (staff) | – |

Ticket numbers restart at 001 for each service every day.

## Next ideas

- QR code sign-in (button is on the login page, not connected yet)
- Admin password reset for staff accounts
- Reports: average wait and service time per service and counter
- Printed tickets with a QR code linking to `/ticket/:id`
- Priority tickets (elderly, disabled, VIP)
