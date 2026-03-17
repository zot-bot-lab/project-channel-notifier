import fs from "fs";

const DB_FILE = "./db.json";

export function initDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ alertedMessages: [], lastSeenMessageIds: {} }, null, 2));
  }
}

export function loadDB() {
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (!db.alertedMessages) db.alertedMessages = [];
  if (!db.lastSeenMessageIds) db.lastSeenMessageIds = {};
  return db;
}

export function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function cleanupDB(db, retentionDays = 7) {
  const msInDay = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - (retentionDays * msInDay);
  
  const initialCount = db.alertedMessages.length;
  
  // Discord Snowflake timestamp extraction: (id >> 22) + 1420070400000
  db.alertedMessages = db.alertedMessages.filter(id => {
    try {
      const timestamp = Number((BigInt(id) >> 22n) + 1420070400000n);
      return timestamp > cutoff;
    } catch (e) {
      // If ID is invalid, remove it
      return false;
    }
  });

  const removed = initialCount - db.alertedMessages.length;
  if (removed > 0) {
    console.log(`🧹 Database cleanup: Removed ${removed} old message ID(s)`);
  } else {
    console.log(`🧹 Database cleanup: No old messages to remove (Retention: ${retentionDays} days)`);
  }
}
