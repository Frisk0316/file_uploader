import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStoragePath,
  encodeRepoPath,
  isExpired,
  matchesFilters,
  parseStoredFilePath,
  resolveExpiration,
  validateRepoConfig,
  validateUploadFile,
} from "../docs/core.mjs";

test("文件路徑、搜尋、期限與輸入驗證", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const path = buildStoragePath({
    uploadDate: "2026-07-17",
    uploadTime: "153045",
    expiresAt: "2026-08-16",
    id,
    originalName: "月報 7月.xlsx",
  });
  const file = parseStoredFilePath(path, { sha: "abc", size: 1234 });

  assert.equal(path, `files/2026-07-17/expire-2026-08-16/153045-${id}/月報 7月.xlsx`);
  assert.equal(file.originalName, "月報 7月.xlsx");
  assert.equal(file.uploadedAt, "2026-07-17 15:30:45");
  assert.equal(file.expiresAt, "2026-08-16");
  assert.equal(matchesFilters(file, { query: "月報", dateFrom: "2026-07-01", dateTo: "2026-07-31" }), true);
  assert.equal(matchesFilters(file, { query: "年報" }), false);
  assert.equal(isExpired(file, "2026-08-16"), true);
  assert.equal(resolveExpiration("30", "", "2026-07-17"), "2026-08-16");
  assert.equal(encodeRepoPath("files/2026-07-17/我的 文件.pdf"), "files/2026-07-17/%E6%88%91%E7%9A%84%20%E6%96%87%E4%BB%B6.pdf");
  assert.deepEqual(validateRepoConfig({ owner: "octocat", repo: "docs_store", branch: "main" }), {
    owner: "octocat",
    repo: "docs_store",
    branch: "main",
  });
  assert.doesNotThrow(() => validateUploadFile({ name: "程式.py", size: 20 }));
  assert.throws(() => validateUploadFile({ name: "影片.mp4", size: 20 }), /暫不支援/u);
  assert.throws(() => validateUploadFile({ name: "../秘密.pdf", size: 20 }), /檔名無效/u);
});
