function getConfig() {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url) throw new Error('Missing APPS_SCRIPT_URL environment variable.');
  if (!secret) throw new Error('Missing APPS_SCRIPT_SECRET environment variable.');
  return { url, secret };
}

/** Fetches { ipos, applicants } (raw, unmasked) from the Apps Script web app. */
export async function fetchData() {
  const { url, secret } = getConfig();
  const res = await fetch(`${url}?secret=${encodeURIComponent(secret)}`);
  if (!res.ok) throw new Error(`Apps Script request failed: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`Apps Script error: ${body.error}`);
  return body; // { ipos: [...], applicants: [...] }
}

async function postAction(action, data) {
  const { url, secret } = getConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, action, data }),
  });
  if (!res.ok) throw new Error(`Apps Script request failed: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`Apps Script error: ${body.error}`);
  return body;
}

export function writeIposRemote(ipos) {
  return postAction('writeIpos', ipos);
}

export function writeApplicantsRemote(applicants) {
  return postAction('writeApplicants', applicants);
}
