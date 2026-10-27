import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Checks every recipe chefs publish to the feed (text, chef name and photo) a few seconds after it changes.
 * Posts appear right away; the AI only steps in when something is wrong:
 *   ok     → nothing happens
 *   review → stays visible, shows up for the admin under "الذكاء الاصطناعي علّم عليها"
 *   block  → hidden from the feed and flagged for the admin (who can show it again)
 * If a blocked post is edited and passes, it comes back by itself (only when the AI was the one that hid it).
 */

const SYSTEM = `You review recipes that customers publish to the public "chefs" feed of Darwish Kitchen, an Egyptian Arabic family recipe app. You get the chef's display name, the recipe text and its photo (if any).

Decide one verdict:
- "block": must not be public. Not a recipe at all (ads, selling, spam, phone numbers, links or social accounts to contact), insults, hate, sexual or violent content, politics, a photo that isn't food or drink or is offensive, pork or alcohol used as an ingredient, or dangerous instructions.
- "review": you are unsure, for example a photo that doesn't match the recipe, a nearly empty recipe, a borderline name or wording.
- "ok": a normal recipe or drink, even if it's short, misspelled, or written in dialect.

reason: one short sentence in Egyptian Arabic for the admin explaining the problem (empty for "ok").`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: { verdict: { type: 'string', enum: ['ok', 'review', 'block'] }, reason: { type: 'string' } },
};

const IMAGE = /^[a-z0-9-]{1,40}-[a-f0-9]{12}\.jpg$/;

export function createModeration({ db, dataDir, claude, delayMs = 4000 }) {
  const q = {
    post: db.prepare('SELECT p.*, u.name AS author_name FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?'),
    // Only saves when the post is still the version that was checked.
    save: db.prepare('UPDATE posts SET ai_status = ?, ai_reason = ?, hidden = ?, ai_hidden = ? WHERE id = ? AND data = ? AND image IS ?'),
  };
  const timers = new Map();
  let chain = Promise.resolve();

  async function check(id) {
    const row = q.post.get(id);
    if (!row) return;
    const r = JSON.parse(row.data);
    const text = [
      `اسم الشيف: ${row.author_name ?? ''}`,
      `اسم الوصفة: ${r.title}`,
      `النوع: ${r.category}`,
      `المكونات:\n${(r.ingredients ?? []).join('\n')}`,
      `الطريقة:\n${(r.steps ?? []).join('\n')}`,
      r.notes ? `ملاحظات: ${r.notes}` : '',
    ].filter(Boolean).join('\n\n');
    const content = [];
    if (row.image && IMAGE.test(row.image)) {
      try {
        const bytes = await readFile(join(dataDir, 'post-images', row.image));
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: bytes.toString('base64') } });
      } catch {
        // The photo is gone; check the text alone.
      }
    }
    content.push({ type: 'text', text });

    const out = await claude.json({ system: SYSTEM, content, schema: SCHEMA });
    const verdict = ['ok', 'review', 'block'].includes(out?.verdict) ? out.verdict : 'review';
    const reason = verdict === 'ok' ? null : String(out?.reason ?? '').trim().slice(0, 300) || 'الذكاء الاصطناعي مقدرش يراجعها، محتاجة نظرة منك.';

    let hidden = row.hidden;
    let aiHidden = row.ai_hidden;
    if (verdict === 'block' && !row.hidden) {
      hidden = 1;
      aiHidden = 1;
    } else if (verdict !== 'block' && row.ai_hidden) {
      hidden = 0;
      aiHidden = 0;
    }
    q.save.run(verdict, reason, hidden, aiHidden, row.id, row.data, row.image);
  }

  /** Checks the post after a short pause (the photo usually arrives right after the text). */
  function schedule(id) {
    clearTimeout(timers.get(id));
    const timer = setTimeout(() => {
      timers.delete(id);
      chain = chain
        .then(() => check(id))
        .catch((e) => console.error(new Date().toISOString(), 'AI moderation failed', id, e?.status ?? '', e?.message));
    }, delayMs);
    timer.unref?.();
    timers.set(id, timer);
  }

  return { schedule, idle: () => chain };
}
