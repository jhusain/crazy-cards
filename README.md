# Crazy Eights

A TypeScript port of the local two-player game in the original Crazy Cards Java binaries. The Phaser 4 table offers the supplied card backs in **Deck art**. Tap cards to queue them, then tap the discard pile or flick a queued card upward to play the queue. Flick a queued card downward to clear the queue. An upward flick from the hand plays a legal card immediately when there is no card that can follow it. The queue holds up to 12 cards and can continue across turns kept by aces and jacks. Tap the felt or deck to clear the queue, draw, or pass. The brighter side of the felt shows whose turn it is. **Instant Replay** shows the preceding sequence at half speed and stops when you tap the screen. In solo play the table automatically draws and, if needed, passes when there is no legal play.

## Run

Use Node.js 24 or later.

```sh
npm ci
npm run dev
npm test
npm run build
```

The production build is a single self-contained `dist/index.html`. Serve it from any static host or open the file directly in a browser that supports local HTML files and Blob workers. It embeds Phaser, the worker, fonts, and art. An open table runs locally, and reloading deals a fresh match.

## GitHub Pages

Set **Settings → Pages → Source** to **GitHub Actions**. On pushes to `main`, the Pages workflow tests and builds the source, updates `gh-pages` with the generated HTML, and deploys the same build to Pages. You can also run the workflow from the Actions tab.

The jack, queen, and king illustrations are cropped from [AustinGabriel64’s public-domain and CC0 playing cards](https://github.com/AustinGabriel/Public-Domain-and-CC0-Playing-Cards).

## Packages

| Package | Role |
| --- | --- |
| `@crazy-eights/game-server` | Rules, dealing, computer strategy, round state, scoring, and JSON request validation. It has no browser, Phaser, or network dependency. |
| `@crazy-eights/protocol` | JSON command, response, and player-view types shared by both ends. |
| `@crazy-eights/web` | Phaser table, touch input, animation, and a dedicated Web Worker that hosts the server package. |

The client sends a serialized `{requestId, revision, command}` envelope. The worker calls `GameServer.handleJSON(seat, body)` and returns the serialized response. Each response contains the requesting seat’s hand and the public table state. The opponent’s hidden cards and the stock order stay inside the server.

For a future human opponent, run `new GameServer(null)` on a JavaScript server. The hosting code will need to associate connections with seats, authorize lifecycle commands, and deliver `stateJSON(seat)` to the other player after an accepted move. Use `automaticMove` and `stepAutomatic()` to advance committed queues one turn at a time. Current local play needs no network transport.

## Java reference

The supplied folder contained `Game.class`, `RuleBook.class`, `ComputerPlayer.class`, `Hand.class`, `Deck.class`, and the AWT client classes. The port follows the embedded two-player defaults in `RuleBook`. They allow same-rank combos, one voluntary draw per turn, ace/jack skips, cumulative twos, the queen of spades, suit changes on eights, and a chance to tie once a player empties their hand. The original score carries between rounds, and the winner starts the next round. Tap the discard pile or the round result’s **Next round** button to deal the next round. The player’s hand uses the Java sort as a base, then moves single skip cards next to matching suits.

Card identities stay stable across suit calls. The last of multiple eights can call the current suit, and eights revert to their printed suit when recycled. The shuffle uses browser or Node cryptographic randomness. A position in which neither player has a legal play or can draw ends as a tie. If the AI has no cards of a permissible preferred suit, it calls the first legal suit in the original suit order.
