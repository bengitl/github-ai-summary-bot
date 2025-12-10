// api/index.js
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
// body limit for diffs etc
app.use(express.json({ limit: "10mb" }));

// ----------------- ENV -----------------
// Required:
// GITHUB_TOKEN: a PAT with repo permissions (or App token with install token flow)
// GITHUB_WEBHOOK_SECRET: webhook secret
// MODEL_PROVIDER: openai | deepseek | custom
// MODEL_API: base URL for chat completions
// MODEL_API_KEY: api key for model
// MODEL_NAME: model name
// Optional:
// AUTO_APPLY_FIX = "true" to attempt to push a fix branch and create a PR (requires token with push rights)
// DEFAULT_LABEL = label name to add to PRs/issues
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const MODEL_PROVIDER = process.env.MODEL_PROVIDER || "openai";
const MODEL_API = process.env.MODEL_API;
const MODEL_API_KEY = process.env.MODEL_API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-mini";
const AUTO_APPLY_FIX = (process.env.AUTO_APPLY_FIX || "false") === "true";
const DEFAULT_LABEL = process.env.DEFAULT_LABEL || "ai-reviewed";

// ----------------- helpers -----------------
function verifySignature(raw, signature) {
  if (!WEBHOOK_SECRET) return true; // for dev (not recommended)
  if (!signature) return false;
  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(raw).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

async function callModel(prompt, system = "") {
  if (!MODEL_API || !MODEL_API_KEY) {
    throw new Error("Model not configured. Set MODEL_API and MODEL_API_KEY.");
  }
  // OpenAI-style body
  const body = {
    model: MODEL_NAME,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt }
    ],
    max_tokens: 800
  };

  const res = await axios.post(MODEL_API, body, {
    headers: {
      Authorization: `Bearer ${MODEL_API_KEY}`,
      "Content-Type": "application/json"
    },
    timeout: 30000
  });

  // try common response shapes
  const data = res.data || {};
  return (
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    data?.output ||
    data?.response ||
    JSON.stringify(data).slice(0, 1000)
  );
}

// post a comment to any comments_url
async function githubComment(comments_url, body) {
  return axios.post(
    comments_url,
    { body },
    { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
}

async function addLabel(owner, repo, issue_number, labels) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/labels`;
  return axios.post(
    url,
    { labels: Array.isArray(labels) ? labels : [labels] },
    { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
}

// fetch PR diff (.diff or .patch); accept type "diff" or "patch"
async function fetchPrDiff(diffUrl) {
  const res = await axios.get(diffUrl, {
    headers: {
      Accept: "application/vnd.github.v3.diff",
      Authorization: `token ${GITHUB_TOKEN}`
    },
    timeout: 20000
  });
  return res.data;
}

// create a fix branch + commit patch (simple approach)
// NOTE: this is optional and requires repo write perms; it's a best-effort implement.
// It creates a branch from PR head ref, creates a commit with a file replacement if provided patch content.
// For safety we will NOT automatically edit arbitrary files: instead we open a PR suggesting code changes via comment.
// (If AUTO_APPLY_FIX=true, implement a minimal create branch + commit logic — but keep simple/safe)
async function createFixPr(owner, repo, baseBranch, headBranch, commitMessage, files) {
  // files = [{ path, content (full new file content) }]
  // This naive implementation uses the GitHub Contents API to create/update files on a new branch.
  // Steps: get baseBranch sha, create branch ref, for each file create/update via PUT.
  const getRef = async (ref) => {
    const r = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${ref}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    return r.data.object.sha;
  };

  const createRef = async (newRef, sha) => {
    return axios.post(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      { ref: `refs/heads/${newRef}`, sha },
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
  };

  const baseSha = await getRef(baseBranch);
  // create new branch name if headBranch exists
  let newBranch = headBranch || `ai-fix-${Date.now()}`;
  try {
    await createRef(newBranch, baseSha);
  } catch (e) {
    // if branch exists, append timestamp
    newBranch = `${newBranch}-${Date.now()}`;
    await createRef(newBranch, baseSha);
  }

  // For each file, PUT contents (create or update)
  for (const f of files) {
    const path = f.path;
    // Try to get existing file to include sha if updating
    let existingSha = null;
    try {
      const get = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${baseBranch}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
      });
      existingSha = get.data.sha;
    } catch (e) {
      existingSha = null;
    }

    const putBody = {
      message: commitMessage,
      content: Buffer.from(f.content, "utf8").toString("base64"),
      branch: newBranch
    };
    if (existingSha) putBody.sha = existingSha;

    await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, putBody, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
  }

  // create PR
  const pr = await axios.post(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    title: commitMessage,
    head: newBranch,
    base: baseBranch,
    body: "Automated fix suggestions from AI"
  }, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });

  return pr.data;
}

// generate changelog from merged PRs list: provide simple header + list
function makeChangelog(prSummaries) {
  let md = `# Changelog\n\n`;
  for (const p of prSummaries) {
    md += `- PR #${p.number} - ${p.title} (${p.user})\n`;
  }
  return md;
}

// parse simple diff to summary
function parseDiff(diff) {
  const files = [];
  const blocks = diff.split("diff --git ");
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const header = lines[0];
    const match = header.match(/a\/(.+?) b\/(.+)/);
    if (!match) continue;
    const filename = match[2];
    let added = 0, removed = 0;
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++") ) added++;
      if (line.startsWith("-") && !line.startsWith("---") ) removed++;
    }
    files.push({ file: filename, added, removed });
  }
  return files;
}

