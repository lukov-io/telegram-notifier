const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN,
  TG_CHAT_ID = process.env.TG_CHAT_ID,
  GITHUB_RUNNER_TOKEN = process.env.GITHUB_RUNNER_TOKEN,
  GITHUB_REPO = process.env.GITHUB_REPO,
  GITHUB_RUN_ID = process.env.GITHUB_RUN_ID,
  GITHUB_FETCH_OPTIONS = {
    headers: {
      'Accept': 'vnd.github+json',
      'Authorization': `Bearer ${GITHUB_RUNNER_TOKEN}`
    }
  };
let jobs_urls = '',
  json_run,
  json_jobs;

(async () => {
  json_run = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${GITHUB_RUN_ID}`,
    GITHUB_FETCH_OPTIONS).then(data => {
    return data.json()
  });
  json_jobs = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${GITHUB_RUN_ID}/jobs`,
    GITHUB_FETCH_OPTIONS).then(data => {
    return data.json()
  });

  json_jobs.jobs.forEach(job => {
    if (job.name !== 'notify') {
      jobs_urls += `<a href="${job.html_url}">${job.name} - ${job.conclusion}</a>\n`;
    }
  });

  let msg_text = `
<a href="${json_run.actor.html_url}">${json_run.actor.login}</a>'s workflow completed with <a href="${json_run.html_url}">status ${json_run.conclusion}</a>

jobs info:\n${jobs_urls}`;

  let fetch_body = {
    chat_id: TG_CHAT_ID,
    text: msg_text,
    parse_mode: "html",
    disable_notification: false
  };

  console.log(fetch_body);

  await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: `${JSON.stringify(fetch_body)}`
    })
    .then((response) => console.log(response));
})();
