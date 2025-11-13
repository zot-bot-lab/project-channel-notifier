import dotenv from "dotenv";
dotenv.config();
import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs";

// Load environment variables
const {
  DISCORD_TOKEN,
  GUILD_ID,
  PROJECT_MGMT_CHANNEL_ID,
  STAFF_ROLE_ID,
} = process.env;

// Testing mode - set to false for production
const TESTING = true;
const TEST_WAIT_TIME = 2 * 60 * 1000; // 2 minutes
const TEST_ALERT_COOLDOWN = 1 * 60 * 1000; // 1 minute
const PROD_WAIT_TIME = 45 * 60 * 1000; // 45 minutes
const PROD_ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutes

// JSON file to store message tracking and snooze/handled states
const DB_FILE = "./db.json";
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const db = loadDB();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once("clientReady", async () => {
  console.log(`✅ Bot started at ${new Date().toLocaleString()}`);

  const guild = await client.guilds.fetch(GUILD_ID);
  
  // Get all roles ending with -ext (client roles)
  const clientRoles = guild.roles.cache.filter(role => role.name.endsWith("-ext"));
  
  if (clientRoles.size === 0) {
    console.log("⚠️  No client roles found ending with '-ext'");
    if (TESTING) {
      console.log("🧪 Testing mode - bot will stay online. Press Ctrl+C to stop.");
    } else {
      client.destroy();
    }
    return;
  }

  // Get all text channels
  const textChannels = guild.channels.cache.filter(ch => ch.isTextBased());

  const now = Date.now();
  const alertMessages = [];

  for (const [channelId, channel] of textChannels) {
    try {
      const msgs = await channel.messages.fetch({ limit: 20 });

      if (msgs.size === 0) continue;

      for (const [msgId, msg] of msgs) {
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

        // Check if message author has a role ending with -ext
        const hasClientRole = member?.roles.cache.some(role => 
          role.name.endsWith("-ext")
        );

        if (!hasClientRole) continue;

        const authorRoles = member.roles.cache
          .filter(role => role.name.endsWith("-ext"))
          .map(role => role.name)
          .join(', ');

        // Check if staff replied to this message
        // Staff reply = any message from staff sent AFTER this client message
        const staffReplies = [];

        for (const [replyId, replyMsg] of msgs) {
          // Skip if it's the same message or older than client message
          if (replyMsg.createdTimestamp <= msg.createdTimestamp) continue;

          // Fetch member for this message if needed
          let replyMember = replyMsg.member;
          if (!replyMember) {
            try {
              replyMember = await guild.members.fetch(replyMsg.author.id);
            } catch (error) {
              continue;
            }
          }

          // Check if this is a staff member
          const hasStaffRole = replyMember?.roles.cache.has(STAFF_ROLE_ID);
          
          if (hasStaffRole) {
            staffReplies.push(replyMsg);
          }
        }

        const staffReplied = staffReplies.length > 0;

        if (staffReplied) continue;

        // No staff reply, check if we should alert
        const key = `${channel.id}-${msg.id}`;
        const existing = db[key] || {};

        const lastAlert = existing.lastAlert || 0;
        const snoozedUntil = existing.snoozedUntil || 0;
        const handled = existing.handled || false;

        // Skip if handled or snoozed
        if (handled || snoozedUntil > now) continue;

        const msgAge = now - msg.createdTimestamp;

        const waitTime = TESTING ? TEST_WAIT_TIME : PROD_WAIT_TIME;
        const isOld = msgAge > waitTime;

        // Check night hours (only in production)
        const isNight = new Date().getHours() < 8 || new Date().getHours() >= 21;
        const nightCheck = !TESTING && isNight && msgAge < 12 * 60 * 60 * 1000;

        if (isOld || nightCheck) {
          const cooldown = TESTING ? TEST_ALERT_COOLDOWN : PROD_ALERT_COOLDOWN;

          if (now - lastAlert > cooldown) {
            alertMessages.push(
              `<@&${STAFF_ROLE_ID}> Message from **${msg.author.username}** in <#${channel.id}>\n[Jump to message](${msg.url})`
            );
            db[key] = { lastAlert: now, handled: false };
            
            console.log(`📨 Alert queued for message from ${msg.author.username} in #${channel.name}`);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error in channel ${channel.name}:`, error.message);
    }
  }

  // Send alerts
  if (alertMessages.length) {
    try {
      const pmChannel = await client.channels.fetch(PROJECT_MGMT_CHANNEL_ID);
      
      for (const alert of alertMessages) {
        await pmChannel.send(alert);
      }
      
      console.log(`✅ Sent ${alertMessages.length} alert(s)`);
    } catch (error) {
      console.error(`❌ Error sending alerts:`, error.message);
    }
  } else {
    console.log("✅ No alerts needed");
  }

  // Save database
  saveDB(db);
  
  if (TESTING) {
    console.log("🧪 Testing mode - bot will stay online. Press Ctrl+C to stop.");
  } else {
    console.log("👋 Bot finished");
    client.destroy();
  }
});

client.on("error", (error) => {
  console.error("❌ Client error:", error);
});

client.login(DISCORD_TOKEN).catch(error => {
  console.error("❌ Failed to login:", error.message);
  process.exit(1);
});