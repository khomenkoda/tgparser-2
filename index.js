require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const schedule = require("node-schedule");
const input = require("input");

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const sessionFileName = "session.txt";
const botToken = process.env.BOT_TOKEN;
const targetChannel = process.env.TARGET_CHANNEL;

// Пошукові слова (різні форми Чернігова)
const rawWords = process.env.SEARCH_WORD.split(",").map((w) => w.trim());
const searchRegexes = rawWords.map(
  (word) => new RegExp(`(?:^|\\W)${word}(?:\\W|$)`, "iu")
);

// Унікальні канали
const channelUsernames = [
  ...new Set(process.env.CHANNEL_USERNAME.split(",").map((c) => c.trim())),
];

const stringSession = new StringSession(
  fs.existsSync(sessionFileName)
    ? fs.readFileSync(sessionFileName, "utf-8")
    : ""
);

const sentMessageIds = new Set();
let lastCheckedTime = Math.floor(Date.now() / 1000);

// Затримка
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Динамічний імпорт fetch
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

// Форматування дати
const formatDate = (timestamp) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString("uk-UA");
};

// Логування з часом
const logWithTime = (message, isError = false) => {
  const now = new Date();
  const timeString = now.toLocaleTimeString("uk-UA", { hour12: false });
  if (isError) {
    console.error(`[${timeString}] ${message}`);
  } else {
    console.log(`[${timeString}] ${message}`);
  }
};

// Таймаут
const withTimeout = (promise, ms) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("⏱ Тайм-аут перевірки")), ms)
    ),
  ]);
};

// Перемішування масиву
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Надсилання повідомлення в Telegram через Bot API
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
    logWithTime(`❗ Bot API error: ${JSON.stringify(json)}`, true);
  } else {
    logWithTime("📩 📩 📩 Бот успішно надіслав повідомлення!");
  }
}

// Telegram авторизація
async function initClient() {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => process.env.PHONE_NUMBER,
    password: async () => await input.text("Введи пароль (2FA Telegram): "),
    phoneCode: async () => await input.text("Введи код з Telegram: "),
    onError: (err) => logWithTime(`Login error: ${err.message}`, true),
  });

  const savedSession = client.session.save();
  fs.writeFileSync(sessionFileName, savedSession);
  return client;
}

// Основна перевірка повідомлень
async function checkMessages(client) {
  let prevChannel = null;
  const shuffledChannels = shuffleArray(channelUsernames);

  for (const channelUsername of shuffledChannels) {
    if (channelUsername === prevChannel) {
      logWithTime(`⏭ Пропущено повторне опитування @${channelUsername}`);
      continue;
    }
    prevChannel = channelUsername;

    try {
      logWithTime(`📡 Перевірка @${channelUsername}...`);

      const channel = await client.getEntity(channelUsername);
      const messages = await client.getMessages(channel, { limit: 3 });

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
          const link = `https://t.me/${channelUsername}/${msg.id}`;
          const compiled = `🔔 <b>Увага @${channelUsername}</b>\n🔗 <a href="${link}">Переглянути</a>\n🕓 <i>${formatDate(
            msg.date
          )}</i>`;
          await sendBotMessage(compiled);

          sentMessageIds.add(msgKey);
          if (sentMessageIds.size > 1000)
            sentMessageIds.delete([...sentMessageIds][0]);
        }
      }

      logWithTime(`✅ Перевірено @${channelUsername}`);
    } catch (err) {
      logWithTime(`❗ Помилка в @${channelUsername}: ${err.message}`, true);
    }

    await delay(2000 + Math.random() * 2000);
  }

  lastCheckedTime = Math.floor(Date.now() / 1000);
}

// Запуск
async function main() {
  const client = await initClient();
  await checkMessages(client);

  schedule.scheduleJob("*/1 * * * *", async () => {
    try {
      await withTimeout(checkMessages(client), 60000);
    } catch (err) {
      logWithTime(`❗ Зависання: ${err.message}`, true);
      process.exit(1);
    }
  });

  logWithTime("▶️▶️▶️ Парсер запущено. Бот працює.");
}

main();
