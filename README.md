# Crazy Eights

A TypeScript port of the local two-player game in the original Crazy Cards Java binaries, with a Phaser 4 table and touch input. Tap cards to queue them; tap the discard pile or flick a queued card up or left to play. Flick down to clear the queue. By default a hand flick selects the bottom card of its eligible rank group, with a suit picker when multiple top suits remain. “Flick selects top card instead of bottom card” (off by default) instead lets any non-excluded group member select the top card, with a legal lead first and shuffled middle cards; flicking the sole legal lead in that mode plays it individually. Wild cards still require a suit call. Settings can stage individual wilds and twos when others of that rank remain. With dimming enabled, bottom-selection mode dims cards that cannot lead onto the discard or staged play; top-selection mode also lights cards playable on top through a group, respecting exclusions. The queue holds up to 12 cards and can continue across turns kept by aces and jacks. Tap the deck to clear the queue, draw, or pass; tapping the felt does nothing.

The brighter side of the felt shows whose turn it is. **Instant Replay** shows the preceding opponent sequence at half speed, including human turns only when a forced draw also required a forced pass. Tap anywhere to stop replay, or use its fast-forward icon to skip immediately to the live table. Optional automatic actions share a cancellable countdown card over the deck: autopass after an unplayable voluntary draw, auto pickup when the previous passed choices have not improved, and playing the sole non-excluded eligible card matching the active suit or top rank, counting members of groups as competing choices. Selected cards move into the play when their countdown starts; cancelling leaves them staged for manual control. The optional skip prefix stages matching singleton aces and jacks in hand order before the selected non-skip single. These are off by default and do not expand replay history. Forced draws and passes when no legal play exists still happen without enabling these settings.

Add `?debug=true` to the page URL, or double-tap the opponent’s hand, to toggle debug mode. A toast confirms the mode. Debug mode enables AI assistance by tapping the discard pile with no cards staged. Its **Autoplay** menu checkbox controls both seats automatically; manual card input is disabled while it is on, and the menu and dialogs pause the exhibition. The checkbox is disabled after a match ends. The old `autoplay` URL parameter is ignored.

In debug mode, double-click or double-tap the deck to preview a real reshuffle. It treats the remaining stock as exhausted and replaces it with the earlier discards, preserving the last play, hands, staged cards, and turn, and doubling PPC. It needs at least one earlier discard. A debug single tap waits briefly to distinguish it from a double tap; normal-mode deck taps remain immediate.

At the end of Settings, debug mode reveals **Debug settings → Test aggressiveness**. The button replaces the current match with the repeatable example: 3♥ on the discard pile, the opponent to move with only 3♣, and four jacks, four aces, and four twos in your hand. Exhibition autoplay is disabled so the opponent plays their last card and you can try the three quadruples manually (scores 2, 3, 9). The server rejects this command outside debug mode.

Debug mode also shows an aggressiveness toast for each actual play by either player, including each separate play submitted through the staging area. The score adds two for a queen of spades on top; one per two plus one per consecutive two already on top of the actual discard stack; one for a skip-containing play; one for a quadruple; one for emptying the hand; and one for playing pickup cards against an empty opponent hand. Returning to the suit the opponent changed away from adds one only on the final non-skip play, while the opponent still has cards. Declared wild suits count as the effective suit. Each consecutive run of the same skip rank adds one carryover point to following plays; repeated plays of that rank do not add more. Intrinsic points never carry. Drawing, passing the turn, and starting a round clear carryover; drawing also clears the suit-restoration opportunity. Thus individual jacks score 1, 2, 2, 2, followed by individual aces scoring 2, 3, 3, 3. A jack quadruple followed by an ace quadruple and a final two quadruple against an empty opponent scores 2, 3, 9. Scores do not affect game rules. Level zero keeps the original play animation. Positive scores lift the play, casting a moving, softened card-shaped shadow on the elements beneath it, then slam it beside the previous discard, with a proportionally faster impact, stronger table shake, and louder synthesized palm-on-table sound (when sound is enabled). At level four and above, the other hand scatters radially toward its own edge; displacement increases with the score above three and returns during the original discard slide. The level-one impact sound uses twice the previous output gain. Stronger shakes also settle more slowly (210 ms at level one, plus 75 ms per additional level), with displacement fading to zero; the discard slide waits for settling and retains its duration and easing. With sound off and vibration enabled, a fading vibration pulse pattern follows the shake intensity and playback duration, including slow-motion replay. Browser vibration support is required; motor amplitude is approximated through pulse timing. Queued plays, AI pacing, pickup animations, and replay all share the extended initial-flight timing; reduced motion disables the visual effects.

A match ends after at least three rounds with a winner and unequal total points; ties do not count, and equal total points add another round. The last round’s winner starts the next match. Total points determine the match winner, and the final dialog reports that score plus each seat’s round wins. It offers **New match**; intermediate results offer **Next round**. Points per card (PPC) start at one and appear on the deck back. Recycling a nonempty discard doubles the current PPC. A tie doubles the next round’s starting PPC, independently of in-round reshuffles. After a decisive round, the next round starts at one PPC. Scores transfer the losing hand’s size times the round’s final PPC between seats.

