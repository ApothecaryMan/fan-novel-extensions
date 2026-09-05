# Fan Novel — Extensions Repository 📦

Official repository of novel extensions and sources for the **Fan Novel** application.

---

## ⚠️ Critical Rules Before Commit & Push

> [!IMPORTANT]
> **Always use signed builds for production!**  
> Never commit `docs/index.json` with `"signature": "unsigned-dev"`. The mobile application strictly verifies the cryptographic Ed25519 signature (64 bytes) against `extensionsPublicKey` in `app.json`. An unsigned or improperly signed index will cause a security rejection on user devices.

### 1. Build and Sign Command:
Whenever you add, modify, or update an extension or icon, always run:
```bash
npm run build:sign
```
*(Requires `keys/private.key` locally or `EXTENSION_SIGNING_KEY` environment variable).*

> [!WARNING]
> `npm run build` without `--sign` is solely intended for local development experiments. Do not commit dev-mode outputs to GitHub!

---

## 🖼️ Extension Icons

- **Primary Storage**: Place source icons in the `icons/` directory (e.g. `icons/kolnovel.png`, `icons/hindawi.png`, `icons/cenele.png`, `icons/novelfull.ico`).
- **Auto-Scraping & Refresh**: The build script checks the modification time of each extension file. When an extension is updated, it automatically fetches and updates the latest favicon/logo directly from the source site if needed.
- **Publishing Output**: The build script copies all icons directly to `docs/icons/` to be served via GitHub Pages.

---

## 🧪 Testing

Run test suites before pushing commits:
```bash
npm test
```
