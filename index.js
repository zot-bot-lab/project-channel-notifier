import dotenv from "dotenv";
dotenv.config();
import { Client, GatewayIntentBits, ChannelType, Events } from "discord.js";
import { initDB, loadDB, saveDB, cleanupDB } from "./src/db.js";
import { fetchNewMessages, hasStaffReply, hasStaffReaction } from "./src/utils.js";

const {
  DISCORD_TOKEN,
  GUILD_ID,
  PROJECT_MGMT_CHANNEL_ID,
  MANAGER_ROLE_ID,
  STAFF_ROLE_ID,
  PROJECT_CATEGORY_ID
} = process.env;

initDB();
const db = loadDB();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot started at ${new Date().toLocaleString()}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const textChannels = guild.channels.cache.filter(ch => {
      if (ch.type !== ChannelType.GuildText) return false;
      if (PROJECT_CATEGORY_ID) return ch.parentId === PROJECT_CATEGORY_ID;
      return ch.parent?.name === "Project Channels";
    });

    console.log(`📁 Scanning ${textChannels.size} text channel(s)...`);

    const unansweredMessages = [];
    const answeredMessageIds = [];

    for (const [channelId, channel] of textChannels) {
      try {
        console.log(`🔍 Checking #${channel.name}...`);
        const lastId = db.lastSeenMessageIds[channel.id];
        const allMessages = await fetchNewMessages(channel, lastId);
        
        if (allMessages.length > 0) {
          const newest = allMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
          db.lastSeenMessageIds[channel.id] = newest.id;
        }

        allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const msg of allMessages) {
          if (msg.author.bot) continue;

          let member = msg.member || await guild.members.fetch(msg.author.id).catch(() => null);
          const hasClientRole = member?.roles.cache.some(role => role.name.endsWith("-ext"));
          if (!hasClientRole) continue;

          const staffReplied = await hasStaffReply(msg, allMessages, MANAGER_ROLE_ID, STAFF_ROLE_ID, guild);
          const staffReacted = staffReplied ? true : await hasStaffReaction(msg, MANAGER_ROLE_ID, STAFF_ROLE_ID, guild);
          const isAnswered = staffReplied || staffReacted;

          if (isAnswered && db.alertedMessages.includes(msg.id)) {
            answeredMessageIds.push(msg.id);
          }

          if (!isAnswered && !db.alertedMessages.includes(msg.id)) {
            unansweredMessages.push({
              messageId: msg.id,
              channelId: channel.id,
              authorName: msg.author.username,
              authorId: msg.author.id,
              messageUrl: msg.url,
            });
          }
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        console.error(`❌ Error in #${channel.name}:`, error.message);
      }
    }

    if (answeredMessageIds.length > 0) {
      db.alertedMessages = db.alertedMessages.filter(id => !answeredMessageIds.includes(id));
      console.log(`✅ Removed ${answeredMessageIds.length} answered message(s)`);
    }

    if (unansweredMessages.length > 0) {
      const pmChannel = await client.channels.fetch(PROJECT_MGMT_CHANNEL_ID);
      
      // Group by Channel -> Author
      const grouped = {};
      for (const msg of unansweredMessages) {
        if (!grouped[msg.channelId]) grouped[msg.channelId] = {};
        if (!grouped[msg.channelId][msg.authorId]) {
          grouped[msg.channelId][msg.authorId] = {
            name: msg.authorName,
            url: msg.messageUrl,
            count: 0,
            ids: []
          };
        }
        grouped[msg.channelId][msg.authorId].count++;
        grouped[msg.channelId][msg.authorId].ids.push(msg.messageId);
      }

      for (const [channelId, authors] of Object.entries(grouped)) {
        let alertContent = `<@&${MANAGER_ROLE_ID}>\n**Unanswered Messages in <#${channelId}>**\n`;
        
        for (const author of Object.values(authors)) {
          const plural = author.count > 1 ? "s" : "";
          alertContent += `• **${author.name}**: ${author.count} message${plural} ([Jump to oldest](${author.url}))\n`;
          db.alertedMessages.push(...author.ids);
        }

        await pmChannel.send(alertContent);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    cleanupDB(db);
    saveDB(db);
    client.destroy();
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    client.destroy();
    process.exit(1);
  }
});

client.login(DISCORD_TOKEN);