const fs = require('fs');
const path = require('path');

let core;
try {
  core = require('@actions/core');
} catch {
  core = {
    setFailed: (message) => {
      console.error(message);
      process.exitCode = 1;
    }
  };
}

const SHOULD_BE_SKIPPED = process.env.INPUT_SHOULD_BE_SKIPPED || process.env.SHOULD_BE_SKIPPED,
  DEBUG = process.env.INPUT_DEBUG || process.env.DEBUG,
  TG_BOT_TOKEN = process.env.INPUT_TG_BOT_TOKEN || process.env.TG_BOT_TOKEN,
  TG_CHAT_ID = process.env.INPUT_TG_CHAT_ID || process.env.TG_CHAT_ID,
  TG_TOPIC_ID = process.env.INPUT_TG_TOPIC_ID || process.env.TG_TOPIC_ID,
  TG_MSG = process.env.INPUT_TG_MSG || process.env.TG_MSG,
  TG_DOCUMENT = process.env.INPUT_TG_DOCUMENT || process.env.TG_DOCUMENT,
  TG_DOCUMENT_CAPTION = process.env.INPUT_TG_DOCUMENT_CAPTION || process.env.TG_DOCUMENT_CAPTION,
  TG_PARSE_MODE = process.env.INPUT_TG_PARSE_MODE || process.env.TG_PARSE_MODE,
  GITHUB_RUNNER_TOKEN = process.env.INPUT_GITHUB_RUNNER_TOKEN || process.env.GITHUB_RUNNER_TOKEN,
  GITHUB_REPO = process.env.INPUT_GITHUB_REPO || process.env.GITHUB_REPOSITORY,
  GITHUB_RUN_ID = process.env.INPUT_GITHUB_RUN_ID || process.env.GITHUB_RUN_ID,
  GITHUB_REF_NAME = process.env.GITHUB_REF_NAME,
  NEEDS = process.env.INPUT_NEEDS || process.env.NEEDS,
  GITHUB_FETCH_OPTIONS = {
    headers: {
      'Accept': 'vnd.github+json',
      'Authorization': `Bearer ${GITHUB_RUNNER_TOKEN}`
    }
  };

let jobs_urls = '',
  msg_text = '',
  json_needs,
  json_run,
  json_jobs,
  conclusion;

(async () => {
  try {
    if (SHOULD_BE_SKIPPED === 'true') return;

    if (!TG_MSG && !TG_DOCUMENT) {
      const defaultMessage = await buildDefaultMessage();
      if (!defaultMessage) {
        core.setFailed('TG_MSG or TG_DOCUMENT is required');
        return;
      }
      await sendMessage(resolveTelegramTarget(TG_CHAT_ID, TG_TOPIC_ID), defaultMessage);
      return;
    }

    const telegramTarget = resolveTelegramTarget(TG_CHAT_ID, TG_TOPIC_ID);

    if (TG_DOCUMENT) {
      await sendDocument(telegramTarget);
    }

    if (TG_MSG) {
      await sendMessage(telegramTarget);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
})();

async function sendMessage(telegramTarget, messageText = null) {
  let msg_text = messageText;

  if (!msg_text) {
    msg_text = TG_MSG;
  }

  if (isDebugEnabled()) {
    msg_text = appendDebugInfo(msg_text);
  }

  let fetch_body = {
    chat_id: telegramTarget.chatId,
    text: msg_text,
    disable_notification: false
  };

  if (TG_PARSE_MODE) {
    fetch_body.parse_mode = TG_PARSE_MODE;
  }

  if (
    telegramTarget.topicId
    && (
      (TG_CHAT_ID && TG_CHAT_ID.includes('_'))
      || telegramTarget.hasLinkInput
    )
  ) {
    fetch_body.message_thread_id = telegramTarget.topicId;
  }

  const resp = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(fetch_body)
  });

  await handleTelegramResponse(resp, fetch_body);
}

async function sendDocument(telegramTarget) {
  if (!fs.existsSync(TG_DOCUMENT)) {
    core.setFailed(`Document not found: ${TG_DOCUMENT}`);
    return;
  }

  const fileBuffer = fs.readFileSync(TG_DOCUMENT);
  const fileName = path.basename(TG_DOCUMENT);
  const form = new FormData();

  form.append('chat_id', telegramTarget.chatId);
  form.append('document', new Blob([fileBuffer]), fileName);

  const caption = TG_DOCUMENT_CAPTION || TG_MSG || '';
  if (caption) {
    form.append('caption', caption);
  }

  if (
    telegramTarget.topicId
    && (
      (TG_CHAT_ID && TG_CHAT_ID.includes('_'))
      || telegramTarget.hasLinkInput
    )
  ) {
    form.append('message_thread_id', telegramTarget.topicId);
  }

  const resp = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form
  });

  await handleTelegramResponse(resp, {
    chat_id: telegramTarget.chatId,
    document: fileName,
    caption
  });
}

async function handleTelegramResponse(resp, requestBody) {
  const responseText = await resp.text();

  if (isDebugEnabled()) {
    console.log({
      request: requestBody,
      status: resp.status,
      statusText: resp.statusText,
      ok: resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
      body: responseText || '<empty>'
    });
  }

  if (!resp.ok) {
    core.setFailed(`Telegram API error ${resp.status}: ${responseText || '<empty>'}`);
  }
}

