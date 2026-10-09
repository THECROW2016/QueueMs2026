# QueueMS

A queue management system for service halls, banks, clinics and offices.
Customers take a numbered ticket, staff call them to a counter, a TV screen
shows who to go where, and customers can get SMS alerts as their turn approaches.

## Screens

| Path | Who uses it | What it does |
|------|-------------|--------------|
| `/kiosk` | Customers | Pick a service, optionally enter a phone number, get a ticket (e.g. `A007`) |
| `/counter` | Staff | Choose the counter, then **Call next**, Recall, Start serving, Skip (no-show), Complete |
| `/display` | Waiting-area TV | Live board of each counter's current ticket, recent calls and waiting counts; flashes, chimes and announces each call (click **Enable sound** once) |
| `/admin` | Manager | Add services (with ticket prefix) and counters |
| `/ticket/:id` | Customers | Live status of one ticket |

Updates are pushed to every screen in real time over Socket.IO.

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
| `AT_USERNAME`, `AT_API_KEY` | – | Africa's Talking credentials |
| `AT_SENDER_ID` | – | Optional registered sender ID |
| `SMS_COUNTRY_CODE` | `254` | Used to convert local numbers |
| `NOTIFY_AHEAD` | `3` | Send the "turn is near" text at this many people ahead |

## API

| Method | Path | Body |
|--------|------|------|
| GET | `/api/queue` | – full live snapshot |
| GET/POST | `/api/services` | `{ name, prefix }` |
| GET/POST | `/api/counters` | `{ name }` |
| POST | `/api/tickets` | `{ serviceId, phone? }` |
| GET | `/api/tickets/:id` | – |
| POST | `/api/counters/:id/call-next` | `{ serviceIds? }` |
| POST | `/api/tickets/:id/recall` \| `serve` \| `skip` \| `complete` | – |

Ticket numbers restart at 001 for each service every day.

## Next ideas

- Staff login and roles
- Reports: average wait and service time per service and counter
- Printed tickets with a QR code linking to `/ticket/:id`
- Priority tickets (elderly, disabled, VIP)
