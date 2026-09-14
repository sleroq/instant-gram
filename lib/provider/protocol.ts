import type { Page, Thread, ThreadMessages } from '../domain.ts';
import type { EngineError } from '../engine/inbox.ts';

export const PROVIDER_PORT = 'icr:instagram-provider-v2';
export type ProviderRequest =
    | { kind: 'request'; id: number; method: 'account' }
    | {
          kind: 'request';
          id: number;
          method: 'inbox';
          expectedAccountId: string;
          cursor?: string;
      }
    | {
          kind: 'request';
          id: number;
          method: 'history';
          expectedAccountId: string;
          threadKey: string;
          cursor?: string;
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
      }
    | {
          kind: 'response';
          id: number;
          method: 'history';
          result:
              | { ok: true; value: ThreadMessages }
              | { ok: false; error: EngineError };
      };