async function buildDefaultMessage() {
  jobs_urls = '';
  await prepareMsgText();
  return msg_text || null;
}

async function prepareMsgText() {
  json_run = await getData(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${GITHUB_RUN_ID}`,
    GITHUB_FETCH_OPTIONS);
  json_jobs = await getData(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${GITHUB_RUN_ID}/jobs`,
    GITHUB_FETCH_OPTIONS);

  if (json_run && json_jobs) {
    conclusion = json_run.conclusion;

    if (NEEDS) {
      json_needs = JSON.parse(NEEDS);
      const jobsArray = Object.keys(json_needs);

      json_jobs.jobs.forEach(job => {
        if (jobsArray.includes(job.name)) {
          jobs_urls += `<a href="${job.html_url}">${job.name} - ${job.conclusion}</a>\n`;
        }

        setConclusion(job.conclusion);
      });
    } else {
      json_jobs.jobs.forEach(job => {
        jobs_urls += `<a href="${job.html_url}">${job.name} - ${job.conclusion}</a>\n`;
        setConclusion(job.conclusion);
      });
    }

    msg_text = `${json_run.name} \nДеплой на ветке <b><u>${GITHUB_REF_NAME}</u></b> завершен со статусом <a href="${json_run.html_url}">${conclusion}</a>, пользователем <a href="${json_run.triggering_actor.html_url}">${json_run.triggering_actor.login}</a>, попытка: ${json_run.run_attempt}\n\nПодзадачи:\n${jobs_urls}`;
    return;
  }

  const runName = json_run?.name || GITHUB_RUN_ID || 'workflow';
  msg_text = `${runName} \nОшибка <a href="https://github.com/${GITHUB_REPO}/actions/runs/${GITHUB_RUN_ID}">деплоя</a>`;
}

function setConclusion(jobConclusion) {
  if (json_run.conclusion === null) {
    if (conclusion !== 'cancelled') {
      if (conclusion !== 'failure') {
        if (jobConclusion !== null) {
          conclusion = jobConclusion;
        }
      }
    }
  }
}
async function getData(url, opt) {
  try {
    const response = await fetch(url, opt);
    if (!response.ok) {
      const responseText = await response.text();
      const errorMessage = `Response status: ${response.status}`;

      if (isDebugEnabled()) {
        console.error({
          message: errorMessage,
          url,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseText || '<empty>'
        });
      } else {
        console.error(`${errorMessage}; body: ${responseText || '<empty>'}`);
      }

      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(error.message);
    return null;
  }
}

function isDebugEnabled() {
  return String(DEBUG).toLowerCase() === 'true';
}

function resolveTelegramTarget(chatIdInput, topicIdInput) {
  const chatLinkData = parseTelegramLink(chatIdInput);
  const topicLinkData = parseTelegramLink(topicIdInput);
  let resolvedChatId = chatIdInput;
  let resolvedTopicId = topicIdInput;
  let hasLinkInput = false;

  if (chatLinkData) {
    hasLinkInput = true;
    resolvedChatId = chatLinkData.chatId;
    if (!resolvedTopicId && chatLinkData.topicId) {
      resolvedTopicId = chatLinkData.topicId;
    }
  }

  if (topicLinkData) {
    hasLinkInput = true;
    resolvedTopicId = topicLinkData.topicId || '';

    if (!resolvedChatId || chatLinkData) {
      resolvedChatId = topicLinkData.chatId;
    }
  }

  return {
    chatId: resolvedChatId,
    topicId: resolvedTopicId,
    hasLinkInput
  };
}

function parseTelegramLink(value) {
  if (!value || typeof value !== 'string') return null;
  const rawValue = value.trim();
  if (!rawValue) return null;

  const normalizedValue = rawValue.startsWith('http://') || rawValue.startsWith('https://')
    ? rawValue
    : `https://${rawValue}`;

  try {
    const parsedUrl = new URL(normalizedValue);
    if (!['t.me', 'www.t.me', 'telegram.me'].includes(parsedUrl.hostname)) return null;

    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathSegments[0] !== 'c') return null;
    if (!/^\d+$/.test(pathSegments[1])) return null;

    const chatId = `-100${pathSegments[1]}`;
    const topicId = pathSegments[2] && /^\d+$/.test(pathSegments[2]) ? pathSegments[2] : '';

    return { chatId, topicId };
  } catch {
    return null;
  }
}

function appendDebugInfo(baseText) {
  const debugEnv = {
    SHOULD_BE_SKIPPED,
    DEBUG,
    GITHUB_REPO,
    GITHUB_RUN_ID,
    GITHUB_REF_NAME,
    TG_CHAT_ID,
    TG_TOPIC_ID: TG_TOPIC_ID || '<empty>',
    TG_PARSE_MODE,
    TG_DOCUMENT: TG_DOCUMENT || '<empty>',
    TG_DOCUMENT_CAPTION: TG_DOCUMENT_CAPTION || '<empty>',
    GITHUB_RUNNER_TOKEN: maskSecret(GITHUB_RUNNER_TOKEN),
    TG_BOT_TOKEN: maskSecret(TG_BOT_TOKEN)
  };

  const debugLines = Object.entries(debugEnv).map(
    ([key, value]) => `${key}=${escapeHtml(String(value))}`
  );
  return `${baseText}\n\n---\nDEBUG ENV:\n${debugLines.join('\n')}`;
}

function maskSecret(value) {
  if (!value) return '[empty]';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
