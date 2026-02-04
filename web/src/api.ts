const API_BASE = (import.meta.env.VITE_API_BASE as string) || '/api/v1';

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function register(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return res.json();
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return res.json();
}

export async function getAccounts() {
  const res = await fetch(`${API_BASE}/accounts`, { headers: { ...authHeader() } });
  return res.json();
}

export async function createAccount(payload: any) {
  const res = await fetch(`${API_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function syncAccount(accountId: string) {
  const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/sync`, {
    method: 'POST',
    headers: { ...authHeader() }
  });
  return res.json();
}

export async function getMailboxes(accountId?: string) {
  const url = accountId ? `${API_BASE}/mailboxes?accountId=${encodeURIComponent(accountId)}` : `${API_BASE}/mailboxes`;
  const res = await fetch(url, { headers: { ...authHeader() } });
  return res.json();
}

export async function getMessages(mailboxId: string, limit = 50, offset = 0, q?: string, category?: string) {
  const query = q ? `&q=${encodeURIComponent(q)}` : '';
  const cat = category ? `&category=${encodeURIComponent(category)}` : '';
  const url = `${API_BASE}/messages?mailboxId=${encodeURIComponent(mailboxId)}&limit=${limit}&offset=${offset}${query}${cat}`;
  const res = await fetch(url, { headers: { ...authHeader() } });
  return res.json();
} 

export async function getMessage(id: string) {
  const res = await fetch(`${API_BASE}/messages/${encodeURIComponent(id)}`, { headers: { ...authHeader() } });
  return res.json();
}

export async function getDashboard() {
  const res = await fetch(`${API_BASE}/dashboard`, { headers: { ...authHeader() } });
  return res.json();
}

export async function enqueueMessageAi(id: string) {
  const res = await fetch(`${API_BASE}/messages/${encodeURIComponent(id)}/ai`, {
    method: 'POST',
    headers: { ...authHeader() }
  });
  return res.json();
}

export async function markMessageRead(id: string) {
  const res = await fetch(`${API_BASE}/messages/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: { ...authHeader() }
  });
  return res.json();
}

export async function setMessageArchived(id: string, archived = true) {
  const res = await fetch(`${API_BASE}/messages/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ archived })
  });
  return res.json();
}

export async function markMessageUnread(id: string) {
  const res = await fetch(`${API_BASE}/messages/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ read: false })
  });
  return res.json();
}

export async function markCategoryReadAll(mailboxId: string, category?: string | null) {
  const res = await fetch(`${API_BASE}/messages/bulk-read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ mailboxId, category: category || null })
  });
  return res.json();
}

export async function archiveCategoryAll(mailboxId: string, category?: string | null) {
  const res = await fetch(`${API_BASE}/messages/bulk-archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ mailboxId, category: category || null })
  });
  return res.json();
}

export async function getMessageAttachments(messageId: string) {
  const res = await fetch(`${API_BASE}/messages/${encodeURIComponent(messageId)}/attachments`, { headers: { ...authHeader() } });
  return res.json();
}

export async function downloadAttachment(messageId: string, attachmentId: string) {
  const res = await fetch(`${API_BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: { ...authHeader() } });
  if (!res.ok) throw new Error('attachment download failed');
  const blob = await res.blob();
  return blob;
}

export async function sendMessage(payload: any) {
  const res = await fetch(`${API_BASE}/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function updateAccount(accountId: string, payload: any) {
  const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload)
  });
  return res.json();
}