// ----------------- main webhook
app.post("/webhook", async (req, res) => {
  try {
    // raw body for signature: express.json already parsed body; need raw - we can't access easily here.
    // For production you should use raw body; for simplicity we accept using signature disabled or rely on platform.
    const raw = JSON.stringify(req.body);
    const signature = req.headers["x-hub-signature-256"];

    if (!verifySignature(raw, signature)) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.headers["x-github-event"];
    const payload = req.body;

    // ---------- Issue opened -> auto reply ----------
    if (event === "issues" && payload.action === "opened") {
      const issue = payload.issue;
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const comments_url = issue.comments_url;

      const prompt = `请简短友好地回复这个 issue 并给出快速建议。\n\n标题：${issue.title}\n\n正文：${issue.body || ""}`;
      const aiReply = await callModel(prompt);

      // add label
      try { await addLabel(owner, repo, issue.number, DEFAULT_LABEL); } catch(e){}

      await githubComment(comments_url, `🤖 AI 回复:\n\n${aiReply}`);
    }

    // ---------- Pull request opened -> summary, review, label, optional fix ----------
    if (event === "pull_request" && (payload.action === "opened" || payload.action === "synchronize")) {
      const pr = payload.pull_request;
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;

      // 1) fetch diff
      const diffText = await fetchPrDiff(pr.diff_url);
      const parsed = parseDiff(diffText);
      const summaryText = parsed.map(f => `${f.file}: +${f.added} / -${f.removed}`).join("\n");

      // 2) ai summary and review
      const prompt = `请以开发者视角总结并审查下面的 PR diff，列出三个主要问题、改进建议、以及简单的修复片段（若可能）。\n\nDiff Summary:\n${summaryText}\n\n完整 diff:\n${diffText.slice(0, 20000)}`; // cap
      const aiReview = await callModel(prompt);

      // post comment with summary + review
      const comments_url = pr.comments_url;
      const commentBody = `### 🤖 PR 自动摘要与审查\n\n**文件变动汇总**:\n\`\`\`\n${summaryText}\n\`\`\`\n\n**AI 评审**:\n${aiReview}`;

      await githubComment(comments_url, commentBody);

      // add label
      try { await addLabel(owner, repo, pr.number, DEFAULT_LABEL); } catch(e){}

      // 3) attempt auto fix (suggest only) — AI may provide patch suggestions in the text.
      // If AUTO_APPLY_FIX = true, try to parse simple suggested files from AI and create a branch+PR.
      if (AUTO_APPLY_FIX) {
        // Build a prompt asking for file patches in a JSON mapping format to safely parse
        const patchPrompt = `请基于上面的 PR diff 给出可执行的修复补丁。只以 JSON 输出：[{ "path": "relative/path.js", "content": "new full file content" }, ...]。不要输出任何其他文本。`;
        const patchRes = await callModel(patchPrompt);
        // Try to parse JSON from AI response
        let patches = null;
        try {
          patches = JSON.parse(patchRes.replace(/^[\s\S]*?(\[.*\])[\s\S]*?$/, "$1"));
        } catch (e) {
          patches = null;
        }

        if (patches && Array.isArray(patches) && patches.length > 0) {
          try {
            const prResult = await createFixPr(owner, repo, pr.base.ref, `ai-fix-${Date.now()}`, `AI auto-fix for PR #${pr.number}`, patches);
            // comment with created PR link
            await githubComment(comments_url, `🤖 我已为你创建了自动修复 PR: ${prResult.html_url}`);
          } catch (e) {
            await githubComment(comments_url, `⚠️ 自动应用补丁失败：${e.message}`);
          }
        } else {
          // if no structured patch, post AI-proposed snippet as suggestion
          await githubComment(comments_url, `🔧 修复建议（请手动应用）:\n\n${patchRes}`);
        }
      } else {
        // Not auto applying: post AI-proposed changes as suggestion
        const suggestionPrompt = `请基于上面的审查给出简洁的修复建议（代码片段或命令），方便开发者手动应用。`;
        const suggestion = await callModel(suggestionPrompt);
        await githubComment(comments_url, `🔧 修复建议（AI）：\n\n${suggestion}`);
      }
    }

    // ---------- PR merged -> generate changelog ----------
    if (event === "pull_request" && payload.action === "closed" && payload.pull_request.merged) {
      const pr = payload.pull_request;
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;

      // For simplicity, generate a small changelog entry and post to repo issues or as comment on PR
      const changelogEntry = `- PR #${pr.number} ${pr.title} (@${pr.user.login})`;
      // Post to a central changelog issue or as a comment to merged PR
      await githubComment(pr.comments_url, `📝 Changelog entry:\n\n${changelogEntry}`);
    }

    // ---------- PR review comment auto-reply ----------
    if (event === "pull_request_review_comment") {
      const comment = payload.comment;
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const comments_url = payload.pull_request.comments_url;

      // High-level: If comment asks for explanation, reply using AI
      const prompt = `这个 review comment 的内容：\n\n${comment.body}\n\n请用礼貌的语气回答。`;
      const aiReply = await callModel(prompt);
      await githubComment(comments_url, `🤖 回复（AI）：\n\n${aiReply}`);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).send("ERROR:" + (err.message || err.toString()));
  }
});

// expose app for Vercel
module.exports = app;
