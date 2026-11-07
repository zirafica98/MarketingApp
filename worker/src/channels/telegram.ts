// Telegram kanal preko bota (Bot API). Korisnik upiše token bota i ime kanala; bot mora biti admin kanala.

import { json, KanalGreska, type Kanal, type Tajna } from './types.ts';

const api = (t: Tajna, metoda: string) => `https://api.telegram.org/bot${String(t['bot_token'])}/${metoda}`;

async function zovi<T>(t: Tajna, metoda: string, telo: Record<string, unknown>): Promise<T> {
  const r = await json<{ ok: boolean; result: T; description?: string }>(api(t, metoda), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(telo),
  }).catch((e: Error) => {
    // ne pokazuj token iz URL-a
    throw new KanalGreska(e.message.replace(/bot[^/\s]+/g, 'bot***'), e instanceof KanalGreska && e.trajna);
  });
  if (!r.ok) throw new KanalGreska(r.description ?? 'Telegram greška', true);
  return r.result;
}

export const telegram: Kanal = {
  id: 'telegram',

  async fromForm(polja) {
    const bot_token = (polja['bot_token'] ?? '').trim();
    let chat = (polja['chat'] ?? '').trim();
    if (!/^\d+:[\w-]{20,}$/.test(bot_token)) throw new KanalGreska('Token bota nije ispravan (izgleda kao 123456:ABC…).', true);
    if (/^[A-Za-z]\w{3,}$/.test(chat)) chat = `@${chat}`;
    if (!/^(@\w{4,}|-?\d+)$/.test(chat)) throw new KanalGreska('Upiši kanal kao @imekanala.', true);
    const tajna: Tajna = { bot_token, chat };
    const nalog = await telegram.nalog(tajna);
    return { tajna, nalog };
  },

  async nalog(t) {
    const bot = await zovi<{ id: number; username: string }>(t, 'getMe', {});
    const chat = await zovi<{ id: number; title?: string; username?: string; type: string }>(t, 'getChat', { chat_id: t['chat'] });
    const clan = await zovi<{ status: string; can_post_messages?: boolean }>(t, 'getChatMember', { chat_id: chat.id, user_id: bot.id });
    if (clan.status !== 'administrator' && clan.status !== 'creator') {
      throw new KanalGreska(`Bot @${bot.username} nije administrator kanala. Dodaj ga kao admina sa pravom objavljivanja.`, true);
    }
    return { account_id: String(chat.id), account_name: chat.username ? `@${chat.username}` : chat.title ?? String(chat.id), meta: { bot: `@${bot.username}`, tip: chat.type } };
  },

  async objavi(t, n, o) {
    const tekst = o.tekst;
    type Poruka = { message_id: number };
    let prva: Poruka;
    if (!o.slike.length) {
      prva = await zovi<Poruka>(t, 'sendMessage', { chat_id: n.account_id, text: tekst.slice(0, 4096) });
    } else if (o.slike.length === 1) {
      prva = await zovi<Poruka>(t, 'sendPhoto', { chat_id: n.account_id, photo: o.slike[0], caption: tekst.slice(0, 1024) });
    } else {
      const album = o.slike.slice(0, 10).map((url, i) => ({ type: 'photo', media: url, ...(i === 0 ? { caption: tekst.slice(0, 1024) } : {}) }));
      prva = (await zovi<Poruka[]>(t, 'sendMediaGroup', { chat_id: n.account_id, media: album }))[0]!;
    }
    const javni = n.account_name.startsWith('@') ? `https://t.me/${n.account_name.slice(1)}/${prva.message_id}` : null;
    return { external_id: String(prva.message_id), permalink: javni };
  },
};
