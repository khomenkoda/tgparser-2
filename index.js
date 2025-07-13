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

// Канал для логів
const logChannel = process.env.LOG_CHANNEL;
const logBuffer = [];

const targetChannel = process.env.TARGET_CHANNEL;

// Токен для alerts.in.ua API
const alertsApiToken = process.env.ALERTS_API_TOKEN;
const chernigivOblatUID = "25"; // UID Чернігівської області

const rawWords = process.env.SEARCH_WORD.split(",").map((w) => w.trim());
const searchRegexes = rawWords.map(
  (word) =>
    new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${word})(?=[^\\p{L}\\p{N}_]|$)`, "iu")
);

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

let isParserRunning = false;
let alertCheckJob = null;
let parserJob = null;
let lastAlertStatus = null; // "A", "P", "N", або null
let isCheckingAlert = false; // Блокування повторної перевірки

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const formatDate = (timestamp) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString("uk-UA");
};

const logWithTime = (message, isError = false) => {
  const now = new Date();
  const timeString = now.toLocaleTimeString("uk-UA", { hour12: false });
  const formatted = `[${timeString}] ${message}`;

  if (isError) {
    console.error(formatted);
  } else {
    console.log(formatted);
  }

  logBuffer.push(formatted);

  // Якщо логів більше 500, очищаємо (перестраховка)
  if (logBuffer.length > 500) {
    logBuffer.splice(0, logBuffer.length - 500);
  }
};

const withTimeout = (promise, ms) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("⏱ Тайм-аут перевірки")), ms)
    ),
  ]);
};

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function checkAirRaidAlert() {
  try {
    logWithTime("🔄 Надсилаємо запит до alerts.in.ua...");
    const url = `https://api.alerts.in.ua/v1/iot/active_air_raid_alerts/${chernigivOblatUID}.json`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${alertsApiToken}`,
        "User-Agent": "TelegramParser/1.0",
        Accept: "application/json",
      },
      timeout: 10000,
    });

    if (!response.ok) {
      if (response.status === 401) {
        logWithTime(
          `❗ Неавторизований доступ до API alerts.in.ua. Перевірте токен!`,
          true
        );
      } else if (response.status === 429) {
        logWithTime(`❗ Перевищено ліміт запитів до API alerts.in.ua`, true);
      } else {
        logWithTime(
          `❗ Помилка API alerts.in.ua: ${response.status} ${response.statusText}`,
          true
        );
      }
      return null;
    }

    const status = await response.text();
    const alertStatus = status.replace(/["\r\n\s]/g, "");

    if (!["A", "P", "N"].includes(alertStatus)) {
      logWithTime(`❗ Отримано невідомий статус тривоги: ${alertStatus}`, true);
      return null;
    }

    const statusText = {
      A: "Активна повітряна тривога",
      P: "Часткова повітряна тривога",
      N: "Немає повітряної тривоги",
    }[alertStatus];

    logWithTime(`🚨 ${statusText} в Чернігівській області`);

    return alertStatus;
  } catch (error) {
    if (error.name === "AbortError") {
      logWithTime(`❗ Таймаут при перевірці повітряної тривоги`, true);
    } else {
      logWithTime(
        `❗ Помилка при перевірці повітряної тривоги: ${error.message}`,
        true
      );
    }
    return null;
  }
}

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

