import crypto from "crypto";
import axios from "axios";

const SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const TOKEN = process.env.GITHUB_TOKEN;
const MODEL_API = process.env.MODEL_API;

// Verify GitHub signature
function verifySignature(reqBody, signature) {
  const hmac = crypto.createHmac("sha256", SECRET);
  const digest = "sha256=" + hmac.update(reqBody).digest("hex");
  return signature === digest;
}

// Github comment helper
async function githubComment(url, body) {
  await axios.post(
    url,
    { body },
    { headers: { Authorization: `token ${TOKEN}` } }
  );
}

// AI generator
async function generateAIReply(text) {
  try {
    const response = await axios.post(MODEL_API, { prompt: text });
    return response.data.output || "AI 回复失败";
  } catch (error) {
    return "AI 接口错误: " + error.message;
  }
}

// --------- VERCEL HANDLER (NO EXPRESS) ---------- //
export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("GitHub Bot is running (Vercel)");
  }

  // Must read raw body to verify signature
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", resolve);
  });

  const signature = req.headers["x-hub-signature-256"];
  if (!verifySignature(rawBody, signature)) {
    return res.status(401).send("Invalid signature");
  }

  const event = req.headers["x-github-event"];
  const payload = JSON.parse(rawBody);

  // ---- ISSUE AUTO REPLY ----
  if (event === "issues" && payload.action === "opened") {
    const issue = payload.issue;

    const aiReply = await generateAIReply(
      issue.title + "\n" + issue.body
    );

    await githubComment(issue.comments_url, aiReply);
  }

  // ---- PR AUTO REVIEW ----
  if (event === "pull_request" && payload.action === "opened") {
    const pr = payload.pull_request;

    await githubComment(pr.comments_url, "🤖 自动审核中，请稍候…");

    const aiReview = await generateAIReply(
      "请帮我总结并审核这个 Pull Request 内容:\n" +
        pr.title +
        "\n" +
        pr.body
    );

    await githubComment(pr.comments_url, "### 🤖 AI 审核结果：\n" + aiReview);
  }

  return res.status(200).send("OK");
}
