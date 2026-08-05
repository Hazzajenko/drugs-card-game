"use strict";
/* Rule tests — run with: npm test
 * These drive the real server rule functions, not a copy of them. */
process.env.DATA_DIR = process.env.DATA_DIR || require("os").tmpdir() + "/drugs-test-data";
const assert = require("assert");
const R = require("../server.js");

const C = (rank, suit = "♠") => ({ rank, suit });
/* A room with no connected players, so broadcasts are no-ops. */
function room(pile, opts = {}) {
  return {
    code: "TEST", phase: "playing", players: [], spectators: [], deck: [], pile: pile.slice(),
    turn: 0, direction: 1, sevenActive: false, busy: false, abandonedAt: null,
    opts: Object.assign({ bots: 0, decks: 1, burn: 4 }, opts),
  };
}
let nextId = 1;
const actor = (name = "P1") => ({ id: nextId++, name, bot: false, connected: true, hand: [], faceUp: [], faceDown: [] });
/* A room with real seats, for the chaos effects that move cards between players. */
function table(pile, seats, opts = {}) {
  const r = room(pile, opts);
  r.players = seats;
  return r;
}
const JK = () => ({ rank: R.JOKER, suit: "★" });
const effect = key => R.JOKER_EFFECTS.find(e => e.key === key);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + e.message); }
}

console.log("\nOverdose");
test("two 4s then two more 4s overdoses at threshold 4 (Joel's scenario)", () => {
  const r = room([C(4, "♠"), C(4, "♥")]);          // player 1 already played two 4s
  const res = R.resolvePlay(r, [C(4, "♦"), C(4, "♣")], actor("P2"));  // player 2 adds two more
  assert.strictEqual(res.burned, true, "should burn");
  assert.strictEqual(res.goAgain, true, "player 2 should go again");
  assert.strictEqual(r.pile.length, 0, "pile should be cleared");
});
test("four 4s played one at a time also overdoses", () => {
  const r = room([C(4, "♠"), C(4, "♥"), C(4, "♦")]);
  assert.strictEqual(R.resolvePlay(r, [C(4, "♣")], actor()).burned, true);
});
test("three 4s do not overdose at threshold 4", () => {
  const r = room([C(4, "♠"), C(4, "♥")]);
  assert.strictEqual(R.resolvePlay(r, [C(4, "♦")], actor()).burned, false);
  assert.strictEqual(r.pile.length, 3);
});
test("four 4s do NOT overdose when the threshold is 5", () => {
  const r = room([C(4, "♠"), C(4, "♥"), C(4, "♦")], { burn: 5 });
  assert.strictEqual(R.resolvePlay(r, [C(4, "♣")], actor()).burned, false);
});
test("five of a kind overdoses when the threshold is 5", () => {
  const r = room([C(6, "♠"), C(6, "♥"), C(6, "♦"), C(6, "♣")], { burn: 5 });
  assert.strictEqual(R.resolvePlay(r, [C(6, "♠")], actor()).burned, true);
});
test("only the run on top counts — lower cards don't break it", () => {
  const r = room([C(9), C(4, "♠"), C(4, "♥"), C(4, "♦")]);
  assert.strictEqual(R.resolvePlay(r, [C(4, "♣")], actor()).burned, true);
});
test("a non-matching card below stops the run", () => {
  const r = room([C(4, "♠"), C(5), C(5, "♥"), C(5, "♦")]);
  assert.strictEqual(R.resolvePlay(r, [C(5, "♣")], actor()).burned, true, "four 5s burn");
  const r2 = room([C(4, "♠"), C(4, "♥"), C(9), C(9, "♥")]);
  assert.strictEqual(R.resolvePlay(r2, [C(9, "♦")], actor()).burned, false, "three 9s do not");
});
test("Overdose off (0) never burns on a run", () => {
  const r = room([C(4, "♠"), C(4, "♥"), C(4, "♦")], { burn: 0 });
  assert.strictEqual(R.resolvePlay(r, [C(4, "♣")], actor()).burned, false);
});
test("a 3 played on three 4s does NOT currently overdose", () => {
  // documents present behaviour: the transparent 3 is not treated as a 4 here
  const r = room([C(4, "♠"), C(4, "♥"), C(4, "♦")]);
  assert.strictEqual(R.resolvePlay(r, [C(3)], actor()).burned, false);
});

