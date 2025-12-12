import axios from "axios";

const TOKEN = process.env.GITHUB_TOKEN;

export async function ghComment(url, body) {
  await axios.post(
    url,
    { body },
    { headers: { Authorization: `token ${TOKEN}` } }
  );
}

export async function ghLabel(repo, number, labels) {
  await axios.post(
    `https://api.github.com/repos/${repo}/issues/${number}/labels`,
    { labels },
    { headers: { Authorization: `token ${TOKEN}` } }
  );
}
