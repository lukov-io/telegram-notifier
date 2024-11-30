const TG_BOT_TOKEN = process.env.INPUT_TG_BOT_TOKEN,
  TG_CHAT_ID = process.env.INPUT_TG_CHAT_ID,
  TG_TOPIC_ID = process.env.INPUT_TG_TOPIC_ID,
  TG_MSG = process.env.INPUT_TG_MSG,
  GITHUB_RUNNER_TOKEN = process.env.INPUT_GITHUB_RUNNER_TOKEN,
  GITHUB_REPO = process.env.INPUT_GITHUB_REPO || process.env.GITHUB_REPOSITORY,
  GITHUB_RUN_ID = process.env.INPUT_GITHUB_RUN_ID || process.env.GITHUB_RUN_ID,
  GITHUB_REF_NAME = process.env.GITHUB_REF_NAME,
  NEEDS = process.env.INPUT_NEEDS,
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
  if (TG_MSG) {
    msg_text = TG_MSG;
  } else {
    await prepareMsgText();
  }

  let fetch_body = {
    chat_id: TG_CHAT_ID,
    text: msg_text,
    parse_mode: "html",
    disable_notification: false
  };

  if (TG_TOPIC_ID) fetch_body.message_thread_id = TG_TOPIC_ID;

  await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: `${JSON.stringify(fetch_body)}`
    })
    .catch((err) => console.log(err));

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
        let jobsArray = [];

        Object.keys(json_needs).forEach(key => {
          jobsArray.push(key);
        });

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

      msg_text = `Деплой на ветке <b><u>${GITHUB_REF_NAME}</u></b> завершен со статусом <a href="${json_run.html_url}">${conclusion}</a>, пользователем <a href="${json_run.actor.html_url}">${json_run.actor.login}</a>, попыток: ${json_run.run_attempt}\n\nПодзадачи:\n${jobs_urls}`;
    } else {
      msg_text = `Ошибка <a href="https://github.com/${GITHUB_REPO}/actions/runs/${GITHUB_RUN_ID}">деплоя</a>`;
    }
  }
})();

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
      throw new Error(`Response status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(error.message);
  }
}
