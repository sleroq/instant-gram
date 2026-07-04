import type { ThreadMessages } from '../../lib/domain';

export type View<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'error'; message: string };

export type ThreadCacheEntry = {
  state: 'idle' | 'loading-initial' | 'ready' | 'error';
  data?: ThreadMessages;
  error?: string;
  loadingOlder: boolean;
  preloadingOlder: boolean;
  cursor?: string;
  hasNextPage: boolean;
  requestId?: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  isAtBottom: boolean;
  visibleStartIndex: number;
  didInitialScroll: boolean;
  replyTargetStatus: Record<string, 'pending' | 'found' | 'missing'>;
};

export type MessageListApi = {
  scrollToMessage: (messageId: string, behavior?: ScrollBehavior) => boolean;
};
