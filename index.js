import dotenv from "dotenv";
dotenv.config();
import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs";

// Load environment variables
const {
  DISCORD_TOKEN,
  GUILD_ID,
  PROJECT_MGMT_CHANNEL_ID,
  MANAGER_ROLE_ID,
} = process.env;

// JSON file to track which messages have been alerted
const DB_FILE = "./db.json";
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ alertedMessages: [] }));

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const db = loadDB();
if (!db.alertedMessages) db.alertedMessages = [];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Fetch messages from the last 3 hours (1 hour buffer for safety)
async function fetchRecentMessages(channel) {
  const messages = [];
  const timeWindow = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
  const cutoffTime = Date.now() - timeWindow;
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);

    for (const msg of batch.values()) {
      // Stop if we've gone past the time window
      if (msg.createdTimestamp < cutoffTime) {
        return messages;
      }
      messages.push(msg);
    }

    // No more messages to fetch
    if (batch.size < 100) break;

    lastId = batch.last().id;

    // If the last message is older than our cutoff, stop
    if (batch.last().createdTimestamp < cutoffTime) break;
  }

  return messages;
}

client.once("ready", async () => {
  console.log(`✅ Bot started at ${new Date().toLocaleString()}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);

    // Get all roles ending with -ext (client roles)
    const clientRoles = guild.roles.cache.filter(role => role.name.endsWith("-ext"));

    if (clientRoles.size === 0) {
      console.log("⚠️  No client roles found ending with '-ext'");
      saveDB(db);
      client.destroy();
      process.exit(0);
      return;
    }

    console.log(`📋 Found ${clientRoles.size} client role(s)`);

    // Get all text channels
    const textChannels = guild.channels.cache.filter(ch => ch.isTextBased());
    console.log(`📁 Scanning ${textChannels.size} text channel(s)...`);

    const unansweredMessages = [];
    const answeredMessageIds = []; // Track messages that got answered

    for (const [channelId, channel] of textChannels) {
      try {
        console.log(`🔍 Checking #${channel.name}...`);

        // Fetch messages from the last 3 hours
        const allMessages = await fetchRecentMessages(channel);
        console.log(`   Found ${allMessages.length} messages in last 3 hours`);

        // Sort messages by timestamp (oldest first)
        allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const msg of allMessages) {
          if (msg.author.bot) continue;

          // Fetch member if not available
          let member = msg.member;
          if (!member) {
            try {
              member = await guild.members.fetch(msg.author.id);
            } catch (error) {
              continue;
            }
          }

          // Check if message author has a client role (ends with -ext)
          const hasClientRole = member?.roles.cache.some(role =>
            role.name.endsWith("-ext")
          );

          if (!hasClientRole) continue;

          // Check if any staff member replied AFTER this message in the same channel
          const hasStaffReply = allMessages.some(replyMsg => {
            // Must be in the same channel
            if (replyMsg.channelId !== msg.channelId) return false;

            // Must be after the client message
            if (replyMsg.createdTimestamp <= msg.createdTimestamp) return false;

            // Skip bot messages
            if (replyMsg.author.bot) return false;

            // Check if replier is staff
            const replyMember = replyMsg.member || guild.members.cache.get(replyMsg.author.id);
            return replyMember?.roles.cache.has(MANAGER_ROLE_ID);
          });

          // Check if any staff member reacted to this message
          const hasStaffReaction = await (async () => {
            if (msg.reactions.cache.size === 0) return false;

            for (const [emoji, reaction] of msg.reactions.cache) {
              try {
                const users = await reaction.users.fetch();
                for (const [userId, user] of users) {
                  if (user.bot) continue;

                  // Fetch member to ensure we have the latest role data
                  try {
                    const reactionMember = await guild.members.fetch(userId);
                    if (reactionMember?.roles.cache.has(MANAGER_ROLE_ID)) {
                      console.log(`   ✓ Staff reaction found: ${emoji} by ${user.username}`);
                      return true; // Staff reacted to this message
                    }
                  } catch (err) {
                    // Member might have left, skip
                    continue;
                  }
                }
              } catch (error) {
                console.error(`   Error fetching reactions for ${emoji}: ${error.message}`);
              }
            }
            return false;
          })();

          const isAnswered = hasStaffReply || hasStaffReaction;

          // Debug logging for unanswered messages
          if (!isAnswered && !db.alertedMessages.includes(msg.id)) {
            console.log(`   ⚠️ Unanswered: "${msg.content.substring(0, 50)}..." by ${msg.author.username}`);
            console.log(`      Staff reply: ${hasStaffReply}, Staff reaction: ${hasStaffReaction}`);
          }

          // If message was previously alerted but now is answered, mark it as answered
          if (isAnswered && db.alertedMessages.includes(msg.id)) {
            answeredMessageIds.push(msg.id);
          }

          // If not answered, and we haven't alerted about this message yet
          if (!isAnswered && !db.alertedMessages.includes(msg.id)) {
            unansweredMessages.push({
              messageId: msg.id,
              channelId: channel.id,
              channelName: channel.name,
              authorName: msg.author.username,
              authorId: msg.author.id,
              messageUrl: msg.url,
              createdAt: msg.createdTimestamp,
            });
          }
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`❌ Error in channel ${channel.name}:`, error.message);
      }
    }

    // Remove answered messages from the database
    if (answeredMessageIds.length > 0) {
      db.alertedMessages = db.alertedMessages.filter(id => !answeredMessageIds.includes(id));
      console.log(`✅ Removed ${answeredMessageIds.length} answered message(s) from tracking`);
    }

    const stillUnanswered = db.alertedMessages.length;

    console.log(`\n📊 Summary:`);
    console.log(`   - New unanswered messages: ${unansweredMessages.length}`);
    console.log(`   - Still unanswered (previously alerted): ${stillUnanswered}`);

    // Send alerts for NEW unanswered messages
    if (unansweredMessages.length > 0) {
      try {
        const pmChannel = await client.channels.fetch(PROJECT_MGMT_CHANNEL_ID);

        // Group alerts (max 5 per message to avoid Discord limits)
        const alertBatches = [];
        for (let i = 0; i < unansweredMessages.length; i += 5) {
          alertBatches.push(unansweredMessages.slice(i, i + 5));
        }

        for (const batch of alertBatches) {
          const alertText = batch.map(m =>
            `**Unanswered**: Message from **${m.authorName}** in <#${m.channelId}> channel. \n[Jump to message](${m.messageUrl})`
          ).join('\n\n');

          await pmChannel.send(`<@&${MANAGER_ROLE_ID}>\n${alertText}`);

          // Mark these messages as alerted
          batch.forEach(m => db.alertedMessages.push(m.messageId));

          // Small delay between batches
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`✅ Sent ${unansweredMessages.length} new alert(s)`);
      } catch (error) {
        console.error(`❌ Error sending alerts:`, error.message);
      }
    } else {
      console.log("✅ No new unanswered messages found");
    }

    // Save database
    saveDB(db);
    console.log("💾 Database saved");

    console.log("👋 Bot finished - shutting down");
    client.destroy();
    process.exit(0);

  } catch (error) {
    console.error("❌ Fatal error:", error);
    saveDB(db);
    client.destroy();
    process.exit(1);
  }
});

client.on("error", (error) => {
  console.error("❌ Client error:", error);
  saveDB(db);
  client.destroy();
  process.exit(1);
});

client.login(DISCORD_TOKEN).catch(error => {
  console.error("❌ Failed to login:", error.message);
  process.exit(1);
});

// Safety timeout - force shutdown after 10 minutes
setTimeout(() => {
  console.log("⏱️  Timeout reached (10 minutes) - forcing shutdown");
  saveDB(db);
  client.destroy();
  process.exit(0);
}, 10 * 60 * 1000);