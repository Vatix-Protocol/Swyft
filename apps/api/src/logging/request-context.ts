import { AsyncLocalStorage } from 'async_hooks';

interface RequestContextStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Threads the current request's requestId through async call chains
 * (services, repositories, exception filters) without passing it as an
 * explicit parameter, so any log line emitted while handling a request can
 * be correlated back to it.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  get requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
