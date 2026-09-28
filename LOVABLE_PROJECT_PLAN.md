# TMAI Prompt Dashboard — Lovable Project Plan

## Architecture Overview
```
┌─────────────────┐    ┌──────────────────────┐    ┌───────────────────┐
│  Lovable UI     │    │  Google Sheets API   │    │  Netlify Functions│
│  (Dashboard)    │◄──►│  (Prompts Library)   │    │  (run-prompt.js)  │
│                 │    │                      │    │  (get-mcc-data.js)│
│  - Client Select│    │  Sheet ID:           │    └────────┬──────────┘
│  - Date Range   │    │  1uz38goOS5sO0dBRbQfDNap          │
│  - Prompt Pick  │    │  Tabs: Google Ads,│              │
│  - Report View  │    │   GA4, Meta, Staff │              │
└─────────────────┘    └──────────────────────┘      Google Ads API
                                                                  MCC 9060186325
```

## Managed Accounts (13 total)
| ID       | Name                 | Currency | Abbrev |
|----------|----------------------|----------|--------|
| 6457701262 | Tri Tool Technologies | ZAR    | TT     |
| 3938092858 | Spier E-commerce     | ZAR      | SP     |
| 1174876049 | Geddes Capital       | ZAR      | GC     |
| 8808134001 | AURA SOS             | ZAR      | AU     |
| 3199837831 | Snap Kitchen         | USD      | SK     |
| 4379852145 | 1Voucher             | ZAR      | 1V     |
| 8391694125 | Spier Hotel          | ZAR      | SH     |
| 5010689409 | Spier Destination    | ZAR      | SD     |
| 2162040364 | Fut Afrique          | ZAR      | FA     |
| 4035336692 | Tri Tool US Dollar   | USD      | TU     |
| 1039498028 | Tri Tool Inc.        | USD      | TI     |
| 1504414244 | Pesalink             | USD      | PL     |
| 8043998866 | Zapmed               | ZAR      | ZM     |

## Lovable App Design
### Page 1: Dashboard Home
- **Top bar**: TMAI logo, current user, account switcher
- **Client selector**: Dropdown of 13 managed accounts (searchable)
- **Date range**: Default 30 days, presets (7, 14, 30, 90 days)
- **Prompt library**: Tabs (Google Ads | GA4 | Meta | Staff) with category sub-tabs
- **Prompt cards**: Each shows name, description, tags
- **Generate button**: Opens report view

### Page 2: Report View
- Account name + date range header
- Loading state while report generates
- Report display (markdown formatted)
- Download/PDF export option
- "Back to prompts" button

## Data Flow
1. User selects client + date range
2. App fetches prompts from Google Sheets API
3. User clicks a prompt → calls Netlify `run-prompt` function:
   ```
   POST https://tmai.ltd/.netlify/functions/run-prompt
   {
     "accountId": "8808134001",
     "account": "AURA SOS",
     "days": 30,
     "prompt": "Deep Account Audit...",
     "promptName": "Deep Account Audit",
     "channel": "Google Ads"
   }
   ```
4. Response renders in report view

## Google Sheets API Setup
1. Go to https://console.cloud.google.com/apis/credentials?project=tmai-dashboard
2. Create **API Key** (restricted to Sheets API)
3. Restrict to IP if needed (or leave unrestricted for Sheets read)
4. Share Sheet `1uz38goOS5sO0dBRbQfDNap96yMu-8psS5sKjzOOkfho` with "Anyone with the link can view"
5. Use in Lovable fetch:
   ```
   https://sheets.googleapis.com/v4/spreadsheets/1uz38goOS5sO0dBRbQfDNap96yMu-8psS5sKjzOOkfho/values/Google%20Ads?key=YOUR_API_KEY
   ```

## Lovable Project Prompt
```
Build a Google Ads Agency Prompt Dashboard (TMAI)

Design: Professional dark navy (#001A24) with gold accents (#FBAD1B) and teal (#008398)
Font: Inter

Pages:
1. Dashboard Home:
   - Top navigation bar with TMAI branding
   - Left sidebar: Client account selector (dropdown, searchable) with 13 accounts
   - Main area: Date range picker (7/14/30/90 day presets)
   - Tab navigation: Google Ads | GA4 | Meta & Instagram | Staff Dashboards
   - Each tab shows category sub-tabs (Ad Copy, Analysis, Audits, Keywords, etc.)
   - Prompt cards grid: each card shows prompt name, description, tags
   - Click prompt → modal with full prompt text and "Generate Report" button

2. Report View:
   - Account header with name, account ID, date range
   - Loading animation while report generates
   - Formatted report display area
   - Export/Print button
   - Back to dashboard button

Data:
- Prompts fetched from Google Sheets API:
  https://sheets.googleapis.com/v4/spreadsheets/1uz38goOS5sO0dBRbQfDNap96yMu-8psS5sKjzOOkfho/values/{sheet}?key={API_KEY}
- Reports generated via Netlify function:
  POST https://tmai.ltd/.netlify/functions/run-prompt
  Body: { accountId, account, days, prompt, promptName, channel, category }

Client accounts (dropdown options):
- Tri Tool Technologies (6457701262)
- Spier E-commerce (3938092858)
- Geddes Capital (1174876049)
- AURA SOS (8808134001)
- Snap Kitchen (3199837831)
- 1Voucher (4379852145)
- Spier Hotel (8391694125)
- Spier Destination (5010689409)
- Fut Afrique (2162040364)
- Tri Tool US Dollar (4035336692)
- Tri Tool Inc. (1039498028)
- Pesalink (1504414244)
- Zapmed (8043998866)

Use React + Tailwind CSS, modern dashboard design, responsive layout.
```