console.log("\nSpecial cards");
test("10 kills the pile and grants another turn", () => {
  const r = room([C(9), C(8)]);
  const res = R.resolvePlay(r, [C(10)], actor());
  assert.strictEqual(res.burned, true);
  assert.strictEqual(res.goAgain, true);
  assert.strictEqual(r.pile.length, 0);
});
test("2 resets — anything may follow", () => {
  const r = room([C(13)]);
  R.resolvePlay(r, [C(2)], actor());
  assert.strictEqual(R.canPlayRank(r, 4), true, "a 4 should be legal after a 2");
});
test("3 mirrors the card underneath", () => {
  const r = room([C(9)]);
  R.resolvePlay(r, [C(3)], actor());
  assert.strictEqual(R.effectiveTop(r), 9, "effective top should still be 9");
  assert.strictEqual(R.canPlayRank(r, 8), false, "an 8 must not be playable on a mirrored 9");
  assert.strictEqual(R.canPlayRank(r, 9), true);
});
test("3 on an empty pile lets anything follow", () => {
  const r = room([]);
  R.resolvePlay(r, [C(3)], actor());
  assert.strictEqual(R.effectiveTop(r), null);
  assert.strictEqual(R.canPlayRank(r, 5), true);
});
test("7 caps the next player at 7 or lower, but 2/3/10 still work", () => {
  const r = room([C(5)]);
  R.resolvePlay(r, [C(7)], actor());
  assert.strictEqual(r.sevenActive, true);
  assert.strictEqual(R.canPlayRank(r, 6), true);
  assert.strictEqual(R.canPlayRank(r, 7), true);
  assert.strictEqual(R.canPlayRank(r, 8), false);
  assert.strictEqual(R.canPlayRank(r, 14), false);
  for (const special of [2, 3, 10]) assert.strictEqual(R.canPlayRank(r, special), true, special + " should be legal");
});
test("the 7 cap does not persist past the next play", () => {
  const r = room([C(5)]);
  R.resolvePlay(r, [C(7)], actor());
  R.resolvePlay(r, [C(6)], actor());
  assert.strictEqual(r.sevenActive, false);
});
test("a single Jack reverses the order", () => {
  const r = room([C(9)]);
  R.resolvePlay(r, [C(11)], actor());
  assert.strictEqual(r.direction, -1);
});
test("Jacks played in separate turns each reverse", () => {
  const r = room([C(9)]);
  R.resolvePlay(r, [C(11)], actor());
  assert.strictEqual(r.direction, -1);
  R.resolvePlay(r, [C(11, "♥")], actor("P2"));
  assert.strictEqual(r.direction, 1, "the next Jack flips it back");
});
test("any number of Jacks played together reverses exactly once", () => {
  for (const count of [2, 3, 4]) {
    const r = room([C(9)]);
    const cards = ["♠", "♥", "♦", "♣"].slice(0, count).map(s => C(11, s));
    R.resolvePlay(r, cards, actor("Bot 1"));
    assert.strictEqual(r.direction, -1, count + " Jacks together should reverse once");
  }
});

console.log("\nPile and progression");
test("equal or higher is legal, lower is not", () => {
  const r = room([C(9)]);
  assert.strictEqual(R.canPlayRank(r, 9), true);
  assert.strictEqual(R.canPlayRank(r, 10), true);
  assert.strictEqual(R.canPlayRank(r, 8), false);
});
test("picking up the pile moves every card into the hand", () => {
  const r = room([C(4), C(9), C(13)]);
  const p = actor();
  R.pickUpPile(r, p);
  assert.strictEqual(p.hand.length, 3);
  assert.strictEqual(r.pile.length, 0);
  assert.strictEqual(r.sevenActive, false);
});
test("zone order is hand, then face-up, then face-down", () => {
  const p = actor();
  p.faceDown = [C(2), C(3)]; p.faceUp = [C(4)]; p.hand = [C(5)];
  assert.strictEqual(R.activeZone(p), "hand");
  p.hand = [];
  assert.strictEqual(R.activeZone(p), "faceUp");
  p.faceUp = [];
  assert.strictEqual(R.activeZone(p), "faceDown");
  p.faceDown = [];
  assert.strictEqual(R.activeZone(p), null);
});
test("a win needs an empty deck and no cards anywhere", () => {
  const r = room([]);
  const p = actor();
  assert.strictEqual(R.hasWon(r, p), true);
  r.deck = [C(5)];
  assert.strictEqual(R.hasWon(r, p), false, "cards left in the deck means no win yet");
});
test("topRunCount counts the identical-rank run on top", () => {
  assert.strictEqual(R.topRunCount(room([])), 0);
  assert.strictEqual(R.topRunCount(room([C(9)])), 1);
  assert.strictEqual(R.topRunCount(room([C(4), C(9, "♠"), C(9, "♥")])), 2);
  assert.strictEqual(R.topRunCount(room([C(9, "♠"), C(9, "♥"), C(9, "♦")])), 3);
  assert.strictEqual(R.topRunCount(room([C(9, "♠"), C(4), C(9, "♥")])), 1, "a break resets the run");
});
test("a deck has 52 distinct cards per copy", () => {
  assert.strictEqual(R.makeDeck(1).length, 52);
  assert.strictEqual(R.makeDeck(3).length, 156);
  const counts = {};
  for (const c of R.makeDeck(2)) counts[c.rank + c.suit] = (counts[c.rank + c.suit] || 0) + 1;
  assert.strictEqual(Object.keys(counts).length, 52);
  assert.ok(Object.values(counts).every(n => n === 2), "two decks means two of every card");
});

