import assert from "node:assert/strict";
import { test } from "node:test";

import { canRedo, canUndo, createHistoryReducer, initHistory } from "../web/history.js";

// A tiny counter reducer is enough to test the history wrapper without
// pulling in board-state.js -- it's deliberately generic.
function counterReducer(count, action) {
  if (action.type === "INCREMENT") return count + 1;
  if (action.type === "SET") return action.value === count ? count : action.value; // same-reference no-op contract
  return count;
}

test("initHistory", async (t) => {
  await t.test("starts with empty past/future and the given present", () => {
    const history = initHistory(0);
    assert.deepEqual(history, { past: [], present: 0, future: [] });
  });
});

test("createHistoryReducer: delegating to the wrapped reducer", async (t) => {
  const dispatch = createHistoryReducer(counterReducer);

  await t.test("advances present and records the previous present in past", () => {
    const history = dispatch(initHistory(0), { type: "INCREMENT" });
    assert.equal(history.present, 1);
    assert.deepEqual(history.past, [0]);
    assert.deepEqual(history.future, []);
  });

  await t.test("clears future on a fresh action", () => {
    let history = initHistory(0);
    history = dispatch(history, { type: "INCREMENT" }); // 1
    history = dispatch(history, { type: "UNDO" }); // back to 0, future: [1]
    assert.deepEqual(history.future, [1]);
    history = dispatch(history, { type: "INCREMENT" }); // fresh action from 0 -> 1
    assert.deepEqual(history.future, []);
  });

  await t.test("a no-op action (same reference) does not touch past or future", () => {
    let history = initHistory(5);
    history = dispatch(history, { type: "SET", value: 5 }); // no-op: same value
    assert.deepEqual(history, initHistory(5));
  });

  await t.test("an unrelated action type is a no-op", () => {
    const history = initHistory(0);
    assert.equal(dispatch(history, { type: "NOPE" }), history);
  });
});

test("createHistoryReducer: UNDO", async (t) => {
  const dispatch = createHistoryReducer(counterReducer);

  await t.test("moves present back to the last past entry", () => {
    let history = initHistory(0);
    history = dispatch(history, { type: "INCREMENT" }); // present: 1, past: [0]
    history = dispatch(history, { type: "INCREMENT" }); // present: 2, past: [0, 1]
    history = dispatch(history, { type: "UNDO" });
    assert.equal(history.present, 1);
    assert.deepEqual(history.past, [0]);
    assert.deepEqual(history.future, [2]);
  });

  await t.test("undoing repeatedly walks all the way back", () => {
    let history = initHistory(0);
    history = dispatch(history, { type: "INCREMENT" });
    history = dispatch(history, { type: "INCREMENT" });
    history = dispatch(history, { type: "UNDO" });
    history = dispatch(history, { type: "UNDO" });
    assert.equal(history.present, 0);
    assert.deepEqual(history.past, []);
    assert.deepEqual(history.future, [1, 2]);
  });

  await t.test("undoing with nothing in past is a no-op (same reference)", () => {
    const history = initHistory(0);
    assert.equal(dispatch(history, { type: "UNDO" }), history);
  });
});

test("createHistoryReducer: REDO", async (t) => {
  const dispatch = createHistoryReducer(counterReducer);

  await t.test("moves present forward to the first future entry", () => {
    let history = initHistory(0);
    history = dispatch(history, { type: "INCREMENT" }); // 1
    history = dispatch(history, { type: "INCREMENT" }); // 2
    history = dispatch(history, { type: "UNDO" }); // 1, future: [2]
    history = dispatch(history, { type: "UNDO" }); // 0, future: [1, 2]
    history = dispatch(history, { type: "REDO" });
    assert.equal(history.present, 1);
    assert.deepEqual(history.past, [0]);
    assert.deepEqual(history.future, [2]);
  });

  await t.test("redoing with nothing in future is a no-op (same reference)", () => {
    const history = initHistory(0);
    assert.equal(dispatch(history, { type: "REDO" }), history);
  });

  await t.test("a fresh action after redo does not resurrect the discarded future", () => {
    let history = initHistory(0);
    history = dispatch(history, { type: "INCREMENT" }); // 1
    history = dispatch(history, { type: "INCREMENT" }); // 2
    history = dispatch(history, { type: "UNDO" }); // 1, future: [2]
    history = dispatch(history, { type: "INCREMENT" }); // fresh action: 1 -> 2, future cleared
    assert.deepEqual(history.future, []);
    assert.equal(dispatch(history, { type: "REDO" }), history);
  });
});

test("canUndo / canRedo", async (t) => {
  await t.test("both false on a fresh history", () => {
    const history = initHistory(0);
    assert.equal(canUndo(history), false);
    assert.equal(canRedo(history), false);
  });

  await t.test("canUndo true after an action, canRedo true after undoing", () => {
    const dispatch = createHistoryReducer(counterReducer);
    let history = initHistory(0);
    history = dispatch(history, { type: "INCREMENT" });
    assert.equal(canUndo(history), true);
    assert.equal(canRedo(history), false);

    history = dispatch(history, { type: "UNDO" });
    assert.equal(canUndo(history), false);
    assert.equal(canRedo(history), true);
  });
});
