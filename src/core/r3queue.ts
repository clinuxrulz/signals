import { EFFECT_PURE, STATE_DIRTY } from "./constants.js";
import type { Computation } from "./core.js";
import { IN_FALLBACK_HEAP_BIT, IN_HEAP_BIT, RECOMPUTING_DEPS_BIT } from "./flags.js";
import { getOwner, setOwner } from "./owner.js";
import { ActiveTransition, globalQueue } from "./scheduler.js";

export interface Link {
  dep: Computation;
  sub: Computation;
  nextDep: Link | null;
  prevSub: Link | null;
  nextSub: Link | null;
}

export class R3Queue {
  minDirty = Number.POSITIVE_INFINITY;
  maxDirty = 0;
  nextMaxDirty = 0;
  contextHeight = 0;
  heapSize = 0;
  fallbackHeap: Computation | undefined = undefined;
  dirtyHeap: (Computation | undefined)[] = new Array(2000);
  computationUpdateMap = new WeakMap<Computation,() => void>;

  increaseHeapSize(n: number) {
    if (n > this.dirtyHeap.length) {
      this.dirtyHeap.length = n;
    }
  }

  insertIntoHeap(n: Computation, update: () => void) {
    this.computationUpdateMap.set(n, update);
    //
    let flags = n._stateFlags;
    if (flags & (IN_HEAP_BIT | RECOMPUTING_DEPS_BIT)) return;
    if (flags & IN_FALLBACK_HEAP_BIT) {
      // flags ^= IN_FALLBACK_HEAP_BIT;
      if (n.prevHeap === n) {
        this.fallbackHeap = undefined;
      } else {
        const next = n.nextHeap;
        const dhh = this.fallbackHeap!;
        const end = next ?? dhh;
        if (n === dhh) {
          this.fallbackHeap = next;
        } else {
          n.prevHeap.nextHeap = next;
        }
        end.prevHeap = n.prevHeap;
      }
      n.prevHeap = n;
      n.nextHeap = undefined;
    }
    this.heapSize++;
    n._stateFlags = flags | IN_HEAP_BIT;
    const height = n.height;
    const heapAtHeight = this.dirtyHeap[height];
    if (heapAtHeight === undefined) {
      this.dirtyHeap[height] = n;
    } else {
      const tail = heapAtHeight.prevHeap;
      tail.nextHeap = n;
      n.prevHeap = tail;
      heapAtHeight.prevHeap = n;
    }
    if (height > this.maxDirty) {
      this.maxDirty = height;
    } else if (height <= this.minDirty) {
      this.nextMaxDirty = height;
    }
  }

  moveToFallbackHeap(n: Computation) {
    const flags = n._stateFlags;
    if (flags & IN_FALLBACK_HEAP_BIT) return;
    this.deleteFromHeap(n);
    n._stateFlags |= IN_FALLBACK_HEAP_BIT;
    if (this.fallbackHeap === undefined) {
      this.fallbackHeap = n;
    } else {
      const tail = this.fallbackHeap.prevHeap;
      tail.nextHeap = n;
      n.prevHeap = tail;
      this.fallbackHeap.prevHeap = n;
    }
  }

  deleteFromHeap(n: Computation) {
    this.computationUpdateMap.delete(n);
    //
    const nodeFlags = n._stateFlags;
    if (!(nodeFlags & IN_HEAP_BIT)) return;
    this.heapSize--;
    n._stateFlags = nodeFlags & ~IN_HEAP_BIT;
    const height = n.height;
    if (n.prevHeap === n) {
      this.dirtyHeap[height] = undefined;
    } else {
      const next = n.nextHeap;
      const dhh = this.dirtyHeap[height]!;
      const end = next ?? dhh;
      if (n === dhh) {
        this.dirtyHeap[height] = next;
      } else {
        n.prevHeap.nextHeap = next;
      }
      end.prevHeap = n.prevHeap;
    }
    n.prevHeap = n;
    n.nextHeap = undefined;
  }

  clearFallbackHeap() {
    while (this.fallbackHeap !== undefined) {
      this.fallbackHeap._stateFlags ^= IN_FALLBACK_HEAP_BIT;
      const prevFallbackHeap = this.fallbackHeap;
      this.fallbackHeap = this.fallbackHeap.nextHeap;
      prevFallbackHeap.prevHeap = prevFallbackHeap;
      prevFallbackHeap.nextHeap = undefined;
    }
  }

  stabilize() {
    if (!this.heapSize) {
      return;
    }
    for (this.minDirty = 0; this.minDirty <= this.maxDirty; this.minDirty++) {
      let el = this.dirtyHeap[this.minDirty];
      while (el !== undefined) {
        this.deleteFromHeap(el);
        this.recompute(el);
        el = this.dirtyHeap[this.minDirty];
      }
    }
    this.clearFallbackHeap();
    this.minDirty = Infinity;
    this.maxDirty = this.nextMaxDirty;
    this.nextMaxDirty = 0;
  }

