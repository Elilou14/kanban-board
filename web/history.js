/**
 * A generic undo/redo wrapper around any reducer -- reducer-agnostic,
 * not specific to the Kanban board at all. Wraps a reducer of type
 * (state, action) -> state into one of type (history, action) ->
 * history, where history is { past: state[], present: state, future: state[] }.
 *
 * Two action types are handled directly (UNDO, REDO); every other
 * action is delegated to the wrapped reducer. If the wrapped reducer
 * returns the exact same reference (its documented no-op contract --
 * see board-state.js), the history is left untouched too: an action
 * that changed nothing doesn't consume an undo slot. Redoing after a
 * fresh action is impossible by design (`future` is cleared), same as
 * every other undo/redo implementation.
 */

export function initHistory(present) {
  return { past: [], present, future: [] };
}

export function createHistoryReducer(reducer) {
  return function historyReducer(history, action) {
    if (action.type === "UNDO") {
      if (history.past.length === 0) return history;
      const previous = history.past[history.past.length - 1];
      return {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      };
    }

    if (action.type === "REDO") {
      if (history.future.length === 0) return history;
      const [next, ...rest] = history.future;
      return {
        past: [...history.past, history.present],
        present: next,
        future: rest,
      };
    }

    const nextPresent = reducer(history.present, action);
    if (nextPresent === history.present) return history;

    return { past: [...history.past, history.present], present: nextPresent, future: [] };
  };
}

export function canUndo(history) {
  return history.past.length > 0;
}

export function canRedo(history) {
  return history.future.length > 0;
}
