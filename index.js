require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const schedule = require("node-schedule");
const fs = require("fs");

// Змінні з .env
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const phoneNumber = process.env.PHONE_NUMBER;
const sessionFileName = `${process.env.SESSION_NAME || "anon"}.session`;
const targetChannel = process.env.TARGET_CHANNEL;

// Ключові слова для пошуку
const rawWords = process.env.SEARCH_WORD.split(",").map((word) => word.trim());
const searchRegexes = rawWords.map(
  (word) =>
    new RegExp(`(?:^|[^а-яіїєґa-zA-Z0-9])${word}(?:[^а-яіїєґa-zA-Z0-9]|$)`, "i")
);

// Отримання списку каналів без порожніх значень
const channelUsernames = process.env.CHANNEL_USERNAME.split(",")
  .map((c) => c.trim())
  .filter((c) => c.length > 0);

// Завантаження сесії, якщо існує
let sessionString = "";
if (fs.existsSync(sessionFileName)) {
  sessionString = fs.readFileSync(sessionFileName, "utf-8");
  console.log(`📂 Завантажено сесію з ${sessionFileName}`);
} else {
  console.log("📭 Сесійний файл не знайдено. Запуск з нуля.");
}

const stringSession = new StringSession(sessionString);
let lastCheckedTime = Math.floor(Date.now() / 1000);
const sentMessageIds = new Set();

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const formatDate = (timestamp) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
};

async function initClient() {
  console.log("🔌 Ініціалізація Telegram клієнта...");

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => phoneNumber,
    password: async () => await input.text("🔐 Введи пароль (2FA, якщо є): "),
    phoneCode: async () => await input.text("📩 Введи код з Telegram: "),
    onError: (err) => console.log("❗ Login error:", err),
  });

  const savedSession = client.session.save();
  const path = require("path");

  const dir = path.dirname(sessionFileName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(sessionFileName, savedSession);
  console.log(`💾 Сесія збережена у файл: ${sessionFileName}`);

  return client;
}

async function checkMessages(client) {
  try {
    console.log(
      `🔍 Пошук слів: [${rawWords.join(
        ", "
      )}] у каналах: @${channelUsernames.join(", @")}`
    );

    const allMatches = new Map();

    for (const channelUsername of channelUsernames) {
      try {
        console.log(`📡 Перевірка @${channelUsername}...`);

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
              `✅ Збіг у повідомленні ${msg.id}: [${matchedWords.join(", ")}]`
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
            console.log(`❌ Немає збігу у повідомленні ${msg.id}`);
          }
        }

        console.log(`✅ Перевірено @${channelUsername}`);
      } catch (err) {
        console.error(`❗ Помилка при перевірці @${channelUsername}:`, err);
      }
    }

    lastCheckedTime = Math.floor(Date.now() / 1000);

    if (allMatches.size > 0) {
      let compiledMessage = `💛💙 Моніторингові канали повідомляють про Чернігів:\n\n`;

      for (const match of allMatches.values()) {
        compiledMessage += `🔗 <a href="${match.link}">@${
          match.channel
        }</a> — <i>${formatDate(match.date)}</i>\n`;
      }

      await delay(1000);
      client.setParseMode("html");

      await client.sendMessage(targetChannel, {
        message: compiledMessage,
      });

      console.log("📨 Підсумкове повідомлення надіслано!");
    } else {
      console.log("🔍 Нових збігів не знайдено.");
    }

    console.log(new Date() + ": Перевірка завершена.");
  } catch (error) {
    console.error("❗ Загальна помилка в checkMessages:", error);
  }
}

async function main() {
  try {
    const client = await initClient();

    await checkMessages(client); // перший запуск

    schedule.scheduleJob("*/3 * * * *", async () => {
      await checkMessages(client);
    });

    console.log(
      `✅ Парсер працює. Слідкує за @${channelUsernames.join(
        ", @"
      )} кожні 3 хвилини для слів: [${rawWords.join(", ")}]`
    );
  } catch (err) {
    console.error("❗ Помилка в main():", err);
  }
}

main();