  recompute(el: Computation) {
    this.runDisposal(el);
    const oldContext = getOwner();
    const oldWorkingHeight = this.contextHeight;
    this.contextHeight = el._parent ? el._parent.height + 1 : 0;
    setOwner(el);
    el.depsTail = null;
    el._stateFlags |= RECOMPUTING_DEPS_BIT;
    let didNotError = true;
    let oldValue;
    let value;
    let fn = this.computationUpdateMap.get(el)!;
    try {
      oldValue = el._value;
      fn();
      value = el._value;
    } catch {
      didNotError = false;
    }
    if (el.height < this.contextHeight) {
      if (el._stateFlags & IN_HEAP_BIT) {
        this.deleteFromHeap(el);
        el.height = this.contextHeight;
        this.insertIntoHeap(el, fn);
      } else {
        el.height = this.contextHeight;
      }
    }
    el._stateFlags &= IN_HEAP_BIT | IN_FALLBACK_HEAP_BIT;
    setOwner(oldContext);
    this.contextHeight = oldWorkingHeight;

    const depsTail = el.depsTail as Link | null;
    let toRemove = depsTail !== null ? depsTail.nextDep : el.deps;
    if (toRemove !== null) {
      do {
        toRemove = unlinkSubs(toRemove);
      } while (toRemove !== null);
      if (depsTail !== null) {
        depsTail.nextDep = null;
      } else {
        el.deps = null;
      }
    }

    let isEqual: boolean;
    if (el._equals == false) {
      isEqual = false;
    } else {
      isEqual = el._equals(oldValue, value);
    }

    if (!isEqual) {
      /*
      if (didNotError) {
        el.value = value;
      }*/
      for (let s = el.subs; s !== null; s = s.nextSub) {
        if (ActiveTransition && ActiveTransition._sources.has(el)) {
          return ActiveTransition._sources.get(el)!._queue.enqueue(EFFECT_PURE, el, () => (el as any)._run(EFFECT_PURE));
        }
        this.insertIntoHeap(el, () => (el as any)._run(EFFECT_PURE));
      }
    }
  }

  runDisposal(node: Computation): void {
    if (!node._disposal) return;
    if (Array.isArray(node._disposal)) {
      for (let i = 0; i < node._disposal.length; i++) {
        const callable = node._disposal[i];
        callable!.call(callable);
      }
    } else {
      node._disposal.call(node._disposal);
    }
    node._disposal = null;
  }
}

function unlinkSubs(link: Link): Link | null {
  const dep = link.dep;
  const nextDep = link.nextDep;
  const nextSub = link.nextSub;
  const prevSub = link.prevSub;
  if (nextSub !== null) {
    nextSub.prevSub = prevSub;
  } else {
    dep.subsTail = prevSub;
  }
  if (prevSub !== null) {
    prevSub.nextSub = nextSub;
  } else {
    dep.subs = nextSub;
    if (nextSub === null && "fn" in dep) {
      unwatched(dep);
    }
  }
  return nextDep;
}

function unwatched(el: Computation) {
  if (ActiveTransition && ActiveTransition._sources.has(el)) {
    return ActiveTransition._pureQueue.deleteFromHeap(el);
  } else {
    globalQueue._pureQueue.deleteFromHeap(el);
  }
  let dep = el.deps;
  while (dep !== null) {
    dep = unlinkSubs(dep);
  }
  el.deps = null;
  runDisposal(el);
}

function runDisposal(node: Computation): void {
  if (!node._disposal) return;

  if (Array.isArray(node._disposal)) {
    for (let i = 0; i < node._disposal.length; i++) {
      const callable = node._disposal[i];
      callable!.call(callable);
    }
  } else {
    node._disposal.call(node._disposal);
  }

  node._disposal = null;
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L52
export function link(
  dep: Computation,
  sub: Computation,
) {
  const prevDep = sub.depsTail;
  if (prevDep !== null && prevDep.dep === dep) {
    return;
  }
  let nextDep: Link | null = null;
  const isRecomputing = sub._stateFlags & RECOMPUTING_DEPS_BIT;
  if (isRecomputing) {
    nextDep = prevDep !== null ? prevDep.nextDep : sub.deps;
    if (nextDep !== null && nextDep.dep === dep) {
      sub.depsTail = nextDep;
      return;
    }
  }

  const prevSub = dep.subsTail;
  if (
    prevSub !== null &&
    prevSub.sub === sub &&
    (!isRecomputing || isValidLink(prevSub, sub))
  ) {
    return;
  }
  const newLink =
    (sub.depsTail =
      dep.subsTail =
      {
        dep,
        sub,
        nextDep,
        prevSub,
        nextSub: null,
      });
  if (prevDep !== null) {
    prevDep.nextDep = newLink;
  } else {
    sub.deps = newLink;
  }
  if (prevSub !== null) {
    prevSub.nextSub = newLink;
  } else {
    dep.subs = newLink;
  }
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L284
function isValidLink(checkLink: Link, sub: Computation): boolean {
  const depsTail = sub.depsTail;
  if (depsTail !== null) {
    let link = sub.deps!;
    do {
      if (link === checkLink) {
        return true;
      }
      if (link === depsTail) {
        break;
      }
      link = link.nextDep!;
    } while (link !== null);
  }
  return false;
}
