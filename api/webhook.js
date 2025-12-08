import { Webhooks } from "@octokit/webhooks";
import axios from "axios";

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET
});

webhooks.on("pull_request.opened", async ({ payload }) => {
  const pr = payload.pull_request;
  const diffUrl = pr.diff_url;

  const diff = await axios.get(diffUrl).then(r => r.data);

  const summary = await axios.post("https://api-inference.modelscope.cn/v1/chat/completions", {
    model: "qwen-turbo",
    messages: [{ role: "user", content: "Summarize this diff:\n" + diff }]
  }).then(r => r.data.choices[0].message.content);

  await axios.post(
    payload.repository.comments_url.replace("{/number}", ""),
    { body: "🤖 **AI Summary**:\n" + summary },
    { headers: { Authorization: `token ${process.env.GITHUB_APP_TOKEN}` } }
  );
});

export default async function handler(req, res) {
  try {
    await webhooks.verifyAndReceive({
      id: req.headers["x-github-delivery"],
      name: req.headers["x-github-event"],
      signature: req.headers["x-hub-signature-256"],
      payload: req.body
    });

    res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    res.status(400).send("Webhook Error");
  }
}
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK (POST required)");
  }

  console.log("Received:", req.body);
  res.status(200).json({ received: true });
}
