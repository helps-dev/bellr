# bellr.fun

The interface for [BELLR](https://github.com/helps-dev/bellr) — Uniswap v4 hooks
that read the US trading calendar, live on Robinhood Chain.

A stock-paired pool keeps quoting after the equity market closes and nobody can
hedge. BELLR makes the pool change its own rules at the bell: fees widen, size
caps bite, and a halted stock stops the pool with it.

## Live contracts — Robinhood Chain (4663)

| | |
| --- | --- |
| `BellrPool` | `0x5B515cD5121efcbd1bA037be5a62d76258d220c4` |
| `TollHook` | `0xC741bc587588981F096a8EB8b0bf374B5d22a080` |
| `SessionCalendar` | `0xd9c0421A5759b1aA2609162BD2178f147cd7E542` |
| `BellrOracle` | `0x55F4B8e88B7F1C50740a6909dB25E187D79015d0` |

The hook addresses end in `2080` and `20C4` because Uniswap v4 reads a hook's
permissions off its own address. They were mined, not chosen.

**There is no BELLR token.** Arming a pool costs gas and nothing else.

## Running it

No build step. Plain HTML, CSS and ES modules.

```bash
python3 -m http.server 8000     # or any static server
```

The page computes the US market calendar in the browser, so it works with no
backend at all. A read API can be pointed at it for live pool data:

```html
<script>window.BELLR_API = 'https://your-indexer';</script>
```

Otherwise it skips the call rather than making every visitor's browser try to
reach their own machine.
