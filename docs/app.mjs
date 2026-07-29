import {
  ALLOWED_EXTENSIONS,
  buildClipboardFileName,
  buildStoragePath,
  describeConnectionError,
  encodeRepoPath,
  formatBytes,
  isExpired,
  matchesFilters,
  parseStoredFilePath,
  resolveExpiration,
  validateRepoConfig,
  validateUploadFile,
} from "./core.mjs";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";

const state = {
  config: null,
  token: "",
  files: [],
  visibleFiles: [],
  selectedPaths: new Set(),
};

const dom = Object.fromEntries([
  "connection-state", "connection-form", "owner", "repo", "branch", "token",
  "connect-button", "disconnect-button", "workspace", "upload-form", "files",
  "upload-dropzone", "selected-files",
  "retention", "custom-expiration-label", "custom-expiration", "upload-button",
  "upload-progress", "refresh-button", "download-selected-button", "delete-expired-button",
  "search-form", "query", "date-from", "date-to", "clear-search-button", "select-all",
  "file-list", "file-count", "status",
].map((id) => [id, document.getElementById(id)]));

dom["files"].setAttribute("accept", ALLOWED_EXTENSIONS.join(","));

dom["connection-form"].addEventListener("submit", connect);
dom["disconnect-button"].addEventListener("click", disconnect);
dom["upload-form"].addEventListener("submit", uploadFiles);
dom["files"].addEventListener("change", updateSelectedFiles);
dom["upload-dropzone"].addEventListener("dragover", handleDragOver);
dom["upload-dropzone"].addEventListener("dragleave", () => dom["upload-dropzone"].classList.remove("drag-over"));
dom["upload-dropzone"].addEventListener("drop", handleDrop);
document.addEventListener("paste", handlePaste);
dom["retention"].addEventListener("change", updateRetentionInput);
dom["refresh-button"].addEventListener("click", () => runAction(refreshFiles));
dom["download-selected-button"].addEventListener("click", downloadSelected);
dom["delete-expired-button"].addEventListener("click", deleteExpired);
dom["search-form"].addEventListener("submit", applySearch);
dom["clear-search-button"].addEventListener("click", clearSearch);
dom["select-all"].addEventListener("change", toggleSelectAll);

async function connect(event) {
  event.preventDefault();
  setBusy(dom["connect-button"], true, "連線中…");
  setStatus("正在讀取 repo…");
  try {
    const config = validateRepoConfig({
      owner: dom["owner"].value.trim(),
      repo: dom["repo"].value.trim(),
      branch: dom["branch"].value.trim(),
    });
    state.config = config;
    state.token = dom["token"].value.trim();
    dom["token"].value = "";
    await refreshFiles();
    dom["workspace"].hidden = false;
    dom["disconnect-button"].hidden = false;
    dom["connection-state"].textContent = `${config.owner}/${config.repo}`;
    dom["connection-state"].classList.add("connected");
    updateWriteControls();
    setStatus(state.token ? "已連線，可上傳與刪除。" : "已唯讀連線公開 repo；上傳與刪除需要 PAT。");
  } catch (error) {
    const message = describeConnectionError(error.status, Boolean(state.token), readableError(error));
    state.config = null;
    state.token = "";
    setStatus(message, true);
  } finally {
    setBusy(dom["connect-button"], false, "連線");
  }
}

function disconnect() {
  state.config = null;
  state.token = "";
  state.files = [];
  state.visibleFiles = [];
  state.selectedPaths.clear();
  dom["upload-form"].reset();
  updateSelectedFiles();
  dom["workspace"].hidden = true;
  dom["disconnect-button"].hidden = true;
  dom["connection-state"].textContent = "尚未連線";
  dom["connection-state"].classList.remove("connected");
  dom["file-list"].replaceChildren();
  updateWriteControls();
  setStatus("連線資料與 PAT 已從目前分頁清除。");
}

