require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const schedule = require("node-schedule");

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const phoneNumber = process.env.PHONE_NUMBER;
const channelUsernames = process.env.CHANNEL_USERNAME.split(",").map((c) =>
  c.trim()
);
const sessionName = process.env.SESSION_NAME;
const targetChannel = process.env.TARGET_CHANNEL;

const rawWords = process.env.SEARCH_WORD.split(",").map((word) => word.trim());
const searchRegexes = rawWords.map(
  (word) =>
    new RegExp(`(?:^|[^а-яіїєґa-zA-Z0-9])${word}(?:[^а-яіїєґa-zA-Z0-9]|$)`, "i")
);

const stringSession = new StringSession("");
let lastCheckedTime = Math.floor(Date.now() / 1000);
const sentMessageIds = new Set();

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const formatDate = (timestamp) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
};

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

async function checkMessages(client) {
  try {
    console.log(
      `Checking for words: [${rawWords.join(
        ", "
      )}] in channels: @${channelUsernames.join(", @")}`
    );

    const allMatches = new Map();

    for (const channelUsername of channelUsernames) {
      try {
        console.log(`Checking @${channelUsername}...`);

        const channel = await client.getEntity(channelUsername);
        const messages = await client.getMessages(channel, { limit: 5 });

        for (const msg of messages) {
          const msgKey = `${channelUsername}:${msg.id}`;
          if (
            !msg.text ||
            Math.floor(msg.date) < lastCheckedTime ||
            sentMessageIds.has(msgKey)
          )
            continue;

          const matchedWords = rawWords.filter((_, i) =>
            searchRegexes[i].test(msg.text)
          );

          if (matchedWords.length > 0) {
            console.log(
              `✅ Match found in message ID ${msg.id}: [${matchedWords.join(
                ", "
              )}]`
            );

            allMatches.set(msgKey, {
              link: `https://t.me/${channelUsername}/${msg.id}`,
              channel: channelUsername,
              date: msg.date,
              words: matchedWords,
            });

            sentMessageIds.add(msgKey);
            if (sentMessageIds.size > 1000) {
              const oldest = [...sentMessageIds][0];
              sentMessageIds.delete(oldest);
            }
          } else {
            console.log(`❌ No match in message ID ${msg.id}`);
          }
        }

        console.log(`✅ Done with @${channelUsername}`);
      } catch (err) {
        console.error(`❗ Error checking @${channelUsername}:`, err);
      }
    }

    lastCheckedTime = Math.floor(Date.now() / 1000);

    if (allMatches.size > 0) {
      let compiledMessage = `💛💙 Моніторингові канали повідомляють про Чернігів: \n\n`;

      for (const match of allMatches.values()) {
        compiledMessage += `🔗 <a href="${match.link}">@${
          match.channel
        }</a> — <i>${formatDate(match.date)}</i>\n`;
      }

      await delay(3000);
      client.setParseMode("html");

      await client.sendMessage(targetChannel, {
        message: compiledMessage,
      });

      console.log("📨 Compiled message sent!");
    } else {
      console.log("🔍 No new matches found.");
    }

    console.log(new Date() + ": All channels checked.");
  } catch (error) {
    console.error("❗ General error in checkMessages:", error);
  }
}

async function main() {
  try {
    const client = await initClient();

    await checkMessages(client); // initial run

    schedule.scheduleJob("*/3 * * * *", async () => {
      await checkMessages(client);
    });

    console.log(
      `✅ Parser running. Watching @${channelUsernames.join(
        ", @"
      )} for [${rawWords.join(", ")}] every 3 minutes.`
    );
  } catch (err) {
    console.error("❗ Error in main():", err);
  }
}

main();
