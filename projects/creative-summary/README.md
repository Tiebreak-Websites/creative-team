# Creative Summary

Automation for the sales team: opens a Figma landing-page file, reads its content, generates a bilingual creative summary, and places the summary above the desktop frame in the Figma file itself. Gives sales colleagues a one-glance brief for what the LP is promoting without having to read the whole design.

## Status

Scaffold only — the tool has not been built yet. This folder exists as the home for that work.

## Planned behavior

1. Take a Figma file URL (or file key) as input.
2. Read text content from the file's desktop-frame nodes via the Figma API / MCP server.
3. Generate a short bilingual summary (target languages TBD — likely EN + the campaign's primary market language).
4. Place the summary as a Figma text node above the desktop frame, styled so it's readable but clearly a meta-annotation (not part of the design).

## Related

- There is an existing Anthropic skill (`anthropic-skills:creative-summary`) that describes the same flow — this project will likely wrap or extend it for our team's specific inputs and output format.
- Will need access to the Figma MCP server (already available in this project — see the `mcp__a17e5c91-...__use_figma` tool family).

## Open questions

- Which languages are required by default? (EN + ??)
- Target length — one paragraph, or structured (headline + body + CTA list)?
- Who has permission to run it against production Figma files vs. a sandbox?

Track decisions here as they're made.
