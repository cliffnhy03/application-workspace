# Application Workspace

A desktop app for graduate job applications. Each company gets its own page holding
its deadline, next step, the exact tailored CV and cover letter you sent, and your
research notes for the interview.

- **Works offline, private by default.** No account, no server. Everything is saved
  on your own laptop.
- **Stores your files.** Drop a CV onto a company page and the app keeps its own copy,
  so moving or deleting the original won't break anything.
- **Master documents.** Keep your base CV and cover letter in Documents, copy one onto
  an application, then tailor the copy.
- **Fast to get around.** Press <kbd>⌘K</kbd> (Mac) or <kbd>Ctrl K</kbd> (Windows) and type
  a company, file name or action to jump straight to it.

---

## For students: install it

Download the installer from the **Releases** page (link from whoever shared this with you).

### Mac (`Application-Workspace-x.y.z.dmg`)
1. Open the `.dmg` and drag **Application Workspace** into **Applications**.
2. Open it from Applications. Because the app isn't registered with Apple (that costs $99 a
   year), macOS blocks the first launch:
   - Click **Done** on the warning.
   - Open **System Settings › Privacy & Security**, scroll down and click **Open Anyway**
     next to "Application Workspace was blocked".
   - Confirm with your password. You only need to do this once.
3. If macOS says the app **"is damaged"**, open Terminal and run the command below, then open the app again:
   ```bash
   xattr -cr "/Applications/Application Workspace.app"
   ```

### Windows (`Application-Workspace-Setup-x.y.z.exe`)
1. Run the installer. If **Windows protected your PC** appears, click **More info › Run anyway**
   (the app isn't code-signed).
2. Pick an install folder and finish. It appears in the Start menu.

### Getting started
1. **Documents → Add master document**: add your base CV and cover letter.
2. **New application** (<kbd>⌘N</kbd> / <kbd>Ctrl N</kbd>): add a company, role and deadline.
3. On the company page, use **From library…** to copy your master CV across. Open it to
   tailor it, or drop in the tailored PDF you actually sent.
4. Write your research in **Research notes**. **Insert research template** gives you a structure.
5. Move the application along with **Move to …**, or click any stage on the progress bar
   (Shortlisted → Applied → Online test → Video interview → Interview → Offer). Clicked the wrong
   one? Press **Undo** on the message that pops up, or **Back to …** to step back a stage.

Want to look around first? **Explore with sample data** loads invented applications,
and you can clear them in one click.

### Keyboard shortcuts
| Mac | Windows | Does |
|---|---|---|
| ⌘K | Ctrl K | Quick find: any company, file or action |
| ⌘N | Ctrl N | New application |
| ⌘1 / ⌘2 / ⌘3 | Ctrl 1 / 2 / 3 | Dashboard / Applications / Documents |
| ⌘, | Ctrl , | Settings & backup |
| / | / | Search applications |
| ↑ ↓ | ↑ ↓ | Move through the application list |

### Back up your data
Everything lives on your laptop only. **Settings & backup → Back up now** copies the
whole workspace (tracker and files) to a folder you pick. A OneDrive, Google Drive or
iCloud folder works well. To move to a new laptop, install the app there and use
**Restore**.

Where the data is stored:
- Mac: `~/Library/Application Support/Application Workspace/workspace`
- Windows: `%APPDATA%\Application Workspace\workspace`

Inside are `workspace.json` (the tracker, readable in any text editor) and `files/`
(your stored documents).

---

## For maintainers: run, build, share

Needs Node.js 20 or newer.

```bash
npm install
npm start          # run the app
npm test           # backend tests
npm run dist:mac   # build dist/Application-Workspace-x.y.z.dmg (universal: Intel + Apple Silicon)
npm run dist:win   # build the Windows installer (most reliable on Windows or in CI)
```

### Sharing with your cohort (recommended: GitHub Releases)
1. Create a GitHub repository and push this folder to it.
2. Bump `version` in `package.json`, then tag and push:
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```
3. The workflow in `.github/workflows/release.yml` builds the Mac `.dmg` and the Windows `.exe`
   and attaches them to a Release. Send people the Releases page link, which always has the latest version.

Without GitHub, you can share the `.dmg` from `dist/` directly (Google Drive, Teams, etc.).
Updating is just installing the new version over the old one. Data is kept between versions.

### How it fits together
| File | Role |
|---|---|
| `src/store.js` | Backend: tracker data in `workspace.json` (atomic writes), file storage, backup/restore. No Electron dependency, covered by `test/store.test.js`. |
| `src/main.js` | Electron main process: window, menus and shortcuts, file dialogs, opening files, IPC handlers. |
| `src/preload.js` | The narrow, typed bridge exposed to the window as `window.api`. |
| `src/renderer/` | Interface: `index.html`, `styles.css`, `app.js` (no framework, no build step). |
| `scripts/screenshot.js` | Drives the real app on throwaway data and saves screenshots of every view. |
| `scripts/make-icon.js` | Renders `build/icon.svg` to `build/icon.png`. |