console.log("\nChaos mode — jokers");
test("a Joker is playable on anything, even under a 7", () => {
  const r = room([C(14)]);
  assert.strictEqual(R.canPlayRank(r, R.JOKER), true, "on an ace");
  r.sevenActive = true;
  assert.strictEqual(R.canPlayRank(r, R.JOKER), true, "under a 7 cap");
});
test("a Joker on top leaves the pile wide open", () => {
  const r = table([], [actor("P1"), actor("P2")]);
  R.resolvePlay(r, [JK()], r.players[0]);
  assert.strictEqual(R.canPlayRank(r, 2), true);
  assert.strictEqual(R.canPlayRank(r, 4), true, "a low card is legal on a Joker");
  assert.strictEqual(R.canPlayRank(r, 14), true);
});
test("a Joker clears an active 7 cap", () => {
  const r = table([C(5)], [actor("P1"), actor("P2")]);
  r.sevenActive = true;
  R.resolvePlay(r, [JK()], r.players[0]);
  assert.strictEqual(r.sevenActive, false);
  assert.strictEqual(R.canPlayRank(r, 13), true, "a king is legal again");
});
test("four Jokers still overdose the pile", () => {
  const r = table([JK(), JK(), JK()], [actor("P1"), actor("P2")]);
  assert.strictEqual(R.resolvePlay(r, [JK()], r.players[0]).burned, true);
  assert.strictEqual(r.pile.length, 0);
});

console.log("\nChaos mode — effects");
test("swap trades hands with the next seat", () => {
  const a = actor("A"), b = actor("B");
  a.hand = [C(4), C(5)];
  b.hand = [C(9), C(10), C(11)];
  const r = table([], [a, b]);
  effect("swap").run(r, a);
  assert.strictEqual(a.hand.length, 3, "A got B's three cards");
  assert.strictEqual(b.hand.length, 2, "B got A's two cards");
  assert.strictEqual(a.hand[0].rank, 9);
});
test("swap follows the play direction", () => {
  const a = actor("A"), b = actor("B"), c = actor("C");
  a.hand = [C(4)]; b.hand = [C(9)]; c.hand = [C(13)];
  const r = table([], [a, b, c]);
  r.direction = -1;
  effect("swap").run(r, a);          // reversed: the seat before A
  assert.strictEqual(a.hand[0].rank, 13, "swapped with C, not B");
  assert.strictEqual(c.hand[0].rank, 4);
});
test("rotate passes every hand one seat along", () => {
  const a = actor("A"), b = actor("B"), c = actor("C");
  a.hand = [C(4)]; b.hand = [C(9)]; c.hand = [C(13)];
  const r = table([], [a, b, c]);
  effect("rotate").run(r, a);
  assert.strictEqual(a.hand[0].rank, 13, "A receives from C");
  assert.strictEqual(b.hand[0].rank, 4, "B receives from A");
  assert.strictEqual(c.hand[0].rank, 9, "C receives from B");
});
test("rotate keeps every card in play", () => {
  const seats = [actor("A"), actor("B"), actor("C")];
  seats[0].hand = [C(4), C(5)]; seats[1].hand = []; seats[2].hand = [C(13)];
  const r = table([], seats);
  effect("rotate").run(r, seats[0]);
  assert.strictEqual(seats.reduce((n, p) => n + p.hand.length, 0), 3);
});
test("skip sets the flag that advanceTurn consumes", () => {
  const a = actor("A"), b = actor("B");
  const r = table([], [a, b]);
  effect("skip").run(r, a);
  assert.strictEqual(r.skipNext, true);
});
test("tax makes everyone else draw, and copes with an empty deck", () => {
  const a = actor("A"), b = actor("B"), c = actor("C");
  const r = table([], [a, b, c]);
  r.deck = [C(7), C(8)];
  effect("tax").run(r, a);
  assert.strictEqual(a.hand.length, 0, "the player who rolled it pays nothing");
  assert.strictEqual(b.hand.length + c.hand.length, 2);
  const r2 = table([], [a, b]);
  r2.deck = [];
  assert.ok(/empty/.test(effect("tax").run(r2, a)), "says so when the deck is dry");
});
test("purge dumps everyone's lowest card onto the pile", () => {
  const a = actor("A"), b = actor("B");
  a.hand = [C(4), C(9)];
  b.hand = [C(6), C(13)];
  const r = table([], [a, b]);
  effect("purge").run(r, a);
  assert.strictEqual(a.hand.length, 1); assert.strictEqual(a.hand[0].rank, 9);
  assert.strictEqual(b.hand.length, 1); assert.strictEqual(b.hand[0].rank, 13);
  assert.deepStrictEqual(r.pile.map(c => c.rank), [4, 6], "in seat order");
});
test("purge skips empty hands without crashing", () => {
  const a = actor("A"), b = actor("B");
  a.hand = []; b.hand = [C(6)];
  const r = table([], [a, b]);
  effect("purge").run(r, a);
  assert.deepStrictEqual(r.pile.map(c => c.rank), [6]);
});
test("bomb arms the pile", () => {
  const r = table([], [actor("A"), actor("B")]);
  effect("bomb").run(r, r.players[0]);
  assert.strictEqual(r.bombArmed, true);
});

