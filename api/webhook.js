import { Webhooks } from "@octokit/webhooks";

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET,
});

webhooks.on("*", async ({ id, name, payload }) => {
  console.log("Received event:", name);

  return {
    ok: true,
    event: name,
  };
});

export default async function handler(req, res) {
  try {
    const sig = req.headers['x-hub-signature-256'];
    const body = req.body;

    await webhooks.verifyAndReceive({
      id: req.headers['x-github-delivery'],
      name: req.headers['x-github-event'],
      payload: body,
      signature: sig,
    });

    res.status(200).json({ ok: true });

  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).json({ error: e.message });
  }
}
