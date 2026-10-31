# Eskender · Updates from Mikhail

Hey Eskender! This is everything new on the AeroGuard dashboard and how to open it on your laptop.
Takes 2 minutes, works on **Windows** and **Mac**, nothing to install, no keys, no wallet.

---

## 1 · Open the dashboard

You need access to the repo first (Mikhail adds you as a collaborator; accept the email invite).

### Windows

1. Go to **https://github.com/womp-maindev/aeroguard** → green **Code** button → **Download ZIP**.
2. In *Downloads*, **right-click the ZIP → Extract All… → Extract**.
   (Don't run anything from inside the ZIP, it won't work.)
3. Open the extracted folder `aeroguard-main` → folder **`web`** → double-click **`start.bat`**.
4. If a blue box says *"Windows protected your PC"*: click **More info → Run anyway**.
5. A black window opens and the dashboard opens in your browser at **http://localhost:8080**.
   **Keep the black window open** while you look. Close it to stop.

`start.bat` runs a tiny web server inside PowerShell (`serve.ps1`), which every Windows has.

### Mac

1. Go to **https://github.com/womp-maindev/aeroguard** → **Code** → **Download ZIP** (Safari unzips it by itself).
2. Open **Terminal** (⌘ Space → "Terminal") and paste:

   ```bash
   cd ~/Downloads/aeroguard-main/web && bash start.command
   ```

3. The dashboard opens at **http://localhost:8080**. Leave Terminal open; press **Ctrl + C** to stop.

Double-clicking `start.command` in Finder works too, but macOS blocks downloaded scripts the first time
(fix: **System Settings → Privacy & Security → Open Anyway**). The Terminal line above avoids that.

### Alternative: GitHub Codespaces (runs in the browser, nothing on your laptop)

Open **https://codespaces.new/womp-maindev/aeroguard?quickstart=1** → *Create codespace*. After ~1–2 minutes the
dashboard opens in a new tab by itself (if not: **Ports** tab → *Dashboard* → 🌐).

### With git (if you prefer)

```bash
git clone https://github.com/womp-maindev/aeroguard
```

Then run `web/start.bat` (Windows) or `bash web/start.command` (Mac). Later updates: `git pull`.

---

## 2 · What you should see

| Where | Expected |
|---|---|
| Top right | green dot **Live · Base Sepolia** (the page reads the real contract straight from your browser) |
| *Policies* | the live policies (IB1314, LH1816, EI357, BA955) with status and Basescan links |
| *Tamper lab* → big button **Try to steal from this contract** | a big green **🛡 4 / 4 BLOCKED** (it picks a live policy with a real signed proof). On the projector, the QR next to it opens the same thing on a phone |
| *Tamper lab* → **Run the 4 attacks** | 4 × **REVERTED**: `NotSignedByAirnode`, `WrongRequest`, `NotSignedByAirnode`, `Stale` |
| *Tamper lab* → **Simulate genuine** (policy #1) | `NotFinal(Expected)`: its proof is a pre-departure status, so it can't pay |
| *Inspector* → **Load real Airnode proof** | ✅ *Signed by the AeroDataBox Airnode*; then change one digit in `data` → ❌ |
| *Cardano* → **Open in Inspector** | the same signed evidence loads into the Inspector |

If something looks different, send Mikhail a screenshot of the page and of the black window / Terminal.

---

## 3 · Updates from Mikhail

**Works without our server.** The dashboard used to be empty unless the keeper API ran locally. Now it reads
everything from the chain itself:
- policies, counters and pool capital via `eth_call` to Base Sepolia (contract
  `0x257054204c4Cd43846C4553eBe6D709841980a80`), refreshed every 20 s;
- **Tamper lab** sends each forgery to the deployed contract as a simulated `settle()` call. No key, no gas, nothing
  written. Settled policies can be "reopened" for the simulation, so the attack demo still works after tonight's
  payouts; *Genuine* can be replayed at the moment it was signed;
- **Inspector** has the real AirnodeHub-signed proof of policy #1 built in;
- **Keeper log** comes from the GitHub Actions keeper runs (shown once the repo is public; until then there is a
  link to the Actions page).

**New Cardano section.** `GET /verdict` → **402 Payment Required** (2 tADA on Cardano preprod) → agent pays → verdict
plus the Airnode signature → **Open in Inspector** to verify it yourself.

**New design.** White-grey sky with hand-drawn planes flying in the background, the payout rule as a boarding pass
(LATE → PAID), fonts from womp.solutions (Kelly Slab, Jost, Caveat), *made by WompSolutions & Eskender* in the footer
with a link to womp.solutions.

**Mobile.** Checked at 390 px (iPhone): buttons stacked and equal width, no sideways scrolling.

**Pitch mode.** "Try to steal from this contract": one button, four forgeries on a live policy, a big 4 / 4 BLOCKED. QR for the slides: `docs/img/qr-try-to-cheat.png`. Live screenshots for the README and Devfolio are in `docs/img/` (taken by the *Dashboard screenshots* workflow against Base Sepolia).

**Sharing.** Link preview image (`og.png`), favicon, Devfolio cover 1200×630 (`web/img/devfolio-cover.png`) and
screenshots in `web/img/`.

**Hosting, ready to switch on.** GitHub Pages (once the repo is public), Cloudflare Pages (needs two secrets),
Codespaces (works now). Details: [`web/README.md`](web/README.md).

---

## 4 · If something goes wrong

| Problem | Fix |
|---|---|
| Red dot **Chain unreachable** | Your network blocks `sepolia.base.org` (some uni / company Wi-Fi). Try a phone hotspot. The Inspector still works offline. |
| `start.bat` flashes and closes | You ran it inside the ZIP. Extract first (step 2). |
| "Windows protected your PC" | **More info → Run anyway**. |
| Mac: "cannot be opened" | Use the Terminal line from the Mac steps. |
| Mac: "python3 not found" / install prompt | Let it install the command line tools, or ignore: the script then opens the page directly (only the fonts differ). |
| Port 8080 busy | Nothing to do: both scripts pick the next free port and print the address. |
| Page looks old | Download the ZIP again (or `git pull`) and reload with **Ctrl + F5** / **⌘ Shift R**. |
| *Cover me* is missing | On purpose: buying needs the keeper wallet, so that part only shows with the local keeper API (`cd keeper && npm i && npm run api`, needs the `.env`). |

---

Hackathon prototype on testnet (aUSD on Base Sepolia, tADA on Cardano preprod). No real money moves.