async function refreshFiles() {
  requireConnection();
  setBusy(dom["refresh-button"], true, "讀取中…");
  try {
    const { tree, truncated } = await apiRequest(
      `/repos/${encodeURIComponent(state.config.owner)}/${encodeURIComponent(state.config.repo)}/git/trees/${encodeURIComponent(state.config.branch)}?recursive=1`,
    );
    if (truncated) throw new Error("Repo 檔案太多，GitHub 回傳的清單不完整。");
    state.files = tree
      .filter((item) => item.type === "blob")
      .map((item) => parseStoredFilePath(item.path, { sha: item.sha, size: item.size }))
      .filter(Boolean)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.path.localeCompare(a.path, "zh-Hant"));
    state.selectedPaths.clear();
    renderFiles(state.files);
  } catch (error) {
    renderFiles([]);
    throw error;
  } finally {
    setBusy(dom["refresh-button"], false, "重新整理");
  }
}

function applySearch(event) {
  event.preventDefault();
  const filters = {
    query: dom["query"].value.trim(),
    dateFrom: dom["date-from"].value,
    dateTo: dom["date-to"].value,
  };
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    setStatus("起始日期不能晚於結束日期。", true);
    return;
  }
  renderFiles(state.files.filter((file) => matchesFilters(file, filters)));
  setStatus("搜尋完成。");
}

function clearSearch() {
  dom["search-form"].reset();
  renderFiles(state.files);
  setStatus("已清除搜尋條件。");
}

function renderFiles(files) {
  state.visibleFiles = files;
  const today = localDateParts(new Date()).date;
  const fragment = document.createDocumentFragment();

  if (files.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty-row";
    cell.textContent = state.files.length ? "沒有符合條件的文件。" : "目前沒有文件。";
    row.append(cell);
    fragment.append(row);
  }

  for (const file of files) fragment.append(createFileRow(file, today));
  dom["file-list"].replaceChildren(fragment);
  dom["file-count"].textContent = `${files.length} 個檔案`;
  dom["select-all"].checked = files.length > 0 && files.every((file) => state.selectedPaths.has(file.path));
  dom["select-all"].indeterminate = files.some((file) => state.selectedPaths.has(file.path)) && !dom["select-all"].checked;
  updateActionButtons();
}

function createFileRow(file, today) {
  const row = document.createElement("tr");
  const expired = isExpired(file, today);
  if (expired) row.classList.add("expired");

  const selectionCell = document.createElement("td");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedPaths.has(file.path);
  checkbox.setAttribute("aria-label", `選取 ${file.originalName}`);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selectedPaths.add(file.path);
    else state.selectedPaths.delete(file.path);
    updateSelectionControls();
  });
  selectionCell.append(checkbox);

  const nameCell = document.createElement("td");
  nameCell.className = "file-name";
  nameCell.textContent = file.originalName;

  const sizeCell = textCell(formatBytes(file.size));
  const uploadedCell = textCell(file.uploadedAt);
  const retentionCell = textCell(file.expiresAt ? `${file.expiresAt}${expired ? "（已到期）" : ""}` : "永久");

  const actionsCell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const download = button("下載", () => runAction(() => downloadFile(file)));
  const remove = button("刪除", () => runAction(() => deleteFileWithConfirmation(file)));
  remove.classList.add("danger");
  remove.disabled = !state.token;
  actions.append(download, remove);
  actionsCell.append(actions);

  row.append(selectionCell, nameCell, sizeCell, uploadedCell, retentionCell, actionsCell);
  return row;
}

function toggleSelectAll() {
  for (const file of state.visibleFiles) {
    if (dom["select-all"].checked) state.selectedPaths.add(file.path);
    else state.selectedPaths.delete(file.path);
  }
  for (const checkbox of dom["file-list"].querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = dom["select-all"].checked;
  }
  updateSelectionControls();
}

