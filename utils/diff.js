import axios from "axios";
import { aiReply } from "./ai.js";

// ------------------------------
// 下载 PR Diff
// ------------------------------
export async function getDiff(url) {
  const res = await axios.get(url, {
    headers: { Accept: "text/plain" }
  });

  return res.data;
}

// ------------------------------
// 解析 diff 为结构化数据
// ------------------------------
export function parseDiff(diffText) {
  const files = [];
  const lines = diffText.split("\n");

  let currentFile = null;
  let currentHunk = null;

  for (const line of lines) {
    // 新文件开始
    if (line.startsWith("diff --git")) {
      if (currentFile) files.push(currentFile);

      const parts = line.split(" ");
      const filePath = parts[parts.length - 1].replace("b/", "");

      currentFile = {
        filePath,
        hunks: []
      };
      currentHunk = null;
    }

    // hunk 开始
    else if (line.startsWith("@@")) {
      currentHunk = {
        header: line,
        changes: []
      };
      currentFile?.hunks.push(currentHunk);
    }

    // hunk 内容
    else if (currentHunk) {
      currentHunk.changes.push(line);
    }
  }

  // 最后一个文件
  if (currentFile) files.push(currentFile);

  return files;
}

// ------------------------------
// 转成 AI 更易理解的摘要文本
// ------------------------------
export function formatDiffForAI(files) {
  let output = "";

  for (const file of files) {
    output += `\n### 文件: ${file.filePath}\n`;

    for (const hunk of file.hunks) {
      output += `\n  ${hunk.header}\n`;

      const added = hunk.changes.filter(l => l.startsWith("+")).length;
      const removed = hunk.changes.filter(l => l.startsWith("-")).length;

      output += `  改动: +${added} / -${removed}\n`;

      // 展示改动片段（剪短）
      const preview = hunk.changes
        .slice(0, 6)
        .map(l => l.substring(0, 120))
        .join("\n");

      output += `  代码片段:\n${preview}\n`;
    }
  }

  return output;
}

// ------------------------------
// 交给 AI 总结整个 diff
// ------------------------------
export async function summarizeDiff(diffText) {
  const files = parseDiff(diffText);
  const formatted = formatDiffForAI(files);

  const prompt = `
以下是 Pull Request 的完整 diff，请将其总结为清晰、结构化、便于 Code Review 的摘要。
请输出结构包括：
1. 变更影响范围（文件/模块）
2. 功能性变化说明
3. 可能的风险
4. 建议的 Review 重点

这是 diff 内容：

${formatted}
  `;

  return aiReply(prompt);
}
