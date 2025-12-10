import express from "express";
import bodyParser from "body-parser";
import { Octokit } from "@octokit/rest";
import fetch from "node-fetch";
import yaml from "js-yaml";

const app = express();
app.use(bodyParser.json());

// GitHub Token
const GH_TOKEN = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: GH_TOKEN });

// 首页避免 “Cannot GET /”
app.get("/", (req, res) => {
  res.send("GitHub AI Bot running via Express.js on Vercel.");
});

// Webhook 入口
app.post("/webhook", async (req, res) => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  try {
    if (event === "pull_request") {
      await handlePullRequest(payload);
    }
    if (event === "issues") {
      await handleIssue(payload);
    }
    if (event === "issue_comment") {
      await handleReviewComment(payload);
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).send("Error");
  }
});

/* ------------------------------------------------------------------
   1. PR 事件：自动 AI 总结、自动修复代码、自动 Label、自动 Changelog
-------------------------------------------------------------------*/
async function handlePullRequest(payload) {
  const { action, pull_request, repository } = payload;

  if (!["opened", "synchronize", "reopened"].includes(action)) return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const pull_number = pull_request.number;

  // 读取 diff 内容
  const diffUrl = pull_request.diff_url;
  const diffText = await fetch(diffUrl).then((r) => r.text());

  // AI Summary
  const summary = await callAI(`请基于以下 diff 生成 PR 总结：\n${diffText}`);

  // 自动 Comment Summary
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pull_number,
    body: `### 🤖 AI 自动总结\n${summary}`
  });

  // 自动 Label
  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: pull_number,
    labels: ["ai-summary"]
  });

  // AI 自动修复代码建议
  const fix = await callAI(`请基于以下 diff 给出修复建议：\n${diffText}`);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pull_number,
    body: `### 🔧 AI 自动修复建议\n${fix}`
  });

  // 自动生成 Changelog
  const changelog = await callAI(`请基于以下 diff 生成 changelog：\n${diffText}`);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pull_number,
    body: `### 📄 Changelog\n${changelog}`
  });
}

/* ------------------------------------------------------------------
   2. Issue 事件：自动 AI 回复
-------------------------------------------------------------------*/
async function handleIssue(payload) {
  const { action, issue, repository } = payload;
  if (!["opened"].includes(action)) return;

  const owner = repository.owner.login;
  const repo = repository.name;

  const answer = await callAI(`以下是 issue 内容，请生成自动回复：\n${issue.title}\n${issue.body}`);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issue.number,
    body: `### 🤖 自动回复\n${answer}`
  });
}

/* ------------------------------------------------------------------
   3. Review 评论：AI 自动回复
-------------------------------------------------------------------*/
async function handleReviewComment(payload) {
  const { action, comment, repository } = payload;
  if (!["created"].includes(action)) return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const issue_number = payload.issue.number;

  const reply = await callAI(`请对以下 review 内容生成回复：\n${comment.body}`);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number,
    body: `### 💬 AI 自动回复 Review\n${reply}`
  });
}

/* ------------------------------------------------------------------
   AI 模型接口（你可以换成 GPT、DeepSeek、Claude）
-------------------------------------------------------------------*/
async function callAI(prompt) {
  // 这里示例用 DeepSeek，可换成任何 API
  const res = await fetch("https://api-inference.modelscope.cn/v1/", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "modelscope",
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

export default app;

