export type Flags = number;

// Exception
export const ERROR_OFFSET = 0;
export const ERROR_BIT = 1 << ERROR_OFFSET;
export const ERROR: unique symbol = Symbol(__DEV__ ? "ERROR" : 0);

// Async is pending?
export const LOADING_OFFSET = 1;
export const LOADING_BIT = 1 << LOADING_OFFSET;
export const LOADING: unique symbol = Symbol(__DEV__ ? "LOADING" : 0);

// Lazy memo not initialized yet?
export const UNINITIALIZED_OFFSET = 2;
export const UNINITIALIZED_BIT = 1 << UNINITIALIZED_OFFSET;
export const UNINITIALIZED: unique symbol = Symbol(__DEV__ ? "UNINITIALIZED" : 0);

// --- START OF R3 ---

export const DIRTY_OFFSET = 3;
export const DIRTY_BIT = 1 << DIRTY_OFFSET;
export const DIRTY: unique symbol = Symbol(__DEV__ ? "DIRTY" : 0);

export const RECOMPUTING_DEPS_OFFSET = 4;
export const RECOMPUTING_DEPS_BIT = 1 << RECOMPUTING_DEPS_OFFSET;
export const RECOMPUTING_DEPS: unique symbol = Symbol(__DEV__ ? "RECOMPUTING_DEPS" : 0);

export const IN_HEAP_OFFSET = 5;
export const IN_HEAP_BIT = 1 << IN_HEAP_OFFSET;
export const IN_HEAP: unique symbol = Symbol(__DEV__ ? "IN_HEAP" : 0);

export const IN_FALLBACK_HEAP_OFFSET = 6;
export const IN_FALLBACK_HEAP_BIT = 1 << IN_FALLBACK_HEAP_OFFSET;
export const IN_FALLBACK_HEAP: unique symbol = Symbol(__DEV__ ? "IN_FALLBACK_HEAP" : 0);

// --- END OF R3 ---

export const DEFAULT_FLAGS = ERROR_BIT;
