import axios from "axios";

const API = process.env.MODEL_API;

export async function aiReply(prompt) {
  try {
    const res = await axios.post(API, { prompt });
    return res.data.output || "AI 生成失败";
  } catch (err) {
    return "AI 接口异常：" + err.message;
  }
}
