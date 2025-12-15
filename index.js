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
app.post("/webhook", async (req, res) => {
  try {
    if (!verifySignature(req)) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.headers["x-github-event"];
    const payload = req.body;

    console.log("✅ Event:", event, payload.action);

    if (event === "issues" && payload.issue?.comments_url) {
      await ghComment(payload.issue.comments_url, "🤖 Issue OK");
    }

    if (event === "pull_request" && payload.pull_request?.number) {
      const { owner, name } = payload.repository;
      const pr = payload.pull_request;
      const url = `https://api.github.com/repos/${owner.login}/${name}/issues/${pr.number}/comments`;
      await ghComment(url, "🤖 PR OK");
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("🔥 Webhook fatal error:", err);
    res.status(200).send("OK"); // webhook 永远不要返回 500
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("GitHub AI Bot is running.");
});

export default app;
