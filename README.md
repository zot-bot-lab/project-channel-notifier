# Discord Channel Notifier Bot

A Discord bot that monitors client messages in project channels and alerts managers when messages go unanswered.

## How It Works

- Runs every hour via GitHub Actions workflow
- Scans project channels for messages from users with roles ending in `-ext` (client roles)
- Alerts project managers when client messages have no staff reply or reaction
- Tracks alerted messages to prevent duplicate notifications
- Automatically removes messages from tracking once staff responds

## Quick Start

### Prerequisites
- Node.js 20+
- Discord bot with privileged intents enabled (Message Content, Server Members)
- Environment variables configured (see `.env.sample`)

### Local Testing
```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.sample .env
# Edit .env with your Discord bot token and IDs

# Run locally
node index.js
```

## Configuration

### Environment Variables
- `DISCORD_TOKEN` - Bot authentication token
- `GUILD_ID` - Discord server ID
- `PROJECT_MGMT_CHANNEL_ID` - Channel where alerts are sent
- `PROJECT_CATEGORY_ID` - Category containing project channels (optional)
- `MANAGER_ROLE_ID` - Role ID for staff who can answer messages

