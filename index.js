import express from "express";
import crypto from "crypto";
import axios from "axios";
import { getDiff, summarizeDiff } from "./utils/diff.js";
import { aiReply } from "./utils/ai.js";
import { ghComment, ghLabel } from "./utils/github.js";

const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
const SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const TOKEN = process.env.GITHUB_TOKEN;

// -------------------- Signature Verify --------------------
function verifySignature(req) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !req.rawBody) return false;

  const hmac = crypto.createHmac("sha256", SECRET);
  const digest =
    "sha256=" + hmac.update(req.rawBody).digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

// -------------------- Webhook Handler --------------------
app.post("/api/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send("Invalid signature");
  }

  const event = req.headers["x-github-event"];
  const body = req.body;

  try {
    // Issue 自动回复 + Label
    if (event === "issues" && body.action === "opened") {
      const issue = body.issue;

      const reply = await aiReply(
        `请给这条 Issue 生成正式、客观、有帮助的回复。\n标题: ${issue.title}\n内容:\n${issue.body}`
      );

      await ghComment(issue.comments_url, reply);
      await ghLabel(body.repository.full_name, issue.number, ["ai-response"]);
    }

    // PR 自动解析 + 总结 + 审查
    if (event === "pull_request" && body.action === "opened") {
      const pr = body.pull_request;

      await ghComment(pr.comments_url, "AI 正在分析此 Pull Request，请稍候…");

      // 读取 diff
      const diffText = await getDiff(pr.diff_url);

      // 总结与审查
      const diffSummary = await summarizeDiff(diffText);
      const review = await aiReply(
        `请审核此 Pull Request 并给出可执行建议:\n标题:${pr.title}\n描述:${pr.body}\n变更摘要:\n${diffSummary}`
      );

      await ghComment(pr.comments_url, `### AI 审查结果\n${review}`);
    }

    // Review 评论自动回复
    if (event === "pull_request_review_comment") {
      const comment = body.comment;

      const reply = await aiReply(
        `请为以下代码 Review 评论生成一个专业、礼貌的 AI 回复:\n\n${comment.body}`
      );

      await ghComment(comment.url, reply);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server Error");
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("GitHub AI Bot is running.");
});

export default app;
