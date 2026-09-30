// The store's observation primitive: a cached snapshot plus change
// notification, the exact contract `useSyncExternalStore` binds to. The
// snapshot's identity changes only when a new value is set, so React (or
// any other subscriber) can compare by reference; publishers must set a
// cell only when state actually changed — the inbox classes' did-change
// booleans are what gate those writes.

export interface ReadonlyCell<T> {
  // Function-typed properties, not methods: get/subscribe travel unbound
  // (into useSyncExternalStore and other subscriber wiring), so
  // implementations must not depend on call-site `this`.
  get: () => T;
  subscribe: (listener: () => void) => () => void;
}

export class ObservableCell<T> implements ReadonlyCell<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  // Arrow fields on purpose: get/subscribe travel unbound into
  // useSyncExternalStore and any other subscriber wiring.
  get = (): T => {
    return this.value;
  };

  set(next: T): void {
    if (Object.is(this.value, next)) {
      return;
    }
    this.value = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