async function checkMessages(client) {
  if (!isParserRunning) {
    logWithTime("⏸ Парсер призупинено - немає повітряної тривоги");
    return;
  }

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

async function startParser(client) {
  if (isParserRunning) {
    logWithTime("⚠️ Парсер вже запущений");
    return;
  }

  isParserRunning = true;
  logWithTime("🟢 Парсер запущено - повітряна тривога активна");

  await sendBotMessage("🚨 Повітряна тривога в Чернігівській області!");

  if (!parserJob) {
    parserJob = schedule.scheduleJob("*/1 * * * *", async () => {
      if (isParserRunning) {
        try {
          await withTimeout(checkMessages(client), 60000);
        } catch (err) {
          logWithTime(`❗ Зависання: ${err.message}`, true);
        }
      }
    });
  }
}

async function stopParser() {
  if (!isParserRunning) {
    logWithTime("⚠️ Парсер вже зупинений");
    return;
  }

  isParserRunning = false;

  if (parserJob) {
    parserJob.cancel();
    parserJob = null;
  }

  logWithTime("🔴 Парсер зупинено - повітряна тривога завершена");

  await sendBotMessage("✅ Відбій повітряної тривоги в Чернігівській області.");
}

async function monitorAirRaidAlerts(client) {
  if (isCheckingAlert) {
    logWithTime("⚠️ Попередня перевірка не завершена — пропускаємо цей цикл");
    return;
  }
  isCheckingAlert = true;

  try {
    const alertStatus = await checkAirRaidAlert();

    if (alertStatus === null) {
      logWithTime(
        "⚠️ Не вдалося отримати стан повітряної тривоги, використовуємо попередній стан",
        true
      );
      return;
    }

    if (alertStatus !== lastAlertStatus) {
      logWithTime(`🔁 Зміна стану: ${lastAlertStatus} → ${alertStatus}`);
      lastAlertStatus = alertStatus;

      if (alertStatus === "A" || alertStatus === "P") {
        await startParser(client);
      } else if (alertStatus === "N") {
        await stopParser();
      }
    } else {
      logWithTime("ℹ️ Стан тривоги не змінився, нічого не робимо.");
    }
  } finally {
    isCheckingAlert = false;
  }
}

// Заплановане завдання для надсилання логів кожні 5 хвилину у Telegram канал
schedule.scheduleJob("*/5 * * * *", async () => {
  if (logBuffer.length === 0) return;

  const recentLogs = logBuffer.join("\n");
  logBuffer.length = 0; // очищаємо після надсилання

  const message = `<b>📋 Зведення логів за 5 хвилин:</b>\n<pre>${recentLogs}</pre>`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: logChannel,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    console.log(`[LOGS] ✅ Надіслано логи за останні 5 хв`);
  } catch (err) {
    console.error(`[LOGS] ❗ Помилка надсилання логів: ${err.message}`);
  }
});

async function main() {
  if (!alertsApiToken) {
    logWithTime(
      "❗ Не знайдено токен для alerts.in.ua API (ALERTS_API_TOKEN)",
      true
    );
    process.exit(1);
  }

  const client = await initClient();

  await monitorAirRaidAlerts(client);

  if (!alertCheckJob) {
    alertCheckJob = schedule.scheduleJob("*/2 * * * *", async () => {
      try {
        await withTimeout(monitorAirRaidAlerts(client), 25000);
      } catch (err) {
        logWithTime(
          `❗ Помилка при моніторингу повітряних тривог: ${err.message}`,
          true
        );
      }
    });
  }

  logWithTime("🚀 Система моніторингу повітряних тривог запущена");
  logWithTime("📡 Перевірка стану повітряної тривоги щохвилини");
  logWithTime("🔍 Парсер запускається тільки під час повітряної тривоги");
}

function cleanup() {
  if (alertCheckJob) {
    alertCheckJob.cancel();
    alertCheckJob = null;
  }
  if (parserJob) {
    parserJob.cancel();
    parserJob = null;
  }
}

process.on("SIGINT", () => {
  logWithTime("🛑 Завершення програми...");
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logWithTime("🛑 Завершення програми...");
  cleanup();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  logWithTime(`❗ Необроблена помилка: ${err.message}`, true);
  cleanup();
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logWithTime(`❗ Необроблений відхилений проміс: ${reason}`, true);
  cleanup();
  process.exit(1);
});

main().catch((err) => {
  logWithTime(`❗ Критична помилка: ${err.message}`, true);
  process.exit(1);
});
