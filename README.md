# AZ-900 / AB-900 / AI-901 / SC-900 Practice Lab

An interactive practice website built from the supplied AZ-900, AB-900, AI-901, and SC-900 PDFs.

## Run

From this folder:

```bash
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

The website supports:

- switching between 297 AZ-900, 89 AB-900, 52 AI-901, and 254 SC-900 source questions;
- full randomized exams or custom runs from 1 question up to the whole bank;
- fully text-based single choice, multiple choice, Yes/No matrices, and dropdowns;
- expandable, answer-safe source PDF screenshots for AZ-900, AI-901, and SC-900 questions;
- optional per-question timer and answer checking;
- smart and all-time wrong-answer practice modes;
- detailed text answers and explanations after submission.
- an admin dashboard for user profiles, question reports, and Firestore-based question edits.

## Admin

Sign in with:

- username: `thegoodstuff`
- password: `rasta299`
- access token: `thegoodstuff`

The Admin button appears in the header after login. Edits and removals are stored in Firestore as question
overrides, so the source JSON files remain unchanged while users see the corrected bank after loading the app.

The simulator intentionally grades against the answer key printed in the supplied
PDF. Questions 17, 73, and 114 in the AZ-900 source contain internal answer-key
contradictions; their review explanations call these out explicitly.
