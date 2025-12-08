import { Webhooks } from "@octokit/webhooks";

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ status: "ok", message: "GitHub Bot is running" });
  }

  try {
    await webhooks.verifyAndReceive({
      id: req.headers["x-github-delivery"],
      name: req.headers["x-github-event"],
      signature: req.headers["x-hub-signature-256"],
      payload: req.body,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
