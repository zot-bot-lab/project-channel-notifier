# Discord Channel Notifier Bot

A Discord bot that monitors client messages in project channels and alerts managers when messages go unanswered.

## How It Works

- **Scheduled Scanning**: Runs every 2 hours (8 AM - 8 PM Sri Lanka time) on workdays via GitHub Actions.
- **Checkpoint Persistence**: Uses `db.json` to store the last scanned message ID per channel, ensuring no messages are missed (even over weekends).
- **Staff Detection**: Recognizes responses from both Managers (`MANAGER_ROLE_ID`) and Staff (`STAFF_ROLE_ID`).
- **Spam Prevention**: Groups unanswered messages by channel into a single alert ping.
- **Auto-Cleanup**: Automatically purges message IDs older than 7 days from the database to maintain performance.

## Quick Start

### Prerequisites
- Node.js 20+
- Discord bot with privileged intents enabled (**Message Content**, **Server Members**)
- Environment variables configured (see `.env.sample`)

### Local Testing
```bash
# Install dependencies
npm install discord.js dotenv

# Copy and configure environment
cp .env.sample .env
# Edit .env with your Discord bot token and IDs

# Run locally
node index.js
```

## Configuration

### Environment Variables
- `DISCORD_TOKEN` - Bot authentication token.
- `GUILD_ID` - Discord server (Guild) ID.
- `PROJECT_MGMT_CHANNEL_ID` - Channel where alerts are sent.
- `PROJECT_CATEGORY_ID` - Category containing project channels (optional).
- `MANAGER_ROLE_ID` - Role ID for managers (used for the alert ping).
- `STAFF_ROLE_ID` - Role ID for general staff/employees (used to detect answers).
