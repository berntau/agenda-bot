VPS Ubuntu 24.04
├── nginx (host) → agenda.offstaj.space → 127.0.0.1:3000
├── AgendaBot (PM2, não Docker)
│   ├── Fastify na :3000
│   ├── Telegraf (bot Telegram)
│   ├── SQLite (agenda.db)
│   └── Shell executor (logs, deploy, restart)
└── RadarOdd (Docker Compose, intacto)