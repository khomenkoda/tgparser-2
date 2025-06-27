require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const schedule = require("node-schedule");
const input = require("input");

// Змінні з .env
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const sessionFileName = "session.txt"; // фіксована назва

const botToken = process.env.BOT_TOKEN;
const targetChannel = process.env.TARGET_CHANNEL;

const rawWords = process.env.SEARCH_WORD.split(",").map((w) => w.trim());
const searchRegexes = rawWords.map(
  (word) =>
    new RegExp(`(?:^|[^а-яіїєґa-zA-Z0-9])${word}(?:[^а-яіїєґa-zA-Z0-9]|$)`, "i")
);
const channelUsernames = process.env.CHANNEL_USERNAME.split(",").map((c) =>
  c.trim()
);

const stringSession = new StringSession(
  fs.existsSync(sessionFileName)
    ? fs.readFileSync(sessionFileName, "utf-8")
    : ""
);

const sentMessageIds = new Set();
let lastCheckedTime = Math.floor(Date.now() / 1000);

// Затримка між запитами до каналів (1000 мс = 1 сек)
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Динамічний fetch
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const formatDate = (timestamp) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString("uk-UA");
};

async function sendBotMessage(message) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: targetChannel,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });

  const json = await res.json();
  if (!json.ok) {
    console.error("❗ Bot API error:", json);
  } else {
    console.log("📩 Бот успішно надіслав повідомлення!");
  }
}

async function initClient() {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => process.env.PHONE_NUMBER,
    password: async () => await input.text("Введи пароль (2FA Telegram): "),
    phoneCode: async () => await input.text("Введи код з Telegram: "),
    onError: (err) => console.log("Login error:", err),
  });

  const savedSession = client.session.save();
  fs.writeFileSync(sessionFileName, savedSession);
  return client;
}

async function checkMessages(client) {
  for (const channelUsername of channelUsernames) {
    try {
      console.log(`📡 Перевірка @${channelUsername}...`);

      const channel = await client.getEntity(channelUsername);
      const messages = await client.getMessages(channel, { limit: 3 }); // менший ліміт

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
          const match = {
            link: `https://t.me/${channelUsername}/${msg.id}`,
            channel: channelUsername,
            date: msg.date,
            words: matchedWords,
          };

          sentMessageIds.add(msgKey);
          if (sentMessageIds.size > 1000)
            sentMessageIds.delete([...sentMessageIds][0]);

          const compiledMessage = `🔔 <b>Увага @${
            match.channel
          }</b>\n🔗 <a href="${
            match.link
          }">Переглянути повідомлення</a>\n🕓 <i>${formatDate(match.date)}</i>`;
          await sendBotMessage(compiledMessage);
        }
      }

      console.log(`✅ Перевірено @${channelUsername}`);
    } catch (err) {
      console.error(`❗ Помилка в @${channelUsername}:`, err);
    }

    await delay(4000); // затримка між каналами
  }

  lastCheckedTime = Math.floor(Date.now() / 1000);
}

async function main() {
  const client = await initClient();
  await checkMessages(client);

  schedule.scheduleJob("*/1 * * * *", async () => {
    await checkMessages(client);
  });

  console.log(" ▶️ Парсер запущено. Бот працює.");
}

main();
