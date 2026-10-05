// Invite someone to Redline accounts: `npm run invite -- friend@example.com ["note"]`.
// Adds the email to allowed_emails; they then log in at /login with an email code.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const [email, note] = process.argv.slice(2);
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Usage: npm run invite -- someone@example.com ["note"]');
  process.exit(1);
}
const ref = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/SUPABASE_PROJECT_REF=(\S+)/)?.[1];
const keys = JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${ref} --reveal -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }));
const secret = keys.find((k) => k.type === 'secret').api_key;
const res = await fetch(`https://${ref}.supabase.co/rest/v1/allowed_emails`, {
  method: 'POST',
  headers: { apikey: secret, 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates' },
  body: JSON.stringify({ email: email.toLowerCase(), note: note ?? null }),
});
if (!res.ok) { console.error('Failed:', res.status, await res.text()); process.exit(1); }
console.log(`Invited ${email.toLowerCase()}. They can log in at /login with an email code.`);
