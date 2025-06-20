require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const schedule = require("node-schedule");

// Telegram API credentials from .env
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const phoneNumber = process.env.PHONE_NUMBER;
const channelUsernames = process.env.CHANNEL_USERNAME.split(",").map((c) =>
  c.trim()
);
const sessionName = process.env.SESSION_NAME;
const targetChannel = process.env.TARGET_CHANNEL;

// Parse search words and create regexes with word boundaries
const rawWords = process.env.SEARCH_WORD.split(",").map((word) => word.trim());
const searchRegexes = rawWords.map(
  (word) =>
    new RegExp(`(?:^|[^а-яіїєґa-zA-Z0-9])${word}(?:[^а-яіїєґa-zA-Z0-9]|$)`, "i")
);

// Initialize session
const stringSession = new StringSession("");

// 🕓 Store last checked time (in seconds since epoch)
let lastCheckedTime = Math.floor(Date.now() / 1000);

// Delay helper
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Format date
const formatDate = (timestamp) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
};

// Telegram login and client init
async function initClient() {
  console.log("Initializing Telegram client...");

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => phoneNumber,
    password: async () => await input.text("Please enter your password: "),
    phoneCode: async () =>
      await input.text("Please enter the code you received: "),
    onError: (err) => console.log(err),
  });

  console.log("Client initialized!");
  console.log("Session string:", client.session.save());

  return client;
}

// Core function to check messages
async function checkMessages(client) {
  try {
    console.log(
      `Checking for words: [${rawWords.join(
        ", "
      )}] in channels: @${channelUsernames.join(", @")}`
    );

    for (const channelUsername of channelUsernames) {
      try {
        console.log(`Checking @${channelUsername}...`);

        const channel = await client.getEntity(channelUsername);
        const messages = await client.getMessages(channel, { limit: 10 });

        const matchingMessages = [];

        for (const msg of messages) {
          console.log(
            `📩 [${channelUsername}] Message ID ${msg.id}:`,
            msg.text
          );

          if (!msg.text || Math.floor(msg.date) < lastCheckedTime) continue;

          const matchedWords = rawWords.filter((_, i) =>
            searchRegexes[i].test(msg.text)
          );
          if (matchedWords.length > 0) {
            console.log(
              `✅ Match found in message ID ${msg.id}: [${matchedWords.join(
                ", "
              )}]`
            );
            matchingMessages.push(msg);
          } else {
            console.log(`❌ No match in message ID ${msg.id}`);
          }
        }

        for (const msg of matchingMessages) {
          const messageLink = `https://t.me/${channelUsername}/${msg.id}`;
          const foundWords = rawWords.filter((_, i) =>
            searchRegexes[i].test(msg.text)
          );

          console.log(
            `🔗 Sending to target: [${foundWords.join(
              ", "
            )}] in @${channelUsername}: ${messageLink}`
          );

          await delay(4000); // Delay before sending

          client.setParseMode("html");
          await client.sendMessage(targetChannel, {
            message: `💛💙 [${foundWords.join(", ")}]: ${messageLink}
<br><i>Date: ${formatDate(msg.date)}</i>`,
          });
        }

        console.log(`✅ Done with @${channelUsername}`);
      } catch (err) {
        console.error(`❗ Error checking @${channelUsername}:`, err);
      }
    }

    // 🕓 Update time marker to "now"
    lastCheckedTime = Math.floor(Date.now() / 1000);

    console.log(new Date() + ": All channels checked.");
  } catch (error) {
    console.error("❗ General error in checkMessages:", error);
  }
}

// Main function
async function main() {
  try {
    const client = await initClient();

    await checkMessages(client); // initial run

    schedule.scheduleJob("*/1 * * * *", async () => {
      await checkMessages(client);
    });

    console.log(
      `✅ Parser running. Watching @${channelUsernames.join(
        ", @"
      )} for [${rawWords.join(", ")}] every 1 minute.`
    );
  } catch (err) {
    console.error("❗ Error in main():", err);
  }
}

main();
