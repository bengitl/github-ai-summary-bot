import axios from "axios";

export async function ghComment(url, body) {
  if (!url) return;

  await axios.post(
    url,
    { body },
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "github-ai-bot"
      }
    }
  );
}

/**
 * 给 Issue / PR 自动打标签
 */
export async function ghLabel(owner, repo, issueNumber, labels = []) {
  if (!owner || !repo || !issueNumber || labels.length === 0) return;

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`;

  try {
    await axios.post(
      url,
      { labels },
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "github-ai-bot"
        }
      }
    );
  } catch (err) {
    console.error("❌ Label failed:", err.response?.data || err.message);
  }
}

