# Pollinations for Obsidian

Generate text and images with [Pollinations](https://pollinations.ai) inside your
notes, paying with your own Pollen.

- **Text from a prompt or straight from the selection** - the answer lands at the
  cursor, on a new line below, or by replacing the selection.
- **Images with a click** - the picture is saved into your vault and embedded in
  the note.
- **Sign in with a code** (device flow), or paste an API key. No secret is baked
  into the plugin, and the sign-in is attributed to your own app key if you set one.
- **Any model from the live lists** - a model browser inside Obsidian searches the
  text and image catalogues as they exist right now.
- **Retries and plain-language errors** - 429s, server errors and network hiccups
  are retried with backoff; every failure turns into one readable sentence.

## Requirements and disclosures

- **An account and pollen are needed.** Generation is billed to the key you paste
  or sign in with; the plugin has no free tier of its own. Create a key at
  `enter.pollinations.ai/keys`, or sign in with a device code.
- **Network use.** The plugin talks to `gen.pollinations.ai` for generation and
  `enter.pollinations.ai` for sign-in, and to no other host.
- **Keys stay on your device**, in this plugin's `data.json`. There is no
  telemetry and no analytics of any kind.
- License: MIT.

## Install

**From the community plugin directory** (once it is listed)

1. `Settings > Community plugins > Browse` and search for **Pollinations**.
2. Install, then enable it.

**With BRAT** (before it is listed)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. `BRAT > Add beta plugin` and enter `xiaotian1171/pollinations-obsidian`.

**By hand**

1. Download `main.js`, `manifest.json` and `styles.css` from the
   [latest release](https://github.com/xiaotian1171/pollinations-obsidian/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/pollinations/`.
3. Reload Obsidian and enable **Pollinations** in the community plugins list.

## Demo

A two minute run-through of everything the plugin does:

1. Enable the plugin, then open `Settings > Pollinations` and either
   - click **Sign in with a code** - a notice and a small window show a code such
     as `ABCD-1234`, you open `enter.pollinations.ai/device`, enter the code,
     approve, and the window closes by itself once the key arrives; or
   - paste an `sk_...` key from `enter.pollinations.ai/keys` into **API key**.
2. Press **Test** next to *Test the connection*. A notice reports how many text
   models are live, for example `connected, 188 text models available.`
3. In a note, put the caret where you want the answer and run the command
   **Pollinations: Generate text at the cursor** from the command palette
   (`Ctrl/Cmd+P`). Type `Name a village in one word` and press Generate. The word
   appears at the caret; the status bar reports the token usage, for example
   `Pollinations: 9 tokens`.
4. Select a paragraph, then run **Pollinations: Generate text from the
   selection** with the selection template set to `Summarise in one sentence:
   {{text}}`. The summary is inserted according to *Where generated text goes*.
5. Run **Pollinations: Generate an image and embed it**, type
   `a wooden watermill, flat illustration`, and press Generate. The image is saved
   next to the note (or in the folder you configured), embedded where the caret
   was, and a notice shows the path.
6. Run **Pollinations: Browse the live model list**, filter by publisher, and click
   **Use for text** or **Use for images** to make that model the default.

The ribbon icon on the left runs step 3 directly.

## Commands

| Command | What it does |
| --- | --- |
| Generate text at the cursor | Asks for a prompt (pre-filled with the selection) and inserts the answer |
| Generate text from the selection | Sends the selection through the selection template and inserts the answer |
| Generate text and review it before inserting | Shows the answer in a window with Insert / Copy / Discard |
| Generate an image and embed it | Asks for a prompt, saves the image into the vault and embeds it |
| Generate an image from the selection | Uses the selection as the prompt |
| Browse the live model list | Searches the live text and image catalogues and sets a default |
| Sign in with a Pollen account | Runs the device flow |
| Test the connection and count the models | One request to the model list |

## Settings

| Setting | Meaning |
| --- | --- |
| API key | Your `sk_...` key. Written by the sign-in flow, or pasted by you |
| App key | Optional `pk_...` publishable key, so sign-ins are attributed to your Pollinations account |
| Text model | Any id from the live text list. Empty means the quick default, `nova-fast` |
| Image model | Any id from the live image list. Empty means the quick default, `tongyi-mai/z-image-turbo` |
| System prompt | Sent with text requests. Empty switches to the cheaper one-shot `/text/{prompt}` route |
| Selection template | How the selection is sent; `{{text}}` is replaced with it |
| Temperature, Max tokens | Passed to chat completions. `0` tokens means no limit |
| Image folder | Vault folder for generated images. Empty means "next to the note" |
| Image size | Width and height, 64 to 4096 |
| Where generated text goes | At the cursor, on a new line below, or replacing the selection |
| Open the sign-in page in the browser | Turn off if you would rather open the link yourself |

## Signing in with a code

The device flow means the plugin never ships a key:

1. The plugin asks `/api/device/code` for a code (with your app key as
   `client_id` when one is configured).
2. You get the code in a window and a notice, and the browser opens
   `enter.pollinations.ai/device?user_code=...`.
3. The plugin polls `/api/device/token` every 5 seconds. A pending answer is
   expected and not an error; `slow_down` makes it wait longer.
4. On approval it stores the returned `sk_...` in the plugin's settings, reads
   `/api/device/userinfo` for your account name, and closes the window.

The key stays on your device, in `data.json` for this plugin only. **Sign out**
removes it; you can also revoke it on the Pollinations site.

## Errors

| Kind | Meaning | Retried |
| --- | --- | --- |
| `auth` (401, 403) | The key is missing, wrong or revoked | no |
| `balance` (402, or a body that says so) | The key is valid but out of Pollen | no |
| `rate_limit` (429) | Too many requests | yes, 0.75s then 1.5s |
| `bad_request` (400, 404, 422) | Unknown model id or bad parameters; the API's own message is shown | no |
| `server` (5xx) | Pollinations or the upstream model failed | yes |
| `network` | DNS, TLS, timeout or a dead connection | yes |
| `parse` | A 2xx answer that cannot be read | no |

Image responses are kept as bytes and never decoded as text.

## Privacy

The plugin sends only what you ask it to: your prompt, the model, and the size.
It talks to `gen.pollinations.ai` for generation and `enter.pollinations.ai` for
sign-in. There is no analytics, no telemetry and no other endpoint. Your key is
stored in this plugin's `data.json` and nowhere else.

## Tests

The logic that decides URLs, payloads, parsing, error kinds, file names and where
the answer lands is plain TypeScript in `src/api.ts` and `src/format.ts`, with no
Obsidian imports, so it runs headless:

```bash
npm install
npm run typecheck   # tsc, no errors
npm test            # 180 checks, no network and no keys
npm run test:live   # the same suite plus real API calls (needs POLLINATIONS_API_KEY)
npm run build       # tsc + esbuild -> main.js
```

`npm run test:live` is the evidence script; it prints real status codes, latencies
and payload shapes. A run produced:

- the prompt route `200` in 3.02s, `text/plain`, answer `Hello, friendly human.`
- chat `200` in 2.52s, model `us.amazon.nova-micro-v1:0`, and the answer extracted
  from `choices[0].message.content`
- `GET /text/models` `200` with 188 text models and `GET /image/models` `200` with
  77 image models, read into the same structure the model browser uses
- `GET /image/...` `200` in 0.43s, `image/jpeg`, 28 813 bytes, recognised as `jpg`
- `POST /api/device/code` `200` in 0.89s with `user_code=8ZMYESJU`, `interval=5`,
  `expires_in=1800`, then `POST /api/device/token` `400`
  `{"error":"authorization_pending"}` classified as pending, not as a failure
- `/v1/audio/speech` `402` classified as a balance failure: speech is a paid model
  and the free account used for the run has no pollen

CI runs the type check, the suite and the build on pull requests
(`.github/workflows/tests.yml`).

## Layout

```
src/api.ts        URLs, request shapes, parsing, error kinds - no Obsidian
src/format.ts     file names, templates, where text lands - no Obsidian
src/settings.ts   defaults and repair of the settings object - no Obsidian
src/main.ts       commands, modals, settings tab, sign-in, the HTTP calls
tests/run.ts      the headless suite and the live check
main.js           the built plugin, committed as the community directory requires
```

## Development

```bash
npm install
npm run dev     # esbuild watch, writes main.js
npm test        # after each change
```

## License

MIT, see [LICENSE](LICENSE).
