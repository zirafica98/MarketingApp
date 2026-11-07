import { inject, Service } from '@angular/core';
import { CONFIG } from './config';
import { Supabase } from './supabase';

/** Pozivi ka HTTP delu workera (tajne: tokeni kanala, AI ključevi, plaćanje). Šalje token prijavljenog korisnika. */
@Service()
export class WorkerApi {
  private readonly sb = inject(Supabase).client;

  async post<T>(putanja: string, telo: unknown): Promise<T> {
    const { data } = await this.sb.auth.getSession();
    const res = await fetch(`${CONFIG.workerUrl}${putanja}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify(telo),
    }).catch(() => {
      throw new Error('Server alata trenutno ne odgovara. Pokušaj za minut.');
    });
    const json = (await res.json().catch(() => ({}))) as T & { greska?: string };
    if (!res.ok) throw new Error(json.greska ?? `Greška ${res.status}`);
    return json;
  }

  async get<T>(putanja: string): Promise<T> {
    const res = await fetch(`${CONFIG.workerUrl}${putanja}`).catch(() => null);
    if (!res?.ok) throw new Error('Server alata trenutno ne odgovara.');
    return (await res.json()) as T;
  }

  url(putanja: string): string {
    return `${CONFIG.workerUrl}${putanja}`;
  }
}
