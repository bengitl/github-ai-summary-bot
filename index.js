const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const TOKEN = process.env.GITHUB_TOKEN;
const MODEL_API = process.env.MODEL_API; // AI endpoint

function verifySignature(req) {
  const signature = req.headers["x-hub-signature-256"];
  const body = JSON.stringify(req.body);
  const hmac = crypto.createHmac("sha256", SECRET);
  const digest = "sha256=" + hmac.update(body).digest("hex");
  return signature === digest;
}

app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) return res.status(401).send("Invalid signature");

  const event = req.headers["x-github-event"];
  const payload = req.body;

  // Auto-reply to Issues
  if (event === "issues" && payload.action === "opened") {
    const issue = payload.issue;
    const aiReply = await generateAIReply(issue.title + "\n" + issue.body);

    await githubComment(issue.comments_url, aiReply);
  }

  // PR check
  if (event === "pull_request" && payload.action === "opened") {
    const pr = payload.pull_request;
    await githubComment(pr.comments_url, "🤖 自动审核中，请稍候…");

    const aiReview = await generateAIReply(
      "请帮我总结并审核这个 Pull Request 内容: " +
        pr.title +
        "\n" +
        pr.body
    );

    await githubComment(pr.comments_url, "### 🤖 AI 审核结果：\n" + aiReview);
  }

  res.send("OK");
});

async function githubComment(url, body) {
  await axios.post(
    url,
    { body },
    { headers: { Authorization: `token ${TOKEN}` } }
  );
}

async function generateAIReply(text) {
  try {
    const res = await axios.post(MODEL_API, { prompt: text });
    return res.data.output || "AI 回复失败";
  } catch (err) {
    return "AI 接口错误: " + err.message;
  }
}

app.get("/", (req, res) => res.send("GitHub Bot is running"));
app.listen(3000);
