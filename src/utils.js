export async function fetchNewMessages(channel, lastSeenId) {
  const messages = [];
  const timeWindow = 24 * 60 * 60 * 1000; // 24 hours fallback
  const cutoffTime = Date.now() - timeWindow;
  let currentLastId;

  while (true) {
    const options = { limit: 100 };
    if (lastSeenId) {
      options.after = lastSeenId;
    } else {
      if (currentLastId) options.before = currentLastId;
    }

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      if (!lastSeenId && msg.createdTimestamp < cutoffTime) {
        return messages;
      }
      messages.push(msg);
    }

    if (batch.size < 100) break;
    
    const sortedBatch = Array.from(batch.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    
    if (options.after) {
      lastSeenId = sortedBatch[sortedBatch.length - 1].id;
    } else {
      currentLastId = sortedBatch[0].id;
    }
  }

  return messages;
}

export async function hasStaffReply(msg, allMessages, MANAGER_ROLE_ID, STAFF_ROLE_ID, guild) {
  for (const replyMsg of allMessages) {
    if (replyMsg.channelId !== msg.channelId) continue;
    if (replyMsg.createdTimestamp <= msg.createdTimestamp) continue;
    if (replyMsg.author.bot) continue;

    let replyMember = replyMsg.member;
    if (!replyMember) {
      try {
        replyMember = await guild.members.fetch(replyMsg.author.id);
      } catch (e) {
        continue;
      }
    }

    if (replyMember && (replyMember.roles.cache.has(MANAGER_ROLE_ID) || replyMember.roles.cache.has(STAFF_ROLE_ID))) {
      return true;
    }
  }
  return false;
}

export async function hasStaffReaction(msg, MANAGER_ROLE_ID, STAFF_ROLE_ID, guild) {
  if (msg.reactions.cache.size === 0) return false;

  for (const [emoji, reaction] of msg.reactions.cache) {
    try {
      const users = await reaction.users.fetch();
      for (const [userId, user] of users) {
        if (user.bot) continue;
        try {
          const reactionMember = await guild.members.fetch(userId);
          if (reactionMember?.roles.cache.has(MANAGER_ROLE_ID) || reactionMember?.roles.cache.has(STAFF_ROLE_ID)) {
            return true;
          }
        } catch (err) {
          continue;
        }
      }
    } catch (error) {
      console.error(`   Error fetching reactions for ${emoji}: ${error.message}`);
    }
  }
  return false;
}