async function uploadFiles(event) {
  event.preventDefault();
  requireWriteToken();
  const files = [...dom["files"].files];
  if (files.length === 0) return;

  const now = localDateParts(new Date());
  let expiresAt;
  try {
    expiresAt = resolveExpiration(dom["retention"].value, dom["custom-expiration"].value, now.date);
    for (const file of files) validateUploadFile(file);
  } catch (error) {
    setStatus(readableError(error), true);
    return;
  }

  setBusy(dom["upload-button"], true, "上傳中…");
  dom["upload-progress"].replaceChildren();
  let uploaded = 0;
  for (const file of files) {
    const progress = progressItem(file.name, "讀取中…");
    dom["upload-progress"].append(progress.row);
    try {
      const path = buildStoragePath({
        uploadDate: now.date,
        uploadTime: localDateParts(new Date()).time,
        expiresAt,
        id: crypto.randomUUID(),
        originalName: file.name,
      });
      progress.value.textContent = "上傳中…";
      await apiRequest(contentsPath(path), {
        method: "PUT",
        body: {
          message: `upload: ${file.name}`,
          content: await fileToBase64(file),
          branch: state.config.branch,
        },
      });
      progress.value.textContent = "完成";
      progress.row.classList.add("success");
      uploaded += 1;
    } catch (error) {
      progress.value.textContent = readableError(error);
      progress.row.classList.add("error");
    }
  }
  setBusy(dom["upload-button"], false, "開始上傳");
  updateWriteControls();
  dom["upload-form"].reset();
  updateSelectedFiles();
  updateRetentionInput();
  try {
    await refreshFiles();
  } catch (error) {
    setStatus(`已上傳 ${uploaded}/${files.length} 個檔案，但清單更新失敗：${readableError(error)}`, true);
    return;
  }
  setStatus(`已成功上傳 ${uploaded}/${files.length} 個檔案。`, uploaded !== files.length);
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = dom["files"].disabled ? "none" : "copy";
  if (!dom["files"].disabled) dom["upload-dropzone"].classList.add("drag-over");
}

function handleDrop(event) {
  event.preventDefault();
  dom["upload-dropzone"].classList.remove("drag-over");
  if (dom["files"].disabled) return;
  setUploadFiles(event.dataTransfer.files);
}

function handlePaste(event) {
  if (!state.token || event.defaultPrevented
    || document.activeElement?.matches('input:not([type="file"]), textarea, select, [contenteditable="true"]')) return;

  const clipboard = event.clipboardData;
  const images = [...(clipboard?.items ?? [])]
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  const text = images.length ? "" : clipboard?.getData("text/plain");
  if (!images.length && !text) return;

  event.preventDefault();
  setStatus("正在處理剪貼簿內容…");
  runAction(async () => {
    const now = localDateParts(new Date());
    const pasted = images.length
      ? await Promise.all(images.map((image, index) => imageToJpeg(
        image,
        buildClipboardFileName("jpg", now, index),
      )))
      : [new File([text], buildClipboardFileName("md", now), { type: "text/markdown" })];
    for (const file of pasted) validateUploadFile(file);
    setUploadFiles([...dom["files"].files, ...pasted]);
    setStatus(`已從剪貼簿加入 ${pasted.length} 個文件。`);
  });
}

function setUploadFiles(files) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  dom["files"].files = transfer.files;
  updateSelectedFiles();
}

function updateSelectedFiles() {
  dom["selected-files"].textContent = dom["files"].files.length
    ? `已選擇 ${dom["files"].files.length} 個文件`
    : "尚未選擇文件";
}

