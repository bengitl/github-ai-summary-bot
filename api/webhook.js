const { Webhooks } = require("@octokit/webhooks");

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET || "test-secret",
});

module.exports = async (req, res) => {
  try {
    // 读取原始 body（Vercel 不会自动解析）
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const rawBody = Buffer.concat(buffers).toString("utf8");

    const id = req.headers["x-github-delivery"];
    const name = req.headers["x-github-event"];
    const signature = req.headers["x-hub-signature-256"];

    await webhooks.verifyAndReceive({
      id,
      name,
      payload: JSON.parse(rawBody),
      signature,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: err.message });
  }
};