console.log("\nChaos mode — the time bomb");
test("playing a plain card on an armed pile eats the whole thing", () => {
  const a = actor("A"), b = actor("B");
  const r = table([C(4), C(9)], [a, b]);
  r.bombArmed = true;
  const res = R.resolvePlay(r, [C(13)], b);
  assert.strictEqual(res.burned, false);
  assert.strictEqual(r.pile.length, 0, "pile cleared into their hand");
  assert.strictEqual(b.hand.length, 3, "two pile cards plus the one they played");
  assert.strictEqual(r.bombArmed, false, "and the bomb is spent");
});
test("a 2, 3, 10 or Joker defuses it instead", () => {
  for (const rank of [2, 3, 10, R.JOKER]) {
    const a = actor("A"), b = actor("B");
    const r = table([C(4)], [a, b]);
    r.bombArmed = true;
    R.resolvePlay(r, [rank === R.JOKER ? JK() : C(rank)], b);
    assert.strictEqual(b.hand.length, 0, `rank ${rank} should not eat the pile`);
    assert.strictEqual(r.bombArmed, false, `rank ${rank} disarms it`);
  }
});
test("picking up the pile takes the bomb with it", () => {
  const a = actor("A");
  const r = table([C(4), C(9)], [a]);
  r.bombArmed = true;
  R.pickUpPile(r, a);
  assert.strictEqual(r.bombArmed, false);
});

console.log("\nChaos mode — client/server parity");
{
  const fs = require("fs");
  const client = fs.readFileSync(require("path").join(__dirname, "..", "public", "index.html"), "utf8");
  test("the roulette lists exactly the effects the server can roll", () => {
    const m = client.match(/const EFFECT_ORDER = \[([^\]]+)\]/);
    assert.ok(m, "EFFECT_ORDER not found in the client");
    const clientKeys = m[1].split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean).sort();
    const serverKeys = R.JOKER_EFFECTS.map(e => e.key).sort();
    assert.deepStrictEqual(clientKeys, serverKeys,
      "reel would land on the wrong effect — client " + clientKeys.join("/") + " vs server " + serverKeys.join("/"));
  });
  test("every effect has an icon and a name for the reel", () => {
    for (const e of R.JOKER_EFFECTS) {
      assert.ok(new RegExp(`\\b${e.key}:\\s*\\{\\s*ic:`).test(client), `no EFFECT_META entry for "${e.key}"`);
    }
  });
  test("the reel item height matches the CSS", () => {
    const js = client.match(/const SLOT_H = (\d+)/);
    const css = client.match(/\.slot-item \{\s*height: (\d+)px/);
    assert.ok(js && css, "could not find SLOT_H or .slot-item height");
    assert.strictEqual(js[1], css[1], "SLOT_H and .slot-item height must agree or the reel lands off-centre");
  });
}

console.log("\nChaos mode — dealing");
test("makeDeck still has no jokers in it", () => {
  assert.strictEqual(R.makeDeck(2).filter(c => c.rank === R.JOKER).length, 0);
  assert.strictEqual(R.makeDeck(1).length, 52);
});
test("shuffle keeps every card", () => {
  const d = R.makeDeck(1);
  const before = d.map(c => c.rank + c.suit).sort().join(",");
  R.shuffle(d);
  assert.strictEqual(d.map(c => c.rank + c.suit).sort().join(","), before);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
