# AB-900 Practice Lab

An offline practice website built from the supplied 89-question AB-900 PDF.

## Run

From this folder:

```bash
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

The website supports:

- all 89 questions in source order;
- a fresh random half (45 questions);
- fully text-based single choice, multiple choice, Yes/No matrices, and dropdowns;
- instant grading;
- detailed text answers and explanations after submission.

The simulator intentionally grades against the answer key printed in the supplied
PDF.
