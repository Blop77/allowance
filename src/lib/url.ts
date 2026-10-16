// APP_URL wins; on Render, RENDER_EXTERNAL_URL is set automatically (behind its proxy req.url is an internal address).
export function appUrl(req: Request): string {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || new URL(req.url).origin).replace(/\/$/, "");
}
