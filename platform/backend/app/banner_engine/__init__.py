"""Banner generation engine (formerly .claude/scripts/banner-openai).

- prompts.py     — pure prompt assembly + moderation + validation (no I/O).
- engine_core.py — OpenAI gen/edit core with 429 backoff (returns PNG bytes).

Imported directly by app.engine — no sys.path juggling, no subprocess.
"""
