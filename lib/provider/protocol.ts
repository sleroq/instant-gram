import type { Page, Thread } from '../domain.ts';
import type { EngineError } from '../engine/inbox.ts';

export const PROVIDER_PORT = 'icr:instagram-provider-v1';
export type ProviderRequest =
    | { kind: 'request'; id: number; method: 'account' }
    | {
          kind: 'request';
          id: number;
          method: 'inbox';
          expectedAccountId: string;
      };
export type ProviderResponse =
    | {
          kind: 'response';
          id: number;
          method: 'account';
          result:
              | { ok: true; value: string }
              | { ok: false; error: EngineError };
      }
    | {
          kind: 'response';
          id: number;
          method: 'inbox';
          result:
              | { ok: true; value: Page<Thread> }
              | { ok: false; error: EngineError };
      };