async function imageToJpeg(image, name) {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法處理剪貼簿圖片。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!jpeg) throw new Error("無法將剪貼簿圖片轉成 JPG。");
    return new File([jpeg], name, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

async function downloadSelected() {
  const files = state.files.filter((file) => state.selectedPaths.has(file.path));
  if (files.length === 0) return;
  setBusy(dom["download-selected-button"], true, "下載中…");
  let completed = 0;
  for (const file of files) {
    try {
      await downloadFile(file);
      completed += 1;
    } catch (error) {
      setStatus(`${file.originalName}：${readableError(error)}`, true);
      break;
    }
  }
  setBusy(dom["download-selected-button"], false, "下載選取項目");
  if (completed === files.length) setStatus(`已送出 ${completed} 個下載；瀏覽器可能會詢問是否允許多檔下載。`);
}

async function downloadFile(file) {
  const response = await apiRequest(`${contentsPath(file.path)}?ref=${encodeURIComponent(state.config.branch)}`, {
    raw: true,
  });
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = file.originalName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function deleteFileWithConfirmation(file) {
  requireWriteToken();
  if (!confirm(`確定要從目前 branch 刪除「${file.originalName}」？\n\nGit 歷史仍可能保留舊版本。`)) return;
  await deleteFile(file);
  await refreshFiles();
  setStatus(`已刪除 ${file.originalName}。`);
}

async function deleteExpired() {
  requireWriteToken();
  const today = localDateParts(new Date()).date;
  const expired = state.files.filter((file) => isExpired(file, today));
  if (!expired.length || !confirm(`確定刪除 ${expired.length} 個已到期檔案？\n\nGit 歷史仍可能保留舊版本。`)) return;
  setBusy(dom["delete-expired-button"], true, "清除中…");
  let deleted = 0;
  for (const file of expired) {
    try {
      await deleteFile(file);
      deleted += 1;
    } catch (error) {
      setStatus(`${file.originalName}：${readableError(error)}`, true);
      break;
    }
  }
  setBusy(dom["delete-expired-button"], false, "清除到期檔案");
  try {
    await refreshFiles();
  } catch (error) {
    setStatus(`已清除 ${deleted}/${expired.length} 個檔案，但清單更新失敗：${readableError(error)}`, true);
    return;
  }
  setStatus(`已清除 ${deleted}/${expired.length} 個到期檔案。`, deleted !== expired.length);
}

function deleteFile(file) {
  return apiRequest(contentsPath(file.path), {
    method: "DELETE",
    body: {
      message: `delete: ${file.originalName}`,
      sha: file.sha,
      branch: state.config.branch,
    },
  });
}

function updateRetentionInput() {
  const custom = dom["retention"].value === "custom";
  dom["custom-expiration-label"].hidden = !custom;
  dom["custom-expiration"].required = custom;
  dom["custom-expiration"].disabled = !state.token || !custom;
  dom["custom-expiration"].min = localDateParts(new Date()).date;
  if (!custom) dom["custom-expiration"].value = "";
}

function updateWriteControls() {
  const readOnly = !state.token;
  dom["files"].disabled = readOnly;
  dom["upload-dropzone"].classList.toggle("disabled", readOnly);
  dom["retention"].disabled = readOnly;
  dom["upload-button"].disabled = readOnly;
  updateRetentionInput();
  updateActionButtons();
}

function updateActionButtons() {
  dom["download-selected-button"].disabled = state.selectedPaths.size === 0;
  const today = localDateParts(new Date()).date;
  dom["delete-expired-button"].disabled = !state.token || !state.files.some((file) => isExpired(file, today));
}

function updateSelectionControls() {
  const selected = state.visibleFiles.filter((file) => state.selectedPaths.has(file.path)).length;
  dom["select-all"].checked = state.visibleFiles.length > 0 && selected === state.visibleFiles.length;
  dom["select-all"].indeterminate = selected > 0 && selected < state.visibleFiles.length;
  updateActionButtons();
}

function contentsPath(path) {
  return `/repos/${encodeURIComponent(state.config.owner)}/${encodeURIComponent(state.config.repo)}/contents/${encodeRepoPath(path)}`;
}

async function apiRequest(path, { method = "GET", body, raw = false } = {}) {
  const headers = {
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (typeof payload.message === "string") message = payload.message;
    } catch {
      // Keep the HTTP status when GitHub did not return JSON.
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  if (raw) return response;
  if (response.status === 204) return null;
  return response.json();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result).split(",", 2)[1]));
    reader.addEventListener("error", () => reject(new Error(`無法讀取 ${file.name}。`)));
    reader.readAsDataURL(file);
  });
}

function localDateParts(date) {
  const number = (value) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${number(date.getMonth() + 1)}-${number(date.getDate())}`,
    time: `${number(date.getHours())}${number(date.getMinutes())}${number(date.getSeconds())}`,
  };
}

function textCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function button(label, action) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

function progressItem(name, value) {
  const row = document.createElement("div");
  row.className = "progress-item";
  const label = document.createElement("span");
  const status = document.createElement("span");
  label.textContent = name;
  status.textContent = value;
  row.append(label, status);
  return { row, value: status };
}

function setBusy(element, busy, label) {
  element.disabled = busy;
  element.textContent = label;
}

function setStatus(message, error = false) {
  if (error) {
    dom["status"].textContent = "";
    dom["status"].classList.remove("error");
    alert(message);
    return;
  }
  dom["status"].textContent = message;
  dom["status"].classList.remove("error");
}

async function runAction(action) {
  try {
    await action();
  } catch (error) {
    setStatus(readableError(error), true);
  }
}

function requireConnection() {
  if (!state.config) throw new Error("請先連線 GitHub repo。");
}

function requireWriteToken() {
  requireConnection();
  if (!state.token) throw new Error("上傳或刪除需要 fine-grained PAT。");
}

function readableError(error) {
  return error instanceof Error ? error.message : "發生未知錯誤。";
}
