import axios from "axios";

export async function ghComment(url, body) {
  if (!url || typeof url !== "string") {
    console.error("❌ Invalid GitHub comment URL:", url);
    return;
  }

  try {
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
  } catch (err) {
    console.error(
      "❌ GitHub comment failed:",
      err.response?.data || err.message
    );
  }
}

