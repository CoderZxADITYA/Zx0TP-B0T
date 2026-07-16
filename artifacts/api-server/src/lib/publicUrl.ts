/**
 * Resolves the publicly reachable base URL for this service, used to build
 * Twilio webhook callback URLs. Works across environments:
 *
 *  - Render / Railway / any host that sets RENDER_EXTERNAL_URL or PUBLIC_URL
 *  - Replit dev environment (REPLIT_DEV_DOMAIN)
 *  - Local fallback (http://localhost:PORT)
 *
 * Set PUBLIC_URL explicitly (e.g. https://your-app.onrender.com) if your
 * host doesn't set one of the platform-specific vars automatically.
 */
export function publicBaseUrl(): string {
  const explicit = process.env['PUBLIC_URL'];
  if (explicit) return explicit.replace(/\/$/, '');

  const render = process.env['RENDER_EXTERNAL_URL'];
  if (render) return render.replace(/\/$/, '');

  const replitDomain = process.env['REPLIT_DEV_DOMAIN'];
  if (replitDomain) return `https://${replitDomain}`;

  return `http://localhost:${process.env['PORT'] ?? 5000}`;
}
