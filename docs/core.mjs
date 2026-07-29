export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const ALLOWED_EXTENSIONS = Object.freeze([
  ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv", ".pptx", ".ppt",
  ".pdf", ".py", ".txt", ".md", ".docx", ".doc", ".json", ".xml",
  ".yaml", ".yml", ".mp3", ".html", ".zip",
]);

const ALLOWED_EXTENSION_SET = new Set(ALLOWED_EXTENSIONS);
const STORED_PATH = /^files\/(\d{4}-\d{2}-\d{2})\/(keep|expire-(\d{4}-\d{2}-\d{2}))\/(\d{6})-([0-9a-f-]{36})\/([^/]+)$/iu;

export function validateRepoConfig({ owner, repo, branch }) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu.test(owner) || owner.includes("--")) {
    throw new Error("GitHub 擁有者格式不正確。");
  }
  if (!/^[a-z\d._-]{1,100}$/iu.test(repo) || repo === "." || repo === "..") {
    throw new Error("Repo 名稱格式不正確。");
  }
  if (!isValidBranch(branch)) {
    throw new Error("Branch 名稱格式不正確。");
  }
  return { owner, repo, branch };
}

export function describeConnectionError(status, hasToken, fallback) {
  if (status === 401) return "PAT 無效或已過期，請重新建立 token。";
  if (status === 403 && hasToken) {
    return "PAT 權限不足或尚待組織核准；請將此 repo 加入 Repository access，並把 Contents 設為 Read and write。";
  }
  if (status === 404 && hasToken) {
    return "找不到 repo，或 PAT 看不到這個 private repo；請確認 Owner、Repo、Resource owner 與 Repository access。";
  }
  if (status === 404) return "找不到公開 repo；連線 private repo 必須輸入已授權的 PAT。";
  if (status === 409) return "Repo 尚未建立 branch；請先在 private repo 建立 README.md。";
  return fallback;
}

function isValidBranch(branch) {
  return branch.length > 0
    && branch.length <= 255
    && branch === branch.trim()
    && branch !== "@"
    && !/[\x00-\x20\x7f~^:?*[\\]/u.test(branch)
    && !branch.includes("..")
    && !branch.includes("@{")
    && !branch.includes("//")
    && !branch.startsWith("/")
    && !branch.endsWith("/")
    && !branch.endsWith(".");
}

export function validateUploadFile({ name, size }) {
  if (!name || name.length > 200 || /[\x00-\x1f\x7f/\\]/u.test(name) || name === "." || name === "..") {
    throw new Error("檔名無效或超過 200 個字元。");
  }
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE) {
    throw new Error("檔案大小必須在 20 MiB 以內。");
  }
  const extension = name.includes(".") ? `.${name.split(".").pop().toLocaleLowerCase("en-US")}` : "";
  if (!ALLOWED_EXTENSION_SET.has(extension)) {
    throw new Error(`暫不支援 ${extension || "沒有副檔名的檔案"}。`);
  }
}

export function resolveExpiration(retention, customDate, uploadDate) {
  if (retention === "keep") return null;
  if (retention === "custom") {
    if (!isDate(customDate) || customDate < uploadDate) throw new Error("請選擇今天或之後的到期日。");
    return customDate;
  }
  const days = Number(retention);
  if (![7, 30, 90].includes(days)) throw new Error("保留期限無效。");
  const date = new Date(`${uploadDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildStoragePath({ uploadDate, uploadTime, expiresAt, id, originalName }) {
  if (!isDate(uploadDate) || !/^\d{6}$/u.test(uploadTime) || !/^[0-9a-f-]{36}$/iu.test(id)) {
    throw new Error("檔案路徑資料無效。");
  }
  validateUploadFile({ name: originalName, size: 0 });
  const retention = expiresAt ? `expire-${expiresAt}` : "keep";
  return `files/${uploadDate}/${retention}/${uploadTime}-${id}/${originalName}`;
}

export function buildClipboardFileName(extension, { date, time }, position = 0) {
  return `clipboard-${date}-${time}${position ? `-${position + 1}` : ""}.${extension}`;
}

export function parseStoredFilePath(path, extra = {}) {
  const match = STORED_PATH.exec(path);
  if (!match || !isDate(match[1]) || (match[3] && !isDate(match[3]))) return null;
  const [, uploadDate, , expiresAt, uploadTime, id, originalName] = match;
  return {
    ...extra,
    path,
    uploadDate,
    uploadTime,
    uploadedAt: `${uploadDate} ${uploadTime.slice(0, 2)}:${uploadTime.slice(2, 4)}:${uploadTime.slice(4, 6)}`,
    expiresAt: expiresAt || null,
    id,
    originalName,
    searchName: normalizeSearch(originalName),
  };
}

export function matchesFilters(file, { query = "", dateFrom = "", dateTo = "" }) {
  if (query && !file.searchName.includes(normalizeSearch(query))) return false;
  if (dateFrom && file.uploadDate < dateFrom) return false;
  if (dateTo && file.uploadDate > dateTo) return false;
  return true;
}

export function isExpired(file, today) {
  return Boolean(file.expiresAt && file.expiresAt <= today);
}

export function encodeRepoPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function normalizeSearch(value) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-Hant");
}

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