The title bar shows the current round and required total, starting at **1/3**; every tie extends the total. A recycled deck fills sequentially in one third of a play animation, makes three cuts (one half each way), then rolls the PPC downward on every face-down card for one play-animation duration and pauses for another full duration. The shuffle follows the completed play and pile return, and precedes cards drawn from the recycled stock. Gameplay waits until it finishes; the menu and Settings remain usable. Settings changes apply to the table after the current sequence settles.

Target width per card replaces the row-count setting: 40–1,000 logical pixels (shown as dpi), default 240. The solver compares row packings, uses one proportional card size, overlaps rows by their minimum corner height and keeps every face and suit inside the bottom margin, and centers the entire block of left-justified rows. Groups stay intact when configured. Opponent and player hands use 20 CSS-pixel side insets; vertical gaps around the central pile row are 24 CSS pixels. Animation density is independent of these logical pixel dimensions.

The player's hand fades over ten CSS pixels before its clear 20-pixel right and bottom margins. The two fades multiply where they meet. A screen-space alpha mask applies to the composited Phaser canvas starting two pixels above the hand's top edge to cover its antialiased outline, revealing the actual felt in either turn color. Cards retain their global depths during flights. Layout reserves the fade width to keep every face and suit opaque, and hand touch targets stop before the fade.

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

Source code lives on `main`; generated files live only in build artifacts and `gh-pages`. No local commit hook is needed. Every push to `main` installs locked dependencies, runs the tests, builds and checks the PWA, then deploys it at https://jhusain.github.io/crazy-cards/.

To work locally, clone https://github.com/jhusain/crazy-cards.git and follow the Run commands above. Commit source changes and push to `main` to publish; never commit `dist` or `node_modules`. Deployment status is available in the repository's Actions tab. The static build has no dependency on the ChatGPT development environment or hosting.

Set **Settings → Pages → Source** to **GitHub Actions**. On pushes to `main`, the Pages workflow tests and builds the source, updates `gh-pages` with the complete generated PWA, and deploys the same build to Pages. You can also run the workflow from the Actions tab.

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

The supplied folder contained `Game.class`, `RuleBook.class`, `ComputerPlayer.class`, `Hand.class`, `Deck.class`, and the AWT client classes. The port follows the embedded two-player defaults in `RuleBook`. They allow same-rank combos, one voluntary draw per turn, ace/jack skips, cumulative twos, the queen of spades, suit changes on eights, and a chance to tie once a player empties their hand. The score carries between rounds, and the winner starts the next round. Use the round result’s **Next round** button to deal the next round. The player’s hand uses the Java sort as a base, then moves single skip cards next to matching suits.

Card identities stay stable across suit calls. The last of multiple eights can call the current suit, and eights revert to their printed suit when recycled. The shuffle uses browser or Node cryptographic randomness. A position in which neither player has a legal play or can draw ends as a tie. If the AI has no cards of a permissible preferred suit, it calls the first legal suit in the original suit order.

An opponent's last wild in a play reveals its called suit through synchronized vertical reels at all three suit positions. The reel starts with the printed suit when eligible and cycles through distinct adjacent eligible suits. A single wild excludes the preceding active suit throughout; multiple wilds allow all suits. At the start, a random choice determines whether the reel will recoil or advance at the end, always resolving to the opponent's actual call. It spins quickly, gradually slows to rest exactly halfway between two eligible suits, briefly balances there, then tips away from resistance and eases into the final suit. The spin lasts 5.5 ordinary-play durations (about 2.9 seconds at normal speed), with a 0.2-duration final hold before the normal slide and pile return. Input, AI scheduling, hand readiness and replay wait for the full animation. Rank ink follows the moving suits, including recoil. Each symbol fades through five-pixel margins inside its own bounds, including the inverted corner. Player wilds and earlier wilds in a group stay static. Reduced-motion rendering shows the final call immediately.

Automatic eligible-card play counts every non-excluded legal card, including members of groups. The selected card must also be a single in the entire hand: excluded or unplayable cards still count toward face groups. Its optional skip prefix must account for every other eligible card and uses only singleton skips of the active suit, followed by one ordinary singleton of that suit. Matches continue beyond three decisive rounds while points are tied; the winner of the last round starts the next match.

Autoplay exclusions for wildcards, twos and the queen of spades apply unless the eligible card is the last card in the player’s hand. A last card still uses the normal staging and cancellable countdown.

The autoplay exclusion for twos also yields when the discard’s top card is a two. That two remains a competing eligible card, so another non-excluded eligible card blocks automatic play.


The hosted game is an installable PWA with 192/512-pixel icons, a standalone manifest, and a versioned offline shell. Open it online once before using it offline. Installing and offline caching require the hosted HTTPS URL; the downloadable HTML still plays independently. A first-visit consent dialog enables sound/vibration; Settings stores both preferences. Cancelable countdowns make a brief synthesized clock tick once per second, with a 25 ms vibration when vibration is enabled and sound is off. Browser/phone support and user activation govern actual playback and vibration. Whole-hand groups of three or four skip cards bypass the final-suit ordering prompt.

With Sound enabled, a short mechanical tick accompanies each suit departing its centered position downward. A slightly lower click marks each halfway resistance crossing, including the final tip forward or recoil. All three suit positions share one sound per crossing; the balance pause and final hold are silent.

Hand rows reserve only the scaled top-left face/suit height plus spacing, allowing the solver to add rows and reach the target card width. Full card bodies may extend behind the next row and fade at the bottom, while the corner regions remain unobscured at rest.
